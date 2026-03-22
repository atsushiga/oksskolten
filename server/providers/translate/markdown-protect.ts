/**
 * Markdown-safe translation orchestrator.
 *
 * Pipeline: marked() → translate (format:html) → Turndown → MD
 * Uses mature libraries. Same pattern as RSS fetch pipeline.
 */

import { marked } from 'marked'
import TurndownService from 'turndown'
import { fixBoldBoundaries, fixUnpairedEmphasis } from './markdown-to-tagged.js'

// Turndown instance (same config as RSS fetcher in content.ts)
const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' })
turndown.keep(['table', 'thead', 'tbody', 'tr', 'th', 'td'])

export interface TranslateChunkFn {
  (chunk: string): Promise<{ translated: string; characters: number }>
}

export interface TranslateResult {
  translated: string
  characters: number
}

export interface TranslateWithProtectionOptions {
  isChunkWithinLimit?: (chunkHtml: string) => boolean
}

/**
 * High-level orchestrator.
 * Providers only need to supply a chunk-level translation callback.
 */
export async function translateWithProtection(
  text: string,
  maxCharsPerRequest: number,
  translateChunk: TranslateChunkFn,
  options?: TranslateWithProtectionOptions,
): Promise<TranslateResult> {
  // Split at Markdown level first, then refine further if provider-specific
  // request-size constraints reject the rendered HTML chunk.
  const pendingChunks = splitIntoChunks(text, maxCharsPerRequest)

  const translatedHtmlParts: string[] = []
  let totalCharacters = 0

  while (pendingChunks.length > 0) {
    const mdChunk = pendingChunks.shift()!
    const html = await marked(mdChunk)
    if (options?.isChunkWithinLimit && !options.isChunkWithinLimit(html) && mdChunk.length > 1) {
      prependChunks(pendingChunks, splitChunkSmaller(mdChunk))
      continue
    }
    const result = await translateChunk(html)
    translatedHtmlParts.push(result.translated)
    totalCharacters += result.characters
  }

  // Clean up common API artifacts before turndown
  let translatedHtml = translatedHtmlParts.join('\n')
  // APIs may insert whitespace between <pre> and <code>, breaking fenced code detection
  translatedHtml = translatedHtml.replace(/<pre>\s*<code/g, '<pre><code')

  // Convert all translated HTML back to Markdown
  let translated = turndown.turndown(translatedHtml)

  // Fix marked rendering issues with CJK punctuation at ** boundaries
  translated = fixBoldBoundaries(translated)
  translated = fixUnpairedEmphasis(translated)

  return { translated, characters: totalCharacters }
}

// ---------------------------------------------------------------------------
// Chunk splitting
// ---------------------------------------------------------------------------

function splitIntoChunks(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text]

  const paragraphs = text.split('\n\n')
  const chunks: string[] = []
  let current = ''

  for (const para of paragraphs) {
    if (current.length + para.length + 2 > maxChars && current.length > 0) {
      chunks.push(current)
      current = para
    } else {
      current = current ? current + '\n\n' + para : para
    }
  }
  if (current) chunks.push(current)

  return chunks
}

function prependChunks(queue: string[], chunks: string[]) {
  for (let i = chunks.length - 1; i >= 0; i--) {
    queue.unshift(chunks[i])
  }
}

function splitChunkSmaller(text: string): string[] {
  const byParagraph = splitAtNearestBoundary(text, /\n\n/g)
  if (byParagraph) return byParagraph

  const byLine = splitAtNearestBoundary(text, /\n/g)
  if (byLine) return byLine

  const bySentence = splitAtNearestBoundary(text, /(?<=[.!?。！？])\s+/g)
  if (bySentence) return bySentence

  const byWhitespace = splitAtNearestBoundary(text, /\s+/g)
  if (byWhitespace) return byWhitespace

  const middle = Math.floor(text.length / 2)
  return [text.slice(0, middle), text.slice(middle)]
}

function splitAtNearestBoundary(text: string, pattern: RegExp): [string, string] | null {
  const boundaries: number[] = []
  for (const match of text.matchAll(pattern)) {
    const index = match.index
    if (index == null) continue
    boundaries.push(index + match[0].length)
  }
  if (boundaries.length === 0) return null

  const middle = text.length / 2
  let splitIndex = boundaries[0]
  for (const boundary of boundaries) {
    if (boundary <= 0 || boundary >= text.length) continue
    if (Math.abs(boundary - middle) < Math.abs(splitIndex - middle)) {
      splitIndex = boundary
    }
  }
  if (splitIndex <= 0 || splitIndex >= text.length) return null

  const left = text.slice(0, splitIndex).trimEnd()
  const right = text.slice(splitIndex).trimStart()
  if (!left || !right) return null
  return [left, right]
}
