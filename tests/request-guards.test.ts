import { describe, expect, it } from 'vitest'
import { isIpHostname, isStateChangingMethod, isTrustedOrigin, requestTargetsIpAddress } from '../lib/security/request-guards'

function requestWithHeaders(headers: HeadersInit, url = 'http://localhost:3080/api/example') {
  return new Request(url, { headers })
}

describe('request origin guards', () => {
  it('identifies state-changing HTTP methods', () => {
    expect(isStateChangingMethod('GET')).toBe(false)
    expect(isStateChangingMethod('HEAD')).toBe(false)
    expect(isStateChangingMethod('POST')).toBe(true)
    expect(isStateChangingMethod('PUT')).toBe(true)
    expect(isStateChangingMethod('PATCH')).toBe(true)
    expect(isStateChangingMethod('DELETE')).toBe(true)
  })

  it('accepts same-origin requests using host from the request URL', () => {
    const request = requestWithHeaders({
      origin: 'http://localhost:3080',
      host: 'localhost:3080',
    })

    expect(isTrustedOrigin(request)).toBe(true)
  })

  it('accepts same-origin requests behind a proxy', () => {
    const request = requestWithHeaders({
      origin: 'https://koma.example.com',
      host: '127.0.0.1:3080',
      'x-forwarded-host': 'koma.example.com',
      'x-forwarded-proto': 'https',
    })

    expect(isTrustedOrigin(request)).toBe(true)
  })

  it('detects IP hostnames without treating domains as IP', () => {
    expect(isIpHostname('192.168.1.50')).toBe(true)
    expect(isIpHostname('192.168.1.50:3080')).toBe(true)
    expect(isIpHostname('[2001:db8::1]:3080')).toBe(true)
    expect(isIpHostname('koma.example.com')).toBe(false)
    expect(isIpHostname('localhost')).toBe(false)
  })

  it('detects requests targeting an IP address', () => {
    expect(
      requestTargetsIpAddress(
        requestWithHeaders(
          {
            origin: 'http://outro-app.example',
            host: '192.168.1.50:3080',
          },
          'http://192.168.1.50:3080/api/local/health',
        ),
      ),
    ).toBe(true)
    expect(
      requestTargetsIpAddress(
        requestWithHeaders(
          {
            origin: 'http://192.168.0.130:3080',
            host: '192.168.0.130:3080',
          },
          'http://192.168.0.130:3080/api/local/health',
        ),
      ),
    ).toBe(true)

    expect(
      requestTargetsIpAddress(
        requestWithHeaders(
          {
            origin: 'http://outro-app.example',
            host: '127.0.0.1:3080',
            'x-forwarded-host': 'koma.example.com',
          },
          'http://127.0.0.1:3080/api/local/health',
        ),
      ),
    ).toBe(false)
  })

  it('rejects cross-origin browser requests by default', () => {
    const request = requestWithHeaders({
      origin: 'https://attacker.example.com',
      host: 'localhost:3080',
    })

    expect(isTrustedOrigin(request)).toBe(false)
  })
})
