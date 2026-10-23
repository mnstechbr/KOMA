import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { SQLITE_MIGRATIONS } from '../lib/backend/shared/migrations'
import { acceptCudaLicenses, cudaActive, cudaDir, cudaSettings, cudaStatus, installCuda } from '../lib/backend/works/cuda-addon'
import { configureInpaint, drawStatus, lamaInpaint, textMaskReader } from '../lib/server/inpaint'
import { renderTranslatedPage, type RenderItem } from '../lib/server/render-translation'

// Fluxo real do complemento CUDA num PC com NVIDIA (só leitura da biblioteca de medição):
// KOMA_CUDA_FLOW=1 [KOMA_CUDA_DIR=~/.local/share/koma/cuda] npx vitest run tests/cuda-flow.real.test.ts
// Com as bibliotecas já na pasta, a instalação só confere os arquivos (nada é baixado).
const bench = process.env.KOMA_BENCH_DIR || path.join(os.homedir(), '.cache/koma-bench')

it.skipIf(process.env.KOMA_CUDA_FLOW !== '1')(
  'instala conferindo, desenha com CUDA e volta para o WebGPU quando falta arquivo',
  async () => {
    const db = new Database(':memory:')
    for (const migration of SQLITE_MIGRATIONS) db.exec(migration.up)
    const dir = cudaDir()
    const before = await cudaStatus(db, dir)
    expect(before.supported).toBe(true)
    process.stderr.write(`[cuda] driver ${before.driver} · faltam ${(before.downloadBytes / 1e9).toFixed(2)} GB para baixar\n`)
    acceptCudaLicenses(db)
    const fetchSpy = vi.fn(fetch)
    await installCuda(db, dir, undefined, fetchSpy)
    process.stderr.write(`[cuda] downloads feitos: ${fetchSpy.mock.calls.length}\n`)
    expect(cudaSettings(db)).toEqual({ enabled: true, accepted: true })
    expect(await cudaActive(db, dir)).toBe(true)

    configureInpaint('cuda', 0, dir)
    const manifest = JSON.parse(fs.readFileSync(path.join(bench, 'chapters/ingles/manifest.json'), 'utf8')) as {
      pages: Array<{ file: string; items: RenderItem[] }>
    }
    const pages = manifest.pages.filter((page) => page.items.length).slice(0, 3)
    for (const page of pages) {
      const original = fs.readFileSync(path.join(bench, 'chapters/ingles', page.file))
      const rows = textMaskReader(original)
      const output = await renderTranslatedPage(original, page.items, undefined, {
        mask: (top, bottom) => rows(top, bottom).catch(() => null),
        inpaint: (data, width, height, holes) => lamaInpaint(data, width, height, holes).catch(() => false),
      })
      const reference = path.join(bench, 'cuda-draw/maximo/ingles/render', `${path.parse(page.file).name}.jpg`)
      if (fs.existsSync(reference)) expect(output.equals(fs.readFileSync(reference))).toBe(true)
    }
    expect(drawStatus()).toEqual({ device: 'cuda', cudaError: null })

    configureInpaint('cuda', 0, path.join(os.tmpdir(), 'nao-existe', 'cuda'))
    expect(await lamaInpaint(new Float32Array(3), 1, 1, new Uint8Array(1))).toBe(true)
    expect(drawStatus().device).toBe('webgpu')
    expect(drawStatus().cudaError).toMatch(/ausente/)
  },
  10 * 60 * 1000,
)
