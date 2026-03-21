ALTER TABLE articles ADD COLUMN comment TEXT;
ALTER TABLE articles ADD COLUMN comment_updated_at TEXT;

CREATE INDEX IF NOT EXISTS idx_articles_comment_updated_at ON articles(comment_updated_at DESC);
