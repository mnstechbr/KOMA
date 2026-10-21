import 'server-only'

import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { runSqliteMigrations } from './migrate'
import { getDataDir } from './data-paths'

const dataDir = getDataDir()
const dbFile = path.resolve(dataDir, 'local.sqlite')

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })

const db = new Database(dbFile)
db.pragma('busy_timeout = 10000')

const shouldRunMigrations = process.env.SKIP_DB_BOOTSTRAP !== '1'

if (shouldRunMigrations) {
  db.pragma('journal_mode = WAL')
  runSqliteMigrations(db)
}

export { db }
