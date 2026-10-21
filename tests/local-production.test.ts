import { afterEach, describe, expect, it, vi } from 'vitest'
import { getDataDir } from '../lib/backend/shared/data-paths'

describe('produção local', () => {
  afterEach(() => { vi.unstubAllEnvs() })

  it('preserva o caminho legado e permite dados fora do pacote', () => {
    vi.stubEnv('KOMA_DATA_DIR', '')
    expect(getDataDir()).toBe(`${process.cwd()}/storage`)
    vi.stubEnv('KOMA_DATA_DIR', '/tmp/biblioteca-pessoal')
    expect(getDataDir()).toBe('/tmp/biblioteca-pessoal')
  })
})
