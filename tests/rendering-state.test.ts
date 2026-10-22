import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'
import { SQLITE_MIGRATIONS } from '../lib/backend/shared/migrations'
vi.mock('server-only', () => ({}))
vi.mock('../lib/backend/shared/database.module', () => ({ db: null }))
import { WorksRepository } from '../lib/backend/works/repository'
import { chaptersDoneRendering } from '../lib/backend/works/render'

describe('capítulo só fica pronto com as páginas traduzidas desenhadas', () => {
  it('espera o desenho e depois fica pronto', () => {
    const db = new Database(':memory:')
    for (const migration of SQLITE_MIGRATIONS) db.exec(migration.up)
    db.prepare(`INSERT INTO users (id,name,email,password_hash,created_at,updated_at) VALUES (1,'L','l@x.invalid','x','d','d')`).run()
    db.prepare(`INSERT INTO sections (id,user_id,name,created_at,updated_at) VALUES (3,1,'S','d','d')`).run()
    db.prepare(
      `INSERT INTO works (id,user_id,source,source_id,title,metadata_json,created_at,updated_at) VALUES (1,1,'mangadex','x','T','{}','d','d')`,
    ).run()
    db.prepare(
      `INSERT INTO work_chapters (id,work_id,chapter_key,source_id,title,number,language,position,page_count,section_id,state,created_at,updated_at) VALUES (5,1,'k','s','1','1','en',1,1,3,'translating','d','d')`,
    ).run()
    db.prepare(
      `INSERT INTO section_images (id,section_id,order_index,original_name,mime,size_bytes,original_path,created_at,updated_at) VALUES (9,3,0,'1.jpg','image/jpeg',1,'/tmp/1.jpg','d','d')`,
    ).run()
    db.prepare(
      `INSERT INTO work_pages (chapter_id,page_index,source_file,image_id,state,ocr_json) VALUES (5,0,'p',9,'ready','[{"det_id":0,"lines":[[0,0,1,1]]}]')`,
    ).run()
    db.prepare(
      `INSERT INTO section_image_ocr_items (section_image_id,det_id,cls_name,conf,x1,y1,x2,y2,ocr_text,translated_text,created_at) VALUES (9,0,'balloon',1,0,0,1,1,'Hi','Oi','d')`,
    ).run()
    const repository = new WorksRepository(db)
    repository.completeChapter(repository.chapter(5)!)
    expect(repository.chapter(5)!.state).toBe('rendering')
    expect(repository.nextChapter()).toBeUndefined()
    expect(chaptersDoneRendering(db)).toEqual([])
    db.prepare("UPDATE section_images SET translated_path='/tmp/1-t.jpg' WHERE id=9").run()
    expect(chaptersDoneRendering(db)).toEqual([5])
    repository.completeChapter(repository.chapter(5)!)
    expect(repository.chapter(5)!.state).toBe('ready')
  })
})
