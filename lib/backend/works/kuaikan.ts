import type {SourceChapter} from '@/lib/works'
import {readNuxtData,findData} from './public-data'
import {checkedSourceUrl,sourceBytes,SourceError} from './source-http'

export function parseKuaikanChapters(html:string,value:string) {
  const url=checkedSourceUrl(value);const id=/^\/web\/topic\/(\d+)$/.exec(url.pathname)?.[1]
  if(url.hostname!=='www.kuaikanmanhua.com'||!id)throw new SourceError('Link de obra Kuaikan inválido.')
  const topic=findData(readNuxtData(html),item=>String(item.id)===id && Array.isArray(item.comics))
  if(!topic)throw new SourceError('A Kuaikan não retornou o índice público desta obra.')
  const chapters:SourceChapter[]=topic.comics.map((entry:any,position:number)=>{
    if(!Number.isSafeInteger(entry.id)||typeof entry.title!=='string')throw new SourceError('Episódio Kuaikan inválido.')
    const number=/第\s*(\d+)\s*[话話]/.exec(entry.title)?.[1] || null
    return {sourceId:`https://www.kuaikanmanhua.com/web/comic/${entry.id}`,key:number?`chapter:${number}`:`kuaikan:${entry.id}`,number,volume:null,title:entry.title,language:'zh',position,pageCount:0}
  })
  return {chapters,total:topic.comics_count || chapters.length,title:topic.title}
}
export async function kuaikanChapters(url:string,signal?:AbortSignal) {return parseKuaikanChapters((await sourceBytes(url,false,signal)).bytes.toString('utf8'),url)}
export function parseKuaikanPages(html:string,value:string) {
  const url=checkedSourceUrl(value);const id=/^\/web\/comic\/(\d+)$/.exec(url.pathname)?.[1]
  if(url.hostname!=='www.kuaikanmanhua.com'||!id)throw new SourceError('Capítulo Kuaikan inválido.')
  const comic=findData(readNuxtData(html),item=>String(item.id)===id && (Array.isArray(item.images)||Array.isArray(item.comic_images)||Array.isArray(item.comicImages)))
  if(!comic || comic.locked || comic.is_pay_comic || comic.need_vip)throw new SourceError('As páginas deste capítulo Kuaikan não estão disponíveis publicamente.',false,'content_unavailable')
  const images=comic.images || comic.comic_images || comic.comicImages
  if(!images.length || images.length>2000)throw new SourceError('A Kuaikan não retornou páginas públicas válidas.')
  return images.map((image:any,index:number)=>{
    const url=checkedSourceUrl(typeof image==='string'?image:image.url)
    if(!/^(f[1-5]|tn1)\.kkmh\.com$/.test(url.hostname)||!url.pathname.startsWith('/image/'))throw new SourceError('Imagem Kuaikan não permitida.',false,'destination_blocked')
    return {name:`page-${String(index+1).padStart(4,'0')}.jpg`,url:url.href}
  })
}
export async function kuaikanPages(url:string,signal?:AbortSignal):Promise<Array<{name:string;url:string}>> {
  if(signal?.aborted)throw new SourceError('Processamento pausado.',false,'paused')
  if(checkedSourceUrl(url).hostname!=='www.kuaikanmanhua.com')throw new SourceError('Fonte Kuaikan inválida.')
  // O SSR contém só duas imagens de prévia. A consulta integral exige uma
  // verificação da fonte (código 3504), que este conector não contorna.
  throw new SourceError('A Kuaikan disponibilizou somente a prévia. A coleta integral exige verificação da fonte; buscando outra versão do capítulo.',false,'content_unavailable')
}
