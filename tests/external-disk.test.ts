import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SQLITE_MIGRATIONS } from '../lib/backend/shared/migrations'
vi.mock('../lib/backend/shared/database.module', () => ({ db: null }))
import { chaptersKeptLocal, ensureChapterLocal, retryCloudNow, runStorage, syncOnce, type Runner } from '../lib/backend/storage/cloud'
import { DISK_MARKER, DiskMissingError, findDisk, forgetDiskCache, listDisks, setupDisk } from '../lib/backend/storage/disk'
import { DEFAULT_STORAGE, parseStorageSettings, saveStorageSettings, type StorageSettings } from '../lib/backend/storage/settings'

// Obra com 10 capítulos prontos, de 2 páginas cada, e um "dispositivo externo"
// que é uma pasta temporária. Desconectar = renomear a pasta.
function library(chapters = 10) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koma-disk-test-'))
  const db = new Database(':memory:')
  for (const migration of SQLITE_MIGRATIONS) db.exec(migration.up)
  const now = '2026-10-24'
  db.prepare(`INSERT INTO users (id,name,email,password_hash,created_at,updated_at) VALUES (1,'Local','l@example.invalid','x',?,?)`).run(
    now,
    now,
  )
  db.prepare(
    `INSERT INTO works (id,user_id,source,source_id,title,metadata_json,created_at,updated_at) VALUES (1,1,'teste','w1','Obra','{}',?,?)`,
  ).run(now, now)
  for (let c = 1; c <= chapters; c++) {
    const sectionId = 100 + c
    db.prepare(`INSERT INTO sections (id,user_id,name,created_at,updated_at) VALUES (?,1,?,?,?)`).run(sectionId, `Cap ${c}`, now, now)
    db.prepare(
      `INSERT INTO work_chapters (id,work_id,chapter_key,source_id,title,number,language,position,page_count,section_id,state,created_at,updated_at) VALUES (?,1,?,?,?,?,'en',?,2,?,'ready',?,?)`,
    ).run(c, `k${c}`, `c${c}`, String(c), String(c), c, sectionId, now, now)
    const section = path.join(dir, 'library', 'sections', String(sectionId))
    fs.mkdirSync(path.join(section, 'images'), { recursive: true })
    fs.mkdirSync(path.join(section, 'translated'), { recursive: true })
    for (let i = 0; i < 2; i++) {
      const original = path.join(section, 'images', `${i + 1}.jpg`)
      const translated = path.join(section, 'translated', `${i + 1}-x.jpg`)
      fs.writeFileSync(original, Buffer.from(`original ${c}/${i} `.repeat(50)))
      fs.writeFileSync(translated, Buffer.from(`traduzida ${c}/${i} `.repeat(50)))
      const image = db
        .prepare(
          `INSERT INTO section_images (section_id,order_index,original_name,mime,size_bytes,original_path,translated_path,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`,
        )
        .run(sectionId, i, `${i}.jpg`, 'image/jpeg', 10, original, translated, now, now)
      db.prepare(`INSERT INTO work_pages (chapter_id,page_index,source_file,image_id,state) VALUES (?,?,?,?,'ready')`).run(
        c,
        i,
        `p${i}`,
        Number(image.lastInsertRowid),
      )
    }
  }
  const mount = path.join(dir, 'PENDRIVE')
  fs.mkdirSync(mount)
  const disk = setupDisk(mount, 'KOMA')
  const settings: StorageSettings = {
    ...DEFAULT_STORAGE,
    provider: 'disk',
    mode: 'cloud',
    diskId: disk.id,
    diskLabel: disk.label,
    diskPath: disk.path,
  }
  saveStorageSettings(db, settings)
  const sectionOf = (chapter: number) => path.join(dir, 'library', 'sections', String(100 + chapter))
  const snapshot = (chapter: number) =>
    Object.fromEntries(
      (fs.readdirSync(sectionOf(chapter), { recursive: true }) as string[])
        .filter((file) => fs.statSync(path.join(sectionOf(chapter), file)).isFile())
        .map((file) => [file, fs.readFileSync(path.join(sectionOf(chapter), file)).toString('base64')]),
    )
  const unplug = () => {
    fs.renameSync(mount, `${mount}-fora`)
    forgetDiskCache()
  }
  const plug = () => {
    fs.renameSync(`${mount}-fora`, mount)
    forgetDiskCache()
  }
  return { db, dir, mount, settings, sectionOf, snapshot, unplug, plug }
}

const local = (db: Database.Database) =>
  (
    db
      .prepare(
        'SELECT c.id FROM work_chapters c LEFT JOIN work_chapter_cloud k ON k.chapter_id=c.id WHERE COALESCE(k.evicted,0)=0 ORDER BY c.position',
      )
      .all() as Array<{ id: number }>
  ).map((row) => row.id)

async function sync(db: Database.Database, run: Runner = runStorage) {
  retryCloudNow()
  await syncOnce(db, run)
}

// Nunca varre os pontos de montagem de verdade: um HD dormindo deixaria o teste lento.
beforeEach(() => {
  vi.stubEnv('KOMA_DISK_ROOTS', fs.mkdtempSync(path.join(os.tmpdir(), 'koma-disk-roots-')))
  forgetDiskCache()
})

describe('dispositivo externo', () => {
  it('reconhece o dispositivo pelo koma-disco.json, não pelo caminho', () => {
    const { mount, settings, unplug, plug } = library(1)
    expect(fs.existsSync(path.join(mount, 'KOMA', DISK_MARKER))).toBe(true)
    expect(findDisk(settings)).toBe(mount)
    // Mesmo caminho, outro dispositivo: não é o mesmo.
    expect(findDisk({ ...settings, diskId: '00000000-0000-4000-8000-000000000000' })).toBeNull()
    unplug()
    expect(findDisk(settings)).toBeNull()
    plug()
    expect(findDisk(settings)).toBe(mount)
    // Preparar de novo reaproveita o código (reinstalação, outro computador).
    expect(setupDisk(mount, 'KOMA').id).toBe(settings.diskId)
  })

  it('lista os dispositivos montados e acha o escolhido num caminho novo', () => {
    const { dir, mount, settings } = library(1)
    vi.stubEnv('KOMA_DISK_ROOTS', dir)
    forgetDiskCache()
    expect(listDisks('KOMA').find((disk) => disk.path === mount)).toMatchObject({ label: 'PENDRIVE', hasKoma: true })
    // Montado com outro nome (outra letra no Windows): reconhecido pelo código.
    fs.renameSync(mount, path.join(dir, 'OUTRO-NOME'))
    forgetDiskCache()
    expect(findDisk(settings)).toBe(path.join(dir, 'OUTRO-NOME'))
  })

  it('valida a escolha do dispositivo e o número de capítulos', () => {
    const base = { ...DEFAULT_STORAGE, provider: 'disk' }
    expect(() => parseStorageSettings({ ...base, diskId: 'x', diskPath: '/run/media/a/HD' })).toThrow()
    expect(() => parseStorageSettings({ ...base, diskId: '00000000-0000-4000-8000-000000000000', diskPath: 'relativo' })).toThrow()
    expect(() =>
      parseStorageSettings({ ...base, diskId: '00000000-0000-4000-8000-000000000000', diskPath: '/run/media/a/HD', keepChapters: 0 }),
    ).toThrow()
    expect(parseStorageSettings({ ...DEFAULT_STORAGE, provider: 'local', diskId: 'x' }).diskId).toBe('')
  })

  it('deixa no computador os 3 mais novos e os 3 próximos não lidos, e o resto vai para o dispositivo', async () => {
    const { db, mount, sectionOf } = library(10)
    db.prepare('UPDATE work_chapters SET read_done=1 WHERE position<=3').run()
    expect([...chaptersKeptLocal(db, 3)].sort((a, b) => a - b)).toEqual([4, 5, 6, 8, 9, 10])
    await sync(db)
    // Todos têm cópia conferida no dispositivo, inclusive os que ficam.
    expect((db.prepare('SELECT COUNT(*) AS n FROM work_chapter_cloud').get() as { n: number }).n).toBe(10)
    expect(fs.readdirSync(path.join(mount, 'KOMA', 'Obra')).filter((f) => f.endsWith('.cbz'))).toHaveLength(10)
    expect(fs.readdirSync(path.join(mount, 'KOMA', 'Obra')).some((f) => f.endsWith('.partial'))).toBe(false)
    expect(local(db)).toEqual([4, 5, 6, 8, 9, 10])
    expect(fs.readdirSync(path.join(sectionOf(1), 'images'))).toEqual([])
    expect(fs.readdirSync(path.join(sectionOf(10), 'images'))).toHaveLength(2)
  })

  it('sem o dispositivo, avisa ao abrir um capítulo antigo; conectado, traz idêntico e mantém por um tempo', async () => {
    const { db, settings, snapshot, unplug, plug } = library(10)
    const before = snapshot(1)
    db.prepare('UPDATE work_chapters SET read_done=1 WHERE position<=3').run()
    await sync(db)
    expect(local(db)).not.toContain(1)
    unplug()
    await expect(ensureChapterLocal(db, 1)).rejects.toBeInstanceOf(DiskMissingError)
    await expect(ensureChapterLocal(db, 1)).rejects.toThrow(settings.diskLabel)
    // Sem o dispositivo nada muda: nem cópia nem limpeza.
    await sync(db)
    expect(local(db)).toEqual([4, 5, 6, 8, 9, 10])
    plug()
    await ensureChapterLocal(db, 1)
    expect(snapshot(1)).toEqual(before)
    await sync(db)
    expect(local(db)).toContain(1)
    // Passado o prazo, volta a ficar só no dispositivo.
    db.prepare(`UPDATE work_chapter_cloud SET restored_at='2020-01-01T00:00:00.000Z' WHERE chapter_id=1`).run()
    await sync(db)
    expect(local(db)).not.toContain(1)
  })

  it('quando a leitura volta para um capítulo antigo, os próximos voltam para o computador', async () => {
    const { db } = library(10)
    db.prepare('UPDATE work_chapters SET read_done=1').run()
    await sync(db)
    expect(local(db)).toEqual([8, 9, 10])
    // "Em qual capítulo parou?" voltou para o 2: o 2, o 3 e o 4 passam a ficar.
    db.prepare('UPDATE work_chapters SET read_done=0 WHERE position>=2').run()
    await sync(db)
    expect(local(db)).toEqual([2, 3, 4, 8, 9, 10])
  })

  it('dispositivo removido no meio da cópia ou cópia corrompida: nada é apagado do computador', async () => {
    const { db, mount, sectionOf, unplug } = library(4)
    db.prepare('UPDATE work_chapters SET read_done=1').run()
    const corrupt: Runner = async (settings, args) =>
      args[0] === 'sha1' ? { ok: true, stdout: 'errado', stderr: '', missing: false } : runStorage(settings, args)
    await sync(db, corrupt)
    expect((db.prepare('SELECT COUNT(*) AS n FROM work_chapter_cloud').get() as { n: number }).n).toBe(0)
    expect(local(db)).toEqual([1, 2, 3, 4])
    let copies = 0
    const removed: Runner = async (settings, args) => {
      if (args[0] === 'copyto' && ++copies === 2) unplug()
      return runStorage(settings, args)
    }
    await sync(db, removed)
    expect(
      (db.prepare('SELECT chapter_id FROM work_chapter_cloud').all() as Array<{ chapter_id: number }>).map((r) => r.chapter_id),
    ).toEqual([1])
    expect(local(db)).toEqual([1, 2, 3, 4])
    for (let c = 1; c <= 4; c++) expect(fs.readdirSync(path.join(sectionOf(c), 'images'))).toHaveLength(2)
    expect(fs.existsSync(mount)).toBe(false)
  })

  it('não apaga do computador se a cópia sumiu do dispositivo', async () => {
    const { db, mount, settings } = library(5)
    db.prepare('UPDATE work_chapters SET read_done=1').run()
    saveStorageSettings(db, { ...settings, mode: 'mirror' })
    await sync(db)
    expect(local(db)).toEqual([1, 2, 3, 4, 5])
    fs.rmSync(path.join(mount, 'KOMA', 'Obra', 'Capítulo 0001.cbz'))
    saveStorageSettings(db, settings)
    await sync(db)
    expect(local(db)).toEqual([1, 3, 4, 5])
  })
})
