export interface SectionCover {
  image_id: number
  mime: string
  view_url: string
  download_url: string
}

export interface SectionPublicAccess {
  enabled: boolean
  key: string | null
  url: string | null
}

export interface SectionListItem {
  id: number
  name: string
  category?: string | null
  category_id?: number | null
  priority: number
  status: string
  internal_status: string
  source_lang: string
  target_lang: string
  include_logs: boolean
  provider_lang?: string | null
  images_count: number
  selected_images_count: number
  queued_images_count: number
  processing_images_count: number
  cover?: SectionCover | null
  public_access?: SectionPublicAccess | null
  created_at: string
  updated_at: string
}

export interface SectionImageOcrItem {
  id: number
  section_image_id: number
  det_id: number
  cls_name: string
  conf: number
  box: [number, number, number, number]
  ocr_text: string | null
  ocr_error: string | null
  translated_text: string | null
  translation_updated_at: string | null
  created_at: string
  updated_at: string
}

export interface SectionImageOcr {
  total_boxes: number
  translated_boxes: number
  has_boxes: boolean
  items: SectionImageOcrItem[]
}

export interface SectionImage {
  id: number
  order_index: number
  original_name: string
  mime: string
  size_bytes: number
  status: string
  translation_status: string
  selected_for_processing: boolean
  translation_error: string | null
  translated_mime?: string | null
  translated_size_bytes?: number | null
  translated_width?: number | null
  translated_height?: number | null
  detections_count?: number | null
  elapsed_ms?: number | null
  source_lang?: string | null
  target_lang?: string | null
  slowest_stage?: string | null
  has_logs?: boolean
  ocr_cache_url?: string | null
  ocr?: SectionImageOcr | null
  original_url: string
  translated_url: string | null
}

export interface SectionQueueSnapshot {
  active_job_id: number | null
  active_job_status: string | null
  queue_position: number | null
  jobs_ahead: number
  estimated_wait_seconds: number
  estimated_wait_minutes: number
  estimated_start_at: string | null
  avg_ms_per_image_reference: number | null
}

export interface SectionJobQueueSnapshot {
  queue_position?: number | null
  jobs_ahead?: number | null
  estimated_wait_seconds?: number | null
  estimated_wait_minutes?: number | null
  estimated_start_at?: string | null
  avg_ms_per_image_reference?: number | null
}

export interface SectionJobSnapshot {
  id?: number | null
  status?: string | null
  avg_ms_per_image_snapshot?: number | null
  estimated_start_at?: string | null
  queue?: SectionJobQueueSnapshot | null
}

export interface SectionDetail extends SectionListItem {
  queue?: SectionQueueSnapshot | null
  images: SectionImage[]
  jobs: SectionJobSnapshot[]
}

export interface QueueState {
  canQueue: boolean
  inQueueOrProcessing: boolean
  completed: boolean
}

const QUEUE_OR_PROCESSING_STATUSES = new Set([
  'queued',
  'queue',
  'em_fila',
  'na_fila',
  'processing',
  'processando',
  'in_progress',
  'running',
  'em_andamento',
  'translating',
  'traduzindo',
])

const COMPLETED_SECTION_STATUSES = new Set(['completed', 'done', 'finished', 'success', 'sucesso', 'concluido', 'concluida', 'all_done'])

const TRANSLATED_IMAGE_STATUSES = new Set(['translated', 'done', 'completed', 'success', 'sucesso', 'concluido', 'concluida'])

export function normalizeStatus(value: string | null | undefined) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s-]+/g, '_')
}

export function formatStatus(value: string | null | undefined) {
  const normalized = normalizeStatus(value)
  if (!normalized) return 'desconhecido'
  return normalized.replace(/_/g, ' ')
}

export function formatSectionDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('pt-BR')
}

export type SectionPriorityTier = 'low' | 'high_essential' | 'high_impulso' | 'high_elite' | 'admin' | 'custom'

export interface SectionPriorityInfo {
  value: number
  tier: SectionPriorityTier
  badgeLabel: string
  description: string
}

function toPriorityNumber(priority: number | null | undefined) {
  if (typeof priority === 'number' && Number.isFinite(priority)) {
    return Math.max(0, Math.floor(priority))
  }
  return 0
}

export function getSectionPriorityInfo(priority: number | null | undefined): SectionPriorityInfo {
  const value = toPriorityNumber(priority)

  if (value === 10) {
    return {
      value,
      tier: 'admin',
      badgeLabel: 'P10 - Admin',
      description: 'Prioridade admin',
    }
  }

  if (value === 7) {
    return {
      value,
      tier: 'high_impulso',
      badgeLabel: 'P7 - Maxima (Impulso)',
      description: 'Prioridade maxima (Plano Impulso)',
    }
  }

  if (value === 8) {
    return {
      value,
      tier: 'high_elite',
      badgeLabel: 'P8 - Ultra (Elite)',
      description: 'Prioridade ultra (Plano Elite)',
    }
  }

  if (value === 5) {
    return {
      value,
      tier: 'high_essential',
      badgeLabel: 'P5 - Alta (Essencial)',
      description: 'Prioridade alta (Plano Essencial)',
    }
  }

  if (value === 2) {
    return {
      value,
      tier: 'low',
      badgeLabel: 'P2 - Baixa',
      description: 'Prioridade baixa',
    }
  }

  return {
    value,
    tier: 'custom',
    badgeLabel: 'P' + value + ' - Personalizada',
    description: 'Prioridade personalizada (P' + value + ')',
  }
}

export function toErrorMessage(payload: unknown, fallback: string) {
  if (payload && typeof payload === 'object') {
    const maybeMessage =
      (payload as { message?: string; error?: string }).message || (payload as { message?: string; error?: string }).error
    if (maybeMessage) return maybeMessage
  }
  return fallback
}

export function isImageTranslated(image: SectionImage) {
  const translationStatus = normalizeStatus(image.translation_status)
  return Boolean(image.translated_url) || TRANSLATED_IMAGE_STATUSES.has(translationStatus)
}

export function buildImageViewUrl(sectionId: number, imageId: number, kind: 'original' | 'translated') {
  return `/api/sections/${sectionId}/images/${imageId}/${kind}/view`
}

export function getSectionQueueState(
  section: Pick<SectionListItem, 'id' | 'status' | 'internal_status' | 'queued_images_count' | 'processing_images_count'>,
  detail: Pick<SectionDetail, 'id' | 'images'> | null,
): QueueState {
  const normalizedStatus = normalizeStatus(section.status)
  const normalizedInternalStatus = normalizeStatus(section.internal_status)
  const statuses = [normalizedStatus, normalizedInternalStatus]

  const hasQueuedOrProcessingCounters = section.queued_images_count > 0 || section.processing_images_count > 0
  const inQueueOrProcessing = hasQueuedOrProcessingCounters || statuses.some((status) => QUEUE_OR_PROCESSING_STATUSES.has(status))
  const completedByStatus = statuses.some((status) => COMPLETED_SECTION_STATUSES.has(status))
  const completedByImages =
    detail?.id === section.id && detail.images.length > 0 && detail.images.every((image) => isImageTranslated(image))

  return {
    canQueue: !(inQueueOrProcessing || completedByStatus || completedByImages),
    inQueueOrProcessing,
    completed: completedByStatus || completedByImages,
  }
}
