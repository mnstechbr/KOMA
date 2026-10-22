export const migration007CatalogSources = {
  version: 7,
  name: '007_catalog_sources',
  up: `
    ALTER TABLE work_chapters ADD COLUMN version_attempts INTEGER NOT NULL DEFAULT 0;
    CREATE TABLE work_catalog_sources (
      work_id INTEGER NOT NULL REFERENCES works(id), provider TEXT NOT NULL,
      url TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
      chapter_count INTEGER NOT NULL DEFAULT 0, message TEXT NOT NULL DEFAULT '', checked_at TEXT,
      PRIMARY KEY(work_id,provider,url)
    );
  `,
} as const
