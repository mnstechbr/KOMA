import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const AUTH_TOKEN_COOKIE = 'koma-session'

function hasBearerToken(request: NextRequest) {
  return /^Bearer\s+\S+/i.test(request.headers.get('authorization') || '')
}

function withCorsHeaders(response: NextResponse) {
  response.headers.set('Access-Control-Allow-Origin', '*')
  response.headers.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
  response.headers.set(
    'Access-Control-Allow-Headers',
    'Authorization, Content-Type, X-API-Key, X-Requested-With'
  )
  response.headers.set('Access-Control-Max-Age', '86400')
  return response
}

function buildContentSecurityPolicy() {
  const scriptSrc = process.env.NODE_ENV === 'production'
    ? "'self' 'unsafe-inline'"
    : "'self' 'unsafe-inline' 'unsafe-eval'"
  const connectSrc = process.env.NODE_ENV === 'production'
    ? "'self' https://openrouter.ai"
    : "'self' https://openrouter.ai ws: wss:"

  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${connectSrc}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ')
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const response = withCorsHeaders(NextResponse.next())

  if (process.env.KOMA_DESKTOP === '1') {
    // O perfil desktop aceita apenas a própria origem local.
    const host = request.headers.get('host') || ''
    if (!/^127\.0\.0\.1:\d+$/.test(host)) {
      return NextResponse.json({ message: 'Endereço local não autorizado.' }, { status: 403 })
    }
    const origin = request.headers.get('origin')
    const localOrigin = `http://${host}`
    if ((origin && origin !== localOrigin) || request.headers.get('sec-fetch-site') === 'cross-site') {
      return NextResponse.json({ message: 'Origem não autorizada.' }, { status: 403 })
    }
    response.headers.delete('Access-Control-Allow-Origin')
    if (pathname === '/api/local/health' || pathname === '/api/local/bootstrap') return response
    if (pathname.startsWith('/api/translate')) {
      const token = request.cookies.get(AUTH_TOKEN_COOKIE)
      if (!token && !hasBearerToken(request)) {
        return NextResponse.json({ message: 'Entre no KOMA para continuar.' }, { status: 401 })
      }
    }
  }

  if (request.method === 'OPTIONS' && pathname.startsWith('/api/')) {
    return withCorsHeaders(new NextResponse(null, { status: 204 }))
  }

  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  response.headers.set('Content-Security-Policy', buildContentSecurityPolicy())

  // Somente a verificação de saúde e a inicialização do app dispensam sessão.
  if (pathname === '/api/local/health' || pathname === '/api/local/bootstrap') {
    return response
  }

  // Demais rotas /api/* exigem a sessão local criada pelo aplicativo.
  if (pathname.startsWith('/api/')) {
    const token = request.cookies.get(AUTH_TOKEN_COOKIE)

    if (!token && !hasBearerToken(request)) {
      return withCorsHeaders(
        NextResponse.json(
          {
            message: 'Token inválido ou expirado',
            error: 'Unauthorized',
            statusCode: 401,
          },
          { status: 401 }
        )
      )
    }
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)']
}
