// Propaganda de sites, marcas d'água e créditos de grupos de tradução: não são
// diálogo e não devem ser traduzidos nem redesenhados.
// Endereço de site: domínio colado ao ponto ("asurascans.com", "newtoki69.com").
// Só domínios que não são palavras do português aceitam espaço depois do ponto
// ("mangayy. org", "likemanga. ink"); ", COM CERTEZA" e "MARK. TO THINK" são fala.
const SITE =
  /\b[a-z0-9-]{3,}\.(c[o0]m|[o0]r[g6]|net|ink|xyz|top|site|club|online|info|live|lol|moe)\b|\b[a-z0-9-]{3,}\.(io|to|me|cc|fun)\b(?![.,]?\s+[a-z])|\b[a-z0-9-]{3,}\s*\.\s+([o0]r[g6]|ink|xyz)\b/i
// Grupos e marcas d'água comuns, inclusive com o nome quebrado pelo OCR ("LIKE MANGA.I NK", "GENZ / TOONS / .ORG").
const GROUPS =
  /discord|patreon|ko-?fi|\bread (it )?(at|on)\b|read the (chapter|latest)|fastest releases?|newtoki|뉴토끼|웹툰왕국|웹툰제공|scanlat|like ?manga|\b[a-z]{3,} ?scans?\b|genz ?toons|https?\/?\/|www\.|dear readers|happy reading|latest chapters?\b|brought to you by|show your support|read this series/i
// Nomes das fontes que o próprio usuário adicionou: os sites costumam carimbar o
// nome nas páginas. Compartilhado entre as cópias do módulo carregadas pelo Next.
const shared = globalThis as typeof globalThis & { __komaPromoNames?: { pattern: RegExp | null } }
const names = (shared.__komaPromoNames ||= { pattern: null })
/** Nomes de sites ("leitor" casa com "LEITOR" e "LEI TOR"); lista vazia desliga. */
export function setPromoNames(list: string[]) {
  const words = [...new Set(list.map((item) => item.toLowerCase().replace(/[^a-z0-9]/g, '')).filter((item) => item.length >= 5))]
  names.pattern = words.length ? new RegExp(words.map((word) => [...word].join('\\s?')).join('|'), 'i') : null
}
export function isPromoText(text: string) {
  const flat = text.replace(/\s+/g, ' ')
  return SITE.test(flat) || GROUPS.test(flat) || Boolean(names.pattern?.test(flat))
}
