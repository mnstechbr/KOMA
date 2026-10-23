import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import * as ort from 'onnxruntime-node'
import sharp from 'sharp'
import { expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { configureOcr, extractTextBoxesNode } from '../lib/server/manga-ocr-node'
import { configureInpaint, inpaintAvailable, lamaInpaint, textMaskReader } from '../lib/server/inpaint'
import { renderTranslatedPage, type RenderItem } from '../lib/server/render-translation'
import { limitsFor, type PerformanceProfile } from '../lib/backend/works/performance'
import { workPageItems } from '../lib/backend/works/render'

// Linha de base do processamento (OCR + máscara + LaMa + desenho) com capítulos reais,
// para comparar cada otimização: o texto lido tem de sair idêntico, as imagens iguais e
// o tempo menor. Nada daqui vai para o repositório: imagens, falas e resultados ficam
// em KOMA_BENCH_DIR (padrão ~/.cache/koma-bench). Use scripts/bench-pipeline.sh.
//
// KOMA_BENCH_PIPELINE=prepare  copia as imagens originais e as falas já traduzidas
//   (banco aberto só para leitura) de 3 capítulos; KOMA_BENCH_CHAPTERS="manhwa=1026,..."
//   escolhe os capítulos à mão.
// KOMA_BENCH_PIPELINE=run KOMA_BENCH_NAME=baseline KOMA_BENCH_PROFILE=equilibrado KOMA_BENCH_LABEL=manhwa
//   processa um capítulo num perfil e grava report.json, ocr.json e as páginas desenhadas.
// KOMA_BENCH_PIPELINE=compare KOMA_BENCH_NAME=teste [KOMA_BENCH_BASE=baseline]
//   compara texto e pixels de uma rodada com a linha de base.
const mode = process.env.KOMA_BENCH_PIPELINE
const root = process.env.KOMA_BENCH_DIR || path.join(os.homedir(), '.cache/koma-bench')
const library = process.env.KOMA_BENCH_LIBRARY || path.join(os.homedir(), '.local/share/koma/library')
const maxPages = Number(process.env.KOMA_BENCH_MAX_PAGES || 40)
const HOUR = 60 * 60 * 1000

// KOMA_BENCH_EP=cuda (ou tensorrt) troca o dispositivo de todos os modelos só nesta medição,
// para comparar com o WebGPU sem mudar o app. As bibliotecas da NVIDIA vêm por LD_LIBRARY_PATH.
const benchEp = process.env.KOMA_BENCH_EP
// KOMA_BENCH_NOSPIN=1: threads do onnxruntime dormem em vez de girar esperando trabalho.
const noSpin = process.env.KOMA_BENCH_NOSPIN === '1'
// KOMA_BENCH_WEBGPU_POWER=low-power (ou high-performance): qual placa o WebGPU escolhe num PC híbrido.
const webgpuPower = process.env.KOMA_BENCH_WEBGPU_POWER
if (benchEp || noSpin || webgpuPower) {
  const create = ort.InferenceSession.create.bind(ort.InferenceSession) as (...args: unknown[]) => Promise<ort.InferenceSession>
  const providers = benchEp === 'tensorrt' ? ['tensorrt', 'cuda', 'cpu'] : [benchEp, 'cpu']
  ;(ort.InferenceSession as unknown as { create: unknown }).create = (model: unknown, options?: ort.InferenceSession.SessionOptions) =>
    create(model, {
      ...options,
      // KOMA_BENCH_EP_SCOPE=draw: só o detector de letras e o LaMa trocam de dispositivo.
      ...(benchEp && (process.env.KOMA_BENCH_EP_SCOPE !== 'draw' || /comic-text-detector|lama/.test(String(model)))
        ? { executionProviders: providers }
        : {}),
      ...(noSpin || webgpuPower
        ? {
            extra: {
              ...(noSpin ? { session: { intra_op: { allow_spinning: '0' }, inter_op: { allow_spinning: '0' } } } : {}),
              ...(webgpuPower ? { ep: { webgpuexecutionprovider: { powerPreference: webgpuPower } } } : {}),
            },
          }
        : {}),
    })
}

interface Manifest {
  label: string
  chapterId: number
  language: string
  pages: Array<{ file: string; imageId: number; width: number; height: number; items: RenderItem[] }>
}
interface PageOcr {
  file: string
  detections: Array<{ box?: number[]; lines?: number[][]; text: string; cls?: string; error?: string }>
}

const log = (line: string) => process.stderr.write(`[bench] ${line}\n`)
const writeJson = (file: string, value: unknown) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 1)}\n`)
}
const readJson = <T>(file: string) => JSON.parse(fs.readFileSync(file, 'utf8')) as T

// Capítulos de referência: manhwa coreano em tiras, inglês em páginas normais e o
// capítulo com mais texto sobre o desenho (fora de balão).
function pickChapters(db: Database.Database): Record<string, number> {
  const manual = process.env.KOMA_BENCH_CHAPTERS
  if (manual)
    return Object.fromEntries(
      manual
        .split(',')
        .map((pair) => pair.split('='))
        .map(([label, id]) => [label, Number(id)]),
    )
  const ready = `p.state IN ('ready','review') AND p.ocr_json LIKE '%"lines"%' AND p.image_id IS NOT NULL`
  const items = `(SELECT COUNT(*) FROM section_image_ocr_items o WHERE o.section_image_id=p.image_id AND TRIM(o.translated_text)<>'')`
  const free = `(LENGTH(p.ocr_json)-LENGTH(REPLACE(p.ocr_json,'"cls_name":"text"','')))/17`
  const one = (sql: string, ...args: unknown[]) => (db.prepare(sql).get(...args) as { id: number } | undefined)?.id
  const manhwa = one(
    `SELECT c.id FROM work_chapters c JOIN work_pages p ON p.chapter_id=c.id WHERE c.language='ko' AND ${ready}
    GROUP BY c.id HAVING COUNT(*)>=10 ORDER BY SUM(${items}) DESC LIMIT 1`,
  )
  // Páginas de mangá (retrato), com densidade de falas mediana. Tiras fatiadas na mesma
  // proporção ficam de fora por terem quase nenhuma fala por imagem.
  const pages = `SELECT c.id, SUM(${items})*1.0/COUNT(*) AS density FROM work_chapters c JOIN work_pages p ON p.chapter_id=c.id
    WHERE c.language='en' AND ${ready} AND p.width>0 GROUP BY c.id
    HAVING COUNT(*)>=12 AND AVG(p.height*1.0/p.width) BETWEEN 1.25 AND 1.8 AND density>=3`
  const english = one(`SELECT id FROM (${pages}) ORDER BY density DESC LIMIT 1 OFFSET (SELECT COUNT(*)/2 FROM (${pages}))`)
  const text = one(
    `SELECT c.id FROM work_chapters c JOIN work_pages p ON p.chapter_id=c.id WHERE LOWER(c.language)<>'pt-br' AND ${ready}
    AND c.id NOT IN (?,?) GROUP BY c.id HAVING COUNT(*)>=8 ORDER BY SUM(${free})*1.0/COUNT(*) DESC LIMIT 1`,
    manhwa ?? -1,
    english ?? -1,
  )
  return Object.fromEntries(
    Object.entries({ manhwa, ingles: english, texto: text }).filter((entry): entry is [string, number] => entry[1] !== undefined),
  )
}

it.skipIf(mode !== 'prepare')(
  'copia os capítulos de referência para a pasta de medição',
  () => {
    const db = new Database(path.join(library, 'local.sqlite'), { readonly: true, fileMustExist: true })
    const chosen = pickChapters(db)
    expect(Object.keys(chosen).length).toBeGreaterThan(0)
    for (const [label, chapterId] of Object.entries(chosen)) {
      const chapter = db.prepare('SELECT language FROM work_chapters WHERE id=?').get(chapterId) as { language: string }
      const rows = db
        .prepare(
          `SELECT p.image_id, i.original_path FROM work_pages p JOIN section_images i ON i.id=p.image_id
          WHERE p.chapter_id=? ORDER BY p.page_index LIMIT ?`,
        )
        .all(chapterId, maxPages) as Array<{ image_id: number; original_path: string }>
      const directory = path.join(root, 'chapters', label)
      fs.rmSync(directory, { recursive: true, force: true })
      fs.mkdirSync(directory, { recursive: true })
      const pages: Manifest['pages'] = []
      for (const [index, row] of rows.entries()) {
        if (!fs.existsSync(row.original_path)) continue
        const file = `${String(index + 1).padStart(4, '0')}${path.extname(row.original_path) || '.jpg'}`
        fs.copyFileSync(row.original_path, path.join(directory, file))
        const size = db.prepare('SELECT width, height FROM work_pages WHERE image_id=?').get(row.image_id) as {
          width: number
          height: number
        }
        pages.push({ file, imageId: row.image_id, width: size.width, height: size.height, items: workPageItems(db, row.image_id) })
      }
      writeJson(path.join(directory, 'manifest.json'), { label, chapterId, language: chapter.language, pages } satisfies Manifest)
      log(
        `${label}: capítulo ${chapterId} (${chapter.language}), ${pages.length} páginas, ${pages.reduce((n, p) => n + p.items.length, 0)} falas`,
      )
    }
    db.close()
  },
  HOUR,
)

// Memória disponível do sistema (não só a livre): abaixo de 2 GB a medição para.
function availableMb() {
  const line = fs
    .readFileSync('/proc/meminfo', 'utf8')
    .split('\n')
    .find((item) => item.startsWith('MemAvailable:'))
  return line ? Number(line.split(/\s+/)[1]) / 1024 : Infinity
}

// Recursos a cada segundo, para achar algo anormal (CPU ociosa, placa parada no Máximo,
// memória crescendo, temperatura alta): CPU do processo e do sistema, memória, NVIDIA
// (nvidia-smi) e temperatura do processador (x86_pkg_temp). Gráfico integrado da Intel
// precisaria do intel_gpu_top com permissão de administrador: não é medido.
const cpuTempFile = (() => {
  try {
    const zone = fs
      .readdirSync('/sys/class/thermal')
      .find((name) => fs.readFileSync(`/sys/class/thermal/${name}/type`, 'utf8').trim() === 'x86_pkg_temp')
    return zone ? `/sys/class/thermal/${zone}/temp` : null
  } catch {
    return null
  }
})()
function systemCpu() {
  const [, ...values] = fs.readFileSync('/proc/stat', 'utf8').split('\n')[0].trim().split(/\s+/).map(Number)
  const idle = values[3] + (values[4] || 0)
  return { idle, total: values.reduce((a, b) => a + b, 0) }
}
function nvidia(): Promise<number[] | null> {
  return new Promise((resolve) =>
    execFile(
      'nvidia-smi',
      ['--query-gpu=utilization.gpu,memory.used,temperature.gpu,power.draw', '--format=csv,noheader,nounits'],
      { timeout: 2000 },
      (error, stdout) => resolve(error ? null : stdout.split('\n')[0].split(',').map(Number)),
    ),
  )
}
type Series = number[]
const summary = (values: Series) =>
  values.length ? { avg: Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10, peak: Math.max(...values) } : null

function sampler() {
  const stats = { peakRssMb: 0, minAvailableMb: Infinity, maxLoad: 0, lowMemory: false }
  const series = {
    procCores: [] as Series,
    systemCpu: [] as Series,
    rssMb: [] as Series,
    gpuUtil: [] as Series,
    vramMb: [] as Series,
    gpuTemp: [] as Series,
    gpuWatts: [] as Series,
    cpuTemp: [] as Series,
  }
  const tick = () => {
    stats.peakRssMb = Math.max(stats.peakRssMb, process.memoryUsage.rss() / 1048576)
    stats.minAvailableMb = Math.min(stats.minAvailableMb, availableMb())
    stats.maxLoad = Math.max(stats.maxLoad, os.loadavg()[0])
    if (stats.minAvailableMb < 2048) stats.lowMemory = true
  }
  let lastCpu = process.cpuUsage()
  let lastAt = performance.now()
  let lastSystem = systemCpu()
  const second = async () => {
    const now = performance.now()
    const cpu = process.cpuUsage()
    series.procCores.push(Math.round(((cpu.user - lastCpu.user + cpu.system - lastCpu.system) / 1000 / (now - lastAt)) * 100) / 100)
    lastCpu = cpu
    lastAt = now
    const system = systemCpu()
    const total = system.total - lastSystem.total
    if (total > 0) series.systemCpu.push(Math.round((1 - (system.idle - lastSystem.idle) / total) * 1000) / 10)
    lastSystem = system
    series.rssMb.push(Math.round(process.memoryUsage.rss() / 1048576))
    if (cpuTempFile)
      try {
        series.cpuTemp.push(Math.round(Number(fs.readFileSync(cpuTempFile, 'utf8')) / 1000))
      } catch {
        /* Sem sensor. */
      }
    const gpu = await nvidia()
    // nvidia-smi devolve "[N/A]" em campos que a placa não informa: cada um entra só se for número.
    const lists = [series.gpuUtil, series.vramMb, series.gpuTemp, series.gpuWatts]
    if (gpu) lists.forEach((list, index) => Number.isFinite(gpu[index]) && list.push(gpu[index]))
  }
  tick()
  const timer = setInterval(tick, 250)
  const slow = setInterval(() => void second(), 1000)
  const resources = () => ({
    seconds: series.procCores.length,
    processCores: summary(series.procCores),
    systemCpuPercent: summary(series.systemCpu),
    rssMb: summary(series.rssMb),
    // Memória crescendo sem parar: diferença entre o fim e o primeiro quarto da rodada.
    rssGrowthMb: series.rssMb.length > 4 ? series.rssMb[series.rssMb.length - 1] - series.rssMb[Math.floor(series.rssMb.length / 4)] : 0,
    minAvailableMb: Math.round(stats.minAvailableMb),
    gpuUtilPercent: summary(series.gpuUtil),
    vramMb: summary(series.vramMb),
    gpuTempC: summary(series.gpuTemp),
    gpuWatts: summary(series.gpuWatts),
    cpuTempC: summary(series.cpuTemp),
    integratedGpu: 'não medido (intel_gpu_top indisponível sem administrador)',
  })
  return {
    stats,
    resources,
    stop: () => {
      clearInterval(timer)
      clearInterval(slow)
    },
  }
}

async function pool<T>(count: number, slots: number, work: (index: number) => Promise<T>) {
  const results: T[] = new Array(count)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.max(1, slots) }, async () => {
      while (next < count) {
        const index = next++
        results[index] = await work(index)
      }
    }),
  )
  return results
}

// Uma etapa medida: tempo de parede, CPU (em núcleos médios) e pico de memória.
async function stage<T>(guard: ReturnType<typeof sampler>, work: () => Promise<T>) {
  const cpu = process.cpuUsage()
  const started = performance.now()
  const value = await work()
  const ms = performance.now() - started
  const used = process.cpuUsage(cpu)
  if (guard.stats.lowMemory) throw new Error('Memória disponível abaixo de 2 GB: medição interrompida.')
  return { value, ms, cpuCores: (used.user + used.system) / 1000 / ms }
}

it.skipIf(mode !== 'run')(
  'processa um capítulo de referência num perfil e grava tempos e saídas',
  async () => {
    const name = process.env.KOMA_BENCH_NAME || 'baseline'
    const profile = (process.env.KOMA_BENCH_PROFILE || 'equilibrado') as PerformanceProfile
    const label = process.env.KOMA_BENCH_LABEL || 'manhwa'
    const manifest = readJson<Manifest>(path.join(root, 'chapters', label, 'manifest.json'))
    // Ajuste fino (KOMA_BENCH_PAGES, KOMA_BENCH_RENDER): trecho do capítulo e páginas desenhadas ao mesmo tempo.
    if (Number(process.env.KOMA_BENCH_PAGES) > 0) manifest.pages = manifest.pages.slice(0, Number(process.env.KOMA_BENCH_PAGES))
    const out = path.join(root, name, profile, label)
    fs.rmSync(out, { recursive: true, force: true })
    fs.mkdirSync(path.join(out, 'render'), { recursive: true })
    expect(inpaintAvailable()).toBe(true)
    const [ocrSlots, ocrThreads] = (process.env.KOMA_BENCH_OCR || '').split(':').map(Number)
    const limits = {
      ...limitsFor(profile),
      ...(Number(process.env.KOMA_BENCH_RENDER) > 0 ? { render: Number(process.env.KOMA_BENCH_RENDER) } : {}),
      ...(ocrSlots > 0 && ocrThreads > 0 ? { ocrSlots, ocrThreads } : {}),
    }
    // KOMA_BENCH_ONLY=ocr mede só a leitura (ajuste dos threads do OCR).
    const ocrOnly = process.env.KOMA_BENCH_ONLY === 'ocr'
    configureOcr({ device: limits.ocrDevice, threads: limits.ocrThreads })
    configureInpaint(limits.ocrDevice, limits.drawThreads)
    const bytes = manifest.pages.map((page) => fs.readFileSync(path.join(root, 'chapters', label, page.file)))
    const timing = (holder: { mask: number; inpaint: number }) => (original: Buffer) => {
      // Como o lib/server/ml-worker.ts monta os modelos do desenho.
      const rows = textMaskReader(original)
      return {
        mask: async (top?: number, bottom?: number) => {
          const started = performance.now()
          const value = await rows(top, bottom).catch(() => null)
          holder.mask += performance.now() - started
          return value
        },
        inpaint: async (data: Float32Array, width: number, height: number, holes: Uint8Array) => {
          const started = performance.now()
          const ok = await lamaInpaint(data, width, height, holes).catch(() => false)
          holder.inpaint += performance.now() - started
          return ok
        },
      }
    }
    // Aquecimento fora da medição: carrega os modelos de OCR, máscara e LaMa.
    const warm = Math.max(
      0,
      manifest.pages.findIndex((page) => page.items.length),
    )
    const warmStarted = performance.now()
    await extractTextBoxesNode(bytes[warm], manifest.language)
    if (!ocrOnly)
      await renderTranslatedPage(bytes[warm], manifest.pages[warm].items, undefined, timing({ mask: 0, inpaint: 0 })(bytes[warm]))
    const warmupMs = performance.now() - warmStarted

    const guard = sampler()
    try {
      const ocrStage = () =>
        stage(guard, () =>
          pool(bytes.length, limits.ocrSlots, async (index) => {
            const started = performance.now()
            const result = await extractTextBoxesNode(bytes[index], manifest.language)
            return { ms: performance.now() - started, detections: result.detections || [] }
          }),
        )
      const drawStage = () =>
        stage(guard, () =>
          pool(ocrOnly ? 0 : bytes.length, limits.render, async (index) => {
            const page = manifest.pages[index]
            const parts = { mask: 0, inpaint: 0 }
            const started = performance.now()
            const image = page.items.length
              ? await renderTranslatedPage(bytes[index], page.items, undefined, timing(parts)(bytes[index]))
              : null
            const ms = performance.now() - started
            if (image) fs.writeFileSync(path.join(out, 'render', `${path.parse(page.file).name}.jpg`), image)
            return {
              ms,
              maskMs: parts.mask,
              lamaMs: parts.inpaint,
              drawMs: Math.max(0, ms - parts.mask - parts.inpaint),
              items: page.items.length,
            }
          }),
        )
      // KOMA_BENCH_MIXED=1: OCR e desenho ao mesmo tempo, como a fila do app com vários capítulos.
      const mixed = process.env.KOMA_BENCH_MIXED === '1'
      const wallStarted = performance.now()
      const [ocr, draw] = mixed ? await Promise.all([ocrStage(), drawStage()]) : [await ocrStage(), await drawStage()]
      const wallMs = performance.now() - wallStarted
      guard.stop()
      const pagesOcr: PageOcr[] = manifest.pages.map((page, index) => ({
        file: page.file,
        detections: ocr.value[index].detections.map((item) => ({
          box: item.box,
          lines: item.lines,
          text: item.ocr_text || '',
          cls: item.cls_name,
          ...(item.ocr_error ? { error: item.ocr_error } : {}),
        })),
      }))
      writeJson(path.join(out, 'ocr.json'), pagesOcr)
      const sum = (values: number[]) => values.reduce((a, b) => a + b, 0)
      const round = (value: number) => Math.round(value)
      const report = {
        name,
        profile,
        label,
        chapterId: manifest.chapterId,
        language: manifest.language,
        when: new Date().toISOString(),
        machine: { cpus: os.availableParallelism(), memoryGb: Math.round(os.totalmem() / 1024 ** 3), load: os.loadavg() },
        limits,
        executionProvider: benchEp || limits.ocrDevice,
        inpaintThreads: Number(process.env.KOMA_INPAINT_THREADS) || null,
        pages: manifest.pages.length,
        warmupMs: round(warmupMs),
        ocr: {
          totalMs: round(ocr.ms),
          msPerPage: round(ocr.ms / bytes.length),
          cpuCores: Number(ocr.cpuCores.toFixed(2)),
          lines: sum(pagesOcr.map((page) => sum(page.detections.map((item) => item.lines?.length || 0)))),
          perPage: ocr.value.map((page) => round(page.ms)),
        },
        render: {
          totalMs: round(draw.ms),
          msPerPage: round(draw.ms / bytes.length),
          cpuCores: Number(draw.cpuCores.toFixed(2)),
          maskMs: round(sum(draw.value.map((page) => page.maskMs))),
          lamaMs: round(sum(draw.value.map((page) => page.lamaMs))),
          drawMs: round(sum(draw.value.map((page) => page.drawMs))),
          perPage: draw.value.map((page) => ({
            ms: round(page.ms),
            mask: round(page.maskMs),
            lama: round(page.lamaMs),
            draw: round(page.drawMs),
            items: page.items,
          })),
        },
        mixed,
        totalMs: round(wallMs),
        peakRssMb: round(Math.max(guard.stats.peakRssMb, process.resourceUsage().maxRSS / 1024)),
        minAvailableMb: round(guard.stats.minAvailableMb),
        maxLoad1m: Number(guard.stats.maxLoad.toFixed(1)),
        resources: guard.resources(),
      }
      writeJson(path.join(out, 'report.json'), report)
      const line = `${name} ${profile} ${label}: ${report.pages} págs · OCR ${report.ocr.msPerPage} ms/pág (${report.ocr.cpuCores} núcleos) · desenho ${report.render.msPerPage} ms/pág (máscara ${report.render.maskMs} + LaMa ${report.render.lamaMs} + desenho ${report.render.drawMs} ms somados) · total ${(report.totalMs / 1000).toFixed(1)} s · pico ${report.peakRssMb} MB · carga máx ${report.maxLoad1m}`
      const r = report.resources
      const resourceLine = `   recursos: CPU do processo ${r.processCores?.avg ?? '-'} núcleos (pico ${r.processCores?.peak ?? '-'}) · CPU do sistema ${r.systemCpuPercent?.avg ?? '-'}% (pico ${r.systemCpuPercent?.peak ?? '-'}%) · RAM pico ${r.rssMb?.peak ?? '-'} MB (cresceu ${r.rssGrowthMb} MB) · livre mín ${r.minAvailableMb} MB · GPU ${r.gpuUtilPercent?.avg ?? '-'}% (pico ${r.gpuUtilPercent?.peak ?? '-'}%) · VRAM pico ${r.vramMb?.peak ?? '-'} MB · GPU ${r.gpuTempC?.peak ?? '-'} °C · ${r.gpuWatts?.avg ?? '-'} W (pico ${r.gpuWatts?.peak ?? '-'}) · CPU ${r.cpuTempC?.peak ?? '-'} °C`
      fs.appendFileSync(path.join(root, name, 'summary.txt'), `${line}\n${resourceLine}\n`)
      log(line)
      log(resourceLine)
    } finally {
      guard.stop()
    }
  },
  HOUR,
)

async function pixels(file: string) {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height }
}

it.skipIf(mode !== 'compare')(
  'compara texto e imagens de uma rodada com a linha de base',
  async () => {
    const name = process.env.KOMA_BENCH_NAME || 'teste'
    const base = process.env.KOMA_BENCH_BASE || 'baseline'
    const result: Array<Record<string, unknown>> = []
    for (const profile of fs.readdirSync(path.join(root, name)).filter((item) => fs.statSync(path.join(root, name, item)).isDirectory())) {
      for (const label of fs.readdirSync(path.join(root, name, profile))) {
        const left = path.join(root, base, profile, label)
        const right = path.join(root, name, profile, label)
        if (!fs.existsSync(path.join(left, 'report.json')) || !fs.existsSync(path.join(right, 'report.json'))) continue
        const a = readJson<PageOcr[]>(path.join(left, 'ocr.json'))
        const b = readJson<PageOcr[]>(path.join(right, 'ocr.json'))
        // Só as páginas desta rodada (pode ser um trecho do capítulo).
        const baseByFile = new Map(a.map((page) => [page.file, page]))
        const textDiff = b.filter((page) => JSON.stringify(page) !== JSON.stringify(baseByFile.get(page.file))).map((page) => page.file)
        let worst = 0
        let changedPixels = 0
        let anyPixels = 0
        let maxDelta = 0
        let sameFiles = 0
        let total = 0
        const imageDiff: string[] = []
        for (const file of fs.readdirSync(path.join(right, 'render'))) {
          const other = path.join(right, 'render', file)
          if (!fs.existsSync(path.join(left, 'render', file))) {
            imageDiff.push(`${file} (sem linha de base)`)
            continue
          }
          if (fs.readFileSync(path.join(left, 'render', file)).equals(fs.readFileSync(other))) {
            sameFiles++
            const { info } = await sharp(other).toBuffer({ resolveWithObject: true })
            total += info.width * info.height
            continue
          }
          const x = await pixels(path.join(left, 'render', file))
          const y = await pixels(other)
          if (x.width !== y.width || x.height !== y.height) {
            imageDiff.push(`${file} (tamanho)`)
            continue
          }
          // Diferença de cada pixel (maior canal): >24 conta como alterado; qualquer valor
          // diferente de zero entra em anyPixels e na imagem de diferença (vermelho = mais).
          let changed = 0
          let any = 0
          const heat = Buffer.alloc(x.data.length)
          for (let i = 0; i < x.data.length; i += 3) {
            const delta = Math.max(
              Math.abs(x.data[i] - y.data[i]),
              Math.abs(x.data[i + 1] - y.data[i + 1]),
              Math.abs(x.data[i + 2] - y.data[i + 2]),
            )
            if (delta > 24) changed++
            if (delta) {
              any++
              heat[i] = Math.min(255, 64 + delta * 4)
            } else heat[i] = heat[i + 1] = heat[i + 2] = Math.round(y.data[i] * 0.3)
            if (delta > maxDelta) maxDelta = delta
          }
          if (any)
            await sharp(heat, { raw: { width: x.width, height: x.height, channels: 3 } })
              .png()
              .toFile(path.join(right, `diff-${path.parse(file).name}.png`))
          const share = changed / (x.data.length / 3)
          worst = Math.max(worst, share)
          changedPixels += changed
          anyPixels += any
          total += x.data.length / 3
          if (any)
            imageDiff.push(`${file} (${((any / (x.data.length / 3)) * 100).toFixed(3)}% com diferença, ${(share * 100).toFixed(3)}% >24)`)
        }
        const r1 = readJson<{ totalMs: number; ocr: { msPerPage: number }; render: { msPerPage: number } }>(path.join(left, 'report.json'))
        const r2 = readJson<{ totalMs: number; ocr: { msPerPage: number }; render: { msPerPage: number } }>(path.join(right, 'report.json'))
        const entry = {
          profile,
          label,
          textIdentical: textDiff.length === 0,
          textDiff,
          changedPixelShare: total ? changedPixels / total : 0,
          anyPixelShare: total ? anyPixels / total : 0,
          maxDelta,
          identicalFiles: sameFiles,
          worstPageShare: worst,
          imageDiff,
          ocrMsPerPage: [r1.ocr.msPerPage, r2.ocr.msPerPage],
          renderMsPerPage: [r1.render.msPerPage, r2.render.msPerPage],
          totalMs: [r1.totalMs, r2.totalMs],
        }
        result.push(entry)
        log(
          `${profile} ${label}: texto ${entry.textIdentical ? 'idêntico' : `diferente em ${textDiff.length} págs`} · arquivos idênticos ${sameFiles} · pixels com diferença ${(entry.anyPixelShare * 100).toFixed(4)}% (máx ${maxDelta}; >24: ${(entry.changedPixelShare * 100).toFixed(3)}%) · total ${(r1.totalMs / 1000).toFixed(1)} s -> ${(r2.totalMs / 1000).toFixed(1)} s`,
        )
      }
    }
    writeJson(path.join(root, name, `compare-${base}.json`), result)
    expect(result.length).toBeGreaterThan(0)
  },
  HOUR,
)
