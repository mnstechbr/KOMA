import {it,expect} from 'vitest'
import {catalogMetadata,searchAllCatalogs,catalogChapters} from '../lib/backend/works/catalog'

it.skipIf(process.env.KOMA_REAL_CATALOG!=='1')('pesquisa no MangaDex e resolve metadados e capítulos',async()=>{
  const result=await searchAllCatalogs('Eminence in Shadow')
  expect(result.sources).toEqual([{name:'MangaDex',available:true}])
  const found=result.results.find(work=>work.source==='mangadex')!
  expect(found).toBeDefined()
  const work=await catalogMetadata(found.sourceId)
  expect(work.title.length).toBeGreaterThan(0)
  const chapters=await catalogChapters(work.sourceId)
  expect(chapters.length).toBeGreaterThan(10)
  console.log(JSON.stringify({sources:result.sources,results:result.results.length,work:work.title,chapters:chapters.length,modelCalls:0}))
},90000)
