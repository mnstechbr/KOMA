import { describe, expect, it } from 'vitest'
import { qrMatrix, reedSolomon } from '../lib/qr'

describe('QR code de "Ler no celular"', () => {
  it('calcula a correção Reed-Solomon do exemplo da norma (HELLO WORLD, 1-M)', () => {
    expect(reedSolomon([32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17], 10)).toEqual([
      196, 35, 39, 119, 235, 215, 231, 226, 93, 23,
    ])
  })
  it('escolhe a versão pelo tamanho e desenha localizadores e temporização', () => {
    const matrix = qrMatrix('http://192.168.15.23:47321/?k=0123456789abcdef0123')
    expect(matrix.length).toBe(33) // versão 4
    // Localizador de cima à esquerda: borda escura, anel claro, centro escuro.
    expect([0, 1, 2, 3, 4, 5, 6].map((x) => matrix[0][x])).toEqual([true, true, true, true, true, true, true])
    expect([matrix[1][1], matrix[2][2], matrix[3][3]]).toEqual([false, true, true])
    // Temporização alternada na linha 6 e módulo escuro fixo.
    expect([8, 9, 10, 11].map((x) => matrix[6][x])).toEqual([true, false, true, false])
    expect(matrix[33 - 8][8]).toBe(true)
    expect(qrMatrix('a').length).toBe(21)
  })
})
