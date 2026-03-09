import { JSDOM } from 'jsdom'
import db from '../server/db.js'

const CONCURRENCY = 5

interface Row {
  id: number
  url: string
}

async function fetchOgImage(url: string): Promise<string | null> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RSSReader/1.0)' },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)

  const html = await res.text()
  const dom = new JSDOM(html, { url })
  return dom.window.document
    .querySelector('meta[property="og:image"]')
    ?.getAttribute('content') || null
}

async function main() {
  const rows = db.prepare(
    'SELECT id, url FROM articles WHERE og_image IS NULL',
  ).all() as Row[]

  console.log(`[backfill] ${rows.length} articles to process`)
  if (rows.length === 0) return

  const update = db.prepare('UPDATE articles SET og_image = ? WHERE id = ?')

  let done = 0
  let found = 0
  let failed = 0

  // Simple semaphore
  let active = 0
  const queue: (() => void)[] = []
  async function withLimit<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= CONCURRENCY) {
      await new Promise<void>(resolve => queue.push(resolve))
    }
    active++
    try {
      return await fn()
    } finally {
      active--
      queue.shift()?.()
    }
  }

  await Promise.all(
    rows.map(row =>
      withLimit(async () => {
        try {
          const ogImage = await fetchOgImage(row.url)
          if (ogImage) {
            update.run(ogImage, row.id)
            found++
          }
        } catch {
          failed++
        }
        done++
        if (done % 50 === 0 || done === rows.length) {
          console.log(`[backfill] ${done}/${rows.length} (found: ${found}, failed: ${failed})`)
        }
      }),
    ),
  )

  console.log(`[backfill] Done. found: ${found}, failed: ${failed}, no-image: ${rows.length - found - failed}`)
}

main()
