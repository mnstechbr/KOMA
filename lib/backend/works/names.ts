import type Database from 'better-sqlite3'

// Glossário de cada obra, montado sozinho a partir das traduções já feitas: a
// palavra que aparece igual no original e na tradução (e a tradução não é só uma
// cópia, como num efeito sonoro) é nome próprio. Vai junto com os próximos
// capítulos para o modelo manter a grafia ("Radios" não vira "Rádio").
const key = (workId: number) => `koma:work-names:v1:${workId}`
const LIMIT = 60
// Palavras iguais nas duas línguas que não são nomes.
const COMMON = new Set([
  'THE',
  'AND',
  'NOT',
  'HAH',
  'HUH',
  'HMM',
  'UGH',
  'TSK',
  'WOW',
  'HEH',
  'OKAY',
  'NORMAL',
  'TOTAL',
  'IDEAL',
  'REAL',
  'MORAL',
  'HORROR',
  'DRAMA',
  'ZERO',
  'NO',
  'SIR',
  'LORD',
  'MANA',
  'AURA',
  'QI',
  'ERA',
  'CAPITAL',
  'FINAL',
  'IMPERIAL',
  'ANIMAL',
  'METAL',
  'CRUEL',
  'LOCAL',
  'NATURAL',
  'CENTRAL',
  'VITAL',
  'MENTAL',
  'HUMOR',
  'SOCIAL',
  'GLOBAL',
  'LEGAL',
  'FATAL',
  'IDEAL',
])

export function harvestNames(pairs: Array<{ source: string; translation: string }>) {
  const found = new Map<string, number>()
  for (const { source, translation } of pairs) {
    const plain = (value: string) => value.toUpperCase().replace(/[^\p{L}\p{N}]/gu, '')
    if (!translation.trim() || plain(source) === plain(translation)) continue
    const words = new Set(
      source
        .split(/[^A-Za-z'-]+/)
        .map((word) => word.replace(/^'+|'+$/g, '').replace(/'S$/i, ''))
        .filter((word) => word.length >= 3 && !/(.)\1\1/i.test(word)),
    )
    for (const word of words) {
      if (COMMON.has(word.toUpperCase())) continue
      // Mesma palavra inteira na tradução, com a grafia que o modelo usou ("McLain").
      // Hífen e apóstrofo não precisam de escape (e o escape é inválido com a flag "u").
      const match = translation.match(new RegExp(`(?<![\\p{L}])${word}(?![\\p{L}])`, 'iu'))
      // Nome fica com inicial maiúscula na tradução; palavra que o português também
      // usa em minúscula ("chance", "status", "avalanche") não é nome.
      if (
        (match && /^\p{Lu}/u.test(match[0]) && !/^[\p{Lu}]+$/u.test(match[0])) ||
        (match && /^[\p{Lu}]+$/u.test(match[0]) && word.length > 3)
      )
        found.set(match[0], (found.get(match[0]) || 0) + 1)
    }
  }
  return found
}

export function rememberNames(database: Database.Database, workId: number, pairs: Array<{ source: string; translation: string }>) {
  const found = harvestNames(pairs)
  if (!found.size) return
  const current = workNames(database, workId)
  for (const [name, count] of found) {
    // Grafia já guardada em outra caixa ("MCLAIN" e "McLain") soma na mesma.
    const existing = Object.keys(current).find((stored) => stored.toUpperCase() === name.toUpperCase())
    const label = existing && existing !== existing.toUpperCase() ? existing : name
    current[label] = (existing ? current[existing] : 0) + count
    if (existing && existing !== label) delete current[existing]
  }
  const kept = Object.fromEntries(
    Object.entries(current)
      .sort((a, b) => b[1] - a[1])
      .slice(0, LIMIT),
  )
  database
    .prepare(
      `INSERT INTO kv_store (key, value, expires_at) VALUES (?, ?, NULL)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = NULL`,
    )
    .run(key(workId), JSON.stringify(kept))
}

export function workNames(database: Database.Database, workId: number): Record<string, number> {
  const row = database.prepare('SELECT value FROM kv_store WHERE key = ?').get(key(workId)) as { value: string } | undefined
  try {
    return row ? JSON.parse(row.value) : {}
  } catch {
    return {}
  }
}

/** Texto enviado ao modelo como glossário da obra. */
export function workGlossary(database: Database.Database, workId: number) {
  // Palavras em minúscula guardadas por versões antigas ("chance", "status") não são nomes,
  // e criaturas com nome em português (Phoenix = Fênix) não ficam como no original.
  const names = Object.keys(workNames(database, workId)).filter(
    (name) => /^\p{Lu}/u.test(name) && !/^(phoenix|dragon|demon|lady|lord)$/i.test(name),
  )
  const corrections = workCorrections(database, workId)
  const terms = Object.entries(corrections.terms)
  return [
    names.length ? `Nomes próprios já usados nesta obra (manter a grafia): ${names.join(', ')}` : '',
    terms.length
      ? `Correções feitas pelo leitor nesta obra (seguir sempre): ${terms.map(([before, after]) => `"${after}" em vez de "${before}"`).join('; ')}`
      : '',
    corrections.lines.length
      ? `Falas corrigidas pelo leitor (referência de termos e tom): ${corrections.lines.map((line) => `"${line.source}" → "${line.after}"`).join('; ')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n')
}

// Correções do editor de balões: a fala corrigida e, quando a troca é de poucas
// palavras ("Phoenix" → "Fênix"), o termo, que vale para os próximos capítulos.
const correctionsKey = (workId: number) => `koma:work-corrections:v1:${workId}`
interface Corrections {
  terms: Record<string, string>
  lines: Array<{ source: string; after: string }>
}
export function workCorrections(database: Database.Database, workId: number): Corrections {
  const row = database.prepare('SELECT value FROM kv_store WHERE key = ?').get(correctionsKey(workId)) as { value: string } | undefined
  try {
    const value = row ? JSON.parse(row.value) : {}
    return { terms: value.terms || {}, lines: Array.isArray(value.lines) ? value.lines : [] }
  } catch {
    return { terms: {}, lines: [] }
  }
}
/** Trecho trocado entre duas versões da mesma fala, se for curto (até 3 palavras). */
export function changedTerm(before: string, after: string) {
  const words = (text: string) => text.split(/\s+/).filter(Boolean)
  const bare = (word: string) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').toLowerCase()
  const a = words(before)
  const b = words(after)
  let start = 0
  while (start < a.length && start < b.length && bare(a[start]) === bare(b[start])) start++
  let end = 0
  while (end < a.length - start && end < b.length - start && bare(a[a.length - 1 - end]) === bare(b[b.length - 1 - end])) end++
  const old = a
    .slice(start, a.length - end)
    .map(bare)
    .filter(Boolean)
    .join(' ')
  const fresh = b
    .slice(start, b.length - end)
    .map((word) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter(Boolean)
    .join(' ')
  if (!old || !fresh || old.split(' ').length > 3 || fresh.split(' ').length > 3 || old === fresh.toLowerCase()) return null
  // Páginas em caixa alta: o termo fica em caixa normal ("ESTÁ" → "está").
  return { before: old, after: fresh === fresh.toUpperCase() && fresh !== fresh.toLowerCase() ? fresh.toLowerCase() : fresh }
}
export function rememberCorrection(database: Database.Database, workId: number, source: string, before: string, after: string) {
  const current = workCorrections(database, workId)
  const term = before.trim() ? changedTerm(before, after) : null
  if (term)
    current.terms = Object.fromEntries(
      [...Object.entries(current.terms).filter(([key]) => key !== term.before), [term.before, term.after]].slice(-60),
    )
  if (source.trim() && after.trim())
    current.lines = [
      ...current.lines.filter((line) => line.source !== source.trim()),
      { source: source.trim().slice(0, 300), after: after.trim().slice(0, 300) },
    ].slice(-20)
  database
    .prepare(
      `INSERT INTO kv_store (key, value, expires_at) VALUES (?, ?, NULL)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = NULL`,
    )
    .run(correctionsKey(workId), JSON.stringify(current))
  return term
}
