import { PROVIDER_IDS, catalogProvider, providerName, type ApiProvider } from '@/lib/model-catalog'
export type { ApiProvider }
export interface ModelProfile { provider: ApiProvider; model: string; credentialId: string }
export interface KomaTranslationSettings {
  enabled: boolean
  translation: ModelProfile
  review: ModelProfile & { enabled: boolean }
  consent: Record<ApiProvider, boolean>
  glossary: string
  voices: string
}

export function defaultTranslationSettings(): KomaTranslationSettings {
  return {
    enabled: false,
    translation: { provider: 'deepseek', model: '', credentialId: '' },
    review: { enabled: true, provider: 'mimo', model: '', credentialId: '' },
    consent: Object.fromEntries(PROVIDER_IDS.map((id) => [id, false])) as Record<ApiProvider, boolean>, glossary: '', voices: '',
  }
}

export class TranslationError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) { super(message) }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TranslationError('invalid_settings', 'Configuração de tradução inválida.')
  return value as Record<string, unknown>
}
function allowedFields(value: Record<string, unknown>, fields: string[]) {
  if (Object.keys(value).some((key) => !fields.includes(key))) throw new TranslationError('invalid_settings', 'Informe apenas configurações e referências do cofre. Não envie chaves de API.')
}
function profile(value: unknown, review = false): ModelProfile {
  const item = object(value)
  allowedFields(item, review ? ['provider', 'model', 'credentialId', 'enabled'] : ['provider', 'model', 'credentialId'])
  if (typeof item.provider !== 'string' || !(PROVIDER_IDS as string[]).includes(item.provider)) throw new TranslationError('invalid_provider', 'Selecione um provedor da lista.')
  if (typeof item.model !== 'string' || item.model.length > 128 || !/^[a-zA-Z0-9._:/-]*$/.test(item.model)) throw new TranslationError('invalid_model', 'Informe um identificador de modelo válido.')
  // O KPassword cria IDs UUID. Exigir esse formato evita confundir o campo com uma API key.
  if (typeof item.credentialId !== 'string' || (item.credentialId !== '' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.credentialId))) throw new TranslationError('invalid_credential', 'Use o ID UUID da credencial no KPassword, nunca a chave de API.')
  return { provider: item.provider as ApiProvider, model: item.model, credentialId: item.credentialId }
}

export function parseTranslationSettings(value: unknown): KomaTranslationSettings {
  const root = object(value)
  allowedFields(root, ['enabled', 'translation', 'review', 'consent', 'glossary', 'voices'])
  const consent = object(root.consent)
  allowedFields(consent, PROVIDER_IDS)
  const review = object(root.review)
  // Provedores adicionados depois começam sem autorização.
  if (typeof root.enabled !== 'boolean' || typeof review.enabled !== 'boolean' || PROVIDER_IDS.some((id) => consent[id] !== undefined && typeof consent[id] !== 'boolean')) throw new TranslationError('invalid_settings', 'Informe as autorizações e etapas de tradução.')
  for (const field of ['glossary', 'voices']) {
    if (typeof root[field] !== 'string' || root[field].length > 6000) throw new TranslationError('invalid_context', 'Glossário e vozes devem ter até 6.000 caracteres cada.')
  }
  const settings: KomaTranslationSettings = {
    enabled: root.enabled, translation: profile(root.translation),
    review: { ...profile(review, true), enabled: review.enabled },
    consent: Object.fromEntries(PROVIDER_IDS.map((id) => [id, consent[id] === true])) as Record<ApiProvider, boolean>,
    glossary: root.glossary as string, voices: root.voices as string,
  }
  if (settings.enabled) {
    // Tradutores grátis (Google, DeepL Free) trabalham sozinhos: sem revisor e sem misturar com IA paga.
    if (catalogProvider(settings.translation.provider).wire === 'free' && settings.review.enabled) throw new TranslationError('invalid_settings', 'Os tradutores grátis trabalham sem revisão. Desligue a revisão ou escolha um modelo de IA para traduzir.')
    if (catalogProvider(settings.review.provider).wire === 'free' && settings.review.enabled) throw new TranslationError('invalid_settings', 'Os tradutores grátis não servem como revisor.')
    for (const item of [settings.translation, ...(settings.review.enabled ? [settings.review] : [])]) {
      if (!item.model) throw new TranslationError('incomplete_settings', 'Preencha o modelo para cada etapa ativa.')
      if (!settings.consent[item.provider]) throw new TranslationError('consent_required', `Autorize o envio dos diálogos ao ${providerName(item.provider)}.`, 403)
    }
  }
  return settings
}
