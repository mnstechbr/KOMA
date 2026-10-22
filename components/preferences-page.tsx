'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AppearanceSettings } from './appearance-settings'
import { PrefSection } from './pref-section'
import { StorageSettings } from './storage-settings'
import { LanguageSettings } from './language-settings'
import { SourceSettings } from './source-settings'
import { BackgroundSettings } from './background-settings'
import { PerformanceSettings } from './performance-settings'
import { SubscriptionConnections } from './subscription-connections'
import { OpenRouterKey } from './openrouter-key'
import { DeeplKey } from './deepl-key'
import { StageTimes } from './stage-times'
import { SettingsSkeleton } from './koma-skeletons'
import { MobileSettings } from './mobile-settings'
import { AniListSettings } from './anilist-settings'
import { Input } from './ui/input'
import { Label } from './ui/label'
import type { KomaTranslationSettings, ModelProfile } from '@/lib/backend/kpassword/settings'
import { API_PROVIDERS, catalogProvider, type ApiProvider } from '@/lib/model-catalog'
import { KOMA_BASE_PROJECT } from '@/lib/koma-brand'
import { useT } from './i18n'

// Grupos da escolha do tradutor, na ordem em que aparecem.
const GROUPS: Array<{ label: string; wires: string[] }> = [
  { label: 'Grátis', wires: ['free'] },
  { label: 'Assinatura, sem chave', wires: ['cli'] },
  { label: 'Chave de API pelo KPassword', wires: ['openai', 'anthropic'] },
  { label: 'Chave de API guardada no KOMA', wires: ['koma-key'] },
]
const SELECT = 'h-10 w-full rounded-[4px] border-2 border-input bg-background px-3 text-sm'

function ProviderPicker({ id, label, value, onChange, disabled, exclude = [] }: { id: string; label: string; value: ModelProfile; onChange: (value: ModelProfile) => void; disabled: boolean; exclude?: ApiProvider[] }) {
  const { t } = useT()
  const provider = catalogProvider(value.provider)
  const chosen = provider.models.find((model) => model.id === value.model)
  return <div className="grid gap-3 md:grid-cols-2">
    <div className="space-y-1"><Label htmlFor={`${id}-provider`}>{t(label)}</Label>
      <select id={`${id}-provider`} className={SELECT} value={value.provider} disabled={disabled} onChange={(event) => {
        const next = catalogProvider(event.target.value as ApiProvider)
        // Um modelo só (Google) ou assinatura: já vem preenchido com o primeiro sugerido.
        onChange({ provider: next.id, model: next.wire === 'free' || next.wire === 'cli' ? next.models[0].id : '', credentialId: '' })
      }}>
        {GROUPS.map((group) => <optgroup key={group.label} label={t(group.label)}>
          {API_PROVIDERS.filter((item) => group.wires.includes(item.wire) && !exclude.includes(item.id)).map((item) => <option key={item.id} value={item.id}>{t(item.name)}</option>)}
        </optgroup>)}
      </select></div>
    {provider.wire === 'free' ? null : <div className="space-y-1"><Label htmlFor={`${id}-model`}>{t('Modelo')}</Label>
      <Input id={`${id}-model`} list={`${id}-models`} value={value.model} maxLength={128} disabled={disabled} placeholder={t('Ex.: {id}', { id: provider.models[0].id })} onChange={(event) => onChange({ ...value, model: event.target.value.trim() })} />
      <datalist id={`${id}-models`}>{provider.models.map((model) => <option key={model.id} value={model.id}>{`${model.label} · ${t(model.tier)}`}</option>)}</datalist></div>}
    <p className="text-xs text-muted-foreground md:col-span-2">{chosen ? `${chosen.label} · ${t(chosen.tier)}${chosen.note ? ` · ${t(chosen.note)}` : ''}` : provider.wire === 'free' ? '' : t('Escolha um modelo sugerido ou digite qualquer ID disponível na sua conta.')}</p>
  </div>
}

// Conexão necessária para o provedor escolhido: login da assinatura, ponte do
// KPassword ou chave do OpenRouter. Só aparece o que o tradutor escolhido usa.
function Connection({ provider, bridge, onCheck, busy }: { provider: ApiProvider; bridge: { available: boolean; message: string } | null; onCheck: () => void; busy: boolean }) {
  const { t } = useT()
  const wire = catalogProvider(provider).wire
  if (provider === 'deepl-free') return <DeeplKey />
  if (wire === 'free') return <p className="koma-note">{t('Grátis e sem conta. O Google traduz fala por fala, sem o contexto do capítulo, e pode bloquear por um tempo se receber pedidos demais.')}</p>
  if (wire === 'cli') return <SubscriptionConnections only={provider as 'claude-code' | 'chatgpt-codex'} />
  if (wire === 'koma-key') return <OpenRouterKey />
  return <div className="space-y-2">
    <p className="text-sm" data-bridge-status={bridge?.available ? 'available' : 'unavailable'}>{bridge?.message || t('Consultando o conector local…')}</p>
    <p className="koma-note">{t('A chave fica no KPassword: abra o cofre, ative o Secrets Bridge e autorize na primeira chamada.')}</p>
    <button type="button" id="check-kpassword-connection" className="koma-outline-button" disabled={busy} onClick={onCheck}>{t('Verificar conexão, sem consumir cota')}</button>
  </div>
}

function TranslationSettings() {
  const { t } = useT()
  const [settings, setSettings] = useState<KomaTranslationSettings | null>(null)
  const [bridge, setBridge] = useState<{ available: boolean; message: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [message, setMessage] = useState('')
  const [sample, setSample] = useState('We did it! I knew you would come back.')
  const [result, setResult] = useState<{ translations: string[]; steps?: Array<{ stage: string; provider: string; requestedModel: string; actualModel: string | null; durationMs: number }> } | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    void fetch('/api/local/translation', { cache: 'no-store', signal: controller.signal }).then(async (response) => {
      const data = await response.json()
      if (!response.ok) throw new Error(data.message)
      setSettings(data.settings); setBridge(data.bridge)
    }).catch(() => { if (!controller.signal.aborted) setMessage(t('Não foi possível carregar as preferências. Reabra esta tela para tentar novamente.')) })
    return () => controller.abort()
  }, [t])

  if (!settings) return message ? <p className="koma-note">{message}</p> : <SettingsSkeleton />
  const current = settings
  const used = [current.translation.provider, ...(current.review.enabled ? [current.review.provider] : [])].filter((id, index, list) => list.indexOf(id) === index)
  const viaVault = used.some((id) => ['openai', 'anthropic'].includes(catalogProvider(id).wire))

  function change(update: Partial<KomaTranslationSettings>) {
    setSettings({ ...current, ...update }); setDirty(true); setResult(null); setMessage('')
  }
  async function save() {
    setBusy(true); setMessage('')
    try {
      const response = await fetch('/api/local/translation', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(current) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || t('Não foi possível salvar.'))
      setSettings(data.settings); setDirty(false); setMessage(t('Preferências salvas.'))
    } catch (error) { setMessage(error instanceof Error ? error.message : t('Não foi possível salvar.')) }
    finally { setBusy(false) }
  }
  async function test() {
    setBusy(true); setMessage(t('Traduzindo o texto de teste…')); setResult(null)
    try {
      const response = await fetch('/api/translate/text-batch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source_lang: 'auto', texts: [sample] }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || t('O teste não foi concluído.'))
      setResult(data); setMessage('')
    } catch (error) { setMessage(error instanceof Error ? error.message : t('O teste não foi concluído.')) }
    finally { setBusy(false) }
  }
  async function checkConnection() {
    setBusy(true); setMessage(t('Verificando a conexão local…'))
    try {
      const response = await fetch('/api/local/translation/check', { method: 'POST' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || t('Não foi possível conectar ao KPassword.'))
      setBridge(data.bridge); setMessage(data.bridge.message)
    } catch (error) { setMessage(error instanceof Error ? error.message : t('Não foi possível conectar ao KPassword.')) }
    finally { setBusy(false) }
  }

  return <div className="flex flex-col gap-4">
    <label className="koma-switch"><input id="kpassword-enabled" type="checkbox" checked={current.enabled} disabled={busy} onChange={(event) => change({ enabled: event.target.checked })} />{t('Traduzir as obras automaticamente')}</label>
    <ProviderPicker id="adaptation" label="Quem traduz" value={current.translation} disabled={busy} onChange={(translation) => change({ translation, ...(catalogProvider(translation.provider).wire === 'free' ? { review: { ...current.review, enabled: false } } : {}) })} />
    {/* Tradutor grátis trabalha sozinho: sem revisor nem IA paga junto. */}
    {catalogProvider(current.translation.provider).wire === 'free' ? null : <label className="koma-switch"><input id="review-enabled" type="checkbox" checked={current.review.enabled} disabled={busy} onChange={(event) => change({ review: { ...current.review, enabled: event.target.checked } })} /><span>{t('Revisar com um segundo modelo')}<br /><span className="koma-note">{t('Confere a tradução contra o original. Fica melhor, mas cada capítulo leva o dobro do tempo.')}</span></span></label>}
    {current.review.enabled ? <ProviderPicker id="review" label="Quem revisa" value={current.review} disabled={busy} exclude={['google-free', 'deepl-free']} onChange={(review) => change({ review: { ...review, enabled: true } })} /> : null}
    {used.map((id) => <Connection key={id} provider={id} bridge={bridge} busy={busy} onCheck={() => void checkConnection()} />)}
    <fieldset className="space-y-2"><legend className="text-sm font-medium">{t('Envio das falas')}</legend>
      {used.map((id) => <label key={id} className="koma-switch"><input id={`consent-${id}`} type="checkbox" disabled={busy} checked={current.consent[id]} onChange={(event) => change({ consent: { ...current.consent, [id]: event.target.checked }, ...(!event.target.checked ? { enabled: false } : {}) })} />{t('Autorizo enviar as falas para {name}.', { name: t(catalogProvider(id).name) })}</label>)}
      <p className="koma-note">{t('Só o texto das falas sai do computador, nunca as imagens.')}</p>
    </fieldset>
    <details className="koma-subdetails"><summary>{t('Avançado: glossário, vozes e credencial')}</summary>
      <div className="flex flex-col gap-3 pt-3">
        <div className="space-y-2"><Label htmlFor="translation-glossary">{t('Glossário')}</Label><textarea id="translation-glossary" className="min-h-24 w-full rounded-[4px] border-2 border-input bg-background p-3 text-sm" maxLength={6000} value={current.glossary} disabled={busy} onChange={(event) => change({ glossary: event.target.value })} placeholder={t('Nomes, termos e traduções que devem ser mantidos.')} /></div>
        <div className="space-y-2"><Label htmlFor="translation-voices">{t('Vozes dos personagens')}</Label><textarea id="translation-voices" className="min-h-24 w-full rounded-[4px] border-2 border-input bg-background p-3 text-sm" maxLength={6000} value={current.voices} disabled={busy} onChange={(event) => change({ voices: event.target.value })} placeholder={t('Ex.: personagem A é formal; personagem B usa linguagem coloquial. Não invente informações ausentes da obra.')} /></div>
        {viaVault ? <div className="space-y-1"><Label htmlFor="adaptation-credential">{t('ID da credencial no KPassword (só se houver mais de uma chave do mesmo provedor)')}</Label>
          <Input id="adaptation-credential" value={current.translation.credentialId} maxLength={36} autoComplete="off" spellCheck={false} disabled={busy} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" onChange={(event) => change({ translation: { ...current.translation, credentialId: event.target.value.trim() } })} /></div> : null}
      </div>
    </details>
    <div className="flex flex-wrap gap-2">
      <button type="button" id="save-kpassword-settings" className="koma-button" onClick={() => void save()} disabled={busy || !dirty}>{busy ? t('Aguarde…') : t('Salvar')}</button>
    </div>
    <details className="koma-subdetails"><summary>{t('Testar o tradutor')}</summary>
      <div className="flex flex-col gap-2 pt-3">
        <textarea id="translation-sample" aria-label={t('Texto de teste')} className="min-h-20 w-full rounded-[4px] border-2 border-input bg-background p-3 text-sm" maxLength={5000} value={sample} disabled={busy} onChange={(event) => setSample(event.target.value)} />
        <button type="button" id="test-kpassword-translation" className="koma-outline-button self-start" disabled={busy || dirty || !current.enabled || !sample.trim()} onClick={() => void test()}>{t('Testar (envia o texto ao tradutor)')}</button>
        {dirty ? <p className="koma-note">{t('Salve as alterações antes de testar.')}</p> : null}
        {result ? <div className="space-y-1 rounded-lg bg-muted p-3"><p className="whitespace-pre-wrap text-sm">{result.translations.join('\n')}</p>
          {result.steps?.map((step, i) => <p key={i} className="text-xs text-muted-foreground">{step.stage === 'review' ? t('Revisão') : t('Tradução')}: {step.provider} / {step.actualModel || step.requestedModel} · {(step.durationMs / 1000).toFixed(1)} s</p>)}</div> : null}
      </div>
    </details>
    <p role="status" aria-live="polite" className="text-sm">{message}</p>
  </div>
}

export function PreferencesPage() {
  const { t } = useT()
  return <div className="flex w-full max-w-5xl flex-col gap-5" data-preferences="true">
    <header className="koma-page-head !mb-0"><div><h1>{t('Preferências')}</h1></div></header>
    <div className="koma-pref-list">
      <PrefSection id="translation" title={t('Tradução')} hint={t('Quem traduz, revisão, glossário e teste')}><TranslationSettings /></PrefSection>
      <PrefSection id="sources" title={t('Fontes')} hint={t('Onde o KOMA procura os capítulos')}><SourceSettings /></PrefSection>
      <PrefSection id="background" title={t('Segundo plano')} hint={t('Bandeja, iniciar com o computador, procura diária e avisos')}><BackgroundSettings /></PrefSection>
      <PrefSection id="mobile" title={t('Ler no celular')} hint={t('Abrir a biblioteca no celular pelo Wi-Fi de casa')}><MobileSettings /></PrefSection>
      <PrefSection id="anilist" title={t('AniList')} hint={t('Atualizar o seu progresso de leitura no AniList')}><AniListSettings /></PrefSection>
      <PrefSection id="storage" title={t('Armazenamento na nuvem')} hint={t('Guardar os capítulos no Google Drive, OneDrive ou outra nuvem')}><StorageSettings /></PrefSection>
      <PrefSection id="performance" title={t('Desempenho')} hint={t('Quanto do computador o KOMA usa para preparar capítulos')}><PerformanceSettings /><StageTimes /></PrefSection>
      <PrefSection id="language" title={t('Idioma e aparência')} hint={t('Idioma das telas e das traduções, fundo animado')}><LanguageSettings /><AppearanceSettings /></PrefSection>
    </div>
    <p className="text-sm text-muted-foreground" data-koma-origin>{t('Sobre o projeto: o KOMA é software livre (AGPL-3.0), baseado no projeto open source {project} (licença MIT).', { project: KOMA_BASE_PROJECT })} <Link href="/inicio/sobre" className="koma-text-link">{t('Ver origem e créditos')}</Link></p>
  </div>
}
