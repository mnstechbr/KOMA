import type { OpenRouterRepository } from './openrouter.repository'

export class OpenRouterService {
  constructor(private readonly repository: OpenRouterRepository) {}

  getApiKey(): string {
    return (this.repository.getApiKey() || '').trim()
  }

  async validateApiKey(apiKey: string) {
    try {
      const response = await fetch('https://openrouter.ai/api/v1/key', {
        headers: { Authorization: `Bearer ${apiKey}` },
        cache: 'no-store',
        signal: AbortSignal.timeout(15000),
      })
      return response.ok
    } catch {
      return false
    }
  }

  async getStatus() {
    const apiKey = this.getApiKey()
    return { hasApiKey: Boolean(apiKey), isValid: apiKey ? await this.validateApiKey(apiKey) : false }
  }

  async saveApiKey(apiKey: string) {
    const valid = await this.validateApiKey(apiKey)
    if (valid) this.repository.setApiKey(apiKey)
    return valid
  }

  clear() {
    this.repository.clear()
  }
}
