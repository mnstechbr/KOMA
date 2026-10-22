// Tipos, constantes e funções puras do leitor de seções (importação de arquivos).
// Separados de section-reader.tsx sem mudar o comportamento.
import { isImageTranslated, normalizeStatus, type SectionImage, type SectionImageOcrItem } from '@/lib/sections'

export interface SectionReaderProps {
  sectionId: number
}

export interface DeleteSectionResponse {
  message?: string
  section?: { id?: number }
}

export interface RenameSectionResponse {
  id?: number
  name?: string
  status?: string
  updated_at?: string
  message?: string
  error?: string
}

export interface SectionCategoryResponse {
  section_id?: unknown
  category?: unknown
  category_id?: unknown
  category_preferences?: unknown
  categories?: unknown
  deleted_sections_count?: unknown
  message?: string
  error?: string
}

export interface SectionStatsResponse {
  section_id?: unknown
  total_pages?: unknown
  selected_pages?: unknown
  translated_pages?: unknown
  ocr_completed_pages?: unknown
  completed_pages?: unknown
  pages_with_elapsed_ms?: unknown
  total_elapsed_ms?: unknown
  total_elapsed_minutes?: unknown
  avg_elapsed_ms_per_page?: unknown
  avg_elapsed_seconds_per_page?: unknown
  total_detections?: unknown
  provider_lang?: unknown
  cost_model?: unknown
  estimated_input_tokens?: unknown
  estimated_output_tokens?: unknown
  estimated_input_cost_usd?: unknown
  estimated_output_cost_usd?: unknown
  estimated_total_cost_usd?: unknown
  generated_at?: unknown
  message?: unknown
  error?: unknown
}

export interface LimitModalState {
  title: string
  description: string
  details?: string
}

export interface QueueActionOptions {
  silent?: boolean
  automatic?: boolean
}

export interface OcrOverlayItem {
  id: number
  box: [number, number, number, number]
  ocrText: string
  translatedText: string
}

export type OcrOverlayShape = 'rect' | 'oval'
export type OcrOverlayTextMode = 'translated' | 'original'
export type OcrOverlayFontFamily = 'sans' | 'serif' | 'mono' | 'comic' | 'manga' | 'anime' | 'manhwa' | 'condensed'

export interface OcrOverlayItemOverride {
  dx: number
  dy: number
  shape?: OcrOverlayShape
  fontScale?: number
  sizeScale?: number
  widthScale?: number
  heightScale?: number
  density?: number
}

export interface OcrOverlayItemColors {
  red: number
  green: number
  blue: number
  baseAlpha: number
  borderColor: string
  textColor: string
}

export interface OcrBatchTranslateResponse {
  translations?: unknown
  provider_lang?: unknown
  source_lang?: unknown
  target_lang?: unknown
  message?: string
  error?: string
}

export interface OcrImageQueueResponse {
  job_key?: unknown
  job_id?: unknown
  queue_key?: unknown
  status?: unknown
  queue_position?: unknown
  redis?: unknown
  message?: unknown
  error?: unknown
}

export interface OcrImageJobPollResponse {
  job_key?: unknown
  queue_key?: unknown
  status?: unknown
  queue_position?: unknown
  queue_length?: unknown
  lock_value?: unknown
  job?: unknown
  message?: unknown
  error?: unknown
}

export interface OcrOverlayStateResponse {
  state?: unknown
  message?: string
  error?: string
}

export interface OcrOverlayPersistedManualItemPayload {
  id: number
  box: [number, number, number, number]
  ocr_text: string
  translated_text: string
}

export interface OcrOverlayPersistedStatePayload {
  font_family: OcrOverlayFontFamily
  font_scale: number
  box_inset_percent: number
  density: number
  overlay_opacity: number
  global_shape: OcrOverlayShape
  overrides_by_image_id: Record<string, Record<string, OcrOverlayItemOverride>>
  manual_items_by_image_id: Record<string, OcrOverlayPersistedManualItemPayload[]>
  hidden_item_ids_by_image_id: Record<string, number[]>
}

export interface OcrOverlayStateSnapshot {
  fontFamily: OcrOverlayFontFamily
  fontScale: number
  boxInsetPercent: number
  density: number
  overlayOpacity: number
  globalShape: OcrOverlayShape
  overridesByImageId: Record<number, Record<number, OcrOverlayItemOverride>>
  manualItemsByImageId: Record<number, OcrOverlayItem[]>
  hiddenItemIdsByImageId: Record<number, number[]>
}

export interface SectionCategoryOverlayPreferences {
  font_family: OcrOverlayFontFamily
  font_scale: number
  box_inset_percent: number
  density: number
  overlay_opacity: number
  global_shape: OcrOverlayShape
  default_reading_mode: 'paginated' | 'scroll'
}

export interface ImageNaturalSize {
  width: number
  height: number
}

export interface OverlayLanguageOption {
  code: string
  name: string
}

export function toFiniteNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

export function toStringValue(value: unknown) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

export function firstDefined<T>(...values: Array<T | null | undefined>) {
  for (const value of values) {
    if (value !== null && value !== undefined) return value
  }
  return null
}

export function asObjectRecord(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

export const PROCESSING_STATUSES = new Set(['processing', 'processando', 'in_progress', 'running', 'traduzindo', 'translating'])
export const FAILED_TRANSLATION_STATUSES = new Set(['failed', 'error', 'erro', 'timeout', 'timed_out'])
export const READING_PRELOAD_RADIUS = 2
export const SWIPE_TRIGGER_PX = 56
export const SWIPE_DIRECTION_RATIO = 1.2
export const READ_PAGES_LS_PREFIX = 'manga-read-'
export const SECTION_READ_LS_PREFIX = 'manga-section-read-'
export const SECTION_READ_THRESHOLD = 0.7
export const SECTION_CATEGORY_MAX_LENGTH = 64
export const OCR_COMPLETED_STATUSES = new Set(['ocr_concluido', 'ocr_completed'])
export const OCR_OVERLAY_FONT_SCALE_MIN = 0.1
export const OCR_OVERLAY_FONT_SCALE_MAX = 1.5
export const OCR_OVERLAY_FONT_SCALE_STEP = 0.05
export const OCR_OVERLAY_DEFAULT_FONT_SCALE = 0.3
export const OCR_OVERLAY_DEFAULT_FONT_FAMILY: OcrOverlayFontFamily = 'condensed'
export const OCR_OVERLAY_DEFAULT_SHAPE: OcrOverlayShape = 'rect'
export const OCR_OVERLAY_BOX_INSET_MIN = -20
export const OCR_OVERLAY_BOX_INSET_MAX = 30
export const OCR_OVERLAY_DEFAULT_BOX_INSET = 6
export const OCR_OVERLAY_ITEM_FONT_SCALE_MIN = 0.45
export const OCR_OVERLAY_ITEM_FONT_SCALE_MAX = 5
export const OCR_OVERLAY_ITEM_FONT_SCALE_STEP = 0.1
export const OCR_OVERLAY_ITEM_FONT_SCALE_DEFAULT = 1
export const OCR_OVERLAY_DENSITY_MIN = 0.35
export const OCR_OVERLAY_DENSITY_MAX = 2.2
export const OCR_OVERLAY_DENSITY_STEP = 0.1
export const OCR_OVERLAY_DENSITY_DEFAULT = 2.0
export const OCR_OVERLAY_OPACITY_MIN = 0.08
export const OCR_OVERLAY_OPACITY_MAX = 1
export const OCR_OVERLAY_OPACITY_DEFAULT = 1
export const OCR_OVERLAY_ITEM_DENSITY_MIN = 0.45
export const OCR_OVERLAY_ITEM_DENSITY_MAX = 2.5
export const OCR_OVERLAY_ITEM_DENSITY_STEP = 0.1
export const OCR_OVERLAY_ITEM_DENSITY_DEFAULT = 1
export const OCR_OVERLAY_ITEM_SIZE_MIN = 0.55
export const OCR_OVERLAY_ITEM_SIZE_MAX = 1.85
export const OCR_OVERLAY_ITEM_SIZE_STEP = 0.05
export const OCR_OVERLAY_ITEM_SIZE_DEFAULT = 1
export const OCR_OVERLAY_ITEM_AXIS_SCALE_MIN = 0.25
export const OCR_OVERLAY_ITEM_AXIS_SCALE_MAX = 4
export const OCR_OVERLAY_ITEM_AXIS_SCALE_DEFAULT = 1
export const OCR_OVERLAY_QUICK_EDITOR_DOUBLE_TAP_MS = 700
export const OCR_OVERLAY_QUICK_EDITOR_TAP_MOVE_PX = 48
export const OCR_QUEUE_POLL_INTERVAL_MS = 900
export const OCR_QUEUE_POLL_TIMEOUT_MS = 45_000
export const OCR_OVERLAY_SELECTION_SOURCE_DEFAULT = 'auto'
export const OCR_OVERLAY_SELECTION_TARGET_DEFAULT = 'pt-BR'
export const OCR_OVERLAY_SELECTION_LANGUAGES: OverlayLanguageOption[] = [
  { code: 'auto', name: 'Detectar automaticamente' },
  { code: 'en', name: 'Inglês' },
  { code: 'pt-BR', name: 'Português (Brasil)' },
  { code: 'es', name: 'Espanhol' },
  { code: 'fr', name: 'Francês' },
  { code: 'de', name: 'Alemão' },
  { code: 'it', name: 'Italiano' },
  { code: 'ja', name: 'Japonês' },
  { code: 'ko', name: 'Coreano' },
  { code: 'zh-cn', name: 'Chinês Simplificado' },
  { code: 'zh-tw', name: 'Chinês Tradicional' },
  { code: 'ru', name: 'Russo' },
  { code: 'ar', name: 'Árabe' },
  { code: 'hi', name: 'Hindi' },
  { code: 'tr', name: 'Turco' },
  { code: 'nl', name: 'Holandês' },
  { code: 'pl', name: 'Polonês' },
  { code: 'uk', name: 'Ucraniano' },
  { code: 'vi', name: 'Vietnamita' },
  { code: 'id', name: 'Indonésio' },
  { code: 'th', name: 'Tailandês' },
]
export const OCR_OVERLAY_SELECTION_TARGET_LANGUAGES = OCR_OVERLAY_SELECTION_LANGUAGES.filter((language) => language.code !== 'auto')

export const OCR_OVERLAY_FONT_FAMILIES: Record<OcrOverlayFontFamily, { label: string; css: string }> = {
  sans: {
    label: 'Wild Words',
    css: 'var(--font-bangers), "CC Wild Words", "Anime Ace 2.0 BB", "Komika Axis", cursive',
  },
  serif: {
    label: 'Retro Hero',
    css: 'var(--font-carter-one), var(--font-righteous), "Trebuchet MS", sans-serif',
  },
  mono: {
    label: 'Tech Scan',
    css: 'var(--font-rubik-mono-one), var(--font-audiowide), "Arial Black", sans-serif',
  },
  comic: {
    label: 'Ink Brush',
    css: 'var(--font-permanent-marker), var(--font-kalam), "Comic Sans MS", cursive',
  },
  manga: {
    label: 'Shonen Blast',
    css: 'var(--font-luckiest-guy), var(--font-bangers), var(--font-changa-one), "Arial Black", sans-serif',
  },
  anime: {
    label: 'Anime Title',
    css: 'var(--font-bebas-neue), var(--font-anton), var(--font-teko), Impact, sans-serif',
  },
  manhwa: {
    label: 'Manhwa Clean Pro',
    css: 'var(--font-noto-sans-kr), "Nanum Gothic", "Apple SD Gothic Neo", "Malgun Gothic", Arial, sans-serif',
  },
  condensed: {
    label: 'Action Condensed',
    css: 'var(--font-teko), var(--font-bebas-neue), "Arial Narrow", Impact, sans-serif',
  },
}

export function resolveOcrOverlayProvider(value: string | null | undefined) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return normalized || 'google'
}

export function formatProviderLabel(value: string | null | undefined) {
  const provider = resolveOcrOverlayProvider(value)
  if (provider.toLowerCase() === 'google') return 'Google Translate'
  if (provider.toLowerCase() === 'kpassword') return 'KPassword · adaptação PT-BR'
  if (provider.toLowerCase().startsWith('openrouter:')) {
    const model = provider.slice('openrouter:'.length).trim()
    return model ? `OpenRouter (${model})` : 'OpenRouter'
  }
  return provider
}

export function normalizeOverlaySelectionLanguage(value: string | null | undefined, fallback: string, options: OverlayLanguageOption[]) {
  const normalizedFallback = options.find((option) => option.code === fallback)?.code ?? options[0]?.code ?? fallback
  if (typeof value !== 'string') return normalizedFallback

  const trimmed = value.trim()
  if (!trimmed) return normalizedFallback

  const match = options.find((option) => option.code.toLowerCase() === trimmed.toLowerCase())
  return match?.code ?? normalizedFallback
}

export function isOverlayFontFamily(value: string): value is OcrOverlayFontFamily {
  return Object.prototype.hasOwnProperty.call(OCR_OVERLAY_FONT_FAMILIES, value)
}

export function isOverlayShape(value: string): value is OcrOverlayShape {
  return value === 'rect' || value === 'oval'
}

export function sanitizeOverlayItemOverride(value: OcrOverlayItemOverride): OcrOverlayItemOverride {
  const next: OcrOverlayItemOverride = {
    dx: clampRange(toFiniteNumber(value.dx) ?? 0, -5000, 5000),
    dy: clampRange(toFiniteNumber(value.dy) ?? 0, -5000, 5000),
  }

  if (value.shape === 'rect' || value.shape === 'oval') {
    next.shape = value.shape
  }

  const fontScale = toFiniteNumber(value.fontScale)
  if (fontScale !== null) {
    next.fontScale = clampRange(fontScale, OCR_OVERLAY_ITEM_FONT_SCALE_MIN, OCR_OVERLAY_ITEM_FONT_SCALE_MAX)
  }

  const sizeScale = toFiniteNumber(value.sizeScale)
  if (sizeScale !== null) {
    next.sizeScale = clampRange(sizeScale, OCR_OVERLAY_ITEM_SIZE_MIN, OCR_OVERLAY_ITEM_SIZE_MAX)
  }

  const widthScale = toFiniteNumber(value.widthScale)
  if (widthScale !== null) {
    next.widthScale = clampRange(widthScale, OCR_OVERLAY_ITEM_AXIS_SCALE_MIN, OCR_OVERLAY_ITEM_AXIS_SCALE_MAX)
  }

  const heightScale = toFiniteNumber(value.heightScale)
  if (heightScale !== null) {
    next.heightScale = clampRange(heightScale, OCR_OVERLAY_ITEM_AXIS_SCALE_MIN, OCR_OVERLAY_ITEM_AXIS_SCALE_MAX)
  }

  const density = toFiniteNumber(value.density)
  if (density !== null) {
    next.density = clampRange(density, OCR_OVERLAY_ITEM_DENSITY_MIN, OCR_OVERLAY_ITEM_DENSITY_MAX)
  }

  return next
}

export function normalizeOverlayOverrides(rawValue: unknown): Record<number, Record<number, OcrOverlayItemOverride>> {
  const root = asObjectRecord(rawValue)
  if (!root) return {}

  const normalized: Record<number, Record<number, OcrOverlayItemOverride>> = {}
  const imageIds = Object.keys(root)
    .map((key) => Number.parseInt(key, 10))
    .filter((imageId) => Number.isFinite(imageId))
    .sort((a, b) => a - b)

  for (const imageId of imageIds) {
    const imageOverridesRaw = asObjectRecord(root[String(imageId)])
    if (!imageOverridesRaw) continue

    const itemIds = Object.keys(imageOverridesRaw)
      .map((key) => Number.parseInt(key, 10))
      .filter((itemId) => Number.isFinite(itemId))
      .sort((a, b) => a - b)

    const nextImageOverrides: Record<number, OcrOverlayItemOverride> = {}
    for (const itemId of itemIds) {
      const itemRaw = asObjectRecord(imageOverridesRaw[String(itemId)])
      if (!itemRaw) continue

      const rawShape = typeof itemRaw.shape === 'string' ? itemRaw.shape.trim().toLowerCase() : ''
      const nextOverride: OcrOverlayItemOverride = sanitizeOverlayItemOverride({
        dx: toFiniteNumber(itemRaw.dx) ?? 0,
        dy: toFiniteNumber(itemRaw.dy) ?? 0,
        shape: rawShape === 'rect' || rawShape === 'oval' ? rawShape : undefined,
        fontScale: toFiniteNumber(itemRaw.fontScale) ?? undefined,
        sizeScale: toFiniteNumber(itemRaw.sizeScale) ?? undefined,
        widthScale: toFiniteNumber(itemRaw.widthScale) ?? undefined,
        heightScale: toFiniteNumber(itemRaw.heightScale) ?? undefined,
        density: toFiniteNumber(itemRaw.density) ?? undefined,
      })
      nextImageOverrides[itemId] = nextOverride
    }

    if (Object.keys(nextImageOverrides).length > 0) {
      normalized[imageId] = nextImageOverrides
    }
  }

  return normalized
}

export function serializeOverlayOverrides(
  overridesByImageId: Record<number, Record<number, OcrOverlayItemOverride>>,
): Record<string, Record<string, OcrOverlayItemOverride>> {
  const serialized: Record<string, Record<string, OcrOverlayItemOverride>> = {}
  const imageIds = Object.keys(overridesByImageId)
    .map((key) => Number.parseInt(key, 10))
    .filter((imageId) => Number.isFinite(imageId))
    .sort((a, b) => a - b)

  for (const imageId of imageIds) {
    const imageOverrides = overridesByImageId[imageId]
    if (!imageOverrides) continue

    const itemIds = Object.keys(imageOverrides)
      .map((key) => Number.parseInt(key, 10))
      .filter((itemId) => Number.isFinite(itemId))
      .sort((a, b) => a - b)

    const nextImageOverrides: Record<string, OcrOverlayItemOverride> = {}
    for (const itemId of itemIds) {
      const override = imageOverrides[itemId]
      if (!override) continue
      nextImageOverrides[String(itemId)] = sanitizeOverlayItemOverride(override)
    }

    if (Object.keys(nextImageOverrides).length > 0) {
      serialized[String(imageId)] = nextImageOverrides
    }
  }

  return serialized
}

export function normalizeOverlayManualItems(rawValue: unknown): Record<number, OcrOverlayItem[]> {
  const root = asObjectRecord(rawValue)
  if (!root) return {}

  const normalized: Record<number, OcrOverlayItem[]> = {}
  const imageIds = Object.keys(root)
    .map((key) => Number.parseInt(key, 10))
    .filter((imageId) => Number.isFinite(imageId))
    .sort((a, b) => a - b)

  for (const imageId of imageIds) {
    const imageItemsRaw = root[String(imageId)]
    if (!Array.isArray(imageItemsRaw) || imageItemsRaw.length === 0) continue

    const nextItems: OcrOverlayItem[] = []
    for (const rawItem of imageItemsRaw) {
      const item = asObjectRecord(rawItem)
      if (!item) continue

      const idRaw = toFiniteNumber(item.id)
      if (idRaw === null) continue

      const boxRaw = Array.isArray(item.box) ? item.box : []
      if (boxRaw.length !== 4) continue

      const x1Raw = toFiniteNumber(boxRaw[0])
      const y1Raw = toFiniteNumber(boxRaw[1])
      const x2Raw = toFiniteNumber(boxRaw[2])
      const y2Raw = toFiniteNumber(boxRaw[3])
      if (x1Raw === null || y1Raw === null || x2Raw === null || y2Raw === null) continue

      const x1 = Math.min(x1Raw, x2Raw)
      const y1 = Math.min(y1Raw, y2Raw)
      const x2 = Math.max(x1Raw, x2Raw)
      const y2 = Math.max(y1Raw, y2Raw)
      if (x2 <= x1 || y2 <= y1) continue

      const ocrText = typeof item.ocr_text === 'string' ? item.ocr_text.trim() : typeof item.ocrText === 'string' ? item.ocrText.trim() : ''
      const translatedText =
        typeof item.translated_text === 'string'
          ? item.translated_text.trim()
          : typeof item.translatedText === 'string'
            ? item.translatedText.trim()
            : ''

      if (!ocrText && !translatedText) continue

      nextItems.push({
        id: Math.floor(idRaw),
        box: [x1, y1, x2, y2],
        ocrText: ocrText || translatedText,
        translatedText: translatedText || ocrText,
      })
    }

    if (nextItems.length > 0) {
      normalized[imageId] = nextItems
    }
  }

  return normalized
}

export function serializeOverlayManualItems(
  manualItemsByImageId: Record<number, OcrOverlayItem[]>,
): Record<string, OcrOverlayPersistedManualItemPayload[]> {
  const serialized: Record<string, OcrOverlayPersistedManualItemPayload[]> = {}
  const imageIds = Object.keys(manualItemsByImageId)
    .map((key) => Number.parseInt(key, 10))
    .filter((imageId) => Number.isFinite(imageId))
    .sort((a, b) => a - b)

  for (const imageId of imageIds) {
    const items = manualItemsByImageId[imageId]
    if (!Array.isArray(items) || items.length === 0) continue

    const nextItems: OcrOverlayPersistedManualItemPayload[] = []
    for (const item of items) {
      if (!item) continue
      const [x1, y1, x2, y2] = item.box
      if (!Number.isFinite(x1) || !Number.isFinite(y1) || !Number.isFinite(x2) || !Number.isFinite(y2)) continue
      if (x2 <= x1 || y2 <= y1) continue

      const ocrText = item.ocrText.trim()
      const translatedText = item.translatedText.trim()
      if (!ocrText && !translatedText) continue

      nextItems.push({
        id: Math.floor(item.id),
        box: [x1, y1, x2, y2],
        ocr_text: ocrText || translatedText,
        translated_text: translatedText || ocrText,
      })
    }

    if (nextItems.length > 0) {
      serialized[String(imageId)] = nextItems
    }
  }

  return serialized
}

export function normalizeOverlayHiddenItemIds(rawValue: unknown): Record<number, number[]> {
  const root = asObjectRecord(rawValue)
  if (!root) return {}

  const normalized: Record<number, number[]> = {}
  const imageIds = Object.keys(root)
    .map((key) => Number.parseInt(key, 10))
    .filter((imageId) => Number.isFinite(imageId))
    .sort((a, b) => a - b)

  for (const imageId of imageIds) {
    const hiddenIdsRaw = root[String(imageId)]
    if (!Array.isArray(hiddenIdsRaw) || hiddenIdsRaw.length === 0) continue

    const normalizedHiddenIds = hiddenIdsRaw
      .map((value: unknown) => toFiniteNumber(value))
      .filter((value): value is number => value !== null)
      .map((value: number) => Math.floor(value))
      .filter((value: number, index: number, array: number[]) => array.indexOf(value) === index)
      .sort((a: number, b: number) => a - b)

    if (normalizedHiddenIds.length > 0) {
      normalized[imageId] = normalizedHiddenIds
    }
  }

  return normalized
}

export function serializeOverlayHiddenItemIds(hiddenItemIdsByImageId: Record<number, number[]>): Record<string, number[]> {
  const serialized: Record<string, number[]> = {}
  const imageIds = Object.keys(hiddenItemIdsByImageId)
    .map((key) => Number.parseInt(key, 10))
    .filter((imageId) => Number.isFinite(imageId))
    .sort((a, b) => a - b)

  for (const imageId of imageIds) {
    const hiddenIds = Array.isArray(hiddenItemIdsByImageId[imageId]) ? hiddenItemIdsByImageId[imageId] : []
    if (hiddenIds.length === 0) continue

    const normalizedHiddenIds = hiddenIds
      .map((value) => toFiniteNumber(value))
      .filter((value): value is number => value !== null)
      .map((value) => Math.floor(value))
      .filter((value, index, array) => array.indexOf(value) === index)
      .sort((a, b) => a - b)

    if (normalizedHiddenIds.length > 0) {
      serialized[String(imageId)] = normalizedHiddenIds
    }
  }

  return serialized
}

export function upsertOverlayItem(items: OcrOverlayItem[], nextItem: OcrOverlayItem) {
  const index = items.findIndex((item) => item.id === nextItem.id)
  if (index === -1) {
    return [...items, nextItem]
  }

  const next = items.slice()
  next[index] = nextItem
  return next
}

export function removeOverlayItem(items: OcrOverlayItem[], itemId: number) {
  const next = items.filter((item) => item.id !== itemId)
  return next
}

export function mergeOverlayItems(seedItems: OcrOverlayItem[], manualItems: OcrOverlayItem[]) {
  if (manualItems.length === 0) return seedItems
  const merged = seedItems.slice()
  for (const manualItem of manualItems) {
    const index = merged.findIndex((item) => item.id === manualItem.id)
    if (index >= 0) {
      merged[index] = manualItem
    } else {
      merged.push(manualItem)
    }
  }
  return merged
}

export function filterOverlayItemsByHiddenIds(items: OcrOverlayItem[], hiddenIds: number[]) {
  if (hiddenIds.length === 0) return items
  const hiddenSet = new Set(hiddenIds)
  return items.filter((item) => !hiddenSet.has(item.id))
}

export function resolveQuickEditorPlacement(anchor: { leftPercent: number; topPercent: number } | null): {
  side: 'top' | 'bottom'
  align: 'start' | 'center' | 'end'
} {
  if (!anchor) {
    return { side: 'top', align: 'center' }
  }

  const top = clampPercent(anchor.topPercent)
  const left = clampPercent(anchor.leftPercent)
  const side: 'top' | 'bottom' = top < 22 ? 'bottom' : 'top'

  let align: 'start' | 'center' | 'end' = 'center'
  if (left < 24) align = 'start'
  if (left > 76) align = 'end'

  return { side, align }
}

export function isOverlaySelectionPopoverInternalTarget(target: EventTarget | null) {
  const element = target instanceof HTMLElement ? target : null
  if (!element) return false

  return Boolean(
    element.closest('[data-ocr-overlay-interactive="true"]') ||
    element.closest('[data-ocr-overlay-selection-lang-select="true"]') ||
    element.closest('[data-slot="select-content"]'),
  )
}

export function buildOverlayStatePayload(snapshot: OcrOverlayStateSnapshot): OcrOverlayPersistedStatePayload {
  return {
    font_family: snapshot.fontFamily,
    font_scale: clampRange(snapshot.fontScale, OCR_OVERLAY_FONT_SCALE_MIN, OCR_OVERLAY_FONT_SCALE_MAX),
    box_inset_percent: clampRange(snapshot.boxInsetPercent, OCR_OVERLAY_BOX_INSET_MIN, OCR_OVERLAY_BOX_INSET_MAX),
    density: clampRange(snapshot.density, OCR_OVERLAY_DENSITY_MIN, OCR_OVERLAY_DENSITY_MAX),
    overlay_opacity: clampRange(snapshot.overlayOpacity, OCR_OVERLAY_OPACITY_MIN, OCR_OVERLAY_OPACITY_MAX),
    global_shape: snapshot.globalShape,
    overrides_by_image_id: serializeOverlayOverrides(snapshot.overridesByImageId),
    manual_items_by_image_id: serializeOverlayManualItems(snapshot.manualItemsByImageId),
    hidden_item_ids_by_image_id: serializeOverlayHiddenItemIds(snapshot.hiddenItemIdsByImageId),
  }
}

export function parseOverlayStateSnapshot(rawValue: unknown): OcrOverlayStateSnapshot | null {
  const root = asObjectRecord(rawValue)
  if (!root) return null

  const rawFontFamily = typeof root.font_family === 'string' ? root.font_family.trim().toLowerCase() : ''
  const fontFamily: OcrOverlayFontFamily = isOverlayFontFamily(rawFontFamily) ? rawFontFamily : OCR_OVERLAY_DEFAULT_FONT_FAMILY

  const fontScale = clampRange(
    toFiniteNumber(root.font_scale) ?? OCR_OVERLAY_DEFAULT_FONT_SCALE,
    OCR_OVERLAY_FONT_SCALE_MIN,
    OCR_OVERLAY_FONT_SCALE_MAX,
  )
  const boxInsetPercent = clampRange(
    toFiniteNumber(root.box_inset_percent) ?? OCR_OVERLAY_DEFAULT_BOX_INSET,
    OCR_OVERLAY_BOX_INSET_MIN,
    OCR_OVERLAY_BOX_INSET_MAX,
  )
  const density = clampRange(toFiniteNumber(root.density) ?? OCR_OVERLAY_DENSITY_DEFAULT, OCR_OVERLAY_DENSITY_MIN, OCR_OVERLAY_DENSITY_MAX)
  const overlayOpacity = clampRange(
    toFiniteNumber(root.overlay_opacity) ?? OCR_OVERLAY_OPACITY_DEFAULT,
    OCR_OVERLAY_OPACITY_MIN,
    OCR_OVERLAY_OPACITY_MAX,
  )
  const globalShapeRaw = typeof root.global_shape === 'string' ? root.global_shape.trim().toLowerCase() : ''
  const globalShape: OcrOverlayShape = isOverlayShape(globalShapeRaw) ? globalShapeRaw : OCR_OVERLAY_DEFAULT_SHAPE

  return {
    fontFamily,
    fontScale,
    boxInsetPercent,
    density,
    overlayOpacity,
    globalShape,
    overridesByImageId: normalizeOverlayOverrides(root.overrides_by_image_id),
    manualItemsByImageId: normalizeOverlayManualItems(root.manual_items_by_image_id),
    hiddenItemIdsByImageId: normalizeOverlayHiddenItemIds(root.hidden_item_ids_by_image_id),
  }
}

export function isOcrCompletedStatus(value: string | null | undefined) {
  return OCR_COMPLETED_STATUSES.has(normalizeStatus(value))
}

export function toOverlaySeedItems(image: SectionImage) {
  const ocrItems = image.ocr?.items
  if (!Array.isArray(ocrItems) || ocrItems.length === 0) return [] as OcrOverlayItem[]

  const result: OcrOverlayItem[] = []

  for (const rawItem of ocrItems) {
    const item = rawItem as SectionImageOcrItem
    const box = Array.isArray(item.box) ? item.box : []
    if (box.length !== 4) continue

    const rawX1 = Number(box[0])
    const rawY1 = Number(box[1])
    const rawX2 = Number(box[2])
    const rawY2 = Number(box[3])
    if (!Number.isFinite(rawX1) || !Number.isFinite(rawY1) || !Number.isFinite(rawX2) || !Number.isFinite(rawY2)) {
      continue
    }

    const x1 = Math.min(rawX1, rawX2)
    const y1 = Math.min(rawY1, rawY2)
    const x2 = Math.max(rawX1, rawX2)
    const y2 = Math.max(rawY1, rawY2)
    if (x2 <= x1 || y2 <= y1) continue

    const ocrText = typeof item.ocr_text === 'string' ? item.ocr_text.trim() : ''
    if (!ocrText) continue

    const translatedText = typeof item.translated_text === 'string' ? item.translated_text.trim() : ''

    result.push({
      id: item.id,
      box: [x1, y1, x2, y2],
      ocrText,
      translatedText,
    })
  }

  return result
}

export function isImageOcrReady(image: SectionImage | null) {
  if (!image) return false
  return isOcrCompletedStatus(image.status) || isOcrCompletedStatus(image.translation_status)
}

export function isImageProcessing(image: SectionImage | null) {
  if (!image || isImageTranslated(image)) return false
  return PROCESSING_STATUSES.has(normalizeStatus(image.status)) || PROCESSING_STATUSES.has(normalizeStatus(image.translation_status))
}

export function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, value))
}

export function clampRange(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, value))
}

export function toRelativePercent(value: number, reference: number) {
  if (!Number.isFinite(value) || !Number.isFinite(reference) || reference === 0) return 100
  return Math.round((value / reference) * 100)
}

export function normalizeSectionCategoryValue(value: unknown) {
  if (typeof value !== 'string') return ''
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  return normalized.slice(0, SECTION_CATEGORY_MAX_LENGTH)
}

export function normalizeSectionCategoryOptions(value: unknown) {
  if (!Array.isArray(value)) return [] as string[]

  const seen = new Set<string>()
  const options: string[] = []

  for (const item of value) {
    const normalized = normalizeSectionCategoryValue(item)
    if (!normalized) continue

    const key = normalized.toLocaleLowerCase('pt-BR')
    if (seen.has(key)) continue
    seen.add(key)
    options.push(normalized)

    if (options.length >= 200) break
  }

  options.sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }))
  return options
}

export function normalizeSectionCategoryOverlayPreferences(value: unknown): SectionCategoryOverlayPreferences | null {
  const root = asObjectRecord(value)
  if (!root) return null

  const rawFontFamily = typeof root.font_family === 'string' ? root.font_family.trim().toLowerCase() : ''
  const fontFamily: OcrOverlayFontFamily = isOverlayFontFamily(rawFontFamily) ? rawFontFamily : OCR_OVERLAY_DEFAULT_FONT_FAMILY

  const rawShape = typeof root.global_shape === 'string' ? root.global_shape.trim().toLowerCase() : ''
  const globalShape: OcrOverlayShape = isOverlayShape(rawShape) ? rawShape : OCR_OVERLAY_DEFAULT_SHAPE
  const rawDefaultReadingMode = typeof root.default_reading_mode === 'string' ? root.default_reading_mode.trim().toLowerCase() : ''
  const defaultReadingMode: 'paginated' | 'scroll' = rawDefaultReadingMode === 'scroll' ? 'scroll' : 'paginated'

  return {
    font_family: fontFamily,
    font_scale: clampRange(
      toFiniteNumber(root.font_scale) ?? OCR_OVERLAY_DEFAULT_FONT_SCALE,
      OCR_OVERLAY_FONT_SCALE_MIN,
      OCR_OVERLAY_FONT_SCALE_MAX,
    ),
    box_inset_percent: clampRange(
      toFiniteNumber(root.box_inset_percent) ?? OCR_OVERLAY_DEFAULT_BOX_INSET,
      OCR_OVERLAY_BOX_INSET_MIN,
      OCR_OVERLAY_BOX_INSET_MAX,
    ),
    density: clampRange(toFiniteNumber(root.density) ?? OCR_OVERLAY_DENSITY_DEFAULT, OCR_OVERLAY_DENSITY_MIN, OCR_OVERLAY_DENSITY_MAX),
    overlay_opacity: clampRange(
      toFiniteNumber(root.overlay_opacity) ?? OCR_OVERLAY_OPACITY_DEFAULT,
      OCR_OVERLAY_OPACITY_MIN,
      OCR_OVERLAY_OPACITY_MAX,
    ),
    global_shape: globalShape,
    default_reading_mode: defaultReadingMode,
  }
}

export function toSectionCategoryKey(value: string) {
  return normalizeSectionCategoryValue(value).toLocaleLowerCase('pt-BR')
}

export function getRelativeLuminance(red: number, green: number, blue: number) {
  const srgb = [red, green, blue].map((channel) => {
    const value = channel / 255
    if (value <= 0.03928) return value / 12.92
    return ((value + 0.055) / 1.055) ** 2.4
  })

  return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2]
}

export function getContrastRatio(l1: number, l2: number) {
  const light = Math.max(l1, l2)
  const dark = Math.min(l1, l2)
  return (light + 0.05) / (dark + 0.05)
}

export function toOverlayColorProfile(red: number, green: number, blue: number): OcrOverlayItemColors {
  const clampedRed = Math.round(clampRange(red, 0, 255))
  const clampedGreen = Math.round(clampRange(green, 0, 255))
  const clampedBlue = Math.round(clampRange(blue, 0, 255))
  const bgLuminance = getRelativeLuminance(clampedRed, clampedGreen, clampedBlue)
  const contrastWithWhite = getContrastRatio(bgLuminance, 1)
  const contrastWithBlack = getContrastRatio(bgLuminance, 0)
  const useDarkText = contrastWithBlack >= contrastWithWhite
  const channelSpread = Math.max(clampedRed, clampedGreen, clampedBlue) - Math.min(clampedRed, clampedGreen, clampedBlue)
  const isNearNeutral = channelSpread <= 24
  const isVeryLightBackground = bgLuminance >= 0.92
  const isLightBackground = bgLuminance >= 0.82
  const whiteBlendStrength = isVeryLightBackground && isNearNeutral ? 0.08 : 0
  const profiledRed = Math.round(clampRange(clampedRed + (255 - clampedRed) * whiteBlendStrength, 0, 255))
  const profiledGreen = Math.round(clampRange(clampedGreen + (255 - clampedGreen) * whiteBlendStrength, 0, 255))
  const profiledBlue = Math.round(clampRange(clampedBlue + (255 - clampedBlue) * whiteBlendStrength, 0, 255))

  const textColor = useDarkText ? 'rgba(15,23,42,0.96)' : 'rgba(226,232,240,0.92)'
  const borderColor =
    isVeryLightBackground && isNearNeutral
      ? 'rgba(255,255,255,0.015)'
      : isLightBackground
        ? `rgba(${profiledRed},${profiledGreen},${profiledBlue},0.08)`
        : useDarkText
          ? 'rgba(15,23,42,0.34)'
          : 'rgba(248,250,252,0.38)'
  const baseAlpha = isVeryLightBackground && isNearNeutral ? 0.66 : isLightBackground ? 0.72 : useDarkText ? 0.84 : 0.74

  return {
    red: profiledRed,
    green: profiledGreen,
    blue: profiledBlue,
    baseAlpha,
    borderColor,
    textColor,
  }
}

export async function loadImageForSampling(src: string) {
  const response = await fetch(src, {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error(`Falha ao buscar imagem para amostragem de cor (HTTP ${response.status}).`)
  }

  const imageBlob = await response.blob()

  return new Promise<HTMLImageElement>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(imageBlob)
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => {
      URL.revokeObjectURL(objectUrl)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('Falha ao carregar blob da imagem para amostragem de cor.'))
    }
    image.src = objectUrl
  })
}

export function sampleAverageColor(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number) {
  const safeX = Math.max(0, Math.floor(x))
  const safeY = Math.max(0, Math.floor(y))
  const safeW = Math.max(1, Math.floor(width))
  const safeH = Math.max(1, Math.floor(height))
  const imageData = context.getImageData(safeX, safeY, safeW, safeH).data

  let red = 0
  let green = 0
  let blue = 0
  let count = 0
  let nonDarkRed = 0
  let nonDarkGreen = 0
  let nonDarkBlue = 0
  let nonDarkCount = 0
  type ColorBucket = { weight: number; red: number; green: number; blue: number }
  const buckets = new Map<string, ColorBucket>()
  const quantizeStep = 24

  const step = Math.max(1, Math.floor(Math.min(safeW, safeH) / 10))
  for (let row = 0; row < safeH; row += step) {
    for (let col = 0; col < safeW; col += step) {
      const index = (row * safeW + col) * 4
      const alpha = imageData[index + 3]
      if (alpha < 20) continue

      const sampledRed = imageData[index]
      const sampledGreen = imageData[index + 1]
      const sampledBlue = imageData[index + 2]
      red += sampledRed
      green += sampledGreen
      blue += sampledBlue
      count += 1

      const luminance = getRelativeLuminance(sampledRed, sampledGreen, sampledBlue)
      const maxChannel = Math.max(sampledRed, sampledGreen, sampledBlue)
      const minChannel = Math.min(sampledRed, sampledGreen, sampledBlue)
      const saturation = maxChannel <= 0 ? 0 : (maxChannel - minChannel) / maxChannel
      const quantizedRed = Math.round(sampledRed / quantizeStep) * quantizeStep
      const quantizedGreen = Math.round(sampledGreen / quantizeStep) * quantizeStep
      const quantizedBlue = Math.round(sampledBlue / quantizeStep) * quantizeStep
      const bucketKey = `${quantizedRed}:${quantizedGreen}:${quantizedBlue}`

      let weight = 1
      if (saturation >= 0.14) weight *= 1.35
      if (luminance > 0.96 && saturation < 0.08) weight *= 0.22
      if (luminance < 0.16) weight *= 0.18

      const bucket = buckets.get(bucketKey) ?? { weight: 0, red: 0, green: 0, blue: 0 }
      bucket.weight += weight
      bucket.red += sampledRed * weight
      bucket.green += sampledGreen * weight
      bucket.blue += sampledBlue * weight
      buckets.set(bucketKey, bucket)

      if (luminance >= 0.2) {
        nonDarkRed += sampledRed
        nonDarkGreen += sampledGreen
        nonDarkBlue += sampledBlue
        nonDarkCount += 1
      }
    }
  }

  if (count === 0) {
    return { red: 255, green: 255, blue: 255 }
  }

  const dominantBucket = Array.from(buckets.values()).sort((a, b) => b.weight - a.weight)[0]
  if (dominantBucket && dominantBucket.weight > 0) {
    return {
      red: dominantBucket.red / dominantBucket.weight,
      green: dominantBucket.green / dominantBucket.weight,
      blue: dominantBucket.blue / dominantBucket.weight,
    }
  }

  if (nonDarkCount >= Math.max(4, Math.floor(count * 0.2))) {
    return {
      red: nonDarkRed / nonDarkCount,
      green: nonDarkGreen / nonDarkCount,
      blue: nonDarkBlue / nonDarkCount,
    }
  }

  return {
    red: red / count,
    green: green / count,
    blue: blue / count,
  }
}

export async function cropImageAreaToBlob(imageSrc: string, referenceSize: ImageNaturalSize, box: [number, number, number, number]) {
  const image = await loadImageForSampling(imageSrc)
  const [x1Raw, y1Raw, x2Raw, y2Raw] = box

  const x1 = clampRange(Math.min(x1Raw, x2Raw), 0, referenceSize.width)
  const y1 = clampRange(Math.min(y1Raw, y2Raw), 0, referenceSize.height)
  const x2 = clampRange(Math.max(x1Raw, x2Raw), 0, referenceSize.width)
  const y2 = clampRange(Math.max(y1Raw, y2Raw), 0, referenceSize.height)
  if (x2 <= x1 || y2 <= y1) {
    throw new Error('Área inválida para OCR.')
  }

  const scaleX = image.naturalWidth / referenceSize.width
  const scaleY = image.naturalHeight / referenceSize.height

  const cropX = Math.floor(x1 * scaleX)
  const cropY = Math.floor(y1 * scaleY)
  const cropW = Math.max(1, Math.ceil((x2 - x1) * scaleX))
  const cropH = Math.max(1, Math.ceil((y2 - y1) * scaleY))

  const canvas = document.createElement('canvas')
  canvas.width = cropW
  canvas.height = cropH
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Falha ao preparar recorte da área selecionada.')
  }

  context.drawImage(image, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH)

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Não foi possível gerar imagem recortada para OCR.'))
        return
      }
      resolve(blob)
    }, 'image/png')
  })
}
