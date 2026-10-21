import {checkedSourceUrl,SourceError} from './source-http'
import {aggregators} from './aggregators'

export const sourceConnectors = [
  {id:'jump',name:'Shonen Jump+',country:'Japão',index:true,pages:true,note:'Índice e páginas públicas. Episódios pagos não são obtidos.'},
  {id:'mangaplus',name:'MANGA Plus',country:'Japão',index:false,pages:false,note:'Conector de catálogo e páginas ainda não implementado.'},
  {id:'naver',name:'Naver Webtoon',country:'Coreia',index:true,pages:true,note:'Fonte original de muitos manhwas. Pesquisa pelo título coreano, índice público e páginas gratuitas, com OCR coreano local.'},
  {id:'kakao',name:'KakaoPage',country:'Coreia',index:false,pages:false,note:'Vínculo original identificado; catálogo dinâmico e páginas ainda sem conector.'},
  {id:'lezhin',name:'Lezhin Comics',country:'Coreia',index:true,pages:false,note:'Consulta do índice público. Páginas com controle de acesso não são obtidas.'},
  {id:'kuaikan',name:'Kuaikan Manhua',country:'China',index:true,pages:false,note:'Índice e prévias públicos. A consulta integral exige verificação da fonte; prévias não viram capítulos prontos.'},
  {id:'tencent',name:'Tencent Dongman',country:'China',index:true,pages:false,note:'Consulta do índice público. O decodificador de páginas não está implementado.'},
  {id:'webtoons',name:'WEBTOON',country:'Oficial (EN)',index:true,pages:true,note:'Publicação oficial em inglês. Pesquisa automática pelo título; somente episódios gratuitos.'},
  {id:'mangadex',name:'MangaDex',country:'Alternativa',index:true,pages:true,note:'Pesquisa por títulos e aliases, metadados, capítulos e imagens públicas.'},
] as const
export function identifySource(value:string) {
  const aggregator=aggregators.find(connector=>connector.work(value.trim()))
  if(aggregator)return {provider:aggregator.id,url:value.trim()}
  const url=checkedSourceUrl(value)
  if(url.hash || url.search && url.hostname!=='comic.naver.com')throw new SourceError('Link de fonte inválido.')
  const rules:[string,string,RegExp][]=[['kuaikan','www.kuaikanmanhua.com',/^\/web\/topic\/\d+\/?$/],['jump','shonenjumpplus.com',/^\/episode\/\d+$/],['naver','comic.naver.com',/^\/webtoon\/list$/],['tencent','ac.qq.com',/^\/Comic\/comicInfo\/id\/\d+$/],['lezhin','www.lezhin.com',/^\/(ko|en|ja)\/comic\/[a-zA-Z0-9_-]+$/],['kakao','page.kakao.com',/^\/content\/\d+\/?$/],['mangaplus','mangaplus.shueisha.co.jp',/^\/titles\/\d+$/]]
  const rule=rules.find(([,host,pattern])=>host===url.hostname && pattern.test(url.pathname))
  if(!rule || rule[0]==='naver' && !/^\d+$/.test(url.searchParams.get('titleId') || ''))throw new SourceError('Use o link da obra em uma das fontes listadas.')
  return {provider:rule[0],url:url.href}
}
