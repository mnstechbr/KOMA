import { NextResponse } from 'next/server'
import { requireAdmin } from '@/app/api/_shared/proxy'
import { isTrustedOrigin } from '@/lib/security/request-guards'
import { db } from '@/lib/backend/shared/database.module'
import { getStorageSettings, saveStorageSettings, StorageSettingsError } from '@/lib/backend/storage/settings'
import { accountSpace, configuredRemotes, connectionState, disconnect, KOMA_REMOTES, komaRemoteReady, rcloneInstalled, startConnect } from '@/lib/backend/storage/rclone'
import { cloudStatus, ensureChapterLocal, retryCloudNow } from '@/lib/backend/storage/cloud'

async function snapshot() {
  const settings = getStorageSettings(db)
  const [rclone, komaRemotes] = await Promise.all([rcloneInstalled(), configuredRemotes('gdrive')])
  const userRemotes = rclone.installed ? (await configuredRemotes('rclone')).filter((name) => !Object.values(KOMA_REMOTES).some((own) => name === `${own}:`)) : []
  const connected = { gdrive: komaRemotes.includes(`${KOMA_REMOTES.gdrive}:`) && komaRemoteReady('gdrive'), onedrive: komaRemotes.includes(`${KOMA_REMOTES.onedrive}:`) && komaRemoteReady('onedrive') }
  const connecting = { gdrive: connectionState('gdrive'), onedrive: connectionState('onedrive') }
  const active = settings.provider === 'local' ? false : settings.provider === 'rclone' ? userRemotes.includes(settings.remote) : connected[settings.provider]
  return { settings, rclone, connected, connecting, userRemotes, active, status: cloudStatus(db), space: active ? await accountSpace(settings) : null }
}

export async function GET() {
  const auth = await requireAdmin()
  if ('response' in auth) return auth.response
  return NextResponse.json(await snapshot(), { headers: { 'Cache-Control': 'no-store' } })
}

export async function PUT(request: Request) {
  const auth = await requireAdmin()
  if ('response' in auth) return auth.response
  if (process.env.KOMA_DESKTOP !== '1' || !isTrustedOrigin(request)) return NextResponse.json({ message: 'Ação não autorizada.' }, { status: 403 })
  try {
    const before = getStorageSettings(db)
    const body = await request.json().catch(() => null)
    const next = { ...before, ...(body && typeof body === 'object' ? body : {}) }
    const changedPlace = next.provider !== before.provider || next.remote !== before.remote || next.folder !== before.folder
    if (changedPlace) {
      // Capítulos que só existem na nuvem antiga precisam voltar antes da troca.
      const evicted = (db.prepare('SELECT COUNT(*) AS n FROM work_chapter_cloud WHERE evicted=1').get() as { n: number }).n
      if (evicted) return NextResponse.json({ message: `Há ${evicted} capítulo(s) guardados só na nuvem atual. Use "Trazer tudo para o computador" antes de trocar.` }, { status: 409 })
    }
    if ((next.provider === 'gdrive' || next.provider === 'onedrive') && !komaRemoteReady(next.provider)) return NextResponse.json({ message: 'Conecte a conta antes de escolher onde guardar os capítulos.' }, { status: 409 })
    saveStorageSettings(db, next)
    if (changedPlace) db.prepare('DELETE FROM work_chapter_cloud').run()
    retryCloudNow()
    return NextResponse.json(await snapshot())
  } catch (error) {
    if (error instanceof StorageSettingsError) return NextResponse.json({ message: error.message }, { status: 400 })
    throw error
  }
}

export async function POST(request: Request) {
  const auth = await requireAdmin()
  if ('response' in auth) return auth.response
  if (process.env.KOMA_DESKTOP !== '1' || !isTrustedOrigin(request)) return NextResponse.json({ message: 'Ação não autorizada.' }, { status: 403 })
  const { action, provider } = await request.json().catch(() => ({})) as { action?: string; provider?: string }
  if ((action === 'connect' || action === 'disconnect') && (provider === 'gdrive' || provider === 'onedrive')) {
    if (action === 'connect') startConnect(provider)
    else {
      const settings = getStorageSettings(db)
      if (settings.provider === provider) return NextResponse.json({ message: 'Escolha outro local de armazenamento antes de desconectar esta conta.' }, { status: 409 })
      await disconnect(provider)
    }
    return NextResponse.json({ started: true })
  }
  if (action === 'sync') { retryCloudNow(); return NextResponse.json({ started: true }) }
  if (action === 'restore-all') {
    // Volta ao modo com cópia no computador, senão a limpeza apagaria tudo de novo.
    saveStorageSettings(db, { ...getStorageSettings(db), mode: 'mirror' })
    const ids = db.prepare('SELECT chapter_id FROM work_chapter_cloud WHERE evicted=1').all() as Array<{ chapter_id: number }>
    // Baixa um por vez em segundo plano; a tela acompanha pelo status.
    void (async () => { for (const { chapter_id } of ids) await ensureChapterLocal(db, chapter_id).catch(() => undefined) })()
    return NextResponse.json({ started: true, chapters: ids.length })
  }
  return NextResponse.json({ message: 'Ação desconhecida.' }, { status: 400 })
}
