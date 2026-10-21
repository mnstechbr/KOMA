import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'

const root = path.resolve(import.meta.dirname, '..')
const bundle = (await fs.readFile(path.join(root, 'artifacts/latest-bundle.txt'), 'utf8')).trim()
const require = createRequire(path.join(bundle, 'server/package.json'))
const sharp = require('sharp')
const { startBackend } = require(path.join(bundle, 'electron/resources/app/backend.cjs'))
// Esta ferramenta cria somente uma biblioteca temporária de imagens sintéticas próprias.
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'koma-ui-fixture-'))
const dataDir = path.join(temp, 'library')
await fs.mkdir(dataDir)
const log = await fs.open(path.join(temp, 'backend.log'), 'a')
const backend = await startBackend({ nodePath: path.join(bundle, 'runtime/node'), serverDir: path.join(bundle, 'server'), dataDir, logFd: log.fd, automation: false })
const titles = ['Cidade de papel', 'Do outro lado', 'Fragmentos da noite', 'Linhas do amanhã']
const tones = ['#c7aa92', '#c1bec2', '#839599', '#b49a9f']
try {
  const session = await backend.bootstrap()
  const headers = { Cookie: `koma-session=${session.sessionToken}`, Origin: backend.url }
  for (let index = 0; index < titles.length; index++) {
    const buildings = Array.from({ length: 14 }, (_, i) => {
      const height = 160 + ((i * 83 + index * 41) % 290)
      const windows = Array.from({ length: 8 }, (_, row) => `<path d="M${i * 48 + 8} ${650 - row * 32}h9m7 0h9" stroke="${tones[index]}" stroke-width="4"/>`).join('')
      return `<rect x="${i * 48}" y="${720 - height}" width="44" height="${height}" fill="#181922" stroke="${tones[index]}" stroke-width="1"/>${windows}`
    }).join('')
    const rays = Array.from({ length: 20 }, (_, i) => `<path d="M320 300L${i * 45 - 100} -100" stroke="#fff" stroke-opacity=".12" stroke-width="1"/>`).join('')
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="900"><rect width="640" height="900" fill="${tones[index]}"/><rect x="24" y="24" width="592" height="852" fill="none" stroke="#272530" stroke-width="2"/><circle cx="390" cy="320" r="185" fill="#eee7dc"/>${rays}${buildings}<rect y="720" width="640" height="180" fill="#17171e"/><text x="40" y="80" font-family="sans-serif" font-size="12" letter-spacing="4" fill="#272530">KOMA / AMOSTRA SINTÉTICA</text><text x="40" y="790" font-family="serif" font-size="43" fill="#f5eee4">${titles[index]}</text><text x="43" y="842" font-family="sans-serif" font-size="12" letter-spacing="3" fill="#c7b6bf">CAPÍTULO 0${index + 1} — TESTE DA INTERFACE</text></svg>`
    const buffer = await sharp(Buffer.from(svg)).png().toBuffer()
    const form = new FormData()
    form.append('name', titles[index]); form.append('defer_processing', 'true')
    form.append('files', new Blob([buffer], { type: 'image/png' }), `amostra-${index + 1}.png`)
    const response = await fetch(`${backend.url}/api/sections`, { method: 'POST', headers, body: form })
    if (!response.ok) throw new Error('Falha ao importar a amostra sintética.')
    const { section } = await response.json()
    if (index === 0) {
      await fetch(`${backend.url}/api/local/library/${section.id}`, { method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ favorite: true, opened: true }) })
    }
    if (index === 2) {
      await fetch(`${backend.url}/api/sections/${section.id}/read-progress`, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ done: true }) })
    }
  }
  await fs.writeFile(path.join(root, 'artifacts/ui-fixture.json'), JSON.stringify({ dataDir, titles }, null, 2))
  console.log(`Biblioteca de teste criada somente em ${dataDir}`)
} finally { await backend.stop(); await log.close() }
const Database = require('better-sqlite3')
const database = new Database(path.join(dataDir, 'local.sqlite'))
const sections = database.prepare('SELECT s.id,i.id AS image_id,i.original_name FROM sections s JOIN section_images i ON i.section_id=s.id ORDER BY s.id').all()
for (const [index, section] of sections.entries()) {
  const id = `00000000-0000-4000-8000-${String(index+1).padStart(12,'0')}`
  const metadata = { source:'mangadex',sourceId:id,title:titles[index],originalTitle:`Título sintético ${index+1}`,aliases:[{language:'en',title:`Alias de teste ${index+1}`}],description:'Obra sintética própria para verificar a interface. Não é um mangá publicado.',descriptionLanguage:'pt-br',originalLanguage:'ja',authors:['KOMA / teste'],genres:[],year:2026,coverFile:null }
  const now = new Date().toISOString()
  const workId = Number(database.prepare(`INSERT INTO works(user_id,source,source_id,title,metadata_json,stage,sync_requested,created_at,updated_at) VALUES(1,'mangadex',?,?,?,'ready',0,?,?)`).run(id,metadata.title,JSON.stringify(metadata),now,now).lastInsertRowid)
  const chapterId = Number(database.prepare(`INSERT INTO work_chapters(work_id,chapter_key,source_id,title,number,language,position,page_count,section_id,state,created_at,updated_at) VALUES(?,'chapter:1',?,'Teste da leitura','1','en',1,1,?,'ready',?,?)`).run(workId,id,section.id,now,now).lastInsertRowid)
  const ocr = [{det_id:1,box:[90,100,550,260],ocr_text:'Hello, reader.',background:'#ffffff',foreground:'#111111'}]
  database.prepare(`INSERT INTO work_pages(chapter_id,page_index,source_file,image_id,state,ocr_json,width,height) VALUES(?,0,?,?,'ready',?,640,900)`).run(chapterId,section.original_name,section.image_id,JSON.stringify(ocr))
  database.prepare(`INSERT INTO section_image_ocr_items(section_image_id,det_id,x1,y1,x2,y2,ocr_text,translated_text,created_at) VALUES(?,1,90,100,550,260,'Hello, reader.','Olá, leitura em português.',?)`).run(section.image_id,now)
}
database.close()
