import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'
import { SQLITE_MIGRATIONS } from '../lib/backend/shared/migrations'
vi.mock('../lib/backend/shared/database.module', () => ({ db: null }))
import { buildZip, readZip } from '../lib/server/cbz'
import {
  chaptersToUpload,
  ensureChapterLocal,
  evictChapters,
  packChapter,
  remoteChapterPath,
  uploadChapter,
  type Runner,
} from '../lib/backend/storage/cloud'
import { DEFAULT_STORAGE, parseStorageSettings, saveStorageSettings, type StorageSettings } from '../lib/backend/storage/settings'

// "Nuvem" falsa: o remoto fake: vira uma pasta temporária.
function fakeCloud(root: string): Runner {
  const local = (value: string) => (value.startsWith('fake:') ? path.join(root, value.slice(5)) : value)
  return async (_settings, args) => {
    if (args[0] === 'copyto') {
      fs.mkdirSync(path.dirname(local(args[2])), { recursive: true })
      fs.copyFileSync(local(args[1]), local(args[2]))
      return { ok: true, stdout: '', stderr: '', missing: false }
    }
    if (args[0] === 'lsjson') {
      const file = local(args[1])
      return { ok: true, stdout: JSON.stringify(fs.existsSync(file) ? [{ Size: fs.statSync(file).size }] : []), stderr: '', missing: false }
    }
    return { ok: false, stdout: '', stderr: 'unexpected', missing: false }
  }
}

function library(pages = 3) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koma-cloud-test-'))
  const db = new Database(':memory:')
  for (const migration of SQLITE_MIGRATIONS) db.exec(migration.up)
  const now = '2026-10-20'
  db.prepare(`INSERT INTO users (id,name,email,password_hash,created_at,updated_at) VALUES (1,'Local','l@example.invalid','x',?,?)`).run(
    now,
    now,
  )
  db.prepare(`INSERT INTO sections (id,user_id,name,created_at,updated_at) VALUES (5,1,'Cap 1',?,?)`).run(now, now)
  db.prepare(
    `INSERT INTO works (id,user_id,source,source_id,title,metadata_json,created_at,updated_at) VALUES (1,1,'teste','w1','Obra: Teste/1','{}',?,?)`,
  ).run(now, now)
  db.prepare(
    `INSERT INTO work_chapters (id,work_id,chapter_key,source_id,title,number,language,position,page_count,section_id,state,created_at,updated_at) VALUES (9,1,'k1','c1','1','1','en',1,?,5,'ready',?,?)`,
  ).run(pages, now, now)
  const section = path.join(dir, 'sections', '5')
  fs.mkdirSync(path.join(section, 'images'), { recursive: true })
  fs.mkdirSync(path.join(section, 'translated'), { recursive: true })
  for (let i = 0; i < pages; i++) {
    const original = path.join(section, 'images', `${String(i + 1).padStart(4, '0')}.jpg`)
    const translated = path.join(section, 'translated', `${String(i + 1).padStart(4, '0')}-abc.jpg`)
    fs.writeFileSync(original, Buffer.from(`original ${i}`))
    fs.writeFileSync(translated, Buffer.from(`traduzida ${i}`))
    const image = db
      .prepare(
        `INSERT INTO section_images (section_id,order_index,original_name,mime,size_bytes,original_path,translated_path,created_at,updated_at) VALUES (5,?,?,?,?,?,?,?,?)`,
      )
      .run(i, `${i}.jpg`, 'image/jpeg', 10, original, translated, now, now)
    db.prepare(`INSERT INTO work_pages (chapter_id,page_index,source_file,image_id,state) VALUES (9,?,?,?,'ready')`).run(
      i,
      `p${i}`,
      Number(image.lastInsertRowid),
    )
  }
  const settings: StorageSettings = { ...DEFAULT_STORAGE, provider: 'rclone', remote: 'fake:', folder: 'KOMA', mode: 'cloud', cacheGb: 0.5 }
  saveStorageSettings(db, settings)
  return { db, dir, section, settings, cloud: path.join(dir, 'nuvem') }
}

describe('arquivo .cbz do KOMA', () => {
  it('ida e volta preserva bytes e nomes', () => {
    const entries = [
      { name: '0001.jpg', data: Buffer.from('a') },
      { name: 'pasta/ção.txt', data: Buffer.from('b'.repeat(1000)) },
    ]
    expect(readZip(buildZip(entries))).toEqual(entries)
  })
})

describe('biblioteca na nuvem', () => {
  it('rejeita configurações inseguras', () => {
    expect(() =>
      parseStorageSettings({ provider: 'rclone', remote: 'sem-dois-pontos', folder: 'KOMA', mode: 'mirror', cacheGb: 2 }),
    ).toThrow()
    expect(() => parseStorageSettings({ provider: 'gdrive', remote: '', folder: '../fora', mode: 'mirror', cacheGb: 2 })).toThrow()
    expect(parseStorageSettings({ provider: 'gdrive', remote: 'x:', folder: 'KOMA', mode: 'cloud', cacheGb: 2 }).remote).toBe('')
  })

  it('envia o capítulo, libera espaço e traz de volta ao abrir', async () => {
    const { db, section, settings, cloud } = library()
    const run = fakeCloud(cloud)
    const before = Object.fromEntries(
      fs
        .readdirSync(section, { recursive: true })
        .filter((f) => !fs.statSync(path.join(section, String(f))).isDirectory())
        .map((f) => [String(f), fs.readFileSync(path.join(section, String(f)), 'utf8')]),
    )
    expect(chaptersToUpload(db)).toEqual([9])
    const packed = packChapter(db, 9)
    expect(packed.entries.map((entry) => entry.name)).toEqual(['0001.jpg', '0002.jpg', '0003.jpg', 'originais.zip', 'koma.json'])
    expect(remoteChapterPath(settings, packed.chapter)).toBe('fake:KOMA/Obra- Teste-1/Capítulo 0001.cbz')
    await uploadChapter(db, settings, 9, run)
    expect(chaptersToUpload(db)).toEqual([])
    // Os 3 próximos não lidos ficam no computador; marcado como lido, pode sair.
    expect(evictChapters(db, settings)).toBe(0)
    db.prepare('UPDATE work_chapters SET read_done=1 WHERE id=9').run()
    expect(evictChapters(db, { ...settings, cacheGb: 0 })).toBe(1)
    expect(fs.readdirSync(path.join(section, 'images'))).toEqual([])
    await ensureChapterLocal(db, 9, run)
    const after = Object.fromEntries(Object.keys(before).map((f) => [f, fs.readFileSync(path.join(section, f), 'utf8')]))
    expect(after).toEqual(before)
    expect((db.prepare('SELECT evicted FROM work_chapter_cloud WHERE chapter_id=9').get() as { evicted: number }).evicted).toBe(0)
  })

  it('reenvia quando uma página é refeita e não apaga cópia desatualizada', async () => {
    const { db, section, settings, cloud } = library()
    const run = fakeCloud(cloud)
    await uploadChapter(db, settings, 9, run)
    fs.writeFileSync(path.join(section, 'translated', '0001-abc.jpg'), Buffer.from('nova versão mais longa'))
    expect(chaptersToUpload(db)).toEqual([9])
    db.prepare('UPDATE work_chapters SET read_done=1 WHERE id=9').run()
    expect(evictChapters(db, { ...settings, cacheGb: 0 })).toBe(0)
  })
})
