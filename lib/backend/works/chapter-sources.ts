import { normalizeTitle, type CatalogWork, type SourceChapter } from '@/lib/works'
import { catalogWork, listSourceChapters, searchCatalog, sourcePages } from './mangadex'
import { catalogChapters, customWorkUrl } from './catalog'
import { naverChapters, naverPages } from './naver'
import { SourceError } from './source-http'
import { kuaikanChapters, kuaikanPages } from './kuaikan'
import { jumpChapters, jumpPages } from './jump-plus'
import { identifySource, sourceConnectors } from './source-registry'
import { officialIndex } from './official-index'
import { aggregatorFor, aggregators, findOnAggregator, searchTitles, versionRank } from './aggregators'
import { findNaverOriginal } from './naver'
import type { WorksRepository, WorkRow } from './repository'

// Só consolidar números entre fontes quando há uma correspondência única.
// Volumes com numeração reiniciada e especiais preservam sua identidade.
export function mergeChapterSources(groups: SourceChapter[][], existing: SourceChapter[] = [], target = 'pt-br') {
  const result = new Map<string, SourceChapter>(existing.map((chapter) => [chapter.key, { ...chapter }]))
  for (const chapters of groups) {
    // Fonte que recomeça a numeração a cada volume (dois "capítulo 1" em volumes
    // diferentes): nela, o volume faz parte da identidade do capítulo.
    const volumesOf = new Map<string, Set<string>>()
    for (const chapter of chapters)
      if (chapter.number && chapter.volume) volumesOf.set(chapter.number, (volumesOf.get(chapter.number) || new Set()).add(chapter.volume))
    for (const chapter of chapters) {
      const numbered = chapter.number ? [...result.values()].filter((item) => item.number === chapter.number) : []
      // Capítulo com volume (como no MangaDex) junta ao de mesmo número sem ambiguidade.
      const mergeable = numbered.length === 1 && (!chapter.volume || (volumesOf.get(chapter.number!)?.size ?? 0) <= 1)
      const key = result.has(chapter.key) ? chapter.key : mergeable ? numbered[0].key : chapter.key
      const previous = result.get(key)
      if (!previous) result.set(key, { ...chapter })
      else {
        const candidates = [...(previous.alternatives || []), chapter, ...(chapter.alternatives || [])]
        previous.alternatives = [
          ...new Map(
            candidates
              .filter((item) => item.sourceId !== previous.sourceId)
              .map((item) => [item.sourceId, { ...item, key, alternatives: undefined }]),
          ).values(),
        ]
      }
    }
  }
  // A versão principal de cada capítulo segue a prioridade de fontes (original
  // primeiro); capítulos já existentes mantêm a versão em uso na fila.
  const ranked = [...result.values()].map((chapter) => {
    const versions = [chapter, ...(chapter.alternatives || [])].map((version) => ({ ...version, alternatives: undefined }))
    const [primary, ...others] = versions.sort((a, b) => versionRank(a, target) - versionRank(b, target))
    return { ...primary, key: chapter.key, alternatives: others.map((version) => ({ ...version, key: chapter.key })) }
  })
  return ranked
    .sort((a, b) => Number(a.number || 1e9) - Number(b.number || 1e9) || a.position - b.position)
    .map((chapter, position) => ({ ...chapter, position }))
}

export async function discoverWorkChapters(repository: WorksRepository, work: WorkRow, signal: AbortSignal) {
  const groups: SourceChapter[][] = []
  const errors: unknown[] = []
  const record = (kind: string, url: string, status: string, message: string) =>
    repository.database
      .prepare(
        'INSERT INTO work_source_checks VALUES(?,?,?,?,?,?) ON CONFLICT(work_id,kind,url) DO UPDATE SET status=excluded.status,message=excluded.message,checked_at=excluded.checked_at',
      )
      .run(work.id, kind, url, status, message, new Date().toISOString())
  const metadata = JSON.parse(repository.row(work.id)!.metadata_json)
  const boundSources = repository.database.prepare('SELECT provider,url FROM work_catalog_sources WHERE work_id=?').all(work.id) as {
    provider: string
    url: string
  }[]
  // Capítulos já conhecidos: índices do mais novo ao mais antigo param no primeiro deles.
  const known = new Set(
    (
      repository.database
        .prepare('SELECT source_id FROM work_source_versions WHERE work_id=? UNION SELECT source_id FROM work_chapters WHERE work_id=?')
        .all(work.id, work.id) as { source_id: string }[]
    ).map((row) => row.source_id),
  )
  // Pesquisa pelo título que não achou a obra fica guardada uns dias, sem repetir a cada procura.
  // Nomes novos da obra (vindos de outra fonte) valem uma pesquisa nova em todos os sites.
  let titlesChanged = false
  const recentSearch = (url: string) => {
    if (titlesChanged) return false
    const row = repository.database
      .prepare('SELECT status,checked_at FROM work_source_checks WHERE work_id=? AND url=?')
      .get(work.id, url) as { status: string; checked_at: string } | undefined
    if (!row) return false
    const age = Date.now() - new Date(row.checked_at).getTime()
    return (row.status === 'not_found' && age < 5 * 86400000) || (row.status === 'unavailable' && age < 86400000)
  }
  const originals = new Map<string, { provider: string; url: string }>()
  for (const link of metadata.publicationLinks || [])
    if (link.kind === 'original') {
      try {
        const source = identifySource(link.url)
        originals.set(source.url, source)
      } catch {
        /* Vínculos sem conector permanecem visíveis nos detalhes. */
      }
    }
  // Vínculos de fontes do usuário que não estão mais cadastradas ficam de fora.
  for (const source of boundSources)
    if (
      source.provider !== 'mangadex' &&
      !aggregators.some((connector) => connector.id === source.provider) &&
      sourceConnectors.some((item) => item.id === source.provider)
    )
      originals.set(source.url, source)
  // Fonte primeiro: sem vínculo original conhecido, pesquisar a obra na
  // plataforma de origem pelo título no idioma original.
  if (
    metadata.originalLanguage === 'ko' &&
    ![...originals.values()].some((source) => source.provider === 'naver') &&
    !recentSearch('search:naver')
  ) {
    try {
      const found = await findNaverOriginal(metadata, signal)
      if (found) {
        originals.set(found, { provider: 'naver', url: found })
        repository.database
          .prepare('INSERT OR IGNORE INTO work_catalog_sources(work_id,provider,url) VALUES(?,?,?)')
          .run(work.id, 'naver', found)
      } else
        record(
          'original',
          'search:naver',
          'not_found',
          'Naver Webtoon: obra não encontrada pelo título original. Pode ser publicada em outra plataforma (ex.: KakaoPage).',
        )
    } catch (error) {
      if (signal.aborted) throw error
      record('original', 'search:naver', 'unavailable', 'Naver Webtoon: a pesquisa não respondeu.')
    }
  }
  // A publicação original é consultada antes das alternativas. Contagens de
  // catálogos sem coleta de páginas não viram capítulos falsamente disponíveis.
  for (const original of originals.values()) {
    try {
      let chapters: SourceChapter[] = []
      let count = 0
      let message = ''
      let status = 'available'
      if (original.provider === 'naver') {
        const data = await naverChapters(original.url, signal, known)
        chapters = data.chapters
        count = data.total
        message =
          chapters.length + data.paid >= data.total
            ? `Naver: ${data.total} episódios listados; ${chapters.length} públicos e ${data.paid} pagos. Coleta apenas das páginas públicas.`
            : `Naver: ${data.total} episódios listados; índice consultado até o último episódio já conhecido.`
      } else if (original.provider === 'jump') {
        chapters = await jumpChapters(original.url, signal)
        count = chapters.length
        message = `Jump+: ${count} episódios consultados. Somente páginas públicas são obtidas.`
      } else if (original.provider === 'kuaikan') {
        const data = await kuaikanChapters(original.url, signal)
        count = data.total
        status = 'catalog_only'
        message = `Kuaikan: ${data.chapters.length} episódios no índice público (${count} declarados). A prévia não é um capítulo completo. A coleta integral exige verificação da fonte.`
      } else {
        const data = await officialIndex(original.provider, original.url, signal)
        count = data.total || 0
        message = data.message
        const capability = sourceConnectors.find((source) => source.id === original.provider)
        status = capability?.index ? 'catalog_only' : 'connector_required'
        if (original.provider === 'tencent') message = `${count} entradas públicas. ${message}`
      }
      if (chapters.length) groups.push(chapters)
      record('original', original.url, status, message)
      repository.database
        .prepare('UPDATE work_catalog_sources SET status=?,chapter_count=?,message=?,checked_at=? WHERE work_id=? AND url=?')
        .run(status, count, message, new Date().toISOString(), work.id, original.url)
    } catch (error) {
      if (signal.aborted) throw error
      errors.push(error)
      const message = error instanceof SourceError ? error.message : 'Não foi possível consultar esta publicação original.'
      record('original', original.url, 'unavailable', message)
      repository.database
        .prepare("UPDATE work_catalog_sources SET status='unavailable',message=?,checked_at=? WHERE work_id=? AND url=?")
        .run(message, new Date().toISOString(), work.id, original.url)
    }
  }
  // Fonte do catálogo onde a obra foi adicionada: MangaDex ou uma fonte personalizada.
  const custom = work.source === 'mangadex' ? null : customWorkUrl(work.source_id)
  const catalogUrl = custom?.url || (work.source === 'mangadex' ? `https://mangadex.org/title/${work.source_id}` : `search:${work.source}`)
  const catalogName = custom?.name || (work.source === 'mangadex' ? 'MangaDex' : work.source)
  try {
    const chapters = await catalogChapters(work.source_id, signal)
    groups.unshift(chapters)
    record('alternative', catalogUrl, 'available', `${catalogName}: ${chapters.length} capítulos consolidados.`)
  } catch (error) {
    if (signal.aborted) throw error
    errors.push(error)
    record('alternative', catalogUrl, 'unavailable', error instanceof SourceError ? error.message : `Falha na consulta ao ${catalogName}.`)
  }
  // Fontes alternativas: pesquisa automática pelo título quando ainda não há
  // vínculo e consulta independente de cada uma, em paralelo.
  const primary = custom?.url || ''
  let titles = searchTitles(metadata)
  // MangaDex também para obras vindas de outras fontes. Os nomes de lá (inclusive
  // os alternativos) ajudam a achar a mesma obra nos outros sites.
  if (work.source !== 'mangadex') {
    const bound = boundSources.find((source) => source.provider === 'mangadex')
    let found: CatalogWork | null = null
    try {
      if (bound) found = await catalogWork(bound.url.split('/').pop() || '', signal)
      else if (!recentSearch('search:mangadex')) {
        found = await findOnMangaDex(titles, signal)
        if (found) {
          repository.database
            .prepare('INSERT OR IGNORE INTO work_catalog_sources(work_id,provider,url) VALUES(?,?,?)')
            .run(work.id, 'mangadex', `https://mangadex.org/title/${found.sourceId}`)
          repository.database.prepare("DELETE FROM work_source_checks WHERE work_id=? AND url='search:mangadex'").run(work.id)
        } else record('alternative', 'search:mangadex', 'not_found', 'MangaDex: obra não encontrada pelo título.')
      }
      if (found) {
        const chapters = await listSourceChapters(found.sourceId, signal)
        groups.push(chapters)
        record(
          'alternative',
          `https://mangadex.org/title/${found.sourceId}`,
          'available',
          `MangaDex: ${chapters.length} capítulos consolidados.`,
        )
        titles = searchTitles({
          ...metadata,
          aliases: [...(metadata.aliases || []), { language: 'en', title: found.title }, ...found.aliases],
        })
      }
    } catch (error) {
      if (signal.aborted) throw error
      record(
        'alternative',
        bound?.url || 'search:mangadex',
        'unavailable',
        error instanceof SourceError ? `MangaDex: ${error.message}` : 'MangaDex: falha na consulta.',
      )
    }
  }
  {
    // Nomes usados na última pesquisa: quando aparecem nomes novos, a pesquisa é refeita.
    const key = `koma:work-titles:v1:${work.id}`
    const signature = titles
      .map((title) => normalizeTitle(title))
      .sort()
      .join('|')
    const previous = (repository.database.prepare('SELECT value FROM kv_store WHERE key=?').get(key) as { value: string } | undefined)
      ?.value
    titlesChanged = previous !== signature
    repository.database
      .prepare('INSERT INTO kv_store (key, value, expires_at) VALUES (?, ?, NULL) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, signature)
  }
  // WEBTOON e as fontes que o próprio usuário adicionou.
  const results = await Promise.allSettled(
    aggregators.map(async (connector) => {
      let links = boundSources.filter((source) => source.provider === connector.id && source.url !== primary).map((source) => source.url)
      if (!links.length && !boundSources.some((source) => source.provider === connector.id)) {
        if (recentSearch(`search:${connector.id}`)) return []
        try {
          const match = await findOnAggregator(connector, titles, signal)
          if (!match) {
            record('alternative', `search:${connector.id}`, 'not_found', `${connector.name}: obra não encontrada pelo título.`)
            return []
          }
          repository.database
            .prepare('INSERT OR IGNORE INTO work_catalog_sources(work_id,provider,url) VALUES(?,?,?)')
            .run(work.id, connector.id, match.url)
          repository.database.prepare('DELETE FROM work_source_checks WHERE work_id=? AND url=?').run(work.id, `search:${connector.id}`)
          links = [match.url]
        } catch (error) {
          if (signal.aborted) throw error
          record(
            'alternative',
            `search:${connector.id}`,
            'unavailable',
            error instanceof SourceError ? `${connector.name}: ${error.message}` : `${connector.name}: falha na pesquisa.`,
          )
          return []
        }
      }
      const found: SourceChapter[][] = []
      for (const url of links) {
        try {
          const chapters = await connector.chapters(url, signal, known)
          found.push(chapters)
          repository.database
            .prepare(
              "UPDATE work_catalog_sources SET status='available',chapter_count=MAX(chapter_count,?),message='',checked_at=? WHERE work_id=? AND url=?",
            )
            .run(chapters.length, new Date().toISOString(), work.id, url)
          record(
            'alternative',
            url,
            'available',
            `${connector.name}: ${chapters.length} entradas lidas no índice${chapters.some((item) => !known.has(item.sourceId)) ? '' : ' (nenhuma nova)'}. A disponibilidade das páginas é conferida na coleta.`,
          )
        } catch (error) {
          if (signal.aborted) throw error
          errors.push(error)
          const message = error instanceof SourceError ? error.message : `Falha na consulta ao ${connector.name}.`
          repository.database
            .prepare("UPDATE work_catalog_sources SET status='unavailable',message=?,checked_at=? WHERE work_id=? AND url=?")
            .run(message, new Date().toISOString(), work.id, url)
          record('alternative', url, 'unavailable', message)
        }
      }
      return found
    }),
  )
  if (signal.aborted) throw new SourceError('Processamento pausado.', false, 'paused')
  for (const result of results) if (result.status === 'fulfilled') groups.push(...result.value)
  if (!groups.length) throw errors[0] || new SourceError('Nenhuma fonte de capítulos respondeu.', true)
  const existing = repository.detail(work.id, work.user_id)!.chapters
  return mergeChapterSources(groups, existing, work.target_language)
}
/** A mesma obra no MangaDex: algum nome (principal ou alternativo) idêntico a um dos conhecidos. */
export async function findOnMangaDex(titles: string[], signal?: AbortSignal) {
  const known = new Set(titles.map((title) => normalizeTitle(title).replace(/^the /, '')))
  for (const title of titles.slice(0, 3)) {
    const results = await searchCatalog(title, signal, false)
    const match = results.find((work) =>
      [work.title, work.originalTitle, ...work.aliases.map((alias) => alias.title)].some(
        (name) => name && known.has(normalizeTitle(name).replace(/^the /, '')),
      ),
    )
    if (match) return match
  }
  return null
}
export async function chapterPages(id: string, signal?: AbortSignal) {
  const aggregator = aggregatorFor(id)
  if (aggregator) return aggregator.pages(id, signal)
  if (id.startsWith('https://comic.naver.com/')) return naverPages(id, signal)
  if (id.startsWith('https://www.kuaikanmanhua.com/')) return kuaikanPages(id, signal)
  if (id.startsWith('https://shonenjumpplus.com/')) return jumpPages(id, signal)
  if (id.startsWith('https://'))
    throw new SourceError(
      'A fonte deste capítulo não está mais nas suas fontes. Adicione o site de novo ou use outra versão.',
      false,
      'content_unavailable',
    )
  return sourcePages(id, signal)
}
