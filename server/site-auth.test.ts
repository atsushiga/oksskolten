import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setupTestDb } from './__tests__/helpers/testDb.js'
const { mockSafeFetch } = vi.hoisted(() => ({
  mockSafeFetch: vi.fn(),
}))

vi.mock('./fetcher/ssrf.js', () => ({
  safeFetch: (...args: unknown[]) => mockSafeFetch(...args),
}))
import { getSiteAccessHeaders, importSiteAccessCookieSession, saveSiteAccessConfig, testSiteAccessProfile } from './site-auth.js'

beforeEach(() => {
  setupTestDb()
  vi.clearAllMocks()
})

describe('site auth profile matching', () => {
  it('uses the matching profile cookie for the request domain', () => {
    saveSiteAccessConfig({
      profiles: [
        {
          name: 'note',
          enabled: true,
          cookie: '_note_session_v5=abc',
          targetDomains: ['note.com'],
        },
        {
          name: 'nikkei',
          enabled: true,
          cookie: 'nikkei_session=xyz',
          targetDomains: ['nikkei.com'],
        },
      ],
    })

    expect(getSiteAccessHeaders('https://note.com/foo')).toEqual(expect.objectContaining({
      Cookie: '_note_session_v5=abc',
      Referer: 'https://note.com',
    }))
    expect(getSiteAccessHeaders('https://www.nikkei.com/bar')).toEqual(expect.objectContaining({
      Cookie: 'nikkei_session=xyz',
      Referer: 'https://www.nikkei.com',
    }))
  })

  it('does not return cookies for non-matching domains', () => {
    saveSiteAccessConfig({
      profiles: [
        {
          name: 'note',
          enabled: true,
          cookie: '_note_session_v5=abc',
          targetDomains: ['note.com'],
        },
      ],
    })

    expect(getSiteAccessHeaders('https://nikkei.com/foo')).toEqual({})
  })

  it('imports cookies into a matching profile from browser session sync', () => {
    const profile = importSiteAccessCookieSession({
      url: 'https://note.com/premium/test',
      profileName: 'note.com',
      userAgent: 'Mozilla/5.0 Chrome/145.0.0.0',
      cookies: [
        { name: '_note_session_v5', value: 'abc', domain: '.note.com', path: '/' },
        { name: 'apay-session-set', value: 'def', domain: 'note.com', path: '/' },
      ],
    })

    expect(profile).toMatchObject({
      name: 'note.com',
      enabled: true,
      configured: true,
      targetDomains: expect.arrayContaining(['note.com']),
      userAgent: 'Mozilla/5.0 Chrome/145.0.0.0',
    })
    expect(getSiteAccessHeaders('https://note.com/premium/test')).toEqual({
      'User-Agent': 'Mozilla/5.0 Chrome/145.0.0.0',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
      'Cache-Control': 'no-cache',
      Cookie: '_note_session_v5=abc; apay-session-set=def',
      Pragma: 'no-cache',
      Referer: 'https://note.com',
      'Upgrade-Insecure-Requests': '1',
    })
  })

  it('ignores imported cookies whose path does not match the requested page', () => {
    importSiteAccessCookieSession({
      url: 'https://note.com/premium/test',
      profileName: 'note.com',
      cookies: [
        { name: '_note_session_v5', value: 'abc', domain: '.note.com', path: '/' },
        { name: 'preview_token', value: 'skip', domain: '.note.com', path: '/settings' },
      ],
    })

    expect(getSiteAccessHeaders('https://note.com/premium/test')).toEqual({
      'User-Agent': expect.stringContaining('Chrome'),
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
      'Cache-Control': 'no-cache',
      Cookie: '_note_session_v5=abc',
      Pragma: 'no-cache',
      Referer: 'https://note.com',
      'Upgrade-Insecure-Requests': '1',
    })
  })

  it('deduplicates imported cookies with the same name by keeping the most specific match', () => {
    importSiteAccessCookieSession({
      url: 'https://note.com/premium/test',
      profileName: 'note.com',
      cookies: [
        { name: '_note_session_v5', value: 'root', domain: '.note.com', path: '/' },
        { name: '_note_session_v5', value: 'premium', domain: '.note.com', path: '/premium' },
        { name: 'apay-session-set', value: 'def', domain: '.note.com', path: '/' },
      ],
    })

    expect(getSiteAccessHeaders('https://note.com/premium/test')).toEqual({
      'User-Agent': expect.stringContaining('Chrome'),
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
      'Cache-Control': 'no-cache',
      Cookie: '_note_session_v5=premium; apay-session-set=def',
      Pragma: 'no-cache',
      Referer: 'https://note.com',
      'Upgrade-Insecure-Requests': '1',
    })
  })

  it('imports note cookies for a custom domain when cookieUrl points to note.com', () => {
    const profile = importSiteAccessCookieSession({
      url: 'https://chatgpt-lab.com/n/n3f74bf9ed9fd',
      cookieUrl: 'https://note.com/',
      profileName: 'chatgpt-lab.com',
      targetDomains: ['chatgpt-lab.com'],
      cookies: [
        { name: '_note_session_v5', value: 'abc', domain: '.note.com', path: '/' },
        { name: 'apay-session-set', value: 'def', domain: 'note.com', path: '/' },
      ],
    })

    expect(profile).toMatchObject({
      name: 'chatgpt-lab.com',
      targetDomains: expect.arrayContaining(['chatgpt-lab.com', 'note.com']),
    })
    expect(getSiteAccessHeaders('https://chatgpt-lab.com/n/n3f74bf9ed9fd')).toEqual(expect.objectContaining({
      Cookie: '_note_session_v5=abc; apay-session-set=def',
      Referer: 'https://chatgpt-lab.com',
    }))
  })

  it('classifies 403 as rejected authentication during test', async () => {
    mockSafeFetch.mockResolvedValue({
      ok: false,
      status: 403,
      url: 'https://note.com/login',
      text: async () => '<html><title>Forbidden</title>forbidden</html>',
    })

    const result = await testSiteAccessProfile({
      name: 'note',
      cookie: '_note_session_v5=abc',
      targetDomains: ['note.com'],
    }, 'https://note.com/premium')

    expect(result).toMatchObject({
      ok: false,
      code: 'AUTH_REJECTED',
      status: 403,
      finalUrl: 'https://note.com/login',
      title: 'Forbidden',
      matchedDomain: 'note.com',
      profileName: 'note',
    })
  })

  it('classifies login wall html as auth required during test', async () => {
    mockSafeFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '<html><body>ログインして続きを読む</body></html>',
    })

    const result = await testSiteAccessProfile({
      name: 'note',
      cookie: '_note_session_v5=abc',
      targetDomains: ['note.com'],
    }, 'https://note.com/premium')

    expect(result).toMatchObject({
      ok: false,
      code: 'AUTH_REQUIRED',
      status: 200,
    })
  })

  it('does not classify generic subscription wording as auth required', async () => {
    mockSafeFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '<html><body>この作品の購読体験について書いた記事です</body></html>',
    })

    const result = await testSiteAccessProfile({
      name: 'note',
      cookie: '_note_session_v5=abc',
      targetDomains: ['note.com'],
    }, 'https://note.com/premium')

    expect(result).toMatchObject({
      ok: true,
      code: 'OK',
      status: 200,
    })
  })

  it('sends browser-like headers during site access test', async () => {
    mockSafeFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '<html><title>OK</title><body>premium article</body></html>',
    })

    await testSiteAccessProfile({
      name: 'nikkei',
      cookie: 'RNikkeiAuth=xyz',
      targetDomains: ['nikkei.com'],
    }, 'https://www.nikkei.com/article/test')

    expect(mockSafeFetch).toHaveBeenCalledWith(
      'https://www.nikkei.com/article/test',
      expect.objectContaining({
        headers: expect.objectContaining({
          'User-Agent': expect.stringContaining('Chrome'),
          'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
          'Referer': 'https://www.nikkei.com',
          Cookie: 'RNikkeiAuth=xyz',
        }),
      }),
    )
  })

  it('treats article-like pages as success even if they include paywall wording', async () => {
    mockSafeFetch.mockResolvedValue({
      ok: true,
      status: 200,
      url: 'https://www.nikkei.com/article/test',
      text: async () => `
        <html>
          <title>ドル覇権失速、4〜5年内の金利ショックに備えを ロゴフ・ハーバード大教授 - 日本経済新聞</title>
          <body>
            <article>
              十分な本文テキストがここにあります。購読案内やログイン導線が途中に入っていても、
              記事ページそのものが返ってきているなら接続テストとしては成功扱いに寄せたいです。
              ログインすると続きをお読みいただけます。
            </article>
          </body>
        </html>
      `,
    })

    const result = await testSiteAccessProfile({
      name: 'nikkei',
      cookie: 'RNikkeiAuth=xyz',
      targetDomains: ['nikkei.com'],
    }, 'https://www.nikkei.com/article/test')

    expect(result).toMatchObject({
      ok: true,
      code: 'OK',
      status: 200,
      finalUrl: 'https://www.nikkei.com/article/test',
      matchedDomain: 'nikkei.com',
      profileName: 'nikkei',
    })
    expect(result.htmlLength).toBeGreaterThan(100)
    expect(result.previewLength).toBeGreaterThan(80)
  })

})
