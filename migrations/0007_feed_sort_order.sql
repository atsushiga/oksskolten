ALTER TABLE feeds ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

WITH ordered AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY category_id
      ORDER BY name COLLATE NOCASE ASC, id ASC
    ) - 1 AS next_sort_order
  FROM feeds
)
UPDATE feeds
SET sort_order = (
  SELECT next_sort_order
  FROM ordered
  WHERE ordered.id = feeds.id
);
