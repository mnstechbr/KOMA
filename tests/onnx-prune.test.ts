import * as ort from 'onnxruntime-node'
import { expect, it } from 'vitest'
import { pruneOnnx } from '../scripts/onnx-prune.mjs'

// Protobuf mínimo para montar um modelo ONNX de teste: X -> Relu -> a, X -> Neg -> b, b -> Abs -> c.
const varint = (value: number) => {
  const bytes: number[] = []
  while (value >= 0x80) {
    bytes.push((value % 0x80) | 0x80)
    value = Math.floor(value / 0x80)
  }
  bytes.push(value)
  return Buffer.from(bytes)
}
const bytes = (field: number, data: Buffer | string) => {
  const payload = typeof data === 'string' ? Buffer.from(data) : data
  return Buffer.concat([varint(field * 8 + 2), varint(payload.length), payload])
}
const number = (field: number, value: number) => Buffer.concat([varint(field * 8), varint(value)])
const tensorType = bytes(2, bytes(1, Buffer.concat([number(1, 1), bytes(2, bytes(1, number(1, 3)))])))
const value = (name: string) => Buffer.concat([bytes(1, name), tensorType])
const node = (op: string, input: string, output: string) => Buffer.concat([bytes(1, input), bytes(2, output), bytes(4, op)])
const graph = Buffer.concat([
  bytes(1, node('Relu', 'x', 'a')),
  bytes(1, node('Neg', 'x', 'b')),
  bytes(1, node('Abs', 'b', 'c')),
  bytes(2, 'teste'),
  bytes(11, value('x')),
  bytes(12, value('a')),
  bytes(12, value('c')),
])
const model = Buffer.concat([number(1, 8), bytes(8, Buffer.concat([bytes(1, ''), number(2, 13)])), bytes(7, graph)])

it('poda o modelo ONNX para as saídas pedidas sem mudar os valores', async () => {
  const input = { x: new ort.Tensor('float32', Float32Array.from([-1, 0, 2]), [3]) }
  const full = await ort.InferenceSession.create(model)
  const expected = await full.run(input)
  const pruned: Buffer = pruneOnnx(model, ['c'])
  expect(pruned.length).toBeLessThan(model.length)
  const session = await ort.InferenceSession.create(pruned)
  expect(session.outputNames).toEqual(['c'])
  expect(Array.from((await session.run(input)).c.data as Float32Array)).toEqual(Array.from(expected.c.data as Float32Array))
  // O nó Relu (só da saída "a") saiu; o resto do modelo ficou byte a byte.
  expect(pruned.includes(Buffer.from('Relu'))).toBe(false)
  expect(pruneOnnx(model, ['a', 'c']).equals(model)).toBe(true)
  expect(() => pruneOnnx(model, ['z'])).toThrow(/ausentes/)
})
