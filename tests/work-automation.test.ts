import fs from 'node:fs'
import Database from 'better-sqlite3'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const { root, db } = vi.hoisted(() => ({ root: `/tmp/koma-work-tests-${process.pid}-${Date.now()}`, db: { prepare:vi.fn(), transaction:vi.fn() } }))
vi.mock('../lib/backend/shared/database.module', () => ({ db }))
vi.mock('../lib/backend/shared/data-paths', () => ({ getDataDir: () => root }))
vi.mock('../lib/server/manga-ocr-node', () => ({ extractTextBoxesNode: vi.fn() }))
import { SQLITE_MIGRATIONS } from '../lib/backend/shared/migrations'
import { WorksRepository } from '../lib/backend/works/repository'
import { SectionsRepository } from '../lib/backend/sections/sections.repository'
import { WorkAutomation, claimAutomationLock } from '../lib/backend/works/worker'
import { SourceError } from '../lib/backend/works/source-http'
import { TranslationError } from '../lib/backend/kpassword/settings'
import type { CatalogWork } from '../lib/works'

const ID = '11111111-1111-4111-8111-111111111111'
const metadata: CatalogWork = { source:'mangadex',sourceId:ID,title:'Obra sintética',originalTitle:'Original',aliases:[],description:'',descriptionLanguage:'pt-br',originalLanguage:'ja',authors:[],genres:[],year:null,coverFile:null }
describe('fila automática com checkpoints reais no SQLite e disco', () => {
  let memory: Database.Database; let repository:WorksRepository; let workId:number; let bytes:Buffer
  beforeEach(async () => {
    memory = new Database(':memory:'); for (const migration of SQLITE_MIGRATIONS) memory.exec(migration.up)
    memory.prepare(`INSERT INTO users(id,name,email,password_hash,role,created_at,updated_at) VALUES(1,'Teste','test@example.invalid','hash',4,'now','now')`).run()
    db.prepare.mockImplementation((sql:string) => memory.prepare(sql)); db.transaction.mockImplementation((fn) => memory.transaction(fn))
    repository = new WorksRepository(memory); workId = repository.add(1,metadata)
    repository.syncChapters(workId,[{ sourceId:ID,key:'chapter:1',number:'1',volume:'1',title:'',language:'en',position:1,pageCount:2 }])
    bytes = await sharp({ create:{width:400,height:300,channels:3,background:'#ffffff'} }).png().toBuffer()
  })
  afterEach(() => { memory.close(); fs.rmSync(root,{recursive:true,force:true}); vi.clearAllMocks() })
  function dependencies() {
    return {
      repository, sections:new SectionsRepository(), chapters:vi.fn(),
      pages:vi.fn().mockResolvedValue([{name:'first.png',url:'https://uploads.mangadex.org/first.png'},{name:'second.png',url:'https://uploads.mangadex.org/second.png'}]),
      download:vi.fn(async (_url: string) => ({bytes,mime:'image/png'})),
      extract:vi.fn(async () => ({detections:[{det_id:1,box:[20,20,300,200] as [number,number,number,number],ocr_text:'Hello',conf:0.9}]})),
      translate:vi.fn<(texts:string[],source:string)=>Promise<{translations:string[];flagged?:number[]}>>(async (texts) => ({translations:texts.map(()=>'Olá')})), authorized:() => true,
    }
  }
  const chapter = () => repository.nextChapter()!
  it('prepara todos os capítulos e balões sem interação por capítulo', async () => {
    const d = dependencies(); await new WorkAutomation(d).prepare(chapter(),new AbortController().signal)
    expect(repository.detail(workId,1)!.chapters[0].state).toBe('ready')
    expect(d.download).toHaveBeenCalledTimes(2); expect(d.translate).toHaveBeenCalledTimes(1)
    expect(d.translate.mock.calls[0][0]).toEqual(['Hello','Hello'])
    expect(memory.prepare('SELECT translated_text FROM section_image_ocr_items').all()).toEqual([{translated_text:'Olá'},{translated_text:'Olá'}])
    const image = memory.prepare('SELECT original_path FROM section_images LIMIT 1').get() as {original_path:string}
    expect(fs.readFileSync(image.original_path).equals(bytes)).toBe(true)
  })
  it('retoma após falha sem repetir download, OCR ou tradução das páginas prontas', async () => {
    const d = dependencies(); d.download.mockRejectedValueOnce(new SourceError('Interrompido',true))
    const engine = new WorkAutomation(d)
    const first = chapter(); await engine.prepare(first,new AbortController().signal)
    expect(repository.detail(workId,1)!.chapters[0].state).toBe('queued')
    repository.control(workId,1,'resume'); memory.prepare('UPDATE work_chapters SET retry_after=0').run()
    d.translate.mockRejectedValueOnce(new TranslationError('bridge_unavailable','Ponte indisponível',503))
    await engine.prepare(chapter(),new AbortController().signal)
    expect(repository.pages(first.id).map((page) => page.state)).toEqual(['translation','translation'])
    const downloads = d.download.mock.calls.length; const ocrs = d.extract.mock.calls.length
    repository.control(workId,1,'resume')
    memory.prepare('UPDATE translation_cooldown SET retry_after=0').run() // Simula o fim da janela de espera.
    await new WorkAutomation(d).prepare(chapter(),new AbortController().signal)
    expect(d.download).toHaveBeenCalledTimes(downloads); expect(d.extract).toHaveBeenCalledTimes(ocrs)
    expect(repository.detail(workId,1)!.chapters[0].state).toBe('ready')
  })
  it('baixa as páginas do capítulo em paralelo e grava na ordem', async () => {
    const d = dependencies()
    const names = Array.from({ length: 8 }, (_, index) => ({ name: `p${index}.png`, url: `https://uploads.mangadex.org/p${index}.png` }))
    d.pages.mockResolvedValue(names)
    memory.prepare('UPDATE work_chapters SET page_count=8').run()
    let running = 0; let peak = 0
    d.download.mockImplementation(async (url: string) => {
      const index = Number(/p(\d+)/.exec(url)![1])
      running++; peak = Math.max(peak, running)
      // As primeiras páginas demoram mais: chegam fora de ordem.
      await new Promise((resolve) => setTimeout(resolve, (8 - index) * 5))
      running--
      return { bytes: await sharp({ create: { width: 100 + index, height: 50, channels: 3, background: '#ffffff' } }).png().toBuffer(), mime: 'image/png' }
    })
    const first = chapter()
    await new WorkAutomation(d).prepare(first, new AbortController().signal, true)
    expect(d.download).toHaveBeenCalledTimes(8)
    expect(peak).toBeGreaterThan(1)
    expect(repository.pages(first.id).map((page) => page.width)).toEqual(names.map((_, index) => 100 + index))
    const order = memory.prepare('SELECT i.order_index, p.page_index FROM work_pages p JOIN section_images i ON i.id=p.image_id WHERE p.chapter_id=?').all(first.id) as Array<{ order_index: number; page_index: number }>
    expect(order.every((row) => row.order_index === row.page_index)).toBe(true)
  })
  it('lista e conserva a fila enquanto aguarda a autorização geral', async () => {
    const d = dependencies(); d.authorized=() => false
    await new WorkAutomation(d).prepare(chapter(),new AbortController().signal)
    expect(repository.detail(workId,1)!.chapters[0].state).toBe('blocked')
    expect(d.download).not.toHaveBeenCalled(); expect(d.translate).not.toHaveBeenCalled()
  })
  it('baixa todos os originais sem depender de autorização de tradução', async () => {
    const d = dependencies(); d.authorized=()=>false
    const first=chapter()
    await new WorkAutomation(d).prepare(first,new AbortController().signal,true)
    expect(d.download).toHaveBeenCalledTimes(2)
    // OCR local acompanha o download; só a chamada aos modelos espera o cofre.
    expect(d.extract).toHaveBeenCalledTimes(2); expect(d.translate).not.toHaveBeenCalled()
    expect(repository.pages(first.id).every(page=>page.image_id && page.state==='translation')).toBe(true)
    expect(repository.list(1)[0]).toMatchObject({downloadedPages:2,downloadedChapters:1,readyChapters:0})
    expect(repository.nextDownload()).toBeUndefined()
    expect(repository.nextChapter([],true)?.id).toBe(first.id)
  })
  it('cota esgotada aguarda globalmente, persiste na reabertura e permite baixar outro capítulo', async () => {
    const d=dependencies()
    const first=chapter()
    d.translate.mockRejectedValueOnce(new TranslationError('quota_exceeded','Limite por hora',429))
    await new WorkAutomation(d).prepare(first,new AbortController().signal)
    const retryAt=repository.cooldown()!.retryAt
    expect(retryAt-Date.now()).toBeGreaterThan(3590000)
    repository.control(workId,1,'resume')
    expect(new WorksRepository(memory).cooldown()?.retryAt).toBe(retryAt)
    await new WorkAutomation(d).prepare(chapter(),new AbortController().signal)
    expect(d.translate).toHaveBeenCalledTimes(1)
    expect(d.download).toHaveBeenCalledTimes(2)
    expect(repository.nextDownload()).toBeUndefined()
    expect(repository.list(1)[0].translationWait?.code).toBe('quota_exceeded')
    // Fim da janela: cofre e capítulo bloqueado expiram juntos.
    memory.prepare('UPDATE translation_cooldown SET retry_after=0').run(); memory.prepare('UPDATE work_chapters SET retry_after=0').run()
    expect(repository.cooldown()).toBeNull()
    await new WorkAutomation(d).prepare(chapter(),new AbortController().signal)
    expect(repository.detail(workId,1)!.chapters[0].state).toBe('ready')
  })
  it('uma tradução lenta não impede downloads de outro capítulo da mesma obra', async () => {
    repository.syncChapters(workId,[{sourceId:ID,key:'chapter:2',number:'2',volume:null,title:'',language:'en',position:2,pageCount:2}])
    const d=dependencies(); const engine=new WorkAutomation(d)
    const first=chapter();await engine.prepare(first,new AbortController().signal,true)
    let release!:()=>void
    d.translate.mockImplementationOnce(async(texts)=>{await new Promise<void>(resolve=>{release=resolve});return {translations:texts.map(()=>'Olá')}})
    const preparing=engine.prepare(repository.nextChapter([],true)!,new AbortController().signal)
    await vi.waitFor(()=>expect(release).toBeDefined())
    const next=repository.nextDownload()!
    expect(next.id).not.toBe(first.id)
    await engine.prepare(next,new AbortController().signal,true)
    expect(repository.pages(next.id).every(page=>page.image_id)).toBe(true)
    release();await preparing
    expect(repository.chapter(first.id)?.state).toBe('ready')
    expect(repository.chapter(next.id)?.state).toBe('downloaded')
  })
  it('coleta e reconhece o original coreano diretamente, sem trocar de versão', async () => {
    const first=chapter()
    memory.prepare("UPDATE work_chapters SET language='ko'").run()
    const d=dependencies();const engine=new WorkAutomation(d)
    await engine.prepare(repository.chapter(first.id)!,new AbortController().signal,true)
    expect(repository.chapter(first.id)?.language).toBe('ko')
    expect(d.download).toHaveBeenCalledTimes(2)
    expect(d.extract.mock.calls.every((call)=>(call as unknown[])[1]==='ko')).toBe(true)
    await engine.prepare(repository.nextChapter([],true)!,new AbortController().signal)
    expect(repository.chapter(first.id)?.state).toBe('ready')
    expect(d.translate.mock.calls[0][1]).toBe('ko')
  })
  it('não chama modelos quando a fonte já fornece PT-BR', async () => {
    memory.prepare("UPDATE work_chapters SET language='pt-br'").run()
    const d = dependencies(); d.authorized=() => false
    await new WorkAutomation(d).prepare(chapter(),new AbortController().signal)
    expect(d.extract).not.toHaveBeenCalled(); expect(d.translate).not.toHaveBeenCalled()
    expect(repository.detail(workId,1)!.chapters[0].state).toBe('ready')
  })
  it('um capítulo estrangeiro sem texto reconhecido não aparece como tradução pronta',async()=>{
    const d=dependencies();d.extract.mockResolvedValue({detections:[]})
    await new WorkAutomation(d).prepare(chapter(),new AbortController().signal)
    expect(d.translate).not.toHaveBeenCalled()
    expect(repository.detail(workId,1)!.chapters[0].state).toBe('partial')
    expect(repository.pages(repository.detail(workId,1)!.chapters[0].id).every(page=>page.state==='review')).toBe(true)
  })
  it('recusa no cofre bloqueia só a tradução e não dispara outra aprovação automaticamente', async () => {
    const d = dependencies(); d.translate.mockRejectedValue(new TranslationError('user_denied','Recusado',502))
    await new WorkAutomation(d).prepare(chapter(),new AbortController().signal)
    expect(repository.list(1)[0].paused).toBe(false)
    expect(repository.cooldown()?.manual).toBe(true)
    expect(repository.nextDownload()).toBeUndefined()
    expect(d.download).toHaveBeenCalledTimes(2)
    expect(d.translate).toHaveBeenCalledTimes(1)
    repository.control(workId,1,'resume'); expect(repository.cooldown()).toBeNull()
    expect(repository.nextChapter()).toBeDefined()
  })
  it('não aplica texto inventado quando o OCR informa balão ilegível', async () => {
    const d = dependencies(); d.extract.mockResolvedValue({detections:[{det_id:1,box:[20,20,300,200],ocr_text:'',conf:0.9}]})
    await new WorkAutomation(d).prepare(chapter(),new AbortController().signal)
    expect(d.translate).not.toHaveBeenCalled()
    expect(repository.detail(workId,1)!.chapters[0].state).toBe('partial')
    expect(d.download).toHaveBeenCalledTimes(2)
    expect(repository.pages(repository.detail(workId,1)!.chapters[0].id).every((page)=>page.state==='review')).toBe(true)
  })
  it('recupera balões com uma tentativa local antes de traduzir', async () => {
    const d = {...dependencies(),recover:vi.fn(async (_bytes:Buffer,detections:any[]) => detections.map((d)=>({...d,ocr_text:'Hello',ocr_error:''})))}
    d.extract.mockResolvedValue({detections:[{det_id:1,box:[20,20,300,200],ocr_text:'',conf:0.9}]})
    await new WorkAutomation(d).prepare(chapter(),new AbortController().signal)
    expect(d.recover).toHaveBeenCalledTimes(2)
    expect(repository.detail(workId,1)!.chapters[0].state).toBe('ready')
  })
  it('traduz balões legíveis sem encobrir os incertos e continua as próximas páginas', async () => {
    const d = dependencies()
    d.extract.mockResolvedValueOnce({detections:[{det_id:1,box:[20,20,150,180],ocr_text:'Hello',conf:0.9},{det_id:2,box:[160,20,300,180],ocr_text:'',conf:0.9}]})
    await new WorkAutomation(d).prepare(chapter(),new AbortController().signal)
    const detail = repository.detail(workId,1)!
    expect(detail.chapters[0].state).toBe('ready')
    const pages = repository.pages(detail.chapters[0].id)
    expect(pages.map((page)=>page.state)).toEqual(['ready','ready'])
    expect(pages[0].message).toContain('ilegíveis')
    expect(d.translate.mock.calls[0][0]).toEqual(['Hello','Hello'])
  })
  it('alterna as obras após uma página sem repetir etapas salvas', async () => {
    const secondId = repository.add(1,{...metadata,sourceId:'22222222-2222-4222-8222-222222222222'})
    repository.syncChapters(secondId,[{sourceId:ID,key:'chapter:1',number:'1',volume:'1',title:'',language:'en',position:1,pageCount:2}])
    const d = {...dependencies(),quantum:1}
    const first = chapter()
    await new WorkAutomation(d).prepare(first,new AbortController().signal)
    expect(repository.pages(first.id).map((page)=>page.state)).toEqual(['ready','download'])
    expect(chapter().work_id).toBe(secondId)
    await new WorkAutomation(d).prepare(chapter(),new AbortController().signal)
    // Mesma marca temporal ainda respeita a ordem estável e volta à primeira obra.
    memory.prepare('UPDATE works SET last_processed_at=last_processed_at+1 WHERE id=?').run(secondId)
    expect(chapter().work_id).toBe(workId)
    await new WorkAutomation(d).prepare(chapter(),new AbortController().signal)
    expect(repository.detail(workId,1)!.chapters[0].state).toBe('ready')
    expect(d.translate).toHaveBeenCalledTimes(3)
  })
  it('uma tradução aguardando resposta não impede a preparação de outra obra em PT-BR',async()=>{
    const second=repository.add(1,{...metadata,sourceId:'22222222-2222-4222-8222-222222222222'})
    repository.syncChapters(second,[{sourceId:ID,key:'chapter:1',number:'1',volume:null,title:'',language:'pt-br',position:0,pageCount:2}])
    const d=dependencies();let release!:()=>void
    d.translate.mockImplementation(async()=>{await new Promise<void>(resolve=>{release=resolve});return {translations:['Olá']}})
    const engine=new WorkAutomation({...d,quantum:1});const first=repository.nextChapter([second])!
    const waiting=engine.prepare(first,new AbortController().signal)
    for(let i=0;i<50&&!release;i++)await new Promise(resolve=>setTimeout(resolve,2))
    expect(release).toBeTypeOf('function')
    const next=repository.nextChapter([workId])!
    expect(next.work_id).toBe(second)
    await engine.prepare(next,new AbortController().signal)
    expect(repository.pages(next.id)[0].state).toBe('ready')
    release();await waiting
  })
  it('tenta outra versão do capítulo preservando o original da tentativa anterior', async () => {
    const alternative = {sourceId:'22222222-2222-4222-8222-222222222222',key:'chapter:1',number:'1',volume:'1',title:'',language:'pt-br',position:1,pageCount:2}
    repository.syncChapters(workId,[{...alternative,sourceId:ID,language:'en',alternatives:[alternative]}])
    const d = dependencies(); d.extract.mockResolvedValue({detections:[{det_id:1,box:[20,20,300,200],ocr_text:'',conf:0.9}]})
    await new WorkAutomation(d).prepare(chapter(),new AbortController().signal)
    expect(chapter().source_id).toBe(alternative.sourceId)
    const archived = memory.prepare('SELECT section_id,pages_json FROM work_chapter_attempts').get() as {section_id:number;pages_json:string}
    expect(JSON.parse(archived.pages_json)).toHaveLength(2)
    const original=memory.prepare('SELECT original_path FROM section_images WHERE section_id=? LIMIT 1').get(archived.section_id) as {original_path:string}
    expect(fs.readFileSync(original.original_path).equals(bytes)).toBe(true)
    await new WorkAutomation(d).prepare(chapter(),new AbortController().signal)
    expect(repository.detail(workId,1)!.chapters[0].state).toBe('ready')
    expect(d.translate).not.toHaveBeenCalled()
  })
  it('não duplica páginas depois de reabrir a obra pronta', async () => {
    const d = dependencies(); const current = chapter(); const engine = new WorkAutomation(d)
    await engine.prepare(current,new AbortController().signal)
    await engine.prepare(repository.chapter(current.id)!,new AbortController().signal)
    expect(memory.prepare('SELECT COUNT(*) AS n FROM section_images').get()).toEqual({n:2})
    expect(d.translate).toHaveBeenCalledTimes(1)
  })
  it('aplica a tradução de falas incertas e registra a dúvida na página', async () => {
    const d = dependencies(); d.translate.mockResolvedValueOnce({translations:['Olá','Oi'],flagged:[1]})
    await new WorkAutomation(d).prepare(chapter(),new AbortController().signal)
    const pages = repository.pages(repository.detail(workId,1)!.chapters[0].id)
    expect(pages.map(page=>page.state)).toEqual(['ready','ready'])
    expect(pages[1].message).toContain('incerto')
    expect(memory.prepare('SELECT translated_text FROM section_image_ocr_items ORDER BY id').all()).toEqual([{translated_text:'Olá'},{translated_text:'Oi'}])
  })
  it('retoma a posse da fila quando o processo anterior não existe mais', () => {
    expect(claimAutomationLock(repository,'first',process.pid)).toBe(true)
    expect(claimAutomationLock(repository,'second',process.pid)).toBe(false)
    memory.prepare("UPDATE automation_lock SET pid=2147483647,process_started='dead'").run()
    expect(claimAutomationLock(repository,'second',process.pid)).toBe(true)
  })
})
