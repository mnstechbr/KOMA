import { NextResponse } from 'next/server'
import { requireAdmin } from '@/app/api/_shared/proxy'
import { isTrustedOrigin } from '@/lib/security/request-guards'
import { db } from '@/lib/backend/shared/database.module'
import { getStorageSettings, parseStorageSettings, saveStorageSettings, StorageSettingsError } from '@/lib/backend/storage/settings'
import { accountSpace, configuredRemotes, connectionState, disconnect, KOMA_REMOTES, komaRemoteReady, rcloneInstalled, startConnect } from '@/lib/backend/storage/rclone'
import { cloudStatus, ensureChapterLocal, retryCloudNow } from '@/lib/backend/storage/cloud'
import { diskSpace, findDisk, forgetDiskCache, listDisks, setupDisk } from '@/lib/backend/storage/disk'

async function snapshot() {
  const settings = getStorageSettings(db)
  const [rclone, komaRemotes] = await Promise.all([rcloneInstalled(), configuredRemotes('gdrive')])
  const userRemotes = rclone.installed ? (await configuredRemotes('rclone')).filter((name) => !Object.values(KOMA_REMOTES).some((own) => name === `${own}:`)) : []
  const connected = { gdrive: komaRemotes.includes(`${KOMA_REMOTES.gdrive}:`) && komaRemoteReady('gdrive'), onedrive: komaRemotes.includes(`${KOMA_REMOTES.onedrive}:`) && komaRemoteReady('onedrive') }
  const connecting = { gdrive: connectionState('gdrive'), onedrive: connectionState('onedrive') }
  const mount = settings.provider === 'disk' ? findDisk(settings) : null
  const active =
    settings.provider === 'local'
      ? false
      : settings.provider === 'disk'
        ? Boolean(mount)
        : settings.provider === 'rclone'
          ? userRemotes.includes(settings.remote)
          : connected[settings.provider]
  const space = !active ? null : mount ? diskSpace(mount) : await accountSpace(settings)
  return { settings, rclone, connected, connecting, userRemotes, active, disk: { mount, choices: listDisks(settings.folder) }, status: cloudStatus(db), space }
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
    const changedPlace =
      next.provider !== before.provider || next.remote !== before.remote || next.folder !== before.folder || next.diskId !== before.diskId
    if (changedPlace) {
      // Capítulos que só existem na nuvem antiga precisam voltar antes da troca.
      const evicted = (db.prepare('SELECT COUNT(*) AS n FROM work_chapter_cloud WHERE evicted=1').get() as { n: number }).n
      if (evicted) return NextResponse.json({ message: `Há ${evicted} capítulo(s) guardados só na nuvem atual. Use "Trazer tudo para o computador" antes de trocar.` }, { status: 409 })
    }
    if ((next.provider === 'gdrive' || next.provider === 'onedrive') && !komaRemoteReady(next.provider)) return NextResponse.json({ message: 'Conecte a conta antes de escolher onde guardar os capítulos.' }, { status: 409 })
    if (next.provider === 'disk') {
      forgetDiskCache()
      if (!findDisk(parseStorageSettings(next))) return NextResponse.json({ message: 'Conecte o dispositivo externo antes de salvar.' }, { status: 409 })
    }
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
  const { action, provider, path } = await request.json().catch(() => ({})) as { action?: string; provider?: string; path?: unknown }
  // Prepara a pasta do KOMA no dispositivo escolhido; a troca só vale ao salvar.
  if (action === 'disk-setup') {
    if (typeof path !== 'string' || !listDisks(getStorageSettings(db).folder).some((disk) => disk.path === path))
      return NextResponse.json({ message: 'Escolha um dispositivo conectado da lista.' }, { status: 400 })
    try {
      return NextResponse.json(setupDisk(path, getStorageSettings(db).folder))
    } catch (error) {
      return NextResponse.json({ message: error instanceof Error ? error.message : 'Não foi possível usar este dispositivo.' }, { status: 409 })
    }
  }
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
    const current = getStorageSettings(db)
    if (current.provider === 'disk' && !findDisk(current)) return NextResponse.json({ message: 'Conecte o dispositivo externo para trazer os capítulos de volta.' }, { status: 409 })
    // Volta ao modo com cópia no computador, senão a limpeza apagaria tudo de novo.
    saveStorageSettings(db, { ...getStorageSettings(db), mode: 'mirror' })
    const ids = db.prepare('SELECT chapter_id FROM work_chapter_cloud WHERE evicted=1').all() as Array<{ chapter_id: number }>
    // Baixa um por vez em segundo plano; a tela acompanha pelo status.
    void (async () => { for (const { chapter_id } of ids) await ensureChapterLocal(db, chapter_id).catch(() => undefined) })()
    return NextResponse.json({ started: true, chapters: ids.length })
  }
  return NextResponse.json({ message: 'Ação desconhecida.' }, { status: 400 })
}
