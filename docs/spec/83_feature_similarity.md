# Oksskolten Spec — Similar Article Detection

> [Back to Overview](./01_overview.md)

## Overview

Detect similar articles across different feeds and provide two behaviors:

1. **Similar article banner**: When viewing an article, show a notice listing other sources that covered the same story
2. **Auto-mark-read**: When a user has already read a similar article from another source, automatically mark the duplicate as `seen_at` (removes it from unread count)

## Motivation

Users subscribing to multiple feeds covering the same topics (e.g., tech news) see the same story reported by different sources repeatedly. This creates noise in the feed list.

## Design

### Detection Algorithm

**Two-stage: Meilisearch title search + Bigram Dice Coefficient**

1. After a new article is inserted, search Meilisearch using the article's title as query
2. Filter candidates: different feed (`feed_id != X`), within ±3 days of `published_at`
3. Compute bigram Dice coefficient between the new article's title and each candidate's title
4. Accept matches with score >= 0.4

```
Dice(A, B) = 2 × |bigrams(A) ∩ bigrams(B)| / (|bigrams(A)| + |bigrams(B)|)
```

Where `bigrams(s)` extracts character bigrams from each word after lowercasing and stripping punctuation. The threshold of 0.4 catches rephrased headlines ("Apple announces iPhone 17" vs "Apple unveils new iPhone 17") while rejecting unrelated articles that share common words.

No LLM or embedding costs — uses existing Meilisearch keyword search infrastructure.

### Storage

```sql
CREATE TABLE article_similarities (
  article_id    INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  similar_to_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  score         REAL NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (article_id, similar_to_id)
);

CREATE INDEX idx_similarities_similar_to ON article_similarities(similar_to_id);
```

- Bidirectional: if A is similar to B, both `(A, B)` and `(B, A)` are stored
- Lookups are always `WHERE article_id = ?` (single-direction query)
- `ON DELETE CASCADE` ensures cleanup when articles are deleted

### Detection Timing

Runs asynchronously (fire-and-forget) after `insertArticle()` in the fetcher pipeline:

```
insertArticle()
  → syncArticleToSearch()           [existing, fire-and-forget]
  → detectAndStoreSimilarArticles() [new, fire-and-forget]
      → Meilisearch title search (exclude same feed, ±3 day window)
      → Bigram Dice filter (>= 0.4)
      → INSERT INTO article_similarities (bidirectional)
      → If similar article has read_at → markArticleSeen(new article)
```

Does not block the ingestion pipeline. Works even when `full_text` is null (title is always present).

### Auto-mark-read Logic

When a similar article is found that has `read_at IS NOT NULL`, the new article's `seen_at` is set to the current timestamp. `read_at` is **not** set — this distinction is intentional:

- `seen_at` removes the article from the unread count, reducing feed noise
- `read_at` is reserved for articles the user actually opened
- The user can still open the article to read a different source's perspective

### API

**GET /api/articles/:id/similar** — Get similar articles

```json
// Response: 200
{
  "similar": [
    {
      "id": 123,
      "feed_name": "TechCrunch",
      "title": "Apple announces iPhone 17",
      "url": "https://techcrunch.com/...",
      "published_at": "2026-03-18T10:00:00Z",
      "read_at": "2026-03-18T11:05:00Z",
      "score": 0.82
    }
  ]
}
```

Sorted by similarity score descending.

**Article list/detail responses** include `similar_count` (integer) computed via subquery:

```sql
(SELECT COUNT(*) FROM article_similarities WHERE article_id = a.id) AS similar_count
```

### Frontend

**Article detail view**: A collapsible banner appears below the summary section when `similar_count > 0`:

- "This story was also covered by {feedNames}" — or "You already read this from {feedName}" if a similar article has `read_at`
- Expandable `<details>` section listing each similar article with title, feed name, and read status
- Clicking a similar article navigates within the app (SPA navigation via `articleUrlToPath`)

**Article list**: A small `Layers` icon appears after the date in the article metadata row when `similar_count > 0`.

### Key Files

| File | Purpose |
|------|---------|
| `migrations/0004_article_similarities.sql` | Schema |
| `server/db/similarities.ts` | DB functions: insertSimilarity, getSimilarArticles, findReadSimilarArticle |
| `server/similarity.ts` | Detection logic: detectAndStoreSimilarArticles, computeTitleSimilarity |
| `server/fetcher.ts` | Hook: calls detectAndStoreSimilarArticles after insertArticle |
| `server/routes/articles.ts` | Endpoint: GET /api/articles/:id/similar |
| `server/db/articles.ts` | similar_count subquery in getArticles, getArticleByUrl, getArticleById |
| `src/components/article/article-similar-banner.tsx` | Frontend banner component |
