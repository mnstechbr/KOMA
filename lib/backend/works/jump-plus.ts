import {parseDocument,DomUtils} from 'htmlparser2'
import type {SourceChapter} from '@/lib/works'
import {checkedSourceUrl,sourceBytes,SourceError} from './source-http'

function episodeUrl(value:string) {
  const url=checkedSourceUrl(value)
  if(url.hostname!=='shonenjumpplus.com'||!/^\/episode\/\d+$/.test(url.pathname)||url.search)throw new SourceError('Link de episódio Jump+ inválido.')
  return url
}
export function parseJumpEpisode(html:string,value:string) {
  const url=episodeUrl(value)
  const script=DomUtils.findOne(node=>node.attribs.id==='episode-json',parseDocument(html).children)
  let episode:any
  try{episode=JSON.parse(script?.attribs['data-value'] || '').readableProduct}catch{throw new SourceError('O Jump+ não retornou os dados públicos do episódio.')}
  if(!episode || episode.permalink!==url.href || !episode.series?.id)throw new SourceError('O Jump+ retornou outro episódio.')
  return episode
}
export async function jumpChapters(value:string,signal?:AbortSignal) {
  let url=episodeUrl(value).href;const seen=new Set<string>();const episodes=new Map<string,any>();let series:string|undefined
  // Percorrer também os anteriores quando o vínculo aponta para uma atualização.
  for(let direction=0;direction<2;direction++) {
    while(url) {
      if(seen.has(`${direction}:${url}`)||episodes.size>=2000)throw new SourceError('O Jump+ interrompeu a paginação de episódios.',true)
      seen.add(`${direction}:${url}`)
      const episode=episodes.get(url) || parseJumpEpisode((await sourceBytes(url,false,signal)).bytes.toString('utf8'),url)
      if(series && episode.series.id!==series)throw new SourceError('A lista do Jump+ mudou de obra.')
      series=episode.series.id;episodes.set(url,episode)
      if(direction===0 && !episode.prevReadableProductUri)break
      url=episodeUrl(direction===0?episode.prevReadableProductUri:episode.nextReadableProductUri || value).href
      if(direction===1 && !episode.nextReadableProductUri)break
    }
  }
  return [...episodes.values()].sort((a,b)=>a.number-b.number).map((episode,position):SourceChapter=>{
    const number=/番外|特別|休載/.test(episode.title)?null:String(episode.number)
    return {sourceId:episode.permalink,key:number?`chapter:${number}`:`jump:${episode.id}`,number,volume:null,title:episode.title,language:'ja',position,pageCount:episode.pageStructure?.pages?.filter((page:any)=>page.type==='main').length || 0}
  })
}
export function parseJumpPages(html:string,url:string) {
  const episode=parseJumpEpisode(html,url)
  const pages=episode.isPublic===true?episode.pageStructure?.pages?.filter((page:any)=>page.type==='main'):[]
  if(!pages?.length)throw new SourceError('Este episódio Jump+ não tem páginas públicas disponíveis.',false,'content_unavailable')
  return pages.map((page:any,index:number)=>{
    const url=checkedSourceUrl(page.src)
    if(url.hostname!=='cdn-ak-img.shonenjumpplus.com'||!url.pathname.startsWith('/public/page/'))throw new SourceError('Página Jump+ não permitida.',false,'destination_blocked')
    return {name:`page-${String(index+1).padStart(4,'0')}.jpg`,url:url.href}
  })
}
export async function jumpPages(url:string,signal?:AbortSignal) {return parseJumpPages((await sourceBytes(url,false,signal)).bytes.toString('utf8'),url)}
