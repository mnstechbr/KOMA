import type Database from 'better-sqlite3'
import { SQLITE_MIGRATIONS } from './migrations'

export function runSqliteMigrations(database: Database.Database) {
  // A versão deve ser consultada depois de obter a escrita exclusiva. Builds
  // e inicializações concorrentes não podem executar a mesma ALTER/CREATE.
  database.transaction(() => {
    database.exec(`CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL,applied_at TEXT NOT NULL)`)
    const applied = database.prepare('SELECT 1 FROM schema_migrations WHERE version=?')
    const record = database.prepare('INSERT INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)')
    for (const migration of [...SQLITE_MIGRATIONS].sort((a,b) => a.version-b.version)) {
      if (applied.get(migration.version)) continue
      database.exec(migration.up)
      record.run(migration.version,migration.name,new Date().toISOString())
    }
  }).immediate()
}
