import { safeFetch } from './ssrf.js'
import { fetchViaFlareSolverr } from './flaresolverr.js'
import { getSiteAccessHeaders } from '../site-auth.js'

export const USER_AGENT = 'Mozilla/5.0 (compatible; RSSReader/1.0)'
export const DEFAULT_TIMEOUT = 15_000
export const DISCOVERY_TIMEOUT = 10_000
export const PROBE_TIMEOUT = 5_000

export interface FetchHtmlResult {
  html: string
  contentType: string
  usedFlareSolverr: boolean
}

/**
 * Fetch HTML from an external URL with safeFetch (SSRF-protected) + FlareSolverr fallback.
 * For internal URLs (e.g. RSS Bridge), use plain fetch() directly instead.
 */
export async function fetchHtml(url: string, opts?: {
  timeout?: number
  useFlareSolverr?: boolean
}): Promise<FetchHtmlResult> {
  const timeout = opts?.timeout ?? DEFAULT_TIMEOUT
  let siteAccessHeaders: Record<string, string> = {}
  try {
    siteAccessHeaders = getSiteAccessHeaders(url)
  } catch {
    // Feed discovery should still work in environments where settings storage is unavailable.
    siteAccessHeaders = {}
  }
  const hasSiteAccess = Object.keys(siteAccessHeaders).length > 0

  // Go straight to FlareSolverr if requested
  if (opts?.useFlareSolverr && !hasSiteAccess) {
    const flare = await fetchViaFlareSolverr(url)
    if (!flare) throw new Error('FlareSolverr failed')
    return { html: flare.body, contentType: flare.contentType, usedFlareSolverr: true }
  }

  let res: Response
  try {
    res = await safeFetch(url, {
      headers: { 'User-Agent': USER_AGENT, ...siteAccessHeaders },
      signal: AbortSignal.timeout(timeout),
    })
  } catch {
    // Network-level failure (ECONNRESET, DNS, timeout, etc.) — try FlareSolverr
    if (hasSiteAccess) throw new Error('Authenticated fetch failed')
    const flare = await fetchViaFlareSolverr(url)
    if (!flare) throw new Error('Fetch failed and FlareSolverr unavailable')
    return { html: flare.body, contentType: flare.contentType, usedFlareSolverr: true }
  }

  if (!res.ok) {
    if (hasSiteAccess) throw new Error(`HTTP ${res.status}`)
    const flare = await fetchViaFlareSolverr(url)
    if (!flare) throw new Error(`HTTP ${res.status}`)
    return { html: flare.body, contentType: flare.contentType, usedFlareSolverr: true }
  }

  return {
    html: await res.text(),
    contentType: res.headers.get('content-type') || '',
    usedFlareSolverr: false,
  }
}
