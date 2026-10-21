import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'
import { SQLITE_MIGRATIONS } from '../lib/backend/shared/migrations'
vi.mock('../lib/backend/shared/database.module', () => ({ db: null }))
import { autoProfile, getPerformanceMode, limitsFor, resolveProfile, savePerformanceMode } from '../lib/backend/works/performance'

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
})
