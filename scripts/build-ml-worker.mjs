// Compila o processo separado do OCR (lib/server/ml-worker.ts e o que ele usa)
// para ESM puro em build/koma-ml/. O pacote desktop leva essa pasta para dentro
// do servidor (server/koma-ml), onde lib/server/ml.ts a encontra.
import fs from 'node:fs/promises'
import path from 'node:path'
import ts from 'typescript'

const root = path.resolve(import.meta.dirname, '..')
const FILES = {
  'ml-worker': 'lib/server/ml-worker.ts',
  'manga-ocr-node': 'lib/server/manga-ocr-node.ts',
  inpaint: 'lib/server/inpaint.ts',
  'text-detect': 'lib/server/text-detect.ts',
  'promo-text': 'lib/promo-text.ts',
  'render-translation': 'lib/server/render-translation.ts',
  'ocr-helpers': 'lib/server/ocr-helpers.ts',
  'render-helpers': 'lib/server/render-helpers.ts',
}
// Importações entre esses arquivos viram "./nome.mjs"; "server-only" sai (vale só no Next).
const LOCAL = { './manga-ocr-node': 'manga-ocr-node', './inpaint': 'inpaint', './text-detect': 'text-detect', '@/lib/promo-text': 'promo-text', './render-translation': 'render-translation', './ocr-helpers': 'ocr-helpers', './render-helpers': 'render-helpers' }

export async function buildMlWorker(out = path.join(root, 'build/koma-ml')) {
  await fs.rm(out, { recursive: true, force: true })
  await fs.mkdir(out, { recursive: true })
  for (const [name, file] of Object.entries(FILES)) {
    const source = await fs.readFile(path.join(root, file), 'utf8')
    let code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, verbatimModuleSyntax: false, isolatedModules: true }, fileName: file }).outputText
    code = code.replace(/^import ['"]server-only['"];?\n/m, '')
    code = code.replace(/from ['"]([^'"]+)['"]/g, (match, specifier) => {
      if (LOCAL[specifier]) return `from './${LOCAL[specifier]}.mjs'`
      if (specifier.startsWith('.') || specifier.startsWith('@/')) throw new Error(`Importação não prevista no worker do OCR: ${specifier} (${file})`)
      return match
    })
    // turbopackIgnore e outros comentários do Next não fazem diferença no Node.
    await fs.writeFile(path.join(out, `${name}.mjs`), code)
  }
  return out
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(await buildMlWorker())
