'use client'

import type { ReactNode } from 'react'

// Caixa recolhível das Preferências (+ abre, − fecha). Todas começam fechadas.
export function PrefSection({ id, title, hint, children }: { id: string; title: string; hint?: string; children: ReactNode }) {
  return (
    <details className="koma-details" data-pref-section={id}>
      <summary>
        <span className="flex flex-col gap-1">
          <span className="koma-pref-title">{title}</span>
          {hint ? <span className="koma-note font-normal">{hint}</span> : null}
        </span>
      </summary>
      <div>{children}</div>
    </details>
  )
}
