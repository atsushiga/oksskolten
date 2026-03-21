import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockSafeFetch, mockFetchViaFlareSolverr } = vi.hoisted(() => ({
  mockSafeFetch: vi.fn(),
  mockFetchViaFlareSolverr: vi.fn(),
}))

vi.mock('./ssrf.js', () => ({
  safeFetch: (...args: unknown[]) => mockSafeFetch(...args),
}))

vi.mock('./flaresolverr.js', () => ({
  fetchViaFlareSolverr: (...args: unknown[]) => mockFetchViaFlareSolverr(...args),
}))

vi.mock('../site-auth.js', () => ({
  getSiteAccessHeaders: vi.fn(() => ({})),
}))

import { fetchHtml, USER_AGENT, DEFAULT_TIMEOUT, DISCOVERY_TIMEOUT, PROBE_TIMEOUT } from './http.js'
import { getSiteAccessHeaders } from '../site-auth.js'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getSiteAccessHeaders).mockReturnValue({})
})

// --- constants ---

describe('constants', () => {
  it('exports expected timeout values', () => {
    expect(DEFAULT_TIMEOUT).toBe(15_000)
    expect(DISCOVERY_TIMEOUT).toBe(10_000)
    expect(PROBE_TIMEOUT).toBe(5_000)
  })

  it('exports a user agent string', () => {
    expect(USER_AGENT).toContain('RSSReader')
  })
})

// --- fetchHtml ---

describe('fetchHtml', () => {
  it('returns HTML from successful safeFetch', async () => {
    mockSafeFetch.mockResolvedValue({
      ok: true,
      text: async () => '<html>ok</html>',
      headers: new Headers({ 'content-type': 'text/html' }),
    })

    const result = await fetchHtml('https://example.com')
    expect(result.html).toBe('<html>ok</html>')
    expect(result.contentType).toBe('text/html')
    expect(result.usedFlareSolverr).toBe(false)
  })

  it('passes User-Agent header and timeout to safeFetch', async () => {
    mockSafeFetch.mockResolvedValue({
      ok: true,
      text: async () => '',
      headers: new Headers(),
    })

    await fetchHtml('https://example.com', { timeout: 5000 })

    expect(mockSafeFetch).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({
        headers: { 'User-Agent': USER_AGENT },
      }),
    )
  })

  it('passes configured Cookie header for matching authenticated domains', async () => {
    vi.mocked(getSiteAccessHeaders).mockReturnValue({ Cookie: 'sessionid=abc123' })
    mockSafeFetch.mockResolvedValue({
      ok: true,
      text: async () => '',
      headers: new Headers(),
    })

    await fetchHtml('https://note.com/example')

    expect(mockSafeFetch).toHaveBeenCalledWith(
      'https://note.com/example',
      expect.objectContaining({
        headers: {
          'User-Agent': USER_AGENT,
          Cookie: 'sessionid=abc123',
        },
      }),
    )
  })

  it('falls back to FlareSolverr on HTTP error', async () => {
    mockSafeFetch.mockResolvedValue({ ok: false, status: 403 })
    mockFetchViaFlareSolverr.mockResolvedValue({
      body: '<html>flare</html>',
      contentType: 'text/html',
    })

    const result = await fetchHtml('https://example.com')
    expect(result.html).toBe('<html>flare</html>')
    expect(result.usedFlareSolverr).toBe(true)
  })

  it('throws when HTTP error and FlareSolverr returns null', async () => {
    mockSafeFetch.mockResolvedValue({ ok: false, status: 500 })
    mockFetchViaFlareSolverr.mockResolvedValue(null)

    await expect(fetchHtml('https://example.com')).rejects.toThrow('HTTP 500')
  })

  it('goes straight to FlareSolverr when useFlareSolverr option is set', async () => {
    mockFetchViaFlareSolverr.mockResolvedValue({
      body: '<html>direct</html>',
      contentType: 'text/html; charset=utf-8',
    })

    const result = await fetchHtml('https://example.com', { useFlareSolverr: true })
    expect(result.html).toBe('<html>direct</html>')
    expect(result.usedFlareSolverr).toBe(true)
    expect(mockSafeFetch).not.toHaveBeenCalled()
  })

  it('throws when useFlareSolverr is set but FlareSolverr returns null', async () => {
    mockFetchViaFlareSolverr.mockResolvedValue(null)

    await expect(fetchHtml('https://example.com', { useFlareSolverr: true }))
      .rejects.toThrow('FlareSolverr failed')
  })

  it('does not use FlareSolverr fallback for authenticated fetches', async () => {
    vi.mocked(getSiteAccessHeaders).mockReturnValue({ Cookie: 'sessionid=abc123' })
    mockSafeFetch.mockResolvedValue({ ok: false, status: 403 })

    await expect(fetchHtml('https://note.com/example')).rejects.toThrow('HTTP 403')
    expect(mockFetchViaFlareSolverr).not.toHaveBeenCalled()
  })

  it('uses DEFAULT_TIMEOUT when no timeout specified', async () => {
    mockSafeFetch.mockResolvedValue({
      ok: true,
      text: async () => '',
      headers: new Headers(),
    })

    await fetchHtml('https://example.com')

    const call = mockSafeFetch.mock.calls[0]
    expect(call[1].signal).toBeDefined()
  })

  it('returns empty content-type when header is missing', async () => {
    mockSafeFetch.mockResolvedValue({
      ok: true,
      text: async () => '',
      headers: new Headers(), // no content-type
    })

    const result = await fetchHtml('https://example.com')
    expect(result.contentType).toBe('')
  })
})
