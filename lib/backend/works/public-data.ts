import { parseExpressionAt } from 'acorn'
import { parseDocument, DomUtils } from 'htmlparser2'
import { SourceError } from './source-http'

// Leitura de valores serializados, sem eval, VM, navegador ou execução remota.
export function readNuxtData(html: string): any {
  const scripts = DomUtils.findAll((node) => node.name === 'script', parseDocument(html).children)
  const script = scripts.map((node) => DomUtils.textContent(node)).find((text) => text.trim().startsWith('window.__NUXT__='))
  if (!script) throw new SourceError('A fonte não retornou seus dados públicos de catálogo.')
  const expression = parseExpressionAt(script, script.indexOf('=') + 1, { ecmaVersion: 2022 })
  let visited = 0
  function read(node: any, scope: Map<string, unknown>, depth = 0): any {
    if (++visited > 200000 || depth > 100) throw new SourceError('Os dados da fonte excederam o limite de leitura.')
    const next = (value: any) => read(value, scope, depth + 1)
    if (node.type === 'Literal' && !node.regex && typeof node.value !== 'bigint') return node.value
    if (node.type === 'Identifier') {
      if (node.name === 'undefined') return null
      if (scope.has(node.name)) return scope.get(node.name)
    }
    if (node.type === 'ArrayExpression') return node.elements.map((item: any) => (item ? next(item) : null))
    if (node.type === 'ObjectExpression') {
      const result = Object.create(null)
      for (const property of node.properties) {
        if (property.type !== 'Property' || property.computed || property.kind !== 'init' || property.method)
          throw new SourceError('Formato público não suportado.')
        const key = property.key.name ?? property.key.value
        if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new SourceError('Chave de catálogo inválida.')
        result[key] = next(property.value)
      }
      return result
    }
    if (node.type === 'UnaryExpression') {
      const value = next(node.argument)
      if (node.operator === 'void') return null
      if (node.operator === '!') return !value
      if (node.operator === '-' && typeof value === 'number') return -value
    }
    if (
      node.type === 'CallExpression' &&
      node.callee.type === 'Identifier' &&
      node.callee.name === 'Array' &&
      node.arguments.length === 1
    ) {
      const count = next(node.arguments[0])
      if (Number.isInteger(count) && count >= 0 && count <= 10000) return Array(count).fill(null)
    }
    if (node.type === 'CallExpression' && node.callee.type === 'FunctionExpression') {
      const fn = node.callee
      const body = fn.body.body
      if (
        body.at(-1)?.type !== 'ReturnStatement' ||
        fn.params.some((p: any) => p.type !== 'Identifier') ||
        fn.params.length !== node.arguments.length
      )
        throw new SourceError('Serialização de catálogo não suportada.')
      const values = node.arguments.map(next)
      const child = new Map(scope)
      fn.params.forEach((parameter: any, index: number) => child.set(parameter.name, values[index]))
      for (const statement of body.slice(0, -1)) {
        const assignment = statement.expression
        if (
          statement.type !== 'ExpressionStatement' ||
          assignment?.type !== 'AssignmentExpression' ||
          assignment.operator !== '=' ||
          assignment.left.type !== 'MemberExpression' ||
          assignment.left.object.type !== 'Identifier'
        )
          throw new SourceError('Serialização de catálogo não suportada.')
        const target: any = child.get(assignment.left.object.name)
        const property = assignment.left.property
        const index =
          assignment.left.computed && property.type === 'Literal'
            ? property.value
            : !assignment.left.computed && property.type === 'Identifier'
              ? property.name
              : null
        if (
          Array.isArray(target)
            ? !Number.isInteger(index) || index < 0 || index >= target.length
            : !target ||
              Object.getPrototypeOf(target) !== null ||
              typeof index !== 'string' ||
              ['__proto__', 'constructor', 'prototype'].includes(index)
        )
          throw new SourceError('Referência de catálogo inválida.')
        target[index] = read(assignment.right, child, depth + 1)
      }
      return read(body.at(-1).argument, child, depth + 1)
    }
    throw new SourceError('A fonte mudou o formato de dados públicos; nenhum script foi executado.')
  }
  return read(expression, new Map())
}
export function findData(value: any, predicate: (item: any) => boolean): any {
  const pending = [value]
  let visited = 0
  while (pending.length && visited++ < 100000) {
    const item = pending.pop()
    if (item && typeof item === 'object') {
      if (predicate(item)) return item
      pending.push(...Object.values(item))
    }
  }
  return null
}
