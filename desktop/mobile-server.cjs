const http = require('node:http')
const crypto = require('node:crypto')

// "Ler no celular": servidor só da rede de casa. Quem entra com o QR code (ou o
// código de 6 dígitos) vê a biblioteca e o leitor em modo só leitura; todo o resto
// do serviço local (Preferências, chaves, fila) fica fora de alcance.
const ALLOWED = [
  ['GET', /^\/movel(\/[\w-]+)*$/], ['GET', /^\/_next\/static\//], ['GET', /^\/fonts\//], ['GET', /^\/[\w.-]+\.(png|svg|ico|webmanifest)$/],
  ['GET', /^\/api\/local\/works$/], ['GET', /^\/api\/local\/works\/\d+$/], ['GET', /^\/api\/local\/works\/\d+\/chapters\/\d+$/],
  // Marcar como lido é o único pedido que muda alguma coisa.
  ['POST', /^\/api\/local\/works\/\d+\/chapters\/\d+$/],
  ['GET', /^\/api\/sections\/\d+\/images\/\d+\/(original|translated)\/view$/], ['GET', /^\/api\/local\/catalog\/[\w:-]+\/cover$/],
]
const SESSION_DAYS = 30
const TEXT = {
  'pt-BR': { title: 'KOMA no celular', hint: 'Digite o código de 6 dígitos que aparece em Preferências → Ler no celular, no computador.', enter: 'Entrar', wrong: 'Código errado.', locked: 'Muitas tentativas. Espere alguns minutos.' },
  en: { title: 'KOMA on your phone', hint: 'Enter the 6-digit code shown in Settings → Read on your phone, on the computer.', enter: 'Enter', wrong: 'Wrong code.', locked: 'Too many attempts. Wait a few minutes.' },
  es: { title: 'KOMA en el móvil', hint: 'Escribe el código de 6 dígitos que aparece en Preferencias → Leer en el móvil, en el ordenador.', enter: 'Entrar', wrong: 'Código incorrecto.', locked: 'Demasiados intentos. Espera unos minutos.' },
}

/** Só a própria máquina e a rede local (faixas privadas) podem falar com o servidor. */
function privateAddress(address) {
  const value = String(address || '').replace(/^::ffff:/, '')
  return value === '127.0.0.1' || value === '::1' || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(value) || /^f[cd][0-9a-f]{2}:/i.test(value) || /^fe80:/i.test(value)
}
function allowed(method, pathname) { return ALLOWED.some(([verb, pattern]) => verb === method && pattern.test(pathname)) }

function loginPage(language, message) {
  const text = TEXT[language] || TEXT['pt-BR']
  const escape = (value) => String(value).replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char])
  return `<!doctype html><html lang="${escape(language)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(text.title)}</title>
<style>body{margin:0;font-family:system-ui,sans-serif;background:#f3eee6;color:#141414;display:grid;place-items:center;min-height:100vh}form{display:flex;flex-direction:column;gap:12px;padding:24px;max-width:340px;border:3px solid #141414;background:#fbf8f3;box-shadow:6px 6px 0 #141414}h1{margin:0;font-size:22px}input{font-size:28px;letter-spacing:.3em;text-align:center;padding:8px;border:2px solid #141414}button{font-size:18px;padding:10px;background:#c62a43;color:#fff;border:0}p{margin:0}.error{color:#c62a43;font-weight:700}</style></head>
<body><form method="post" action="/entrar"><h1>${escape(text.title)}</h1><p>${escape(text.hint)}</p>${message ? `<p class="error">${escape(message)}</p>` : ''}<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="\\d{6}" maxlength="6" required autofocus><button>${escape(text.enter)}</button></form></body></html>`
}

function startMobileServer({ port, token, code, backendUrl, sessionToken, language }) {
  const sessions = new Map()
  const failures = new Map()
  const backend = new URL(backendUrl)
  const newSession = (response) => {
    const id = crypto.randomBytes(24).toString('hex')
    sessions.set(id, Date.now() + SESSION_DAYS * 86400000)
    response.setHeader('Set-Cookie', `koma-mobile=${id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}`)
  }
  const sessionOf = (request) => {
    const id = /(?:^|;\s*)koma-mobile=([0-9a-f]{48})/.exec(request.headers.cookie || '')?.[1]
    const expires = id && sessions.get(id)
    return Boolean(expires && expires > Date.now())
  }
  const send = (response, status, body, type = 'text/html; charset=utf-8') => {
    response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' })
    response.end(body)
  }
  const server = http.createServer((request, response) => {
    if (!privateAddress(request.socket.remoteAddress)) { request.socket.destroy(); return }
    let url
    try { url = new URL(request.url || '/', 'http://celular.local') } catch { send(response, 400, 'Bad request'); return }
    const ip = String(request.socket.remoteAddress)
    // QR code: o link traz o token comprido; o código de 6 dígitos é para digitar.
    if (request.method === 'GET' && url.pathname === '/' && url.searchParams.get('k')) {
      const given = Buffer.from(url.searchParams.get('k') || '')
      const expected = Buffer.from(token)
      if (given.length === expected.length && crypto.timingSafeEqual(given, expected)) { newSession(response); response.writeHead(302, { Location: '/movel' }); response.end(); return }
      send(response, 403, loginPage(language, (TEXT[language] || TEXT['pt-BR']).wrong)); return
    }
    if (request.method === 'POST' && url.pathname === '/entrar') {
      const state = failures.get(ip) || { count: 0, until: 0 }
      if (state.until > Date.now()) { send(response, 429, loginPage(language, (TEXT[language] || TEXT['pt-BR']).locked)); return }
      let body = ''
      request.on('data', (chunk) => { body += chunk; if (body.length > 200) request.destroy() })
      request.on('end', () => {
        const typed = new URLSearchParams(body).get('code') || ''
        if (/^\d{6}$/.test(typed) && crypto.timingSafeEqual(Buffer.from(typed), Buffer.from(code))) {
          failures.delete(ip); newSession(response); response.writeHead(302, { Location: '/movel' }); response.end(); return
        }
        const count = state.count + 1
        failures.set(ip, { count: count >= 5 ? 0 : count, until: count >= 5 ? Date.now() + 10 * 60000 : 0 })
        send(response, 403, loginPage(language, (TEXT[language] || TEXT['pt-BR']).wrong))
      })
      return
    }
    if (!sessionOf(request)) { send(response, 401, loginPage(language)); return }
    if (url.pathname === '/') { response.writeHead(302, { Location: '/movel' }); response.end(); return }
    if (!allowed(request.method, url.pathname)) { send(response, 404, 'Not found', 'text/plain; charset=utf-8'); return }
    // Repassa ao serviço local como se fosse a janela do app (mesma origem e sessão).
    const headers = { ...request.headers, host: backend.host, cookie: `koma-session=${sessionToken}; koma-lang=${language}` }
    delete headers.origin; delete headers.referer; delete headers['sec-fetch-site']
    if (request.method === 'POST') headers.origin = backend.origin
    const forward = http.request({ hostname: backend.hostname, port: backend.port, path: url.pathname + url.search, method: request.method, headers }, (upstream) => {
      const outgoing = { ...upstream.headers }
      delete outgoing['set-cookie']
      response.writeHead(upstream.statusCode || 502, outgoing)
      upstream.pipe(response)
    })
    forward.on('error', () => { if (!response.headersSent) send(response, 502, 'KOMA', 'text/plain; charset=utf-8'); else response.destroy() })
    request.pipe(forward)
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '0.0.0.0', () => resolve({ port: server.address().port, stop: () => new Promise((done) => { server.close(() => done()); server.closeAllConnections?.() }) }))
  })
}

module.exports = { startMobileServer, privateAddress, allowed }
