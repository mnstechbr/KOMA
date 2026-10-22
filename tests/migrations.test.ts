import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { SQLITE_MIGRATIONS } from '../lib/backend/shared/migrations'
import { runSqliteMigrations } from '../lib/backend/shared/migrate'

describe('SQLite migrations', () => {
  it('libera downloads pausados automaticamente por revogação e mantém a tradução bloqueada', () => {
    const db = new Database(':memory:')
    db.exec('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT,applied_at TEXT)')
    for (const migration of SQLITE_MIGRATIONS.filter((m) => m.version < 8)) {
      db.exec(migration.up)
      db.prepare('INSERT INTO schema_migrations VALUES(?,?,?)').run(migration.version, migration.name, 'before')
    }
    db.prepare(
      "INSERT INTO users(id,name,email,password_hash,created_at,updated_at) VALUES(1,'Teste','test@example.invalid','hash','before','before')",
    ).run()
    db.prepare(
      "INSERT INTO works(id,user_id,source,source_id,title,metadata_json,paused,stage,message,created_at,updated_at) VALUES(1,1,'mangadex','one','Uma','{}',1,'blocked','Adaptação: A autorização foi revogada no KPassword.','before','before'),(2,1,'mangadex','two','Duas','{}',1,'paused','','before','before')",
    ).run()
    runSqliteMigrations(db)
    expect(db.prepare('SELECT id,paused FROM works ORDER BY id').all()).toEqual([
      { id: 1, paused: 0 },
      { id: 2, paused: 1 },
    ])
    expect(db.prepare('SELECT code,retry_after FROM translation_cooldown').get()).toEqual({
      code: 'permission_revoked',
      retry_after: Number.MAX_SAFE_INTEGER,
    })
    db.close()
  })
  it('devolve à tradução páginas descartadas por uma única fala incerta', () => {
    const db = new Database(':memory:')
    db.exec('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT,applied_at TEXT)')
    for (const migration of SQLITE_MIGRATIONS.filter((m) => m.version < 9)) {
      db.exec(migration.up)
      db.prepare('INSERT INTO schema_migrations VALUES(?,?,?)').run(migration.version, migration.name, 'before')
    }
    db.prepare(
      "INSERT INTO users(id,name,email,password_hash,created_at,updated_at) VALUES(1,'Teste','test@example.invalid','hash','before','before')",
    ).run()
    db.prepare(
      "INSERT INTO works(id,user_id,source,source_id,title,metadata_json,stage,created_at,updated_at) VALUES(1,1,'mangadex','one','Uma','{}','partial','before','before')",
    ).run()
    db.prepare(
      "INSERT INTO work_chapters(id,work_id,chapter_key,source_id,title,language,position,page_count,state,created_at,updated_at) VALUES(1,1,'c1','s1','','en',1,2,'partial','before','before')",
    ).run()
    db.prepare(
      "INSERT INTO work_pages(chapter_id,page_index,source_file,state,ocr_json,message) VALUES(1,0,'a','review','[]','Revisão (mimo / m): A fala 1 precisa de revisão humana por falta de contexto ou OCR incerto. A tradução não foi aplicada.'),(1,1,'b','review','[]','O OCR não conseguiu reconhecer o texto após nova tentativa.')",
    ).run()
    runSqliteMigrations(db)
    // Sem as linhas do texto (leitura antiga), a página volta para uma nova leitura (migração 15).
    expect(db.prepare('SELECT state FROM work_pages ORDER BY page_index').all()).toEqual([{ state: 'ocr' }, { state: 'review' }])
    expect(db.prepare('SELECT state FROM work_chapters').get()).toEqual({ state: 'queued' })
    expect(db.prepare('SELECT stage FROM works').get()).toEqual({ stage: 'queued' })
    db.close()
  })
  it('atualiza uma biblioteca existente e não repete migrações na reabertura', () => {
    const db = new Database(':memory:')
    db.exec('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT,applied_at TEXT)')
    for (const migration of SQLITE_MIGRATIONS.filter((migration) => migration.version < 5)) {
      db.exec(migration.up)
      db.prepare('INSERT INTO schema_migrations VALUES(?,?,?)').run(migration.version, migration.name, 'before')
    }
    db.prepare(
      `INSERT INTO users(id,name,email,password_hash,created_at,updated_at) VALUES(1,'Existente','existing@example.invalid','hash-preservado','before','before')`,
    ).run()
    runSqliteMigrations(db)
    runSqliteMigrations(db)
    expect(db.prepare('SELECT name,password_hash FROM users').get()).toEqual({ name: 'Existente', password_hash: 'hash-preservado' })
    expect(db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get()).toEqual({ n: SQLITE_MIGRATIONS.length })
    expect(db.prepare('SELECT COUNT(*) AS n FROM works').get()).toEqual({ n: 0 })
    db.close()
  })
  it('recupera erros de OCR da 0.4 sem alterar capítulos prontos ou já lidos', () => {
    const db = new Database(':memory:')
    db.exec('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT,applied_at TEXT)')
    for (const migration of SQLITE_MIGRATIONS.filter((m) => m.version < 6)) {
      db.exec(migration.up)
      db.prepare('INSERT INTO schema_migrations VALUES(?,?,?)').run(migration.version, migration.name, 'before')
    }
    db.prepare(
      "INSERT INTO users(id,name,email,password_hash,created_at,updated_at) VALUES(1,'Teste','test@example.invalid','hash','before','before')",
    ).run()
    db.prepare(
      "INSERT INTO works(id,user_id,source,source_id,title,metadata_json,created_at,updated_at,sync_requested) VALUES(1,1,'mangadex','source','Teste','{}','before','before',0)",
    ).run()
    db.prepare(
      "INSERT INTO work_chapters(id,work_id,chapter_key,source_id,title,language,position,page_count,state,message,read_done,created_at,updated_at) VALUES(1,1,'1','s1','','en',1,1,'ready','',1,'before','before'),(2,1,'2','s2','','en',2,1,'error','O OCR encontrou um balão ilegível.',0,'before','before')",
    ).run()
    runSqliteMigrations(db)
    expect(db.prepare('SELECT id,state,read_done FROM work_chapters ORDER BY id').all()).toEqual([
      { id: 1, state: 'ready', read_done: 1 },
      { id: 2, state: 'queued', read_done: 0 },
    ])
    expect(db.prepare('SELECT sync_requested FROM works').get()).toEqual({ sync_requested: 1 })
    db.close()
  })
  it('apply cleanly to an empty database and create core tables', () => {
    const db = new Database(':memory:')

    db.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `)

    for (const migration of SQLITE_MIGRATIONS) {
      db.exec(migration.up)
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
        migration.version,
        migration.name,
        new Date().toISOString(),
      )
    }

    const tables = db
      .prepare(
        `
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
      ORDER BY name ASC
    `,
      )
      .all() as Array<{ name: string }>

    expect(tables.map((table) => table.name)).toEqual(
      expect.arrayContaining([
        'users',
        'sessions',
        'sections',
        'section_images',
        'section_image_ocr_items',
        'translation_reports',
        'kv_store',
        'schema_migrations',
      ]),
    )

    const applied = db.prepare('SELECT version, name FROM schema_migrations').all()
    expect(applied).toEqual(SQLITE_MIGRATIONS.map(({ version, name }) => ({ version, name })))

    const translationReportColumns = db.prepare('PRAGMA table_info(translation_reports)').all() as Array<{ name: string }>

    expect(translationReportColumns.map((column) => column.name)).toEqual(expect.arrayContaining(['image_crop', 'corrected_text']))
    db.close()
  })
})
