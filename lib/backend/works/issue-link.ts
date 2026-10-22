import type Database from 'better-sqlite3'
import packageInfo from '@/package.json'
import { isPromoText } from '@/lib/promo-text'
import type { ReportKind } from './quality-reports'

// Link para abrir no navegador uma issue já preenchida no GitHub do KOMA. Só texto:
// sem imagem, sem título da obra, sem link ou nome de site. Nada é enviado
// sozinho; a pessoa revisa e envia com a própria conta.
const REPOSITORY = 'https://github.com/mnstechbr/KOMA/issues/new'
const KINDS: Record<ReportKind, string> = { english: 'Texto em inglês sobrando', outside: 'Frase fora do balão', 'too-big': 'Letra grande demais', name: 'Nome ou termo errado', other: 'Outro' }
// URLs longas demais são recusadas pelo GitHub e pelo navegador.
const LIMIT = 6000

/** Tira endereços e domínios (marca d'água de site) do texto copiado da página. */
export function scrubText(text: string) {
  return text.replace(/https?:\/\/\S+/gi, '[link]').replace(/\b[a-z0-9-]{2,}(\.[a-z0-9-]{2,})*\.(com|org|net|io|to|me|cc|xyz|top|site|club|online|info|live|moe|ink|fun|br)\b/gi, '[site]')
}
const platform = () => ({ linux: 'Linux', win32: 'Windows', darwin: 'macOS' } as Record<string, string>)[process.platform] || process.platform

export function issueLink(database: Database.Database, imageId: number, kind: ReportKind, note: string, chapter: { language: string; target: string }) {
  const rows = (database.prepare('SELECT ocr_text, translated_text FROM section_image_ocr_items WHERE section_image_id=? ORDER BY id').all(imageId) as Array<{ ocr_text: string; translated_text: string }>)
    .filter((row) => row.ocr_text?.trim() && !isPromoText(row.ocr_text))
  const params = (ocr: string[], translation: string[]) => new URLSearchParams({
    template: 'erro-de-traducao.yml', title: `[Tradução] ${KINDS[kind]}`, versao: packageInfo.version, sistema: `${platform()} ${process.arch}`,
    tipo: KINDS[kind], idiomas: `${chapter.language} → ${chapter.target}`, ocr: ocr.join('\n'), traducao: translation.join('\n'), descricao: scrubText(note).slice(0, 1000),
  })
  // Corta as falas do fim até caber no limite de tamanho do link.
  let count = rows.length
  let url = ''
  do {
    const shown = rows.slice(0, count).map((row) => ({ ocr: scrubText(row.ocr_text.replace(/\s+/g, ' ').trim()).slice(0, 300), translation: scrubText((row.translated_text || '').replace(/\s+/g, ' ').trim()).slice(0, 300) }))
    url = `${REPOSITORY}?${params(shown.map((item, index) => `${index + 1}. ${item.ocr}`), shown.map((item, index) => `${index + 1}. ${item.translation}`)).toString()}`
  } while (url.length > LIMIT && --count > 0)
  return url
}
