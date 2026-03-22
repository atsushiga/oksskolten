import { lookup } from 'node:dns/promises'

function isPrivateIP(ip: string): boolean {
  // IPv4 private/loopback/link-local ranges
  if (/^127\./.test(ip)) return true
  if (/^10\./.test(ip)) return true
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true
  if (/^192\.168\./.test(ip)) return true
  if (/^169\.254\./.test(ip)) return true
  if (ip === '0.0.0.0') return true
  // IPv6 loopback / private
  if (ip === '::1' || ip === '::' || /^f[cd]/i.test(ip) || /^fe80:/i.test(ip)) return true
  return false
}

export async function assertSafeUrl(url: string): Promise<void> {
  const parsed = new URL(url)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Blocked URL: disallowed protocol ${parsed.protocol}`)
  }
  const hostname = parsed.hostname
  if (hostname === 'localhost' || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    throw new Error(`Blocked URL: private hostname ${hostname}`)
  }
  // If hostname is already an IP literal, check directly
  if (/^[\d.]+$/.test(hostname) || hostname.startsWith('[')) {
    const ip = hostname.replace(/^\[|\]$/g, '')
    if (isPrivateIP(ip)) throw new Error(`Blocked URL: private IP ${ip}`)
    return
  }
  // Resolve DNS and check the resulting IP
  try {
    const { address } = await lookup(hostname)
    if (isPrivateIP(address)) throw new Error(`Blocked URL: ${hostname} resolves to private IP ${address}`)
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Blocked URL:')) throw err
    // DNS resolution failed — let the subsequent fetch handle it
  }
}

const MAX_REDIRECTS = 5

function parseCookieHeader(value: string): Map<string, string> {
  const cookies = new Map<string, string>()
  for (const part of value.split(';')) {
    const trimmed = part.trim()
    if (!trimmed) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    cookies.set(trimmed.slice(0, eq), trimmed.slice(eq + 1))
  }
  return cookies
}

function parseSetCookieNameValue(value: string): { name: string; value: string } | null {
  const first = value.split(';', 1)[0]?.trim()
  if (!first) return null
  const eq = first.indexOf('=')
  if (eq <= 0) return null
  return {
    name: first.slice(0, eq).trim(),
    value: first.slice(eq + 1),
  }
}

function getSetCookieValues(res: Response): string[] {
  const headers = res.headers as Headers & { getSetCookie?: () => string[] }
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie()
  const single = res.headers.get('set-cookie')
  return single ? [single] : []
}

export async function safeFetch(url: string, init?: RequestInit): Promise<Response> {
  await assertSafeUrl(url)
  let currentUrl = url
  const headers = new Headers(init?.headers)
  for (let i = 0; i < MAX_REDIRECTS; i++) {
    const res = await fetch(currentUrl, { ...init, headers, redirect: 'manual' })
    if (res.status >= 300 && res.status < 400) {
      const setCookies = getSetCookieValues(res)
      if (setCookies.length > 0 && headers.has('Cookie')) {
        const merged = parseCookieHeader(headers.get('Cookie') || '')
        for (const setCookie of setCookies) {
          const parsed = parseSetCookieNameValue(setCookie)
          if (!parsed) continue
          merged.set(parsed.name, parsed.value)
        }
        headers.set('Cookie', [...merged.entries()].map(([name, value]) => `${name}=${value}`).join('; '))
      }
      const location = res.headers.get('location')
      if (!location) throw new Error(`Redirect without Location header from ${currentUrl}`)
      currentUrl = new URL(location, currentUrl).href
      await assertSafeUrl(currentUrl)
      continue
    }
    return res
  }
  throw new Error(`Too many redirects (max ${MAX_REDIRECTS})`)
}
