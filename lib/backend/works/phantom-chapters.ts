// Capítulo "fantasma": listado por uma fonte só, enquanto pelo menos duas outras fontes
// da obra têm capítulos antes e depois dele e o pulam. Exemplo real: um agregador lista
// 82.5 e 82.8 sem páginas, e a editora (Naver) e mais três fontes vão do 82 direto ao 83.
// Ele fica dispensado, não conta no total e não prende a fila; se outra fonte passar a
// listá-lo, volta para a fila sozinho. Capítulo novo que só uma fonte já publicou não é
// fantasma: nenhuma outra fonte tem capítulo depois dele.
export const PHANTOM_WITNESSES = 2

export interface ChapterVersion {
  key: string
  sourceId: string
  number: string | null
}

/** Fonte de uma versão: o site (sem www), ou o próprio identificador quando não é endereço. */
export function sourceHost(sourceId: string) {
  try {
    return new URL(sourceId).hostname.replace(/^www\./, '')
  } catch {
    return sourceId.split(/[:/]/)[0] || sourceId
  }
}

/** Fontes que listam cada capítulo. */
export function hostsByChapter(versions: ChapterVersion[]) {
  const hosts = new Map<string, Set<string>>()
  for (const version of versions) {
    const set = hosts.get(version.key) || new Set<string>()
    set.add(sourceHost(version.sourceId))
    hosts.set(version.key, set)
  }
  return hosts
}

/** Capítulos fantasma, com a fonte que os lista. */
export function phantomChapters(versions: ChapterVersion[], witnesses = PHANTOM_WITNESSES) {
  const hosts = hostsByChapter(versions)
  // Menor e maior número listado por cada fonte, e os números que ela tem.
  const range = new Map<string, { min: number; max: number; numbers: Set<number> }>()
  for (const version of versions) {
    const number = Number(version.number)
    if (version.number === null || version.number === '' || !Number.isFinite(number)) continue
    const host = sourceHost(version.sourceId)
    const entry = range.get(host) || { min: number, max: number, numbers: new Set<number>() }
    entry.min = Math.min(entry.min, number)
    entry.max = Math.max(entry.max, number)
    entry.numbers.add(number)
    range.set(host, entry)
  }
  const phantoms = new Map<string, string>()
  const seen = new Set<string>()
  for (const version of versions) {
    if (seen.has(version.key)) continue
    seen.add(version.key)
    const listed = hosts.get(version.key)!
    const number = Number(version.number)
    if (listed.size !== 1 || version.number === null || version.number === '' || !Number.isFinite(number)) continue
    const [only] = listed
    let skipping = 0
    for (const [host, entry] of range)
      if (host !== only && entry.min < number && entry.max > number && !entry.numbers.has(number)) skipping++
    if (skipping >= witnesses) phantoms.set(version.key, only)
  }
  return phantoms
}
