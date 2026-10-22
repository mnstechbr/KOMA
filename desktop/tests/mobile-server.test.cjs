const { test } = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const { startMobileServer, privateAddress, allowed } = require('../mobile-server.cjs')

test('só rede local e só as rotas de leitura', () => {
  for (const address of ['127.0.0.1', '::ffff:192.168.0.10', '10.1.2.3', '172.20.0.5']) assert.equal(privateAddress(address), true)
  for (const address of ['8.8.8.8', '::ffff:200.1.1.1', '172.32.0.1']) assert.equal(privateAddress(address), false)
  assert.equal(allowed('GET', '/movel/ler/1/2'), true)
  assert.equal(allowed('GET', '/api/local/works/3/chapters/9'), true)
  assert.equal(allowed('POST', '/api/local/works/3/chapters/9'), true)
  for (const [method, path] of [
    ['GET', '/inicio/preferencias'],
    ['GET', '/api/openrouter'],
    ['PUT', '/api/local/mobile'],
    ['PATCH', '/api/local/works/3'],
    ['GET', '/api/deepl'],
    ['POST', '/api/local/works'],
  ])
    assert.equal(allowed(method, path), false)
})

test('entra com o QR code ou o código e repassa só o permitido', async () => {
  const seen = []
  const backend = http.createServer((request, response) => {
    seen.push({ url: request.url, host: request.headers.host, cookie: request.headers.cookie })
    response.setHeader('Set-Cookie', 'koma-session=x')
    response.end('ok')
  })
  await new Promise((resolve) => backend.listen(0, '127.0.0.1', resolve))
  const backendUrl = `http://127.0.0.1:${backend.address().port}`
  const server = await startMobileServer({
    port: 0,
    token: 'a'.repeat(32),
    code: '123456',
    backendUrl,
    sessionToken: 'desktop-token',
    language: 'pt-BR',
  })
  const base = `http://127.0.0.1:${server.port}`
  try {
    assert.equal((await fetch(`${base}/movel`)).status, 401)
    assert.equal((await fetch(`${base}/?k=${'b'.repeat(32)}`, { redirect: 'manual' })).status, 403)
    const login = await fetch(`${base}/?k=${'a'.repeat(32)}`, { redirect: 'manual' })
    assert.equal(login.status, 302)
    const cookie = login.headers.get('set-cookie').split(';')[0]
    const page = await fetch(`${base}/movel`, { headers: { cookie } })
    assert.equal(await page.text(), 'ok')
    assert.equal(page.headers.get('set-cookie'), null)
    assert.deepEqual(seen.at(-1), { url: '/movel', host: new URL(backendUrl).host, cookie: 'koma-session=desktop-token; koma-lang=pt-BR' })
    assert.equal((await fetch(`${base}/inicio/preferencias`, { headers: { cookie } })).status, 404)
    for (let attempt = 0; attempt < 5; attempt++)
      assert.equal(
        (
          await fetch(`${base}/entrar`, {
            method: 'POST',
            body: 'code=000000',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
          })
        ).status,
        403,
      )
    assert.equal(
      (
        await fetch(`${base}/entrar`, {
          method: 'POST',
          body: 'code=123456',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
        })
      ).status,
      429,
    )
  } finally {
    await server.stop()
    backend.close()
  }
})
