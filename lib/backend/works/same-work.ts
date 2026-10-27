import { normalizeTitle } from '@/lib/works'

// Sites diferentes usam o mesmo nome para obras diferentes ("The Demon God",
// manhwa coreano, e "Demon God", manhua chinês). O nome só aproxima; antes de
// ligar um site à obra, o que se sabe dela não pode contradizer o que o site diz.

/** O que se sabe de uma obra para conferir se dois sites falam da mesma. */
export interface WorkIdentity {
  title?: string
  originalTitle?: string
  aliases?: Array<{ title: string }>
  originalLanguage?: string
  genres?: string[]
  description?: string
}

const ORIGINS = new Set(['ko', 'zh', 'ja'])
/** País de origem: idioma original informado ou "manhwa"/"manhua" nos gêneros e na sinopse. */
export function workOrigin(work: WorkIdentity) {
  const language = (work.originalLanguage || '').toLowerCase().split('-')[0]
  if (ORIGINS.has(language)) return language
  const words = [...(work.genres || []), work.description || ''].join(' ').toLowerCase()
  const korean = /\bmanhwa\b/.test(words)
  const chinese = /\bmanhua\b/.test(words)
  return korean === chinese ? null : korean ? 'ko' : 'zh'
}

// Palavras com inicial maiúscula que não são nomes de personagens ou lugares.
const COMMON = new Set(
  'a an and as at but by for from he her his how i if in into it its of on or our she so that the their then there they this to was we what when where which while who why with you your um uma o os as e de do da dos das no na em ele ela eles seu sua mas quando'.split(
    ' ',
  ),
)
const token = (value: string) => normalizeTitle(value).replace(/\s+/g, '')
/** Nomes próprios da sinopse: palavras com inicial maiúscula fora do começo da frase. */
export function synopsisNames(work: WorkIdentity) {
  const titleWords = new Set(
    [work.title, work.originalTitle, ...(work.aliases || []).map((alias) => alias.title)]
      .flatMap((title) => normalizeTitle(title || '').split(' '))
      .filter(Boolean),
  )
  // Propaganda entre colchetes ("Do autor de <Outra Obra>!") fala de outras obras.
  const text = (work.description || '').replace(/\[[^\]]*\]|<[^>]*>|\([^)]*\)/g, ' ')
  const names = new Set<string>()
  for (const sentence of text.split(/[.!?…:;\n]+/)) {
    const words = sentence.split(/[\s,"“”'‘’]+/).filter(Boolean)
    for (const [index, word] of words.entries()) {
      // Nomes com hífen ("Hyung-woo") contam como uma palavra só.
      const value = token(word)
      if (index === 0 || !/^\p{Lu}/u.test(word) || value.length < 3 || COMMON.has(value) || titleWords.has(value)) continue
      names.add(value)
    }
  }
  return names
}
const similar = (a: string, b: string) => a === b || (Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a)))

/**
 * O que a ficha de outro site diz em relação à obra. País de origem e nomes da
 * sinopse vêm de sites que erram (gênero trocado, sinopse em outro idioma), então
 * nenhum dos dois decide sozinho contra um nome idêntico.
 */
export function compareWorks(work: WorkIdentity, candidate: WorkIdentity) {
  const origins = [workOrigin(work), workOrigin(candidate)]
  const ours = synopsisNames(work)
  const theirs = synopsisNames(candidate)
  const sharedNames = [...ours].some((name) => [...theirs].some((other) => similar(name, other)))
  return {
    originConflict: Boolean(origins[0] && origins[1] && origins[0] !== origins[1]),
    sameOrigin: Boolean(origins[0] && origins[0] === origins[1]),
    namesConflict: ours.size >= 2 && theirs.size >= 2 && !sharedNames,
    sharedNames,
  }
}
/**
 * Aceitar um resultado achado pelo nome. Nome idêntico: recusado só quando a origem
 * diverge e nenhum personagem coincide. Nome que só bate sem o "The": precisa de um
 * sinal a favor (mesma origem ou personagem em comum) e nenhum contra.
 */
export function sameWork(work: WorkIdentity, candidate: WorkIdentity, match: 'exact' | 'article') {
  const check = compareWorks(work, candidate)
  if (match === 'exact') return !(check.originConflict && !check.sharedNames)
  return !check.originConflict && !check.namesConflict && (check.sameOrigin || check.sharedNames)
}
