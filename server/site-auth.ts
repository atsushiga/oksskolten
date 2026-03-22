import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { deleteSetting, getSetting, upsertSetting } from './db/settings.js'
import { safeFetch } from './fetcher/ssrf.js'

const SETTINGS = {
  profiles: 'site_access.profiles',
  legacyEnabled: 'site_access.enabled',
  legacyTargetDomains: 'site_access.target_domains',
  legacyCookieEncrypted: 'site_access.cookie_encrypted',
  encryptionKey: 'system.data_encryption_key',
} as const

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const TEST_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36'
const TEST_TIMEOUT = 15_000

interface StoredSiteAccessProfile {
  id: string
  name: string
  enabled: boolean
  targetDomains: string[]
  cookieEncrypted: string | null
  browserCookiesEncrypted: string | null
  browserStorageEncrypted: string | null
  userAgent: string | null
  lastSyncAt: string | null
}

export interface SiteAccessProfile {
  id: string
  name: string
  enabled: boolean
  configured: boolean
  targetDomains: string[]
  cookie: string | null
  userAgent: string | null
}

export interface SiteAccessConfig {
  profiles: SiteAccessProfile[]
}

export interface SiteAccessProfileInput {
  id?: string
  name?: string
  enabled?: boolean
  targetDomains?: string[]
  cookie?: string | null
  userAgent?: string | null
}

export interface SiteAccessTestResult {
  ok: boolean
  code: 'OK' | 'AUTH_REJECTED' | 'AUTH_REQUIRED' | 'HTTP_ERROR'
  status: number
  url: string
  finalUrl?: string | null
  message: string
  title?: string | null
  preview?: string | null
  htmlLength?: number
  previewLength?: number
  matchedDomain?: string | null
  profileName?: string | null
}

export interface ImportedSiteCookie {
  name: string
  value: string
  domain?: string | null
  path?: string | null
}

function normalizeDomain(input: string): string {
  return input.trim().toLowerCase().replace(/^\.+/, '').replace(/\.+$/, '')
}

export function parseTargetDomains(input: string): string[] {
  return [...new Set(
    input
      .split(/[\n,\s]+/)
      .map(normalizeDomain)
      .filter(Boolean),
  )]
}

export function isValidTargetDomain(input: string): boolean {
  const domain = normalizeDomain(input)
  if (!domain) return false
  if (domain.includes('/') || domain.includes(':')) return false
  if (domain.length > 253) return false
  return domain.split('.').every(label =>
    label.length > 0 &&
    label.length <= 63 &&
    /^[a-z0-9-]+$/.test(label) &&
    !label.startsWith('-') &&
    !label.endsWith('-'),
  )
}

function getOrCreateDataEncryptionKey(): Buffer {
  const existing = getSetting(SETTINGS.encryptionKey)
  if (existing) return Buffer.from(existing, 'base64url')
  const generated = randomBytes(32).toString('base64url')
  upsertSetting(SETTINGS.encryptionKey, generated)
  return Buffer.from(generated, 'base64url')
}

function encryptSecret(secret: string): string {
  const key = getOrCreateDataEncryptionKey()
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join('.')
}

function decryptSecret(payload: string): string {
  const [version, ivRaw, tagRaw, encryptedRaw] = payload.split('.')
  if (version !== 'v1' || !ivRaw || !tagRaw || !encryptedRaw) {
    throw new Error('Invalid encrypted payload')
  }
  const key = getOrCreateDataEncryptionKey()
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivRaw, 'base64url'))
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'))
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, 'base64url')),
    decipher.final(),
  ])
  return decrypted.toString('utf8')
}

function randomId(): string {
  return randomBytes(8).toString('hex')
}

function readStoredProfiles(): StoredSiteAccessProfile[] {
  const raw = getSetting(SETTINGS.profiles)
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) {
        return parsed
          .filter((item): item is StoredSiteAccessProfile => typeof item === 'object' && item !== null)
          .map(item => ({
            id: typeof item.id === 'string' && item.id ? item.id : randomId(),
            name: typeof item.name === 'string' ? item.name : '',
            enabled: item.enabled !== false,
            targetDomains: Array.isArray(item.targetDomains)
              ? item.targetDomains.map(String).map(normalizeDomain).filter(Boolean)
              : [],
            cookieEncrypted: typeof item.cookieEncrypted === 'string' && item.cookieEncrypted ? item.cookieEncrypted : null,
            browserCookiesEncrypted: typeof item.browserCookiesEncrypted === 'string' && item.browserCookiesEncrypted ? item.browserCookiesEncrypted : null,
            browserStorageEncrypted: typeof item.browserStorageEncrypted === 'string' && item.browserStorageEncrypted ? item.browserStorageEncrypted : null,
            userAgent: typeof item.userAgent === 'string' && item.userAgent.trim() ? item.userAgent.trim() : null,
            lastSyncAt: typeof item.lastSyncAt === 'string' && item.lastSyncAt.trim() ? item.lastSyncAt.trim() : null,
          }))
      }
    } catch {
      return []
    }
  }

  // Legacy single-profile migration view
  const legacyEnabled = getSetting(SETTINGS.legacyEnabled) === '1'
  const legacyDomains = parseTargetDomains(getSetting(SETTINGS.legacyTargetDomains) || '')
  const legacyCookieEncrypted = getSetting(SETTINGS.legacyCookieEncrypted) || null
  if (!legacyCookieEncrypted && legacyDomains.length === 0) return []
  return [{
    id: randomId(),
    name: 'Default',
    enabled: legacyEnabled,
    targetDomains: legacyDomains,
    cookieEncrypted: legacyCookieEncrypted,
    browserCookiesEncrypted: null,
    browserStorageEncrypted: null,
    userAgent: null,
    lastSyncAt: null,
  }]
}

function writeStoredProfiles(profiles: StoredSiteAccessProfile[]): void {
  if (profiles.length === 0) {
    deleteSetting(SETTINGS.profiles)
  } else {
    upsertSetting(SETTINGS.profiles, JSON.stringify(profiles))
  }
  deleteSetting(SETTINGS.legacyEnabled)
  deleteSetting(SETTINGS.legacyTargetDomains)
  deleteSetting(SETTINGS.legacyCookieEncrypted)
}

function toPublicProfile(profile: StoredSiteAccessProfile): SiteAccessProfile {
  let cookie: string | null = null
  if (profile.cookieEncrypted) {
    try {
      cookie = decryptSecret(profile.cookieEncrypted)
    } catch {
      cookie = null
    }
  }
  return {
    id: profile.id,
    name: profile.name,
    enabled: profile.enabled,
    configured: !!cookie,
    targetDomains: profile.targetDomains,
    cookie,
    userAgent: profile.userAgent,
  }
}

export function getSiteAccessConfig(): SiteAccessConfig {
  return {
    profiles: readStoredProfiles().map(toPublicProfile),
  }
}

export function saveSiteAccessConfig(input: { profiles: SiteAccessProfileInput[] }): SiteAccessConfig {
  const currentById = new Map(readStoredProfiles().map(profile => [profile.id, profile]))
  const nextProfiles: StoredSiteAccessProfile[] = input.profiles.map((profileInput, index) => {
    const existing = profileInput.id ? currentById.get(profileInput.id) : undefined
    const id = profileInput.id || existing?.id || randomId()
    const name = (profileInput.name || existing?.name || '').trim()
    const enabled = profileInput.enabled ?? existing?.enabled ?? true
    const targetDomains = [...new Set((profileInput.targetDomains ?? existing?.targetDomains ?? [])
      .map(normalizeDomain)
      .filter(Boolean))]
    const cookie = profileInput.cookie === undefined
      ? (existing?.cookieEncrypted ? decryptSecret(existing.cookieEncrypted) : null)
      : (profileInput.cookie?.trim() || null)
    const userAgent = profileInput.userAgent === undefined
      ? (existing?.userAgent ?? null)
      : (profileInput.userAgent?.trim() || null)

    if (!name) throw new Error(`Profile ${index + 1}: name is required`)
    if (targetDomains.length === 0) throw new Error(`Profile ${index + 1}: at least one target domain is required`)
    if (targetDomains.some(domain => !isValidTargetDomain(domain))) {
      throw new Error(`Profile ${index + 1}: target domains must contain valid hostnames only`)
    }
    if (!cookie) throw new Error(`Profile ${index + 1}: cookie is required`)

    return {
      id,
      name,
      enabled,
      targetDomains,
      cookieEncrypted: encryptSecret(cookie),
      browserCookiesEncrypted: existing?.browserCookiesEncrypted ?? null,
      browserStorageEncrypted: existing?.browserStorageEncrypted ?? null,
      userAgent,
      lastSyncAt: existing?.lastSyncAt ?? null,
    }
  })

  writeStoredProfiles(nextProfiles)
  return getSiteAccessConfig()
}

export function clearSiteAccessConfig(): void {
  writeStoredProfiles([])
}

export function matchesTargetDomain(url: string, targetDomains: string[]): boolean {
  if (targetDomains.length === 0) return false
  let hostname: string
  try {
    hostname = new URL(url).hostname.toLowerCase()
  } catch {
    return false
  }
  return targetDomains.some(domain => hostname === domain || hostname.endsWith(`.${domain}`))
}

export function getSiteAccessProfileForUrl(url: string): SiteAccessProfile | null {
  return getSiteAccessConfig().profiles.find(profile =>
    profile.enabled &&
    profile.cookie &&
    matchesTargetDomain(url, profile.targetDomains),
  ) || null
}

export function getSiteAccessHeaders(url: string): Record<string, string> {
  const match = getSiteAccessProfileForUrl(url)
  if (!match?.cookie) return {}
  return buildBrowserHeaders(url, match.cookie, match.userAgent || TEST_USER_AGENT)
}

function normalizeCookieDomain(input: string): string {
  return normalizeDomain(input.replace(/^\./, ''))
}

function pathMatches(requestPath: string, cookiePath: string): boolean {
  if (!cookiePath.startsWith('/')) return false
  if (requestPath === cookiePath) return true
  if (!requestPath.startsWith(cookiePath)) return false
  if (cookiePath.endsWith('/')) return true
  return requestPath.charAt(cookiePath.length) === '/'
}

function buildCookieHeader(cookies: ImportedSiteCookie[], requestUrl: URL): string {
  const hostname = requestUrl.hostname.toLowerCase()
  const pathname = requestUrl.pathname || '/'
  const seenNames = new Set<string>()

  return cookies
    .map(cookie => ({
      name: cookie.name.trim(),
      value: cookie.value,
      domain: cookie.domain ? normalizeCookieDomain(cookie.domain) : null,
      path: cookie.path?.trim() || '/',
    }))
    .filter(cookie => cookie.name && cookie.value !== '')
    .filter(cookie => !cookie.domain || hostname === cookie.domain || hostname.endsWith(`.${cookie.domain}`))
    .filter(cookie => pathMatches(pathname, cookie.path))
    .sort((a, b) =>
      (b.path.length - a.path.length) ||
      ((b.domain?.length ?? 0) - (a.domain?.length ?? 0)) ||
      a.name.localeCompare(b.name),
    )
    .filter((cookie) => {
      if (seenNames.has(cookie.name)) return false
      seenNames.add(cookie.name)
      return true
    })
    .map(cookie => `${cookie.name}=${cookie.value}`)
    .join('; ')
}

function deriveTargetDomains(url: string, cookies: ImportedSiteCookie[]): string[] {
  const hostname = new URL(url).hostname.toLowerCase()
  const domains = new Set<string>([hostname])
  for (const cookie of cookies) {
    if (!cookie.domain) continue
    const domain = normalizeCookieDomain(cookie.domain)
    if (!domain) continue
    if (hostname === domain || hostname.endsWith(`.${domain}`)) domains.add(domain)
  }
  return [...domains]
}

export function importSiteAccessCookieSession(input: {
  url: string
  cookieUrl?: string | null
  profileName?: string | null
  targetDomains?: string[]
  userAgent?: string | null
  cookies: ImportedSiteCookie[]
}): SiteAccessProfile {
  const url = input.url.trim()
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:') throw new Error('Only https:// URLs are supported')
  const cookieSourceUrl = input.cookieUrl?.trim() || url
  const cookieSourceParsed = new URL(cookieSourceUrl)
  if (cookieSourceParsed.protocol !== 'https:') throw new Error('Only https:// cookie URLs are supported')

  const hostname = parsed.hostname.toLowerCase()
  const cookie = buildCookieHeader(input.cookies, cookieSourceParsed)
  if (!cookie) throw new Error('No matching cookies found for the requested URL')

  const targetDomains = [...new Set([
    hostname,
    ...deriveTargetDomains(cookieSourceParsed.href, input.cookies),
    ...((input.targetDomains || []).map(normalizeDomain).filter(Boolean)),
  ])]
  const current = readStoredProfiles()
  const existingIndex = current.findIndex(profile => matchesTargetDomain(url, profile.targetDomains))
  const existing = existingIndex >= 0 ? current[existingIndex] : null
  const id = existing?.id || randomId()
  const name = input.profileName?.trim() || existing?.name || hostname
  const userAgent = input.userAgent?.trim() || existing?.userAgent || null
  const mergedDomains = [...new Set([...(existing?.targetDomains || []), ...targetDomains])]

  const nextProfile: StoredSiteAccessProfile = {
    id,
    name,
    enabled: true,
    targetDomains: mergedDomains,
    cookieEncrypted: encryptSecret(cookie),
    browserCookiesEncrypted: existing?.browserCookiesEncrypted ?? null,
    browserStorageEncrypted: existing?.browserStorageEncrypted ?? null,
    userAgent,
    lastSyncAt: new Date().toISOString(),
  }

  if (existingIndex >= 0) {
    current.splice(existingIndex, 1, nextProfile)
  } else {
    current.push(nextProfile)
  }

  writeStoredProfiles(current)
  return toPublicProfile(nextProfile)
}

function looksLikeAuthWall(text: string): boolean {
  const lower = text.toLowerCase()
  const patterns = [
    'sign in to continue',
    'log in to continue',
    'subscribe to read',
    'subscribe to continue',
    'member only',
    'members only',
    'please sign in',
    'purchase to read',
    'purchase this article',
    'この記事は有料です',
    '続きは有料',
    '購入すると続きを',
    'ログインすると続きを',
    'ログインして続きを読む',
    '会員の方はログイン',
    '有料会員限定',
  ]
  return patterns.some(pattern => lower.includes(pattern))
}

function extractHtmlTitle(text: string): string | null {
  const match = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  if (!match) return null
  return match[1].replace(/\s+/g, ' ').trim().slice(0, 160) || null
}

function summarizeHtml(text: string): string | null {
  const cleaned = text
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned ? cleaned.slice(0, 220) : null
}

function looksLikeArticlePage(title: string | null, preview: string | null): boolean {
  const previewLen = preview?.length ?? 0
  const hasArticleishTitle = !!title && title.length >= 20
  return hasArticleishTitle && previewLen >= 80
}

function buildBrowserHeaders(url: string, cookie: string, userAgent = TEST_USER_AGENT): Record<string, string> {
  const origin = new URL(url).origin
  return {
    'User-Agent': userAgent,
    Cookie: cookie,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Upgrade-Insecure-Requests': '1',
    'Referer': origin,
  }
}

function findMatchedDomain(url: string, targetDomains: string[]): string | null {
  let hostname: string
  try {
    hostname = new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
  return targetDomains.find(domain => hostname === domain || hostname.endsWith(`.${domain}`)) || null
}

export async function testSiteAccessProfile(profile: SiteAccessProfileInput & { name: string }, testUrl?: string): Promise<SiteAccessTestResult> {
  const existing = profile.id ? readStoredProfiles().find(item => item.id === profile.id) : undefined
  const targetDomains = [...new Set((profile.targetDomains ?? existing?.targetDomains ?? []).map(normalizeDomain).filter(Boolean))]
  const cookie = profile.cookie === undefined
    ? (existing?.cookieEncrypted ? decryptSecret(existing.cookieEncrypted) : null)
    : (profile.cookie?.trim() || null)
  const userAgent = profile.userAgent === undefined
    ? (existing?.userAgent || TEST_USER_AGENT)
    : (profile.userAgent?.trim() || TEST_USER_AGENT)
  const url = (testUrl?.trim() || `https://${targetDomains[0] || ''}/`)
  const profileName = profile.name.trim()
  const matchedDomain = findMatchedDomain(url, targetDomains)

  if (!profile.name.trim()) throw new Error('Profile name is required')
  if (targetDomains.length === 0) throw new Error('At least one target domain is required')
  if (targetDomains.some(domain => !isValidTargetDomain(domain))) throw new Error('Target domains must contain valid hostnames only')
  if (!cookie) throw new Error('Cookie is required')
  if (!matchesTargetDomain(url, targetDomains)) throw new Error('Test URL must match one of the target domains')

  let status: number
  let ok: boolean
  let body: string
  let finalUrl: string

  const res = await safeFetch(url, {
    headers: buildBrowserHeaders(url, cookie, userAgent),
    signal: AbortSignal.timeout(TEST_TIMEOUT),
  })
  status = res.status
  ok = res.ok
  body = await res.text().catch(() => '')
  finalUrl = 'url' in res && typeof res.url === 'string' ? res.url : url
  const title = extractHtmlTitle(body)
  const preview = summarizeHtml(body)
  const htmlLength = body.length
  const previewLength = preview?.length ?? 0
  if (status === 401 || status === 403) {
    return {
      ok: false,
      code: 'AUTH_REJECTED',
      status,
      url,
      finalUrl,
      message: `Authentication rejected (${status})`,
      title,
      preview,
      htmlLength,
      previewLength,
      matchedDomain,
      profileName,
    }
  }
  if (looksLikeAuthWall(body) && !looksLikeArticlePage(title, preview)) {
    return {
      ok: false,
      code: 'AUTH_REQUIRED',
      status,
      url,
      finalUrl,
      message: 'Response looks like a login or paywall page',
      title,
      preview,
      htmlLength,
      previewLength,
      matchedDomain,
      profileName,
    }
  }
  if (!ok) {
    return {
      ok: false,
      code: 'HTTP_ERROR',
      status,
      url,
      finalUrl,
      message: `HTTP ${status}`,
      title,
      preview,
      htmlLength,
      previewLength,
      matchedDomain,
      profileName,
    }
  }
  return {
    ok: true,
    code: 'OK',
    status,
    url,
    finalUrl,
    message: 'Authenticated fetch looks healthy',
    title,
    preview,
    htmlLength,
    previewLength,
    matchedDomain,
    profileName,
  }
}
