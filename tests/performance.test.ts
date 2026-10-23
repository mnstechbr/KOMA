import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'
import { SQLITE_MIGRATIONS } from '../lib/backend/shared/migrations'
vi.mock('../lib/backend/shared/database.module', () => ({ db: null }))
import {
  autoProfile,
  getPerformanceMode,
  graphicsCards,
  limitsFor,
  resolveProfile,
  savePerformanceMode,
} from '../lib/backend/works/performance'
import { gpuFaster } from '../lib/server/ocr-helpers'

describe('perfis de desempenho', () => {
  it('escolhe Leve em PC pequeno, Máximo com placa de vídeo e Equilibrado sem ela', () => {
    expect(autoProfile(true, { cores: 4, memoryGb: 16 })).toBe('leve')
    expect(autoProfile(true, { cores: 8, memoryGb: 8 })).toBe('leve')
    expect(autoProfile(true, { cores: 16, memoryGb: 15.4 })).toBe('maximo')
    expect(autoProfile(false, { cores: 16, memoryGb: 15.4 })).toBe('equilibrado')
  })
  it('Máximo sem placa de vídeo cai para Equilibrado', () => {
    expect(resolveProfile('maximo', false, { cores: 16, memoryGb: 16 })).toBe('equilibrado')
    expect(resolveProfile('leve', true, { cores: 16, memoryGb: 16 })).toBe('leve')
  })
  it('limites medidos de cada perfil', () => {
    expect(limitsFor('equilibrado', 16)).toMatchObject({ ocrSlots: 4, ocrThreads: 4, ocrDevice: 'cpu', downloads: 4 })
    expect(limitsFor('maximo', 16)).toMatchObject({ ocrSlots: 6, ocrThreads: 2, ocrDevice: 'webgpu' })
    expect(limitsFor('leve', 4)).toMatchObject({ ocrSlots: 2, ocrThreads: 2, ocrDevice: 'cpu', downloads: 2, render: 1 })
    expect(limitsFor('leve', 2)).toMatchObject({ ocrSlots: 1, ocrThreads: 2 })
  })
  it('guarda a escolha e recusa valores inválidos', () => {
    const db = new Database(':memory:')
    for (const migration of SQLITE_MIGRATIONS) db.exec(migration.up)
    expect(getPerformanceMode(db)).toBe('auto')
    savePerformanceMode(db, 'leve')
    expect(getPerformanceMode(db)).toBe('leve')
    expect(() => savePerformanceMode(db, 'turbo')).toThrow()
  })
  it('placa de vídeo só conta se for bem mais rápida que o processador', () => {
    expect(gpuFaster(8, 29)).toBe(true)
    // Renderizador por software (llvmpipe) quando não há placa: medido 1163 ms contra 27 ms na CPU.
    expect(gpuFaster(1163, 27)).toBe(false)
    expect(gpuFaster(20, 29)).toBe(false)
    expect(gpuFaster(10, null)).toBe(true)
  })
  it('marca o perfil e a velocidade medida da placa', async () => {
    vi.resetModules()
    const fresh = await import('../lib/backend/works/performance')
    await fresh.detectGpu(async () => ({ available: false, ms: 1163, cpuMs: 27 }))
    const db = new Database(':memory:')
    for (const migration of SQLITE_MIGRATIONS) db.exec(migration.up)
    expect(fresh.currentPerformance(db)).toMatchObject({ gpu: false, slowGpu: true, gpuSpeedup: 0 })
    expect(fresh.resolveProfile('maximo', fresh.gpuAvailable(), { cores: 16, memoryGb: 16 })).toBe('equilibrado')
  })
  it('lê as placas informadas pela janela e separa dedicada de integrada', () => {
    const cards = graphicsCards(
      JSON.stringify([
        { vendorId: 0x10de, deviceId: 0x249d, deviceString: 'NVIDIA GeForce RTX 3070 Laptop GPU', active: true },
        { vendorId: 0x8086, deviceId: 0x9a60, deviceString: '' },
        { vendorId: 0x8086, deviceId: 0x56a0, deviceString: 'Intel(R) Arc(TM) A770 Graphics' },
        { vendorId: 0x1002, deviceId: 0x1681, deviceString: 'AMD Radeon(TM) Graphics' },
        { vendorId: 0x1002, deviceId: 0x73bf, deviceString: 'AMD Radeon RX 6800' },
      ]),
    )
    expect(cards.map((card) => card.kind)).toEqual(['dedicated', 'integrated', 'dedicated', 'integrated', 'dedicated'])
    expect(cards[1].name).toBe('Intel 9a60')
    expect(cards[0].active).toBe(true)
    expect(graphicsCards('isso não é json')).toEqual([])
    expect(graphicsCards(undefined)).toEqual([])
  })
})
