'use client'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Pause, Play, Minus, Plus } from 'lucide-react'
import { useT } from '@/components/i18n'

// Rolagem do leitor:
// - Botão do meio (roda) pressionado: arraste para cima/baixo e a página rola
//   na velocidade da distância; soltar logo após clicar mantém o modo até o
//   próximo clique (como no Windows). O Linux não oferece isso nativamente.
// - Rolagem automática: Espaço inicia/pausa; + e - ajustam a velocidade.
const SPEEDS = [20, 30, 45, 60, 80, 110, 150, 200, 270, 360, 480, 620, 800, 1030, 1320]
const STORAGE_KEY = 'koma:reader:auto-speed'
const DEAD_ZONE = 10

function readStoredSpeed() {
  try { const value = Number(localStorage.getItem(STORAGE_KEY)); return SPEEDS.includes(value) ? value : 60 } catch { return 60 }
}
const atBottom = () => window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2

export function useReaderScroll(enabled: boolean) {
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(60)
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null)
  const state = useRef({ playing: false, speed: 60, anchor: null as null | { x: number; y: number }, pointerY: 0, carry: 0, last: 0, held: false, moved: false })

  useEffect(() => { const stored = readStoredSpeed(); setSpeed(stored); state.current.speed = stored }, [])
  useEffect(() => { state.current.playing = playing }, [playing])
  useEffect(() => { state.current.speed = speed; try { localStorage.setItem(STORAGE_KEY, String(speed)) } catch { /* Preferência só local. */ } }, [speed])

  const changeSpeed = useCallback((direction: 1 | -1) => {
    setSpeed((current) => SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, SPEEDS.indexOf(current) + direction))] ?? 60)
  }, [])
  const toggle = useCallback(() => setPlaying((current) => !current), [])

  // Um único laço atende as duas rolagens; frações de pixel acumulam. Intervalo
  // fixo em vez de requestAnimationFrame: segue rolando mesmo com a janela sem foco.
  useEffect(() => {
    if (!enabled) return
    const tick = () => {
      const s = state.current
      const time = performance.now()
      const elapsed = s.last ? Math.min(0.5, (time - s.last) / 1000) : 0
      s.last = time
      let velocity = 0
      if (s.playing) velocity += s.speed
      if (s.anchor) {
        const distance = s.pointerY - s.anchor.y
        if (Math.abs(distance) > DEAD_ZONE) velocity += Math.sign(distance) * (Math.abs(distance) - DEAD_ZONE) * 8
      }
      if (!velocity) { s.carry = 0; return }
      s.carry += velocity * elapsed
      const step = Math.trunc(s.carry)
      if (step) { window.scrollBy(0, step); s.carry -= step }
      if (s.playing && atBottom()) setPlaying(false)
    }
    const timer = window.setInterval(tick, 16)
    return () => window.clearInterval(timer)
  }, [enabled])

  useEffect(() => {
    if (!enabled) return
    const stopAnchor = () => { state.current.anchor = null; state.current.held = false; setAnchor(null) }
    const onMouseDown = (event: MouseEvent) => {
      if (state.current.anchor) { event.preventDefault(); stopAnchor(); return }
      if (event.button !== 1) return
      // Impede colar a área de transferência (Linux) e o comportamento nativo.
      event.preventDefault()
      const point = { x: event.clientX, y: event.clientY }
      Object.assign(state.current, { anchor: point, pointerY: event.clientY, held: true, moved: false })
      setAnchor(point)
    }
    const onMouseMove = (event: MouseEvent) => {
      const s = state.current
      if (!s.anchor) return
      s.pointerY = event.clientY
      if (Math.abs(event.clientY - s.anchor.y) > DEAD_ZONE) s.moved = true
    }
    const onMouseUp = (event: MouseEvent) => {
      const s = state.current
      if (event.button !== 1 || !s.held) return
      s.held = false
      // Arrastou com o botão pressionado: soltar encerra. Só clicou: segue até o próximo clique.
      if (s.moved) stopAnchor()
    }
    const onAuxClick = (event: MouseEvent) => { if (event.button === 1) event.preventDefault() }
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return
      if (event.key === 'Escape' && state.current.anchor) { stopAnchor(); return }
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (event.code === 'Space') { event.preventDefault(); toggle() }
      else if (event.key === '+' || event.key === '=' || event.code === 'NumpadAdd') { event.preventDefault(); changeSpeed(1) }
      else if (event.key === '-' || event.key === '_' || event.code === 'NumpadSubtract') { event.preventDefault(); changeSpeed(-1) }
    }
    window.addEventListener('mousedown', onMouseDown, { capture: true })
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    window.addEventListener('auxclick', onAuxClick)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('mousedown', onMouseDown, { capture: true })
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      window.removeEventListener('auxclick', onAuxClick)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [enabled, toggle, changeSpeed])

  return { playing, toggle, speed, changeSpeed, anchor, level: SPEEDS.indexOf(speed) + 1, levels: SPEEDS.length }
}

// Coluna vertical à direita, fora da faixa das páginas. `extra` recebe os
// botões do leitor (original/PT-BR e capítulos) acima da rolagem automática.
export function ReaderScrollControls({ scroll, extra }: { scroll: ReturnType<typeof useReaderScroll>; extra?: ReactNode }) {
  const { t } = useT()
  return <>
    {scroll.anchor ? <span aria-hidden="true" className="pointer-events-none fixed z-50 flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white bg-black/60 text-xs text-white shadow" style={{ left: scroll.anchor.x, top: scroll.anchor.y }}>↕</span> : null}
    <aside className="koma-reader-dock" aria-label={t('Controles de leitura')}>
      {extra}
      <div className="koma-scroll-dock" role="group" aria-label={t('Rolagem automática')}>
        <button type="button" onClick={() => scroll.changeSpeed(1)} aria-label={t('Aumentar velocidade (tecla +)')} title={t('Mais rápido (+)')}><Plus size={18} /></button>
        <span className="koma-scroll-level" aria-live="polite"><strong>{scroll.level}</strong><small>{t('DE {n}', { n: scroll.levels })}</small><span className="sr-only"> {t('de velocidade')}</span></span>
        <button type="button" onClick={() => scroll.changeSpeed(-1)} aria-label={t('Diminuir velocidade (tecla -)')} title={t('Mais devagar (-)')}><Minus size={18} /></button>
        <button type="button" className="koma-scroll-play" onClick={(event) => { scroll.toggle(); event.currentTarget.blur() }} aria-pressed={scroll.playing} aria-label={scroll.playing ? t('Pausar rolagem (Espaço)') : t('Iniciar rolagem (Espaço)')} title={t('Iniciar/pausar (Espaço)')}>
          {scroll.playing ? <Pause size={18} /> : <Play size={18} />}
        </button>
      </div>
      <span className="koma-scroll-hint">{scroll.playing ? t('Rolando') : t('Parado')} · {t('Espaço')}</span>
    </aside>
  </>
}
