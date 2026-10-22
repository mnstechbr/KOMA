const { test } = require('node:test')
const assert = require('node:assert/strict')
const { allowedExternalLink } = require('../external-links.cjs')
test('somente perfis do criador e o projeto base abrem no navegador externo', () => {
  assert.equal(allowedExternalLink('https://www.linkedin.com/in/jean-vitor-16a19642a/'), true)
  assert.equal(allowedExternalLink('https://github.com/mnstechbr'), true)
  assert.equal(allowedExternalLink('https://github.com/marco0antonio0/translate-manga-br'), true)
  assert.equal(allowedExternalLink('https://github.com/mnstechbr/KOMA/issues/new?template=erro-de-traducao.yml&tipo=x'), true)
  for (const value of [
    'https://github.com/mnstechbr/KOMA/issues/new/../../evil',
    'https://github.com/mnstechbr/KOMA/issues/new#x',
    'file:///etc/passwd',
    'https://evil.invalid',
    'https://github.com/mnstechbr?token=secret',
    'https://www.linkedin.com.evil.invalid/in/jean-vitor-16a19642a/',
  ])
    assert.equal(allowedExternalLink(value), false)
})
