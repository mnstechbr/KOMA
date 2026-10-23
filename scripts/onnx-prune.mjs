// Poda um modelo ONNX para só as saídas pedidas: o onnxruntime calcula o grafo
// inteiro mesmo quando só uma saída é lida. Lê e regrava o protobuf direto, sem
// dependências; os nós, pesos e metadados mantidos são copiados byte a byte, então
// o modelo podado calcula exatamente os mesmos valores nas saídas mantidas.
const MODEL_GRAPH = 7
const GRAPH = { node: 1, initializer: 5, output: 12, valueInfo: 13 }
const NODE = { input: 1, output: 2 }
const TENSOR_NAME = 8
const VALUE_INFO_NAME = 1
const NODE_ATTRIBUTE = 5
const ATTRIBUTE_GRAPH = 6
const ATTRIBUTE_GRAPHS = 11

function varint(buffer, offset) {
  let value = 0
  let shift = 0
  for (;;) {
    const byte = buffer[offset++]
    value += (byte & 0x7f) * 2 ** shift
    if (byte < 0x80) return [value, offset]
    shift += 7
  }
}
function encodeVarint(value) {
  const bytes = []
  while (value >= 0x80) {
    bytes.push((value % 0x80) | 0x80)
    value = Math.floor(value / 0x80)
  }
  bytes.push(value)
  return Buffer.from(bytes)
}

/** Campos de uma mensagem: número, tipo, bytes brutos (chave incluída) e conteúdo, se for bytes. */
function fields(buffer) {
  const list = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    const [key, afterKey] = varint(buffer, offset)
    const field = Math.floor(key / 8)
    const wire = key % 8
    offset = afterKey
    let payload = null
    if (wire === 0) offset = varint(buffer, offset)[1]
    else if (wire === 1) offset += 8
    else if (wire === 5) offset += 4
    else if (wire === 2) {
      const [length, afterLength] = varint(buffer, offset)
      payload = buffer.subarray(afterLength, afterLength + length)
      offset = afterLength + length
    } else throw new Error(`Formato de campo protobuf não suportado (${wire}).`)
    list.push({ field, raw: buffer.subarray(start, offset), payload })
  }
  return list
}
const strings = (message, field) =>
  fields(message)
    .filter((item) => item.field === field)
    .map((item) => item.payload.toString('utf8'))

export function pruneOnnx(model, outputs) {
  const top = fields(model)
  const graphField = top.find((item) => item.field === MODEL_GRAPH)
  if (!graphField) throw new Error('Modelo ONNX sem grafo.')
  const graph = fields(graphField.payload)
  const nodes = graph.filter((item) => item.field === GRAPH.node)
  // Atributo com subgrafo (If/Loop) usa nomes de fora sem declará-los: não suportado.
  const subgraph = (node) =>
    fields(node.payload).some(
      (item) =>
        item.field === NODE_ATTRIBUTE &&
        fields(item.payload).some((part) => part.field === ATTRIBUTE_GRAPH || part.field === ATTRIBUTE_GRAPHS),
    )
  if (nodes.some(subgraph)) throw new Error('Subgrafos não suportados.')
  // Do fim para o começo (o grafo está em ordem topológica): fica o nó que produz algo necessário.
  const needed = new Set(outputs)
  const keep = new Set()
  for (let index = nodes.length - 1; index >= 0; index--) {
    const node = nodes[index].payload
    if (!strings(node, NODE.output).some((name) => needed.has(name))) continue
    keep.add(nodes[index])
    for (const name of strings(node, NODE.input)) if (name) needed.add(name)
  }
  const kept = graph.filter((item) => {
    if (item.field === GRAPH.node) return keep.has(item)
    if (item.field === GRAPH.initializer) return needed.has(strings(item.payload, TENSOR_NAME)[0])
    if (item.field === GRAPH.output) return outputs.includes(strings(item.payload, VALUE_INFO_NAME)[0])
    if (item.field === GRAPH.valueInfo) return needed.has(strings(item.payload, VALUE_INFO_NAME)[0])
    return true
  })
  const missing = outputs.filter(
    (name) => !kept.some((item) => item.field === GRAPH.output && strings(item.payload, VALUE_INFO_NAME)[0] === name),
  )
  if (missing.length) throw new Error(`Saídas ausentes no modelo: ${missing.join(', ')}`)
  const graphBytes = Buffer.concat(kept.map((item) => item.raw))
  return Buffer.concat(
    top.map((item) =>
      item === graphField ? Buffer.concat([encodeVarint(MODEL_GRAPH * 8 + 2), encodeVarint(graphBytes.length), graphBytes]) : item.raw,
    ),
  )
}
