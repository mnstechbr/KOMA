import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { configureOcr, extractTextBoxesNode, probeGpu, type OcrDevice } from '../lib/server/manga-ocr-node'

// Medição dos perfis de desempenho com páginas reais da biblioteca (só leitura).
// KOMA_BENCH=1 KOMA_BENCH_LIBRARY=~/.local/share/koma/library npx vitest run tests/ocr-benchmark.real.test.ts
// KOMA_BENCH_CONFIGS="cpu:1:2,cpu:4:4,webgpu:2:4" escolhe dispositivo:páginas simultâneas:threads.
const library = process.env.KOMA_BENCH_LIBRARY || path.join(os.homedir(), '.local/share/koma/library')
const configs = (process.env.KOMA_BENCH_CONFIGS || 'cpu:4:4,webgpu:4:4').split(',').map((item) => {
  const [device, slots, threads] = item.split(':')
  return { device: device as OcrDevice, slots: Number(slots), threads: Number(threads) }
})

function samplePages(count: number) {
  const db = new Database(path.join(library, 'local.sqlite'), { readonly: true, fileMustExist: true })
  const rows = db
    .prepare(
      `SELECT i.original_path AS file, c.language FROM work_pages p JOIN work_chapters c ON c.id=p.chapter_id JOIN section_images i ON i.id=p.image_id
    WHERE p.state='ready' AND lower(c.language) NOT IN ('pt-br') ORDER BY (p.id * 2654435761) % 1000003 LIMIT ?`,
    )
    .all(count * 3) as Array<{ file: string; language: string }>
  db.close()
  return rows.filter((row) => fs.existsSync(row.file)).slice(0, count)
}

async function run(pages: Array<{ file: string; language: string; bytes: Buffer }>, slots: number) {
  const texts: string[] = new Array(pages.length)
  let next = 0
  const started = performance.now()
  await Promise.all(
    Array.from({ length: slots }, async () => {
      while (next < pages.length) {
        const index = next++
        const result = await extractTextBoxesNode(pages[index].bytes, pages[index].language)
        texts[index] = result.detections.map((item) => item.ocr_text || '').join(' | ')
      }
    }),
  )
  return { ms: performance.now() - started, texts }
}

// Resultado em arquivo: o vitest pode esconder a saída dos testes.
const report = (line: string) => {
  fs.appendFileSync(process.env.KOMA_BENCH_OUT || path.join(os.tmpdir(), 'koma-bench.txt'), `${line}\n`)
  process.stderr.write(`[bench] ${line}\n`)
}
const same = (a: string, b: string) => a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim()

it.skipIf(process.env.KOMA_BENCH !== '1')(
  'mede o OCR em cada perfil e compara o texto entre CPU e placa de vídeo',
  async () => {
    const pages = samplePages(Number(process.env.KOMA_BENCH_PAGES || 30)).map((page) => ({ ...page, bytes: fs.readFileSync(page.file) }))
    expect(pages.length).toBeGreaterThan(5)
    report(`${pages.length} páginas · ${os.availableParallelism()} threads · GPU ${JSON.stringify(await probeGpu())}`)
    let baseline: string[] | null = null
    for (const config of configs) {
      configureOcr({ device: config.device, threads: config.threads })
      await run(pages.slice(0, 2), 1) // aquece e carrega os modelos fora da medição
      const memoryBefore = process.memoryUsage().rss
      const result = await run(pages, config.slots)
      const equal = baseline ? result.texts.filter((text, index) => same(text, baseline![index])).length : pages.length
      baseline ??= result.texts
      report(
        `${config.device} páginas=${config.slots} threads=${config.threads}: ${(result.ms / pages.length).toFixed(0)} ms/página, total ${(result.ms / 1000).toFixed(1)} s, memória +${Math.round((process.memoryUsage().rss - memoryBefore) / 1048576)} MB, texto igual ao 1º perfil em ${equal}/${pages.length}`,
      )
    }
  },
  60 * 60 * 1000,
)
