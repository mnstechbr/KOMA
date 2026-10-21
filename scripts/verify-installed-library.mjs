import fs from 'node:fs/promises'
import path from 'node:path'
import {createRequire} from 'node:module'
import assert from 'node:assert/strict'

const bundle=(await fs.readFile('artifacts/latest-bundle.txt','utf8')).trim()
const output=path.resolve('artifacts/fontes-reais-0.4.2')
const baseline=JSON.parse(await fs.readFile('artifacts/backup-0.4.2.json','utf8'))
const require=createRequire(import.meta.url)
const {startBackend}=require(path.join(bundle,'electron/resources/app/backend.cjs'))
const log=await fs.open(path.join(output,'leitura-backend.log'),'a')
const backend=await startBackend({nodePath:path.join(bundle,'runtime/node'),serverDir:path.join(bundle,'server'),dataDir:path.join(process.env.HOME,'.local/share/koma/library'),logFd:log.fd,automation:false})
try {
 const session=await backend.bootstrap();const headers={Cookie:`koma-session=${session.sessionToken}`,Origin:backend.url}
 const get=route=>fetch(backend.url+route,{headers})
 const works=[];const newlyReady=[]
 for(const [id] of baseline.works) {
  const detail=await (await get(`/api/local/works/${id}`)).json()
  for(const [chapterId,workId] of baseline.ready.filter(row=>row[1]===id)) {
   assert.equal(workId,id);assert.equal(detail.chapters.find(chapter=>chapter.id===chapterId)?.state,'ready')
  }
  const oldIds=new Set(baseline.ready.map(row=>row[0]))
  for(const chapter of detail.chapters.filter(chapter=>chapter.state==='ready'&&!oldIds.has(chapter.id))) {
   const response=await get(`/api/local/works/${id}/chapters/${chapter.id}`)
   assert.equal(response.status,200);const reader=await response.json()
   assert.equal(reader.pages.length,chapter.pageCount)
   for(const page of reader.pages) {
    const image=await get(page.originalUrl)
    assert.equal(image.status,200);assert.match(image.headers.get('content-type'),/^image\//)
    assert.ok((await image.arrayBuffer()).byteLength>0)
   }
   newlyReady.push({work:detail.work.title,workId:id,chapter:chapter.number,chapterId:chapter.id,sourceLanguage:chapter.language,readerStatus:response.status,imagesChecked:reader.pages.length})
  }
  works.push({id,title:detail.work.title,cataloged:detail.chapters.length,ready:detail.work.readyChapters,stage:detail.work.stage,paused:detail.work.paused})
 }
 const evidence={checkedAt:new Date().toISOString(),installedBundle:bundle,baselineReadyPreserved:baseline.ready.length,works,newlyReady,verificationModelCalls:0}
 await fs.writeFile(path.join(output,'biblioteca-instalada.json'),JSON.stringify(evidence,null,2))
 console.log(JSON.stringify(evidence,null,2))
}finally {await backend.stop();await log.close()}
