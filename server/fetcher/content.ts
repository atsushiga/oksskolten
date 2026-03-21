import Piscina from 'piscina'
import { JSDOM } from 'jsdom'
import { fetchHtml } from './http.js'
import { fetchViaFlareSolverr } from './flaresolverr.js'
import type { CleanerConfig } from '../lib/cleaner/selectors.js'
import type { ParseHtmlInput, ParseHtmlResult } from './contentWorker.js'

// Worker pool for CPU-intensive DOM parsing (jsdom + Readability + Turndown).
// Runs on separate threads so the main event loop stays responsive for API requests.
// Inherit the parent's execArgv so the tsx TypeScript loader is available in workers.
const pool = new Piscina({
  filename: new URL('./contentWorker.ts', import.meta.url).href,
  execArgv: process.execArgv,
  maxThreads: Number(process.env.PARSE_MAX_THREADS) || 2,
})

/** Per-task timeout for worker pool. */
const WORKER_TIMEOUT_MS = 45_000

/**
 * Strip heavy non-content tags before passing HTML to the worker thread.
 * This runs on the main thread with simple regex (no DOM parsing), so it's fast.
 * Removes clearly non-content shells before Readability to reduce parse time.
 */
export function stripHeavyTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<aside[\s\S]*?<\/aside>/gi, '')
    .replace(/<dialog[\s\S]*?<\/dialog>/gi, '')
    .replace(/<form[\s\S]*?<\/form>/gi, '')
    .replace(/<template[\s\S]*?<\/template>/gi, '')
    .replace(/<canvas[\s\S]*?<\/canvas>/gi, '')
}

function normalizeStructuredText(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

interface StructuredArticleData {
  fullText: string | null
  title: string | null
}

function htmlToPlainText(value: string): string {
  return normalizeStructuredText(
    value
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
}

function extractStructuredArticleData(html: string): StructuredArticleData {
  const scripts = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
  let bestText: string | null = null
  let bestTitle: string | null = null

  function visit(node: unknown) {
    if (!node) return
    if (Array.isArray(node)) {
      for (const item of node) visit(item)
      return
    }
    if (typeof node !== 'object') return

    const obj = node as Record<string, unknown>
    if (obj['@graph']) visit(obj['@graph'])

    const typeValue = obj['@type']
    const types = Array.isArray(typeValue) ? typeValue.map(String) : typeValue ? [String(typeValue)] : []
    const isArticle = types.some(type => /article|newsarticle|reportagenewsarticle|analysisnewsarticle/i.test(type))
    if (!isArticle) {
      for (const value of Object.values(obj)) {
        if (typeof value === 'object') visit(value)
      }
      return
    }

    const articleBody = typeof obj.articleBody === 'string' ? normalizeStructuredText(obj.articleBody) : null
    const headline = typeof obj.headline === 'string' ? obj.headline.trim() : typeof obj.name === 'string' ? obj.name.trim() : null
    if (articleBody && (!bestText || articleBody.length > bestText.length)) {
      bestText = articleBody
      bestTitle = headline || bestTitle
    }
  }

  for (const match of scripts) {
    const raw = match[1]?.trim()
    if (!raw) continue
    try {
      visit(JSON.parse(raw))
    } catch {
      // Ignore malformed JSON-LD blocks.
    }
  }

  return { fullText: bestText, title: bestTitle }
}

function parseJsonLikeScript(raw: string): unknown | null {
  const trimmed = raw.trim().replace(/;\s*$/, '')
  const candidates = [
    trimmed,
    trimmed.match(/^[^{[]*=\s*([\s\S]+)$/)?.[1]?.trim(),
    trimmed.match(/JSON\.parse\((["'`])([\s\S]+)\1\)/)?.[2],
  ].filter(Boolean) as string[]

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate)
    } catch {
      // Try next candidate.
    }
  }
  return null
}

function extractEmbeddedArticleData(html: string): StructuredArticleData {
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
  let bestText: string | null = null
  let bestTitle: string | null = null

  function maybeUseText(text: string | null, title: string | null) {
    if (!text) return
    const normalized = text.includes('<') ? htmlToPlainText(text) : normalizeStructuredText(text)
    if (!normalized) return
    if (!bestText || normalized.length > bestText.length) {
      bestText = normalized
      bestTitle = title || bestTitle
    }
  }

  function visit(node: unknown, inheritedTitle: string | null = null) {
    if (!node) return
    if (Array.isArray(node)) {
      for (const item of node) visit(item, inheritedTitle)
      return
    }
    if (typeof node !== 'object') return

    const obj = node as Record<string, unknown>
    const localTitle =
      (typeof obj.headline === 'string' && obj.headline.trim()) ||
      (typeof obj.title === 'string' && obj.title.trim()) ||
      (typeof obj.name === 'string' && obj.name.trim()) ||
      inheritedTitle

    const candidates = [
      obj.articleBody,
      obj.body,
      obj.content,
      obj.contents,
      obj.renderedBody,
      obj.serializedBody,
      obj.description,
    ]

    for (const candidate of candidates) {
      if (typeof candidate === 'string') maybeUseText(candidate, localTitle)
    }

    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string') {
        const looksLikeBodyKey = /articlebody|body|content|contents|description|html/i.test(key)
        if (looksLikeBodyKey && value.length >= 200) maybeUseText(value, localTitle)
      } else if (typeof value === 'object') {
        visit(value, localTitle)
      }
    }
  }

  for (const match of scripts) {
    const raw = match[1]?.trim()
    if (!raw || raw.length < 20) continue
    const parsed = parseJsonLikeScript(raw)
    if (parsed) visit(parsed)
  }

  return { fullText: bestText, title: bestTitle }
}

function isHeading(el: Element): el is HTMLElement {
  return /^H[1-6]$/i.test(el.tagName)
}

function headingLevel(el: Element | null): number {
  if (!el) return 6
  if (isHeading(el)) return Number(el.tagName[1])
  if (el.getAttribute('role') === 'heading') {
    const ariaLevel = Number(el.getAttribute('aria-level') || '6')
    return Number.isFinite(ariaLevel) && ariaLevel > 0 ? ariaLevel : 6
  }
  return 6
}

function isBoundaryHeading(el: Element, targetLevel: number): boolean {
  return headingLevel(el) <= targetLevel
}

/**
 * For anchor-link documents like changelogs, extract only the targeted section.
 * This avoids sending the entire page history to jsdom + Readability.
 */
export function extractAnchoredContentHtml(html: string, articleUrl: string): string {
  const url = new URL(articleUrl)
  const hash = url.hash.replace(/^#/, '')
  if (!hash) return html

  const dom = new JSDOM(html, { url: articleUrl })
  const doc = dom.window.document
  const target = doc.getElementById(hash)
  if (!target) return html

  const start = isHeading(target) ? target : (target as Element).closest('h1, h2, h3, h4, h5, h6, [role="heading"]') || target
  const targetLevel = headingLevel(start)

  let endBoundary: Element | null = null
  let current: Element | null = start
  while ((current = current!.nextElementSibling)) {
    if (isBoundaryHeading(current, targetLevel)) {
      endBoundary = current
      break
    }
  }

  const range = doc.createRange()
  range.setStartBefore(start)
  if (endBoundary) range.setEndBefore(endBoundary)
  else range.setEndAfter(doc.body.lastElementChild || doc.body)

  const fragment = doc.createElement('article')
  fragment.append(range.cloneContents())
  const fragmentHtml = fragment.innerHTML.trim()
  if (!fragmentHtml) return html

  const ogTags = [
    doc.querySelector('meta[property="og:image"]')?.outerHTML,
    doc.querySelector('meta[property="og:title"]')?.outerHTML,
  ].filter(Boolean).join('\n')
  const title = doc.querySelector('title')?.textContent || ''

  return `<!DOCTYPE html>
<html>
<head>
<title>${title}</title>
${ogTags}
</head>
<body>
<article>
${fragmentHtml}
</article>
</body>
</html>`
}

export interface FetchFullTextOptions {
  cleanerConfig?: CleanerConfig
  requiresJsChallenge?: boolean
  html?: string
}

export async function fetchFullText(articleUrl: string, options?: FetchFullTextOptions): Promise<ParseHtmlResult> {
  const cleanerConfig = options?.cleanerConfig
  const requiresJsChallenge = options?.requiresJsChallenge ?? false

  // Step 1: Fetch HTML (async I/O, non-blocking — stays on main thread)
  const html = options?.html ?? (await fetchHtml(articleUrl, { useFlareSolverr: requiresJsChallenge })).html
  const structured = extractStructuredArticleData(html)
  const embedded = extractEmbeddedArticleData(html)
  const extractedHtml = extractAnchoredContentHtml(html, articleUrl)
  const cleanedHtml = stripHeavyTags(extractedHtml)

  // Step 2: Parse HTML in worker thread (CPU-intensive, off main thread)
  const input: ParseHtmlInput = { html: cleanedHtml, articleUrl, cleanerConfig }
  const result: ParseHtmlResult = await pool.run(input, { signal: AbortSignal.timeout(WORKER_TIMEOUT_MS) })

  // Step 3: FlareSolverr fallback if extracted text is too short or looks like garbage
  const extractedLen = result.fullText.replace(/\s+/g, ' ').trim().length
  const needsRetry = extractedLen < 200 || isGarbageExtraction(result.fullText)
  const structuredLen = structured.fullText?.replace(/\s+/g, ' ').trim().length || 0
  const embeddedLen = embedded.fullText?.replace(/\s+/g, ' ').trim().length || 0
  if (structured.fullText && structuredLen > extractedLen * 1.5 && structuredLen >= 400) {
    return {
      fullText: structured.fullText,
      ogImage: result.ogImage,
      excerpt: structured.fullText.slice(0, 200).trim() || null,
      title: structured.title || result.title,
    }
  }
  if (embedded.fullText && embeddedLen > extractedLen * 1.5 && embeddedLen >= 400) {
    return {
      fullText: embedded.fullText,
      ogImage: result.ogImage,
      excerpt: embedded.fullText.slice(0, 200).trim() || null,
      title: embedded.title || result.title,
    }
  }
  if (needsRetry && !requiresJsChallenge) {
    const flare = await fetchViaFlareSolverr(articleUrl, {
      waitForSelector: 'article, main, [role="main"], .post-content, .entry-content',
    })
    if (flare) {
      const flareHtml = stripHeavyTags(extractAnchoredContentHtml(flare.body, articleUrl))
      const flareInput: ParseHtmlInput = { html: flareHtml, articleUrl, cleanerConfig }
      const flareResult: ParseHtmlResult = await pool.run(flareInput, { signal: AbortSignal.timeout(WORKER_TIMEOUT_MS) })
      const flareLen = flareResult.fullText.replace(/\s+/g, ' ').trim().length
      if (flareLen > extractedLen) {
        return flareResult
      }
    }
  }

  return result
}

/**
 * Detect garbage extraction: text that is mostly code/scripts with little natural prose.
 * Strips markdown code fences and checks if remaining text has enough prose sentences.
 * A legitimate blog post about JS has explanatory sentences outside code blocks;
 * garbage extraction from leaked scripts has almost none.
 */
function isGarbageExtraction(text: string): boolean {
  // Bot detection / form submission pages
  if (isBotBlockPage(text)) return true

  // Strip markdown code blocks (```...```)
  const withoutCodeBlocks = text.replace(/```[\s\S]*?```/g, '')
  // Strip inline code (`...`)
  const withoutInlineCode = withoutCodeBlocks.replace(/`[^`]+`/g, '')

  const prose = withoutInlineCode.replace(/\s+/g, ' ').trim()
  if (prose.length === 0) return true

  // Count prose sentences: sequences ending with sentence-final punctuation
  // that contain at least a few word-like tokens
  const sentences = prose.match(/[^.!?。！？]+[.!?。！？]/g) || []
  const proseSentences = sentences.filter(s => {
    const words = s.trim().split(/\s+/)
    return words.length >= 3
  })

  // A real article should have at least a handful of prose sentences
  if (proseSentences.length < 3) return true

  // Check ratio: if prose (outside code fences) is tiny relative to total text, likely garbage
  if (prose.length < text.length * 0.1) return true

  return false
}

/** Detect bot-block / form-submission pages that Readability mistakenly extracts. */
export function isBotBlockPage(text: string): boolean {
  const lower = text.toLowerCase()
  const patterns = [
    'your submission has been received',
    'something went wrong while submitting',
    'please verify you are a human',
    'checking your browser',
    'enable javascript and cookies',
    'just a moment',
    'attention required',
    'access denied',
  ]
  return patterns.some(p => lower.includes(p))
}
