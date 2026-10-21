import { NextResponse } from 'next/server'
import { personalAccess, sourceFailure } from '../../works/_shared'
import { getCatalogWork } from '@/lib/backend/works/service'
import { localizeMetadata } from '@/lib/backend/works/synopsis'
import { getLanguageSettings } from '@/lib/backend/shared/language-settings'
import { db } from '@/lib/backend/shared/database.module'
import { ensureSources } from '@/lib/backend/works/custom-sources'

export async function GET(_request: Request, { params }: { params: Promise<{ sourceId: string }> }) {
  const auth = await personalAccess()
  if ('response' in auth) return auth.response
  // A prévia usa a sinopse da fonte no idioma da interface, quando existe.
  try { await ensureSources(db); return NextResponse.json({ work: localizeMetadata(await getCatalogWork((await params).sourceId), getLanguageSettings(db).ui) }) }
  catch (error) { return sourceFailure(error) }
}
