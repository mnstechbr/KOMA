import { NextResponse } from 'next/server'
import { db } from '@/lib/backend/shared/database.module'
import { requireUser, unauthorizedResponse } from '@/app/api/_shared/proxy'
import { sectionsController } from '@/lib/backend/sections/sections.module'
import { readLibraryPreferences } from '@/lib/backend/sections/library-preferences'
import { ReadProgressRepository } from '@/lib/backend/read-progress/read-progress.repository'

export async function GET() {
  const user = await requireUser()
  if (!user) return unauthorizedResponse()
  const linked = new Set((db.prepare('SELECT section_id FROM work_chapters WHERE section_id IS NOT NULL UNION SELECT section_id FROM work_chapter_attempts WHERE section_id IS NOT NULL').all() as Array<{ section_id: number }>).map((row) => row.section_id))
  const sections = sectionsController.listSections(user.id).filter((section) => !linked.has(section.id))
  const preferences = readLibraryPreferences(user.id)
  const progress = await new ReadProgressRepository().getProgressBatchRaw(sections.map((section) => String(section.id)), user.id)
  const items = sections.map((section, index) => {
    let read = false
    try { read = JSON.parse(progress[index] || '{}').done === true } catch { /* Estado legado inválido equivale a não lido. */ }
    return { ...section, favorite: preferences.favorites.includes(section.id), read }
  })
  return NextResponse.json({ items, lastOpenedId: preferences.lastOpenedId }, { headers: { 'Cache-Control': 'no-store' } })
}
