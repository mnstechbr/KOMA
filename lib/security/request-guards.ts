import { isIP } from 'node:net'

export function isStateChangingMethod(method: string) {
  return method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE'
}

function firstHeaderValue(value: string | null) {
  if (!value) return null
  return value.split(',')[0]?.trim() || null
}

function stripPort(host: string) {
  const normalized = host.trim()
  if (!normalized) return ''
  if (normalized.startsWith('[')) {
    const closingBracket = normalized.indexOf(']')
    return closingBracket > 0 ? normalized.slice(1, closingBracket) : normalized
  }
  return normalized.split(':')[0] || normalized
}

export function isIpHostname(host: string | null | undefined) {
  const hostname = stripPort(host || '')
  return Boolean(hostname && isIP(hostname))
}

export function getRequestHostname(request: Request) {
  const forwardedHost = firstHeaderValue(request.headers.get('x-forwarded-host'))
  const host = forwardedHost || firstHeaderValue(request.headers.get('host'))
  if (host) return stripPort(host)

  try {
    return new URL(request.url).hostname
  } catch {
    return ''
  }
}

export function requestTargetsIpAddress(request: Request) {
  return isIpHostname(getRequestHostname(request))
}

export function isTrustedOrigin(request: Request) {
  const origin = firstHeaderValue(request.headers.get('origin'))
  if (!origin) return false

  const forwardedHost = firstHeaderValue(request.headers.get('x-forwarded-host'))
  const host = forwardedHost || firstHeaderValue(request.headers.get('host'))
  const forwardedProto = firstHeaderValue(request.headers.get('x-forwarded-proto'))

  if (!host) return false

  let expectedOrigin = ''
  if (forwardedProto) {
    expectedOrigin = `${forwardedProto}://${host}`
  } else {
    try {
      const url = new URL(request.url)
      expectedOrigin = `${url.protocol}//${host}`
    } catch {
      expectedOrigin = `http://${host}`
    }
  }

  return origin === expectedOrigin
}
