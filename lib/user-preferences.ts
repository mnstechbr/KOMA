export function readAutoProcessingEnabledPreference() {
  if (typeof window === 'undefined') return Promise.resolve(false)

  return fetch('/api/user/preferences/auto-processing', {
    method: 'GET',
    cache: 'no-store',
  })
    .then(async (response) => {
      if (!response.ok) return false
      const data = (await response.json()) as { auto_processing_enabled?: unknown }
      return data.auto_processing_enabled === true
    })
    .catch(() => false)
}

