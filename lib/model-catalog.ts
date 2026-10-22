// Provedores que o KPassword sabe chamar e modelos sugeridos para tradução e
// revisão. O ID do modelo continua livre: a lista só sugere; qualquer ID
// disponível na conta pode ser digitado. Preços mudam: confira no provedor.
export type ApiProvider =
  'deepseek' | 'mimo' | 'openai' | 'anthropic' | 'zai' | 'claude-code' | 'chatgpt-codex' | 'google-free' | 'deepl-free' | 'openrouter'
export type ModelTier = 'econômico' | 'equilíbrio' | 'qualidade'
export interface CatalogModel {
  id: string
  label: string
  tier: ModelTier
  vision?: boolean
  note?: string
}
export interface CatalogProvider {
  id: ApiProvider
  name: string
  /** Identificadores das chaves no cofre, em ordem de preferência. */
  identifiers: string[]
  /** Formato do pedido: compatível com OpenAI (chat/completions), Anthropic (messages) ou programa local (assinatura). */
  wire: 'openai' | 'anthropic' | 'cli' | 'free' | 'koma-key'
  operation: 'chat' | 'messages' | 'cli' | 'free'
  models: CatalogModel[]
}

export const API_PROVIDERS: CatalogProvider[] = [
  {
    // Tradutor automático do Google, sem conta nem chave. Rápido e grátis, mas
    // traduz fala por fala, sem contexto da cena nem correção de leitura do OCR.
    id: 'google-free',
    name: 'Google Tradutor (grátis)',
    identifiers: [],
    wire: 'free',
    operation: 'free',
    models: [
      {
        id: 'google-translate',
        label: 'Google Tradutor',
        tier: 'econômico',
        note: 'Grátis e rápido; tradução literal, sem contexto entre as falas.',
      },
    ],
  },
  {
    // DeepL API Free: conta gratuita do DeepL com franquia mensal, chave guardada no
    // KOMA. Também traduz fala por fala, sem contexto da cena.
    id: 'deepl-free',
    name: 'DeepL API Free (chave guardada no KOMA)',
    identifiers: [],
    wire: 'free',
    operation: 'free',
    models: [
      {
        id: 'deepl-free',
        label: 'DeepL',
        tier: 'econômico',
        note: 'Grátis dentro da franquia mensal da conta; tradução fala por fala, sem contexto entre as falas.',
      },
    ],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    identifiers: ['DEEPSEEK_API_KEY'],
    wire: 'openai',
    operation: 'chat',
    models: [
      {
        id: 'deepseek-v4-flash',
        label: 'DeepSeek V4.1 Flash',
        tier: 'econômico',
        note: 'Recomendado para tradução; responde como deepseek-flash.',
      },
      { id: 'deepseek-flash', label: 'DeepSeek Flash (alias)', tier: 'econômico' },
      { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', tier: 'qualidade', note: 'Cerca de 12× o custo do Flash.' },
    ],
  },
  {
    id: 'mimo',
    name: 'Xiaomi MiMo',
    identifiers: ['MIMO_API_KEY', 'XIAOMI_API_KEY'],
    wire: 'openai',
    operation: 'chat',
    models: [
      { id: 'mimo-v2.6-flash', label: 'MiMo V2.6 Flash', tier: 'econômico', note: 'Recomendado para revisão.' },
      { id: 'mimo-v2.6-pro', label: 'MiMo V2.6 Pro', tier: 'qualidade' },
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI (GPT)',
    identifiers: ['OPENAI_API_KEY'],
    wire: 'openai',
    operation: 'chat',
    models: [
      { id: 'gpt-6-luna', label: 'GPT-6 Luna', tier: 'econômico', vision: true },
      { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', tier: 'econômico', vision: true },
      { id: 'gpt-5.4-nano', label: 'GPT-5.4 nano', tier: 'econômico', vision: true },
      { id: 'gpt-5.4-mini', label: 'GPT-5.4 mini', tier: 'equilíbrio', vision: true },
      { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', tier: 'equilíbrio', vision: true },
      { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol', tier: 'qualidade', vision: true },
      { id: 'gpt-6-astra', label: 'GPT-6 Astra', tier: 'qualidade', vision: true },
      { id: 'gpt-5.5', label: 'GPT-5.5', tier: 'qualidade', vision: true },
    ],
  },
  {
    id: 'anthropic',
    name: 'Anthropic (Claude)',
    identifiers: ['ANTHROPIC_API_KEY'],
    wire: 'anthropic',
    operation: 'messages',
    models: [
      { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', tier: 'econômico', vision: true },
      { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', tier: 'equilíbrio', vision: true },
      { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', tier: 'qualidade', vision: true },
      { id: 'claude-fable-5-1', label: 'Claude Fable 5.1', tier: 'qualidade', vision: true },
      { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', tier: 'econômico', vision: true },
      { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5', tier: 'equilíbrio', vision: true },
    ],
  },
  {
    id: 'zai',
    name: 'Z.ai (GLM)',
    identifiers: ['ZAI_API_KEY', 'ZHIPU_API_KEY', 'GLM_API_KEY'],
    wire: 'openai',
    operation: 'chat',
    models: [
      { id: 'glm-4.7-flash', label: 'GLM-4.7 Flash', tier: 'econômico', note: 'Gratuito na API segundo a Z.ai (sujeito a limites).' },
      { id: 'glm-5.3-flash', label: 'GLM-5.3 Flash', tier: 'econômico' },
      { id: 'glm-5', label: 'GLM-5', tier: 'qualidade' },
      { id: 'glm-4.6v-flash', label: 'GLM-4.6V Flash (visão)', tier: 'econômico', vision: true },
    ],
  },
  {
    // Chave guardada no próprio KOMA, sem KPassword (no Windows a ponte não existe).
    // Qualquer modelo do catálogo do OpenRouter pode ser digitado.
    id: 'openrouter',
    name: 'OpenRouter (chave guardada no KOMA)',
    identifiers: [],
    wire: 'koma-key',
    operation: 'chat',
    models: [
      { id: 'deepseek/deepseek-v4-flash', label: 'DeepSeek V4 Flash', tier: 'econômico' },
      { id: 'google/gemma-4-31b-it', label: 'Gemma 4 31B', tier: 'econômico' },
      { id: 'z-ai/glm-4.7-flash:free', label: 'GLM-4.7 Flash (grátis, com limite)', tier: 'econômico' },
    ],
  },
  {
    // Usa o login do Claude Code no computador (assinatura Pro/Max), sem API key
    // nem KPassword. Sujeito aos limites de uso da assinatura.
    id: 'claude-code',
    name: 'Assinatura Claude (Claude Code)',
    identifiers: [],
    wire: 'cli',
    operation: 'cli',
    models: [
      {
        id: 'haiku',
        label: 'Claude Haiku (mais recente)',
        tier: 'econômico',
        vision: true,
        note: 'Rápido; consome pouco do limite da assinatura.',
      },
      { id: 'sonnet', label: 'Claude Sonnet (mais recente)', tier: 'equilíbrio', vision: true },
      {
        id: 'opus',
        label: 'Claude Opus (mais recente)',
        tier: 'qualidade',
        vision: true,
        note: 'Consome o limite da assinatura bem mais rápido.',
      },
    ],
  },
  {
    // Usa o login do Codex que vem com o app do ChatGPT (Plus/Pro), sem API key
    // nem KPassword. Sujeito aos limites de uso da assinatura.
    id: 'chatgpt-codex',
    name: 'Assinatura ChatGPT (Codex)',
    identifiers: [],
    wire: 'cli',
    operation: 'cli',
    models: [
      { id: 'gpt-6-luna', label: 'GPT-6 Luna', tier: 'econômico', vision: true, note: 'Rápido; consome pouco do limite da assinatura.' },
      { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', tier: 'econômico', vision: true },
      { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol', tier: 'equilíbrio', vision: true, note: 'Padrão do Codex.' },
      { id: 'gpt-6-astra', label: 'GPT-6 Astra', tier: 'qualidade', vision: true, note: 'Consome o limite da assinatura bem mais rápido.' },
    ],
  },
]

export const PROVIDER_IDS = API_PROVIDERS.map((provider) => provider.id) as ApiProvider[]
export function catalogProvider(id: ApiProvider) {
  return API_PROVIDERS.find((provider) => provider.id === id)!
}
export function providerName(id: string) {
  return API_PROVIDERS.find((provider) => provider.id === id)?.name || id
}
