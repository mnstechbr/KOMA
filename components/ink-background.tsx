'use client'
import { useEffect, useRef, useState } from 'react'

// Fundo vivo da direção Tinta: retícula que engrossa numa lente em volta do
// ponteiro (miolo vermelho) e uma gota de nanquim que segue com atraso de mola,
// espirrando respingos em movimentos rápidos. Fica atrás do conteúdo, nunca
// recebe cliques e dorme quando tudo assenta, a janela perde o foco ou o
// sistema pede menos movimento. Só usa transform/opacity e um canvas pequeno.

export const INK_PREFS_KEY = 'koma:fundo:v1'
export const INK_PREFS_EVENT = 'koma:fundo'
export interface InkPrefs { live: boolean; ink: boolean }
const DEFAULT_PREFS: InkPrefs = { live: true, ink: true }

export function readInkPrefs(): InkPrefs {
  try { return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(INK_PREFS_KEY) || '{}') } } catch { return DEFAULT_PREFS }
}
export function saveInkPrefs(prefs: InkPrefs) {
  try { localStorage.setItem(INK_PREFS_KEY, JSON.stringify(prefs)) } catch { /* Preferência só local. */ }
  window.dispatchEvent(new Event(INK_PREFS_EVENT))
}

const LENS = 190 // raio da lente em px
const CORE = 66
const BLOB = 15 // raio da gota
const TRAIL = 6
const SPLATS = 10
const STEP = 1000 / 60
// Sobre estes elementos o efeito some, para nunca disputar com texto, botões ou capas.
const CONTENT = 'a, button, input, select, textarea, label, summary, img, h1, h2, h3, p, li, table, [role=group], [role=progressbar], .koma-panel, .koma-box, .koma-book, .koma-queue-row, .koma-details, .koma-empty, .koma-result, .koma-alert, .koma-rail, .koma-stat'

export function InkBackground() {
  const layer = useRef<HTMLDivElement>(null)
  const lens = useRef<HTMLDivElement>(null)
  const core = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [prefs, setPrefs] = useState<InkPrefs>(DEFAULT_PREFS)
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    const sync = () => setPrefs(readInkPrefs())
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const motion = () => setReduced(media.matches)
    sync(); motion()
    window.addEventListener(INK_PREFS_EVENT, sync)
    window.addEventListener('storage', sync)
    media.addEventListener('change', motion)
    return () => { window.removeEventListener(INK_PREFS_EVENT, sync); window.removeEventListener('storage', sync); media.removeEventListener('change', motion) }
  }, [])

  const active = prefs.live && !reduced
  const inkOn = active && prefs.ink

  useEffect(() => {
    if (!active) return
    const root = layer.current, lensEl = lens.current, coreEl = core.current, cv = canvas.current
    if (!root || !lensEl || !coreEl) return
    const ctx = inkOn && cv ? cv.getContext('2d') : null
    const start = { x: window.innerWidth * 0.7, y: window.innerHeight * 0.55 }
    const s = {
      target: { ...start }, pos: { ...start }, vel: { x: 0, y: 0 },
      trail: Array.from({ length: TRAIL }, () => ({ ...start })),
      splats: Array.from({ length: SPLATS }, () => ({ x: 0, y: 0, r: 0, o: 0 })),
      next: 0, inside: false, scale: 0.6, frame: 0, last: 0, carry: 0, dpr: 1,
    }
    const resize = () => {
      s.dpr = Math.min(window.devicePixelRatio || 1, 1.5)
      if (!cv || !ctx) return
      cv.width = Math.round(window.innerWidth * s.dpr); cv.height = Math.round(window.innerHeight * s.dpr)
      ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0)
    }
    resize()

    const place = (el: HTMLDivElement, radius: number, offset: number) => {
      const x = s.pos.x - radius, y = s.pos.y - radius
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) scale(${s.scale.toFixed(3)})`
      // Mantém os pontos alinhados à retícula do papel enquanto a lente anda.
      el.style.backgroundPosition = `${(-x + offset).toFixed(1)}px ${(-y + offset).toFixed(1)}px`
    }
    lensEl.style.width = lensEl.style.height = `${LENS * 2}px`
    coreEl.style.width = coreEl.style.height = `${CORE * 2}px`

    const simulate = () => {
      s.vel.x = (s.vel.x + (s.target.x - s.pos.x) * 0.09) * 0.78
      s.vel.y = (s.vel.y + (s.target.y - s.pos.y) * 0.09) * 0.78
      s.pos.x += s.vel.x; s.pos.y += s.vel.y
      s.trail.unshift({ x: s.pos.x, y: s.pos.y }); s.trail.length = TRAIL
      s.scale += ((s.inside ? 1 : 0.6) - s.scale) * 0.04
      const speed = Math.hypot(s.vel.x, s.vel.y)
      if (inkOn && speed > 9 && Math.random() < 0.35) {
        const angle = Math.atan2(s.vel.y, s.vel.x) + (Math.random() - 0.5) * 1.6
        const dist = 26 + Math.random() * 40
        s.splats[s.next] = { x: s.pos.x + Math.cos(angle) * dist, y: s.pos.y + Math.sin(angle) * dist, r: 2 + Math.random() * 6, o: 0.9 }
        s.next = (s.next + 1) % SPLATS
      }
      for (const p of s.splats) p.o = Math.max(0, p.o - 0.012)
    }
    const draw = () => {
      place(lensEl, LENS, 0); place(coreEl, CORE, 5)
      if (!ctx) return
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight)
      ctx.fillStyle = '#141414'; ctx.strokeStyle = '#141414'; ctx.lineCap = 'round'
      // Traço afinando atrás da gota faz o papel do filtro "goo" sem blur.
      for (let i = 1; i < TRAIL; i++) {
        const a = s.trail[i - 1], b = s.trail[i]
        ctx.lineWidth = BLOB * 2 * (1 - i * 0.14); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke()
      }
      ctx.beginPath(); ctx.arc(s.pos.x, s.pos.y, BLOB, 0, Math.PI * 2); ctx.fill()
      for (const p of s.splats) if (p.o > 0) { ctx.globalAlpha = p.o; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill() }
      ctx.globalAlpha = 1; ctx.fillStyle = '#c62a43'
      ctx.beginPath(); ctx.arc(s.pos.x, s.pos.y, BLOB * 0.36, 0, Math.PI * 2); ctx.fill()
    }
    const settled = () => Math.hypot(s.target.x - s.pos.x, s.target.y - s.pos.y) < 0.3 && Math.hypot(s.vel.x, s.vel.y) < 0.05
      && Math.abs((s.inside ? 1 : 0.6) - s.scale) < 0.003 && s.splats.every((p) => p.o === 0)
      && s.trail.every((p) => Math.abs(p.x - s.pos.x) < 0.3 && Math.abs(p.y - s.pos.y) < 0.3)
    const loop = (time: number) => {
      s.carry += s.last ? Math.min(100, time - s.last) : STEP; s.last = time
      while (s.carry >= STEP) { simulate(); s.carry -= STEP }
      draw()
      if (settled()) { s.frame = 0; s.last = 0; s.carry = 0; return }
      s.frame = requestAnimationFrame(loop)
    }
    const wake = () => { if (!s.frame && document.hasFocus() && document.visibilityState === 'visible') s.frame = requestAnimationFrame(loop) }
    const sleep = () => { if (s.frame) cancelAnimationFrame(s.frame); s.frame = 0; s.last = 0; s.carry = 0 }

    let muted = false
    const onMove = (event: PointerEvent) => {
      s.target = { x: event.clientX, y: event.clientY }
      if (!s.inside) { s.inside = true; root.classList.add('is-live') }
      const over = event.target instanceof Element && Boolean(event.target.closest(CONTENT))
      if (over !== muted) { muted = over; root.classList.toggle('is-muted', over) }
      wake()
    }
    const onLeave = (event: MouseEvent) => { if (!event.relatedTarget) { s.inside = false; wake() } }
    const onBlur = () => { s.inside = false; root.classList.remove('is-live'); sleep(); ctx?.clearRect(0, 0, window.innerWidth, window.innerHeight) }
    const onVisibility = () => { if (document.visibilityState !== 'visible') onBlur() }
    const onResize = () => { resize(); draw() }

    draw()
    window.addEventListener('pointermove', onMove, { passive: true })
    document.addEventListener('mouseout', onLeave)
    window.addEventListener('blur', onBlur)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('resize', onResize)
    return () => {
      sleep()
      window.removeEventListener('pointermove', onMove)
      document.removeEventListener('mouseout', onLeave)
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('resize', onResize)
      root.classList.remove('is-live')
    }
  }, [active, inkOn])

  return <div ref={layer} className="koma-ink-layer" aria-hidden="true">
    <div className="koma-ink-paper" />
    {active ? <><div ref={lens} className="koma-ink-lens" /><div ref={core} className="koma-ink-core" />{inkOn ? <canvas ref={canvas} className="koma-ink-canvas" /> : null}</> : null}
  </div>
}
