import { NextResponse } from 'next/server'
import { requireAdmin } from '@/app/api/_shared/proxy'
import { isTrustedOrigin } from '@/lib/security/request-guards'
import { db } from '@/lib/backend/shared/database.module'
import {
  acceptCudaLicenses,
  cancelCudaInstall,
  cudaStatus,
  installCuda,
  removeCuda,
  setCudaEnabled,
} from '@/lib/backend/works/cuda-addon'
import { drawDeviceStatus } from '@/lib/server/ml'

// Complemento CUDA (opcional): estado, download, cancelar, ligar/desligar e remover.
async function snapshot() {
  const draw = await drawDeviceStatus().catch(() => ({ device: 'cpu', cudaError: null }))
  return { ...(await cudaStatus(db)), drawDevice: draw.device, cudaError: draw.cudaError }
}

export async function GET() {
  const auth = await requireAdmin()
  if ('response' in auth) return auth.response
  return NextResponse.json(await snapshot(), { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: Request) {
  const auth = await requireAdmin()
  if ('response' in auth) return auth.response
  if (process.env.KOMA_DESKTOP !== '1' || !isTrustedOrigin(request))
    return NextResponse.json({ message: 'Ação não autorizada.' }, { status: 403 })
  const { action, accept } = (await request.json().catch(() => ({}))) as { action?: string; accept?: boolean }
  try {
    if (action === 'install') {
      if (accept !== true) return NextResponse.json({ message: 'É preciso aceitar as licenças da NVIDIA.' }, { status: 400 })
      const status = await cudaStatus(db)
      if (!status.supported) return NextResponse.json({ message: 'Este computador não tem placa NVIDIA compatível.' }, { status: 400 })
      acceptCudaLicenses(db)
      void installCuda(db)
    } else if (action === 'cancel') cancelCudaInstall()
    else if (action === 'enable') setCudaEnabled(db, true)
    else if (action === 'disable') setCudaEnabled(db, false)
    else if (action === 'remove') removeCuda(db)
    else return NextResponse.json({ message: 'Ação inválida.' }, { status: 400 })
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : 'Falha no complemento CUDA.' }, { status: 400 })
  }
  return NextResponse.json(await snapshot())
}
