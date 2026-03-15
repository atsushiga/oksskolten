-- Add partial index on last_error for efficient retry article lookup
CREATE INDEX IF NOT EXISTS idx_articles_last_error ON articles(last_error) WHERE last_error IS NOT NULL;
