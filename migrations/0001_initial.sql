-- Squashed initial schema
-- Consolidates migrations 0001–0041 into a single file.

CREATE TABLE IF NOT EXISTS categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  collapsed  INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS feeds (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  name                  TEXT NOT NULL,
  url                   TEXT NOT NULL UNIQUE,
  rss_url               TEXT,
  rss_bridge_url        TEXT,
  type                  TEXT NOT NULL DEFAULT 'rss',
  category_id           INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  disabled              INTEGER NOT NULL DEFAULT 0,
  requires_js_challenge INTEGER NOT NULL DEFAULT 0,
  last_error            TEXT,
  error_count           INTEGER NOT NULL DEFAULT 0,
  etag                  TEXT,
  last_modified         TEXT,
  last_content_hash     TEXT,
  next_check_at         TEXT,
  check_interval        INTEGER,
  created_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_feeds_category_id ON feeds(category_id);

CREATE TABLE IF NOT EXISTS articles (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  feed_id              INTEGER NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
  category_id          INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  title                TEXT NOT NULL,
  url                  TEXT NOT NULL UNIQUE,
  lang                 TEXT,
  full_text            TEXT,
  full_text_translated TEXT,
  translated_lang      TEXT,
  summary              TEXT,
  excerpt              TEXT,
  comment              TEXT,
  comment_updated_at   TEXT,
  og_image             TEXT,
  score                REAL NOT NULL DEFAULT 0,
  last_error           TEXT,
  seen_at              TEXT,
  read_at              TEXT,
  bookmarked_at        TEXT,
  liked_at             TEXT,
  images_archived_at   TEXT,
  published_at         TEXT,
  fetched_at           TEXT NOT NULL DEFAULT (datetime('now')),
  created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_articles_feed_id ON articles(feed_id);
CREATE INDEX IF NOT EXISTS idx_articles_published_at ON articles(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_bookmarked_at ON articles(bookmarked_at);
CREATE INDEX IF NOT EXISTS idx_articles_feed_seen_at ON articles(feed_id, seen_at);
CREATE INDEX IF NOT EXISTS idx_articles_seen_at ON articles(seen_at);
CREATE INDEX IF NOT EXISTS idx_articles_read_at ON articles(read_at);
CREATE INDEX IF NOT EXISTS idx_articles_score ON articles(score DESC);
CREATE INDEX IF NOT EXISTS idx_articles_liked_at ON articles(liked_at);
CREATE INDEX IF NOT EXISTS idx_articles_category_published ON articles(category_id, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_feed_score ON articles(feed_id, score DESC);
CREATE INDEX IF NOT EXISTS idx_articles_category_score ON articles(category_id, score DESC);
CREATE INDEX IF NOT EXISTS idx_articles_comment_updated_at ON articles(comment_updated_at DESC);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  token_version INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS credentials (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  credential_id   TEXT NOT NULL UNIQUE,
  public_key      BLOB NOT NULL,
  counter         INTEGER NOT NULL DEFAULT 0,
  device_type     TEXT NOT NULL,
  backed_up       INTEGER NOT NULL DEFAULT 0,
  transports      TEXT,
  aaguid          TEXT,
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS conversations (
  id            TEXT PRIMARY KEY,
  title         TEXT,
  article_id    INTEGER REFERENCES articles(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content         TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation ON chat_messages(conversation_id, id);
