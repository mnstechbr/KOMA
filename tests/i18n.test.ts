import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { catalog } from '../lib/i18n'
import { format, translateWith } from '../lib/i18n/core'

// Todo texto passado a t('...') nas telas precisa existir em inglês e espanhol.
function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    return entry.isDirectory() ? sources(full) : /\.tsx?$/.test(entry.name) ? [full] : []
  })
}
const unescape = (raw: string) => JSON.parse(`"${raw.replace(/\\'/g, "'").replace(/"/g, '\\"')}"`) as string

describe('interface em vários idiomas', () => {
  it('interpola variáveis e cai no português quando falta tradução', () => {
    expect(format('{n} capítulos', { n: 3 })).toBe('3 capítulos')
    expect(translateWith(catalog, 'en', 'Texto sem tradução')).toBe('Texto sem tradução')
    expect(translateWith(catalog, 'en', 'Biblioteca')).toBe('Library')
  })
  it('todos os textos das telas têm versão em inglês e espanhol', () => {
    const missing: string[] = []
    for (const file of [...sources('components'), ...sources('app')]) {
      if (file.includes(`${path.sep}ui${path.sep}`) || /section-(reader|create-form)|spotlight-tour/.test(file)) continue
      const text = fs.readFileSync(file, 'utf8')
      for (const match of text.matchAll(/\bt\('((?:[^'\\]|\\.)*)'/g)) {
        const key = unescape(match[1])
        for (const lang of ['en', 'es'] as const) if (!(key in catalog[lang])) missing.push(`${lang} ${path.relative('.', file)}: ${key}`)
      }
    }
    expect(missing).toEqual([])
  })
})
