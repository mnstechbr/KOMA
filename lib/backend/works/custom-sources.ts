import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type Database from 'better-sqlite3'
import { parseDocument, DomUtils } from 'htmlparser2'
import type { CatalogWork } from '@/lib/works'
import { getDataDir } from '../shared/data-paths'
import * as kit from './aggregator-kit'
import { madara, type AggregatorConnector } from './aggregator-kit'
import { setUserConnectors } from './aggregators'
import { setPromoNames } from '@/lib/promo-text'
import { shareMlPromoNames } from '@/lib/server/ml'
import { checkedSourceUrl, registerSourceHosts, sourceBytes, SourceError, type SourceHostRule } from './source-http'

// Fontes que o próprio usuário adiciona. O KOMA não traz nenhum site não oficial:
// - fontes personalizadas: sites com o tema Madara (WordPress), cadastrados nas
//   Preferências pelo link de uma obra;
// - conectores locais: arquivos .mjs na pasta "connectors" dos dados do KOMA,
//   para sites com outro formato. Ficam só no computador do usuário.
export interface CustomSource { id: string; name: string; origin: string; kind: string; imageHosts?: string[] }
interface CatalogSource { id: string; name: string; search: (query: string, signal?: AbortSignal) => Promise<CatalogWork[]>; work: (sourceId: string, signal?: AbortSignal) => Promise<CatalogWork>; chaptersOf: (sourceId: string, signal?: AbortSignal) => ReturnType<AggregatorConnector['chapters']>; workUrl: (slug: string) => string }
interface LocalConnectors { connectors?: AggregatorConnector[]; hosts?: Array<{ match: RegExp | string[]; referer?: string }> }

const KEY = 'koma:custom-sources:v1'
// Identificadores já usados pelas fontes embutidas.
const RESERVED = new Set(['mangadex', 'webtoons', 'naver', 'jump', 'mangaplus', 'kakao', 'lezhin', 'kuaikan', 'tencent', 'search', 'original', 'alternative'])
const state = (globalThis as typeof globalThis & { __komaSources?: { key: string; stamp: string; checkedAt: number; catalogs: Map<string, CatalogSource>; local: AggregatorConnector[]; localHosts: string[]; loading: Promise<void> | null } })
  .__komaSources ||= { key: '\0', stamp: '\0', checkedAt: 0, catalogs: new Map(), local: [] as AggregatorConnector[], localHosts: [] as string[], loading: null }

export function connectorsDir() { return path.join(getDataDir(), 'connectors') }

/** Domínio registrável (exemplo.com, exemplo.com.br): imagens do mesmo site em subdomínios. */
export function baseDomain(host: string) {
  const labels = host.toLowerCase().split('.')
  const second = labels.at(-2) || ''
  return labels.slice(labels.at(-1)!.length === 2 && ['co', 'com', 'net', 'org', 'gov', 'edu', 'ac'].includes(second) ? -3 : -2).join('.')
}
function hostRule(source: CustomSource): SourceHostRule {
  const base = baseDomain(new URL(source.origin).hostname)
  const extra = new Set(source.imageHosts || [])
  return { allows: (host) => host === base || host.endsWith(`.${base}`) || extra.has(host), referer: `${source.origin}/` }
}

export function listCustomSources(database: Database.Database): CustomSource[] {
  const row = database.prepare('SELECT value FROM kv_store WHERE key = ?').get(KEY) as { value: string } | undefined
  try {
    const list = row ? JSON.parse(row.value) : []
    return Array.isArray(list) ? list.filter((item) => item && typeof item.id === 'string' && typeof item.origin === 'string' && typeof item.kind === 'string') : []
  } catch { return [] }
}
function save(database: Database.Database, list: CustomSource[]) {
  database.prepare(`INSERT INTO kv_store (key, value, expires_at) VALUES (?, ?, NULL)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = NULL`).run(KEY, JSON.stringify(list))
}

/** Lê o link de uma obra (https://site/pasta/obra/) e monta a fonte, sem consultar a rede. */
export function sourceFromWorkUrl(value: string, taken: string[] = []) {
  let url: URL
  try { url = new URL(value.trim()) } catch { throw new SourceError('Cole o link de uma obra no site.') }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) throw new SourceError('Use um link https da obra no site.')
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts.length < 2 || !/^[a-z0-9-]{1,40}$/.test(parts[0]) || !/^[a-z0-9-]{1,180}$/.test(parts[1])) throw new SourceError('Cole o link da página de uma obra, como https://site.com/manga/nome-da-obra/.')
  const label = url.hostname.replace(/^www\./, '').split('.')[0].replace(/[^a-z0-9-]/g, '').slice(0, 30) || 'fonte'
  let id = RESERVED.has(label) ? `${label}-site` : label
  for (let n = 2; taken.includes(id); n++) id = `${label}-${n}`
  const source: CustomSource = { id, name: url.hostname.replace(/^www\./, ''), origin: url.origin, kind: parts[0] }
  return { source, workUrl: `${url.origin}/${parts[0]}/${parts[1]}/` }
}

/**
 * Cadastra um site com o tema Madara a partir do link de uma obra. Confere se o
 * site responde no formato esperado (índice de capítulos e imagens do leitor).
 */
export async function addCustomSource(database: Database.Database, value: string, name?: string, signal?: AbortSignal) {
  const list = listCustomSources(database)
  const { source, workUrl } = sourceFromWorkUrl(value, list.map((item) => item.id))
  if (list.some((item) => item.origin === source.origin)) throw new SourceError('Este site já está nas suas fontes.')
  if (name?.trim()) source.name = name.trim().slice(0, 40)
  registerSourceHosts(`custom:${source.id}`, hostRule(source))
  try {
    const page = (await sourceBytes(workUrl, false, signal)).bytes.toString('utf8')
    if (!/wp-manga|manga-chapters-holder|c-page-content/.test(page)) throw new SourceError('Este site não usa o modelo Madara. Ele precisa de um conector próprio.')
    const site = madara({ ...source, imageHost: () => true })
    const chapters = await site.connector.chapters(workUrl, signal)
    // Servidores de imagem fora do domínio do site, vistos no último capítulo.
    const html = parseDocument((await sourceBytes(chapters.at(-1)!.sourceId, false, signal)).bytes.toString('utf8'))
    const hosts = new Set<string>()
    for (const node of DomUtils.findAll((item) => item.name === 'img' && kit.hasClass(item, 'wp-manga-chapter-img'), html.children)) {
      try { hosts.add(checkedSourceUrl(new URL((node.attribs['data-src'] || node.attribs.src || '').trim(), workUrl).href).hostname) } catch { /* Endereço inválido: ignorado. */ }
    }
    const base = baseDomain(new URL(source.origin).hostname)
    const extra = [...hosts].filter((host) => host !== base && !host.endsWith(`.${base}`))
    if (!hosts.size) throw new SourceError('O site respondeu, mas o leitor do capítulo não mostrou as imagens no formato esperado.')
    if (extra.length) source.imageHosts = extra.slice(0, 8)
    save(database, [...listCustomSources(database), source])
    await ensureSources(database, true)
    return { source, chapters: chapters.length }
  } catch (error) {
    registerSourceHosts(`custom:${source.id}`, null)
    throw error
  }
}

export async function removeCustomSource(database: Database.Database, id: string) {
  const list = listCustomSources(database)
  if (!list.some((item) => item.id === id)) return false
  save(database, list.filter((item) => item.id !== id))
  await ensureSources(database, true)
  return true
}

/** Fonte de catálogo (busca de obras) pelo prefixo do identificador ("site:obra"). */
export function catalogFor(sourceId: string) { return state.catalogs.get(sourceId.slice(0, sourceId.indexOf(':'))) }
export function customCatalogs() { return [...state.catalogs.values()] }
export function localConnectors() { return [...state.local] }

function localFiles() {
  try { return fs.readdirSync(connectorsDir()).filter((file) => file.endsWith('.mjs')).sort() } catch { return [] }
}
async function loadLocal(files: string[]) {
  const connectors: AggregatorConnector[] = []
  for (const id of state.localHosts) registerSourceHosts(id, null)
  state.localHosts = []
  for (const file of files) {
    const full = path.join(connectorsDir(), file)
    try {
      const href = `${pathToFileURL(full).href}?v=${fs.statSync(full).mtimeMs}`
      const loaded = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ href) as { default?: (api: typeof kit) => LocalConnectors | Promise<LocalConnectors> }
      const result = await loaded.default?.(kit)
      for (const [index, rule] of (result?.hosts || []).entries()) {
        const allows = rule.match instanceof RegExp ? (host: string) => (rule.match as RegExp).test(host) : (host: string) => (rule.match as string[]).includes(host)
        registerSourceHosts(`local:${file}:${index}`, { allows, referer: rule.referer })
        state.localHosts.push(`local:${file}:${index}`)
      }
      for (const connector of result?.connectors || []) if (connector && typeof connector.id === 'string' && typeof connector.owns === 'function') connectors.push({ ...connector, official: false })
    } catch (error) {
      console.error('[KOMA] Conector local não carregou', { file, error: error instanceof Error ? error.message : 'erro' })
    }
  }
  state.local = connectors
}

/**
 * Monta as fontes do usuário (personalizadas e locais). Barato quando nada mudou:
 * compara o cadastro e, a cada 10 s, a pasta dos conectores locais.
 */
export async function ensureSources(database: Database.Database, force = false) {
  while (state.loading) await state.loading
  const row = database.prepare('SELECT value FROM kv_store WHERE key = ?').get(KEY) as { value: string } | undefined
  const key = row?.value || ''
  let stamp = state.stamp
  if (force || Date.now() - state.checkedAt > 10000) {
    state.checkedAt = Date.now()
    stamp = localFiles().map((file) => { try { return `${file}:${fs.statSync(path.join(connectorsDir(), file)).mtimeMs}` } catch { return file } }).join('|')
  }
  if (!force && key === state.key && stamp === state.stamp) return
  state.loading = (async () => {
    if (stamp !== state.stamp) await loadLocal(localFiles())
    const custom = listCustomSources(database)
    for (const id of state.catalogs.keys()) registerSourceHosts(`custom:${id}`, null)
    state.catalogs = new Map()
    const connectors: AggregatorConnector[] = []
    for (const source of custom) {
      const rule = hostRule(source)
      registerSourceHosts(`custom:${source.id}`, rule)
      const site = madara({ ...source, imageHost: rule.allows })
      connectors.push(site.connector)
      state.catalogs.set(source.id, { id: source.id, name: source.name, search: site.catalogSearch, work: site.catalogWork, workUrl: site.workUrl,
        chaptersOf: (sourceId, signal) => site.connector.chapters(site.workUrl(sourceId.slice(source.id.length + 1)), signal) })
    }
    const ids = new Set(connectors.map((item) => item.id))
    const all = [...connectors, ...state.local.filter((item) => !ids.has(item.id))]
    setUserConnectors(all)
    // O nome do site carimbado nas páginas não é fala.
    const promoNames = all.flatMap((item) => [item.id, item.name, ...custom.filter((source) => source.id === item.id).map((source) => new URL(source.origin).hostname.replace(/^www\./, '').split('.')[0])])
    setPromoNames(promoNames)
    shareMlPromoNames(promoNames)
    state.key = key; state.stamp = stamp
  })().finally(() => { state.loading = null })
  await state.loading
}
