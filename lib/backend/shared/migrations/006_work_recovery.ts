export const migration006WorkRecovery = {
  version: 6, name: '006_work_recovery', up: `
    ALTER TABLE works ADD COLUMN last_processed_at INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE work_pages ADD COLUMN recovery_attempted INTEGER NOT NULL DEFAULT 0;
    CREATE TABLE work_source_versions (
      work_id INTEGER NOT NULL REFERENCES works(id), chapter_key TEXT NOT NULL,
      source_id TEXT NOT NULL, metadata_json TEXT NOT NULL, PRIMARY KEY(work_id, chapter_key, source_id)
    );
    CREATE TABLE work_chapter_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, chapter_id INTEGER NOT NULL REFERENCES work_chapters(id),
      source_id TEXT NOT NULL, section_id INTEGER REFERENCES sections(id), pages_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE work_source_checks (
      work_id INTEGER NOT NULL REFERENCES works(id), kind TEXT NOT NULL,
      url TEXT NOT NULL, status TEXT NOT NULL, message TEXT NOT NULL, checked_at TEXT NOT NULL,
      PRIMARY KEY(work_id,kind,url)
    );
    UPDATE work_chapters SET state='queued',attempts=0,retry_after=0,message=''
      WHERE state='error' AND (message LIKE '%OCR%' OR message LIKE '%revisão humana%');
    UPDATE works SET sync_requested=1,sync_attempts=0,sync_retry_after=0 WHERE paused=0;
  `,
} as const
