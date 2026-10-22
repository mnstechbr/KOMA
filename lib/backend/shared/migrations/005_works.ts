export const migration005Works = {
  version: 5,
  name: '005_works',
  up: `
    CREATE TABLE works (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id),
      source TEXT NOT NULL, source_id TEXT NOT NULL, title TEXT NOT NULL, metadata_json TEXT NOT NULL,
      favorite INTEGER NOT NULL DEFAULT 0, paused INTEGER NOT NULL DEFAULT 0,
      sync_requested INTEGER NOT NULL DEFAULT 1, stage TEXT NOT NULL DEFAULT 'discovering',
      sync_attempts INTEGER NOT NULL DEFAULT 0, sync_retry_after INTEGER NOT NULL DEFAULT 0,
      message TEXT NOT NULL DEFAULT '', last_synced_at TEXT, last_opened_at TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(user_id, source, source_id)
    );
    CREATE TABLE work_chapters (
      id INTEGER PRIMARY KEY AUTOINCREMENT, work_id INTEGER NOT NULL REFERENCES works(id),
      chapter_key TEXT NOT NULL, source_id TEXT NOT NULL, title TEXT NOT NULL, number TEXT,
      volume TEXT, language TEXT NOT NULL, position REAL NOT NULL, page_count INTEGER NOT NULL,
      section_id INTEGER REFERENCES sections(id), state TEXT NOT NULL DEFAULT 'queued',
      message TEXT NOT NULL DEFAULT '', attempts INTEGER NOT NULL DEFAULT 0,
      retry_after INTEGER NOT NULL DEFAULT 0, read_done INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(work_id, chapter_key)
    );
    CREATE TABLE work_pages (
      id INTEGER PRIMARY KEY AUTOINCREMENT, chapter_id INTEGER NOT NULL REFERENCES work_chapters(id),
      page_index INTEGER NOT NULL, source_file TEXT NOT NULL, image_id INTEGER REFERENCES section_images(id),
      state TEXT NOT NULL DEFAULT 'download', ocr_json TEXT, width INTEGER, height INTEGER,
      message TEXT NOT NULL DEFAULT '', UNIQUE(chapter_id, page_index)
    );
    CREATE TABLE catalog_cache (source_id TEXT PRIMARY KEY, metadata_json TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE automation_lock (id INTEGER PRIMARY KEY CHECK(id=1), owner TEXT NOT NULL, pid INTEGER NOT NULL, process_started TEXT NOT NULL);
    CREATE INDEX idx_work_chapters_pending ON work_chapters(work_id, state, position);
    CREATE INDEX idx_work_pages_chapter ON work_pages(chapter_id, page_index);
  `,
} as const
