// Esqueletos de carregamento: aparecem na hora do clique enquanto a tela ou os
// dados ainda chegam, para o app nunca parecer parado.
export function LineSkeleton({ width = '100%', height = 16 }: { width?: string; height?: number }) {
  return <span className="koma-line-skeleton" style={{ width, height }} aria-hidden="true" />
}

export function PageSkeleton() {
  return <div aria-busy="true" data-skeleton="page" className="flex flex-col gap-4">
    <LineSkeleton width="40%" height={36} /><LineSkeleton width="65%" />
    <div className="koma-book-grid">{[1, 2, 3, 4, 5, 6].map((id) => <div key={id} className="koma-cover-skeleton" />)}</div>
  </div>
}

export function WorkSkeleton() {
  return <section className="koma-work-hero" aria-busy="true" data-skeleton="work">
    <div className="koma-work-cover"><div className="koma-cover-skeleton" /></div>
    <div className="koma-work-info flex flex-col gap-3"><LineSkeleton width="30%" /><LineSkeleton width="70%" height={40} /><LineSkeleton /><LineSkeleton /><LineSkeleton width="80%" /></div>
  </section>
}

export function ReaderSkeleton() {
  return <div className="koma-reader-pages" aria-busy="true" data-skeleton="reader">{[1, 2].map((id) => <div key={id} className="koma-page-skeleton" />)}</div>
}

export function SettingsSkeleton() {
  return <div aria-busy="true" data-skeleton="settings" className="flex flex-col gap-3"><LineSkeleton width="50%" /><LineSkeleton height={40} /><LineSkeleton width="70%" /></div>
}
