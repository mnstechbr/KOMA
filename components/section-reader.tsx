'use client'

import Link from 'next/link'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import {
  buildImageViewUrl,
  formatSectionDate,
  formatStatus,
  getSectionQueueState,
  getSectionPriorityInfo,
  isImageTranslated,
  normalizeStatus,
  type SectionDetail,
  type SectionImage,
  type SectionListItem,
  toErrorMessage,
} from '@/lib/sections'
import { readAutoProcessingEnabledPreference } from '@/lib/user-preferences'
import {
  ArrowLeft,
  BookOpen,
  BarChart3,
  Check,
  CheckCircle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Loader2,
  Pencil,
  Play,
  RefreshCw,
  RotateCcw,
  Rows3,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { toast } from 'sonner'
import { SpotlightTour, checkTourDone, type TourStep } from '@/components/spotlight-tour'

import {
  toFiniteNumber,
  toStringValue,
  firstDefined,
  asObjectRecord,
  FAILED_TRANSLATION_STATUSES,
  READING_PRELOAD_RADIUS,
  SWIPE_TRIGGER_PX,
  SWIPE_DIRECTION_RATIO,
  READ_PAGES_LS_PREFIX,
  SECTION_READ_LS_PREFIX,
  SECTION_READ_THRESHOLD,
  SECTION_CATEGORY_MAX_LENGTH,
  OCR_OVERLAY_FONT_SCALE_MIN,
  OCR_OVERLAY_FONT_SCALE_MAX,
  OCR_OVERLAY_FONT_SCALE_STEP,
  OCR_OVERLAY_DEFAULT_FONT_SCALE,
  OCR_OVERLAY_DEFAULT_FONT_FAMILY,
  OCR_OVERLAY_DEFAULT_SHAPE,
  OCR_OVERLAY_DEFAULT_BOX_INSET,
  OCR_OVERLAY_ITEM_FONT_SCALE_MIN,
  OCR_OVERLAY_ITEM_FONT_SCALE_MAX,
  OCR_OVERLAY_ITEM_FONT_SCALE_STEP,
  OCR_OVERLAY_ITEM_FONT_SCALE_DEFAULT,
  OCR_OVERLAY_DENSITY_MIN,
  OCR_OVERLAY_DENSITY_MAX,
  OCR_OVERLAY_DENSITY_STEP,
  OCR_OVERLAY_DENSITY_DEFAULT,
  OCR_OVERLAY_OPACITY_MIN,
  OCR_OVERLAY_OPACITY_MAX,
  OCR_OVERLAY_OPACITY_DEFAULT,
  OCR_OVERLAY_ITEM_DENSITY_MIN,
  OCR_OVERLAY_ITEM_DENSITY_MAX,
  OCR_OVERLAY_ITEM_DENSITY_STEP,
  OCR_OVERLAY_ITEM_DENSITY_DEFAULT,
  OCR_OVERLAY_ITEM_SIZE_MIN,
  OCR_OVERLAY_ITEM_SIZE_MAX,
  OCR_OVERLAY_ITEM_SIZE_STEP,
  OCR_OVERLAY_ITEM_SIZE_DEFAULT,
  OCR_OVERLAY_ITEM_AXIS_SCALE_MIN,
  OCR_OVERLAY_ITEM_AXIS_SCALE_MAX,
  OCR_OVERLAY_ITEM_AXIS_SCALE_DEFAULT,
  OCR_QUEUE_POLL_INTERVAL_MS,
  OCR_QUEUE_POLL_TIMEOUT_MS,
  OCR_OVERLAY_SELECTION_SOURCE_DEFAULT,
  OCR_OVERLAY_SELECTION_TARGET_DEFAULT,
  OCR_OVERLAY_SELECTION_LANGUAGES,
  OCR_OVERLAY_SELECTION_TARGET_LANGUAGES,
  OCR_OVERLAY_FONT_FAMILIES,
  resolveOcrOverlayProvider,
  formatProviderLabel,
  normalizeOverlaySelectionLanguage,
  upsertOverlayItem,
  removeOverlayItem,
  mergeOverlayItems,
  filterOverlayItemsByHiddenIds,
  resolveQuickEditorPlacement,
  isOverlaySelectionPopoverInternalTarget,
  buildOverlayStatePayload,
  parseOverlayStateSnapshot,
  toOverlaySeedItems,
  isImageOcrReady,
  isImageProcessing,
  clampPercent,
  clampRange,
  toRelativePercent,
  normalizeSectionCategoryValue,
  normalizeSectionCategoryOptions,
  normalizeSectionCategoryOverlayPreferences,
  toSectionCategoryKey,
  toOverlayColorProfile,
  loadImageForSampling,
  sampleAverageColor,
  cropImageAreaToBlob,
  type SectionReaderProps,
  type DeleteSectionResponse,
  type RenameSectionResponse,
  type SectionCategoryResponse,
  type SectionStatsResponse,
  type LimitModalState,
  type QueueActionOptions,
  type OcrOverlayItem,
  type OcrOverlayShape,
  type OcrOverlayTextMode,
  type OcrOverlayFontFamily,
  type OcrOverlayItemOverride,
  type OcrOverlayItemColors,
  type OcrBatchTranslateResponse,
  type OcrImageQueueResponse,
  type OcrImageJobPollResponse,
  type OcrOverlayStateResponse,
  type OcrOverlayStateSnapshot,
  type SectionCategoryOverlayPreferences,
  type ImageNaturalSize,
} from './section-reader/model'

export { SECTION_READ_LS_PREFIX } from './section-reader/model'

import { OcrTextOverlay } from './section-reader/ocr-text-overlay'

export function SectionReader({ sectionId }: SectionReaderProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const libraryPageParam = searchParams.get('page')
  const libraryPage = libraryPageParam ? Number.parseInt(libraryPageParam, 10) : NaN
  const backToLibraryHref = Number.isFinite(libraryPage) && libraryPage > 1
    ? `/inicio/secoes?page=${libraryPage}`
    : '/inicio/secoes'

  const [section, setSection] = useState<SectionDetail | null>(null)
  const [isLoadingSection, setIsLoadingSection] = useState(true)
  const [isDeletingSection, setIsDeletingSection] = useState(false)
  const [isRenamingSection, setIsRenamingSection] = useState(false)
  const [isEditingSectionName, setIsEditingSectionName] = useState(false)
  const [sectionNameDraft, setSectionNameDraft] = useState('')
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [limitModalState, setLimitModalState] = useState<LimitModalState | null>(null)
  const [isPollingStatus, setIsPollingStatus] = useState(false)
  const [lastStatusSyncAt, setLastStatusSyncAt] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [queueActionLoading, setQueueActionLoading] = useState<'queue' | 'reprocess' | null>(null)
  const [isAutoProcessingEnabled, setIsAutoProcessingEnabled] = useState(false)

  const [readPages, setReadPages] = useState<Set<number>>(new Set())
  const [readingMode, setReadingMode] = useState(false)
  const [readingViewMode, setReadingViewMode] = useState<'paginated' | 'scroll'>('paginated')
  const [suggestedSections, setSuggestedSections] = useState<SectionListItem[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const suggestionsScrollRef = useRef<HTMLDivElement | null>(null)
  const [suggestionsCanScrollLeft, setSuggestionsCanScrollLeft] = useState(false)
  const [suggestionsCanScrollRight, setSuggestionsCanScrollRight] = useState(true)
  const SECTION_GRID_INITIAL_PAGES = 20
  const SECTION_GRID_LOAD_MORE_BATCH = 20
  const [sectionGridVisibleCount, setSectionGridVisibleCount] = useState(SECTION_GRID_INITIAL_PAGES)
  const [revealedScrollImageIds, setRevealedScrollImageIds] = useState<Set<number>>(new Set())
  const scrollImageObserverRef = useRef<IntersectionObserver | null>(null)
  const [isOverlayFontPopoverOpen, setIsOverlayFontPopoverOpen] = useState(false)
  const [currentReadingPage, setCurrentReadingPage] = useState(0)
  const [zoom, setZoom] = useState(100)
  const [loadedImageUrls, setLoadedImageUrls] = useState<Record<string, boolean>>({})
  const [isReadingImageLoading, setIsReadingImageLoading] = useState(false)
  const [sectionCategoryDraft, setSectionCategoryDraft] = useState('')
  const [sectionCategoryOptions, setSectionCategoryOptions] = useState<string[]>([])
  const [sectionCategoryQuery, setSectionCategoryQuery] = useState('')
  const [isSectionCategoryPopoverOpen, setIsSectionCategoryPopoverOpen] = useState(false)
  const [sectionCategoryPopoverWidth, setSectionCategoryPopoverWidth] = useState<number | null>(null)
  const [isSectionCategoryLoading, setIsSectionCategoryLoading] = useState(false)
  const [isSectionCategorySaving, setIsSectionCategorySaving] = useState(false)
  const [isDeleteCategoryDialogOpen, setIsDeleteCategoryDialogOpen] = useState(false)
  const [categoryToDelete, setCategoryToDelete] = useState('')
  const [isStatsExpanded, setIsStatsExpanded] = useState(false)
  const [isStatsLoading, setIsStatsLoading] = useState(false)
  const [statsError, setStatsError] = useState('')
  const [sectionStats, setSectionStats] = useState<{
    totalPages: number
    selectedPages: number
    translatedPages: number
    ocrCompletedPages: number
    completedPages: number
    pagesWithElapsedMs: number
    totalElapsedMinutes: number
    avgElapsedSecondsPerPage: number
    totalDetections: number
    providerLang: string | null
    costModel: string | null
    estimatedInputTokens: number
    estimatedOutputTokens: number
    estimatedInputCostUsd: number | null
    estimatedOutputCostUsd: number | null
    estimatedTotalCostUsd: number | null
    generatedAt: string | null
  } | null>(null)
  const [isDeletingCategory, setIsDeletingCategory] = useState(false)
  const [ocrOverlayFontFamily, setOcrOverlayFontFamily] = useState<OcrOverlayFontFamily>(OCR_OVERLAY_DEFAULT_FONT_FAMILY)
  const [ocrOverlayFontScale, setOcrOverlayFontScale] = useState(OCR_OVERLAY_DEFAULT_FONT_SCALE)
  const [ocrOverlayTextMode, setOcrOverlayTextMode] = useState<OcrOverlayTextMode>('translated')
  const [ocrOverlayBoxInsetPercent, setOcrOverlayBoxInsetPercent] = useState(OCR_OVERLAY_DEFAULT_BOX_INSET)
  const [ocrOverlayDensity, setOcrOverlayDensity] = useState(OCR_OVERLAY_DENSITY_DEFAULT)
  const [ocrOverlayOpacity, setOcrOverlayOpacity] = useState(OCR_OVERLAY_OPACITY_DEFAULT)
  const [ocrOverlayGlobalShape, setOcrOverlayGlobalShape] = useState<OcrOverlayShape>(OCR_OVERLAY_DEFAULT_SHAPE)
  const [sectionCategoryOverlayPreferences, setSectionCategoryOverlayPreferences] =
    useState<SectionCategoryOverlayPreferences | null>(null)
  const ocrOverlayEditMode = true
  const [ocrOverlayOverridesByImageId, setOcrOverlayOverridesByImageId] = useState<Record<number, Record<number, OcrOverlayItemOverride>>>({})
  const [selectedOverlayTarget, setSelectedOverlayTarget] = useState<{ imageId: number; itemId: number } | null>(null)
  const [overlayQuickEditorState, setOverlayQuickEditorState] = useState<{
    imageId: number
    itemId: number
    leftPercent: number
    topPercent: number
  } | null>(null)
  const [overlayDragEnabledTarget, setOverlayDragEnabledTarget] = useState<{ imageId: number; itemId: number } | null>(null)
  const [overlayQuickEditorPlacement, setOverlayQuickEditorPlacement] = useState<{
    imageId: number
    itemId: number
    side: 'top' | 'bottom'
    align: 'start' | 'center' | 'end'
  } | null>(null)
  const [ocrOverlayColorsByImageId, setOcrOverlayColorsByImageId] = useState<Record<number, Record<number, OcrOverlayItemColors>>>({})
  const [ocrOverlayColorLoadingByImageId, setOcrOverlayColorLoadingByImageId] = useState<Record<number, boolean>>({})
  const [ocrOverlayByImageId, setOcrOverlayByImageId] = useState<Record<number, OcrOverlayItem[]>>({})
  const [ocrOverlayManualItemsByImageId, setOcrOverlayManualItemsByImageId] = useState<Record<number, OcrOverlayItem[]>>({})
  const [ocrOverlayHiddenItemIdsByImageId, setOcrOverlayHiddenItemIdsByImageId] = useState<Record<number, number[]>>({})
  const [ocrOverlayLoadingByImageId, setOcrOverlayLoadingByImageId] = useState<Record<number, boolean>>({})
  const [ocrOverlayTranslateQueue, setOcrOverlayTranslateQueue] = useState<number[]>([])
  const [ocrOverlayCreatingSelectionByImageId, setOcrOverlayCreatingSelectionByImageId] = useState<Record<number, boolean>>({})
  const [isOverlaySelectionMode, setIsOverlaySelectionMode] = useState(false)
  const [overlaySelectionDraft, setOverlaySelectionDraft] = useState<{
    imageId: number
    box: [number, number, number, number]
    leftPercent: number
    topPercent: number
  } | null>(null)
  const [overlaySelectionSourceLang, setOverlaySelectionSourceLang] = useState(OCR_OVERLAY_SELECTION_SOURCE_DEFAULT)
  const [overlaySelectionTargetLang, setOverlaySelectionTargetLang] = useState(OCR_OVERLAY_SELECTION_TARGET_DEFAULT)
  const [isOverlayStateReady, setIsOverlayStateReady] = useState(false)
  const [imageNaturalSizeById, setImageNaturalSizeById] = useState<Record<number, ImageNaturalSize>>({})
  const [isTourOpen, setIsTourOpen] = useState(false)
  const readProgressLastSyncedDoneRef = useRef<boolean | null>(null)
  const overlayStateSaveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const overlayStateLastSavedRef = useRef('')
  const overlayStateLoadedFromServerRef = useRef(false)
  const overlayCategoryDefaultsAppliedRef = useRef(false)
  const sectionCategoryLastSavedRef = useRef('')
  const sectionCategorySaveRequestRef = useRef(0)
  const sectionCategorySkipCloseCommitRef = useRef(false)
  const sectionCategoryTriggerRef = useRef<HTMLButtonElement | null>(null)
  const ocrOverlayTranslateWorkerBusyRef = useRef(false)
  const sectionNameSyncedRef = useRef('')
  const sectionNameInputRef = useRef<HTMLInputElement | null>(null)
  const readingTouchStartRef = useRef<{ x: number; y: number } | null>(null)
  const readingSwipeLockedRef = useRef(false)
  const readingInteractionZoneRef = useRef<HTMLDivElement | null>(null)
  const autoQueueAttemptedRef = useRef(false)
  const autoReprocessAttemptedRef = useRef(false)
  const autoReprocessAcceptedRef = useRef(false)

  const handleUnauthorized = useCallback(() => {
    const params = new URLSearchParams()
    params.set('expired', '1')
    const currentPath =
      typeof window !== 'undefined'
        ? `${window.location.pathname}${window.location.search}`
        : `/inicio/secoes/${sectionId}`
    if (currentPath.startsWith('/')) {
      params.set('redirect', currentPath)
    }
    router.replace(`/inicio/secoes?${params.toString()}`)
  }, [router, sectionId])

  useEffect(() => {
    let cancelled = false
    void readAutoProcessingEnabledPreference().then((enabled) => {
      if (cancelled) return
      setIsAutoProcessingEnabled(enabled)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const markImageAsLoaded = useCallback((url: string) => {
    setLoadedImageUrls((prev) => {
      if (prev[url]) return prev
      return {
        ...prev,
        [url]: true,
      }
    })
  }, [])

  const updateImageNaturalSize = useCallback((imageId: number, width: number, height: number) => {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return
    }

    setImageNaturalSizeById((prev) => {
      const current = prev[imageId]
      if (current && current.width === width && current.height === height) {
        return prev
      }

      return {
        ...prev,
        [imageId]: { width, height },
      }
    })
  }, [])

  const fetchSection = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false

    if (silent) {
      setIsPollingStatus(true)
    } else {
      setIsLoadingSection(true)
    }

    try {
      const response = await fetch(`/api/sections/${sectionId}`, { cache: 'no-store' })
      const data = await response.json()

      if (response.status === 401) {
        handleUnauthorized()
        return
      }

      if (!response.ok) {
        throw new Error(toErrorMessage(data, 'Não foi possível carregar a seção.'))
      }

      setSection(data as SectionDetail)
      setLastStatusSyncAt(Date.now())
      if (!silent) {
        setError('')
      }
    } catch (err) {
      if (!silent) {
        setError(err instanceof Error ? err.message : 'Erro ao carregar seção.')
      }
    } finally {
      if (silent) {
        setIsPollingStatus(false)
      } else {
        setIsLoadingSection(false)
      }
    }
  }, [handleUnauthorized, sectionId])

  const fetchSectionStats = useCallback(async () => {
    setIsStatsLoading(true)
    setStatsError('')

    try {
      const response = await fetch(`/api/sections/${sectionId}/stats`, { cache: 'no-store' })
      const data = (await response.json().catch(() => ({}))) as SectionStatsResponse

      if (response.status === 401) {
        handleUnauthorized()
        return
      }

      if (!response.ok) {
        throw new Error(toErrorMessage(data, 'Não foi possível carregar estatísticas da seção.'))
      }

      setSectionStats({
        totalPages: Math.max(0, toFiniteNumber(data.total_pages) ?? 0),
        selectedPages: Math.max(0, toFiniteNumber(data.selected_pages) ?? 0),
        translatedPages: Math.max(0, toFiniteNumber(data.translated_pages) ?? 0),
        ocrCompletedPages: Math.max(0, toFiniteNumber(data.ocr_completed_pages) ?? 0),
        completedPages: Math.max(0, toFiniteNumber(data.completed_pages) ?? 0),
        pagesWithElapsedMs: Math.max(0, toFiniteNumber(data.pages_with_elapsed_ms) ?? 0),
        totalElapsedMinutes: Math.max(0, toFiniteNumber(data.total_elapsed_minutes) ?? 0),
        avgElapsedSecondsPerPage: Math.max(0, toFiniteNumber(data.avg_elapsed_seconds_per_page) ?? 0),
        totalDetections: Math.max(0, toFiniteNumber(data.total_detections) ?? 0),
        providerLang: toStringValue(data.provider_lang),
        costModel: toStringValue(data.cost_model),
        estimatedInputTokens: Math.max(0, toFiniteNumber(data.estimated_input_tokens) ?? 0),
        estimatedOutputTokens: Math.max(0, toFiniteNumber(data.estimated_output_tokens) ?? 0),
        estimatedInputCostUsd: toFiniteNumber(data.estimated_input_cost_usd),
        estimatedOutputCostUsd: toFiniteNumber(data.estimated_output_cost_usd),
        estimatedTotalCostUsd: toFiniteNumber(data.estimated_total_cost_usd),
        generatedAt: typeof data.generated_at === 'string' ? data.generated_at : null,
      })
    } catch (err) {
      setStatsError(err instanceof Error ? err.message : 'Erro ao carregar estatísticas da seção.')
    } finally {
      setIsStatsLoading(false)
    }
  }, [handleUnauthorized, sectionId])

  useEffect(() => {
    void fetchSection()
  }, [fetchSection])

  const forcedPollingEndAtRef = useRef<number>(0)
  const prevProcessingRef = useRef(false)

  const triggerForcedPolling = useCallback((durationMs = 90_000) => {
    forcedPollingEndAtRef.current = Date.now() + durationMs
  }, [])

  const derivedProcessingCount = useMemo(
    () => (
      section?.images ?? []
    ).filter((img) => img.selected_for_processing && isImageProcessing(img)).length,
    [section]
  )
  const derivedQueuedCount = useMemo(
    () => (
      section?.images ?? []
    ).filter((img) => (
      img.selected_for_processing
      && (img.translation_status === 'queued' || img.translation_status === 'pending')
    )).length,
    [section]
  )

  useEffect(() => {
    const isProcessing = derivedProcessingCount > 0 || derivedQueuedCount > 0
    const isForcedPolling = Date.now() < forcedPollingEndAtRef.current
    const shouldPoll = isProcessing || isForcedPolling

    if (prevProcessingRef.current && !isProcessing && !isForcedPolling) {
      const timeout = setTimeout(() => void fetchSection({ silent: true }), 1500)
      prevProcessingRef.current = false
      return () => clearTimeout(timeout)
    }

    prevProcessingRef.current = isProcessing

    if (!shouldPoll) return

    const interval = setInterval(() => {
      void fetchSection({ silent: true })
    }, 4000)

    return () => clearInterval(interval)
  }, [fetchSection, derivedProcessingCount, derivedQueuedCount])

  useEffect(() => {
    setIsStatsExpanded(false)
    setIsStatsLoading(false)
    setStatsError('')
    setSectionStats(null)
  }, [sectionId])

  useEffect(() => {
    if (!isStatsExpanded) return
    void fetchSectionStats()
  }, [fetchSectionStats, isStatsExpanded])

  useEffect(() => {
    if (!section?.id) return
    if (sectionStats) return
    void fetchSectionStats()
  }, [fetchSectionStats, section?.id, sectionStats])

  useEffect(() => {
    if (overlayStateSaveDebounceRef.current !== null) {
      clearTimeout(overlayStateSaveDebounceRef.current)
      overlayStateSaveDebounceRef.current = null
    }

    overlayStateLastSavedRef.current = ''
    setIsOverlayStateReady(false)
    setOcrOverlayByImageId({})
    setOcrOverlayManualItemsByImageId({})
    setOcrOverlayHiddenItemIdsByImageId({})
    setOcrOverlayLoadingByImageId({})
    setOcrOverlayTranslateQueue([])
    setOcrOverlayCreatingSelectionByImageId({})
    setOcrOverlayColorsByImageId({})
    setOcrOverlayColorLoadingByImageId({})
    setOcrOverlayOverridesByImageId({})
    setSelectedOverlayTarget(null)
    setOverlayQuickEditorState(null)
    setOverlayDragEnabledTarget(null)
    setIsOverlaySelectionMode(false)
    setOverlaySelectionDraft(null)
    setOcrOverlayFontFamily(OCR_OVERLAY_DEFAULT_FONT_FAMILY)
    setSectionCategoryDraft('')
    setSectionCategoryOptions([])
    setSectionCategoryQuery('')
    setIsSectionCategoryPopoverOpen(false)
    setSectionCategoryPopoverWidth(null)
    setIsSectionCategoryLoading(false)
    setIsSectionCategorySaving(false)
    setIsDeleteCategoryDialogOpen(false)
    setCategoryToDelete('')
    setIsDeletingCategory(false)
    sectionCategoryLastSavedRef.current = ''
    sectionCategorySaveRequestRef.current = 0
    sectionCategorySkipCloseCommitRef.current = false
    ocrOverlayTranslateWorkerBusyRef.current = false
    setImageNaturalSizeById({})
    setOcrOverlayFontScale(OCR_OVERLAY_DEFAULT_FONT_SCALE)
    setOcrOverlayBoxInsetPercent(OCR_OVERLAY_DEFAULT_BOX_INSET)
    setOcrOverlayDensity(OCR_OVERLAY_DENSITY_DEFAULT)
    setOcrOverlayOpacity(OCR_OVERLAY_OPACITY_DEFAULT)
    setOcrOverlayGlobalShape(OCR_OVERLAY_DEFAULT_SHAPE)
    setSectionCategoryOverlayPreferences(null)
    readProgressLastSyncedDoneRef.current = null
    overlayStateLoadedFromServerRef.current = false
    overlayCategoryDefaultsAppliedRef.current = false
  }, [sectionId])

  useEffect(() => {
    let cancelled = false

    const loadOverlayState = async () => {
      const defaultSnapshot: OcrOverlayStateSnapshot = {
        fontFamily: OCR_OVERLAY_DEFAULT_FONT_FAMILY,
        fontScale: OCR_OVERLAY_DEFAULT_FONT_SCALE,
        boxInsetPercent: OCR_OVERLAY_DEFAULT_BOX_INSET,
        density: OCR_OVERLAY_DENSITY_DEFAULT,
        overlayOpacity: OCR_OVERLAY_OPACITY_DEFAULT,
        globalShape: OCR_OVERLAY_DEFAULT_SHAPE,
        overridesByImageId: {},
        manualItemsByImageId: {},
        hiddenItemIdsByImageId: {},
      }
      overlayStateLastSavedRef.current = JSON.stringify(buildOverlayStatePayload(defaultSnapshot))
      overlayStateLoadedFromServerRef.current = false

      try {
        const response = await fetch(`/api/sections/${sectionId}/ocr-overlay-state`, { cache: 'no-store' })
        const data = (await response.json()) as OcrOverlayStateResponse

        if (cancelled) return

        if (response.status === 401) {
          handleUnauthorized()
          return
        }

        if (!response.ok) {
          return
        }

        const parsed = parseOverlayStateSnapshot(data.state)
        if (!parsed) return

        overlayStateLoadedFromServerRef.current = true
        setOcrOverlayFontFamily(parsed.fontFamily)
        setOcrOverlayFontScale(parsed.fontScale)
        setOcrOverlayBoxInsetPercent(parsed.boxInsetPercent)
        setOcrOverlayDensity(parsed.density)
        setOcrOverlayOpacity(parsed.overlayOpacity)
        setOcrOverlayGlobalShape(parsed.globalShape)
        setOcrOverlayOverridesByImageId(parsed.overridesByImageId)
        setOcrOverlayManualItemsByImageId(parsed.manualItemsByImageId)
        setOcrOverlayHiddenItemIdsByImageId(parsed.hiddenItemIdsByImageId)
        setSelectedOverlayTarget(null)
        setOverlayQuickEditorState(null)
        setOverlayDragEnabledTarget(null)
        overlayStateLastSavedRef.current = JSON.stringify(buildOverlayStatePayload(parsed))
      } catch {
      } finally {
        if (!cancelled) {
          setIsOverlayStateReady(true)
        }
      }
    }

    void loadOverlayState()

    return () => {
      cancelled = true
    }
  }, [handleUnauthorized, sectionId])

  useEffect(() => {
    const trigger = sectionCategoryTriggerRef.current
    if (!trigger) return

    const updateWidth = () => {
      const width = Math.round(trigger.getBoundingClientRect().width)
      if (width > 0) {
        setSectionCategoryPopoverWidth((prev) => (prev === width ? prev : width))
      }
    }

    updateWidth()
    const observer = new ResizeObserver(updateWidth)
    observer.observe(trigger)
    window.addEventListener('resize', updateWidth)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateWidth)
    }
  }, [section?.id, isSectionCategoryPopoverOpen])

  useEffect(() => {
    let cancelled = false

    const loadSectionCategory = async () => {
      setIsSectionCategoryLoading(true)
      try {
        const response = await fetch(`/api/sections/${sectionId}/category`, { cache: 'no-store' })
        const data = (await response.json()) as SectionCategoryResponse

        if (cancelled) return

        if (response.status === 401) {
          handleUnauthorized()
          return
        }

        if (!response.ok) {
          setSectionCategoryDraft('')
          setSectionCategoryOptions([])
          sectionCategoryLastSavedRef.current = ''
          return
        }

        const nextCategory = normalizeSectionCategoryValue(data.category)
        const nextOptions = normalizeSectionCategoryOptions(data.categories)
        const nextCategoryPreferences = normalizeSectionCategoryOverlayPreferences(
          data.category_preferences
        )

        setSectionCategoryDraft(nextCategory)
        setSectionCategoryOptions(nextOptions)
        setSectionCategoryOverlayPreferences(nextCategoryPreferences)
        sectionCategoryLastSavedRef.current = nextCategory
      } catch {
        if (cancelled) return
        setSectionCategoryDraft('')
        setSectionCategoryOptions([])
        setSectionCategoryOverlayPreferences(null)
        sectionCategoryLastSavedRef.current = ''
      } finally {
        if (!cancelled) {
          setIsSectionCategoryLoading(false)
        }
      }
    }

    void loadSectionCategory()

    return () => {
      cancelled = true
    }
  }, [handleUnauthorized, sectionId])

  useEffect(() => {
    const handler = (e: Event) => {
      const force = (e as CustomEvent<{ force?: boolean }>).detail?.force
      if (force || !checkTourDone('tour-reader-v2')) {
        setIsTourOpen(true)
      }
    }
    window.addEventListener('open-page-tour', handler)
    return () => window.removeEventListener('open-page-tour', handler)
  }, [])

  useEffect(() => {
    if (!isOverlayStateReady) return
    if (!sectionCategoryOverlayPreferences) return
    if (overlayStateLoadedFromServerRef.current) return
    if (overlayCategoryDefaultsAppliedRef.current) return

    const categorySnapshot: OcrOverlayStateSnapshot = {
      fontFamily: sectionCategoryOverlayPreferences.font_family,
      fontScale: sectionCategoryOverlayPreferences.font_scale,
      boxInsetPercent: sectionCategoryOverlayPreferences.box_inset_percent,
      density: sectionCategoryOverlayPreferences.density,
      overlayOpacity: sectionCategoryOverlayPreferences.overlay_opacity,
      globalShape: sectionCategoryOverlayPreferences.global_shape,
      overridesByImageId: ocrOverlayOverridesByImageId,
      manualItemsByImageId: ocrOverlayManualItemsByImageId,
      hiddenItemIdsByImageId: ocrOverlayHiddenItemIdsByImageId,
    }

    setOcrOverlayFontFamily(categorySnapshot.fontFamily)
    setOcrOverlayFontScale(categorySnapshot.fontScale)
    setOcrOverlayBoxInsetPercent(categorySnapshot.boxInsetPercent)
    setOcrOverlayDensity(categorySnapshot.density)
    setOcrOverlayOpacity(categorySnapshot.overlayOpacity)
    setOcrOverlayGlobalShape(categorySnapshot.globalShape)
    overlayStateLastSavedRef.current = JSON.stringify(buildOverlayStatePayload(categorySnapshot))
    overlayCategoryDefaultsAppliedRef.current = true
  }, [
    isOverlayStateReady,
    ocrOverlayHiddenItemIdsByImageId,
    ocrOverlayManualItemsByImageId,
    ocrOverlayOverridesByImageId,
    sectionCategoryOverlayPreferences,
  ])

  useEffect(() => {
    const abortController = new AbortController()

    fetch(`/api/sections/${sectionId}/suggestions?limit=10`, {
      cache: 'no-store',
      signal: abortController.signal,
    })
      .then((r) => r.json())
      .then((data: unknown) => {
        const root = (data && typeof data === 'object' ? data : null) as { data?: unknown } | null
        const list = Array.isArray(root?.data) ? (root.data as SectionListItem[]) : []
        setSuggestedSections(list)
      })
      .catch(() => {})

    return () => {
      abortController.abort()
    }
  }, [sectionId])

  useEffect(() => {
    if (readingMode) return
    setIsOverlaySelectionMode(false)
  }, [readingMode])

  const sectionImages = useMemo(() => {
    if (!section) return []
    return section.images.slice().sort((a, b) => a.order_index - b.order_index)
  }, [section])

  useEffect(() => {
    setSectionGridVisibleCount(SECTION_GRID_INITIAL_PAGES)
    setRevealedScrollImageIds(new Set())
  }, [sectionId])

  useEffect(() => {
    scrollImageObserverRef.current = new IntersectionObserver(
      (entries) => {
        const newIds: number[] = []
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const id = Number((entry.target as HTMLElement).dataset.scrollImageId)
            if (id) newIds.push(id)
            scrollImageObserverRef.current?.unobserve(entry.target)
          }
        })
        if (newIds.length > 0) {
          setRevealedScrollImageIds((prev) => {
            const next = new Set(prev)
            newIds.forEach((id) => next.add(id))
            return next
          })
        }
      },
      { rootMargin: '300px 0px' }
    )
    return () => {
      scrollImageObserverRef.current?.disconnect()
    }
  }, [])

  const pageEndSuggestions = useMemo(
    () => suggestedSections.filter((item) => item.id !== sectionId).slice(0, 10),
    [sectionId, suggestedSections]
  )

  useEffect(() => {
    const serverName = section?.name ?? ''
    setSectionNameDraft((current) => {
      const lastSynced = sectionNameSyncedRef.current
      sectionNameSyncedRef.current = serverName

      if (!current || current === lastSynced) {
        return serverName
      }

      return current
    })
  }, [section?.name])

  useEffect(() => {
    if (!isEditingSectionName) return

    const focusTimer = window.setTimeout(() => {
      sectionNameInputRef.current?.focus()
      sectionNameInputRef.current?.select()
    }, 0)

    return () => window.clearTimeout(focusTimer)
  }, [isEditingSectionName])

  useEffect(() => {
    if (sectionImages.length === 0) {
      setCurrentReadingPage(0)
      return
    }

    if (currentReadingPage > sectionImages.length - 1) {
      setCurrentReadingPage(sectionImages.length - 1)
    }
  }, [currentReadingPage, sectionImages])

  useEffect(() => {
    if (readingViewMode !== 'paginated') return
    if (!selectedOverlayTarget) return
    const imageOnCurrentPage = sectionImages[currentReadingPage] ?? null
    if (!imageOnCurrentPage || selectedOverlayTarget.imageId !== imageOnCurrentPage.id) {
      setSelectedOverlayTarget(null)
      setOverlayQuickEditorState(null)
      setOverlayDragEnabledTarget(null)
    }
  }, [currentReadingPage, readingViewMode, sectionImages, selectedOverlayTarget])

  useEffect(() => {
    if (readingViewMode !== 'paginated') return
    if (!overlayQuickEditorState) return
    const imageOnCurrentPage = sectionImages[currentReadingPage] ?? null
    if (!imageOnCurrentPage || overlayQuickEditorState.imageId !== imageOnCurrentPage.id) {
      setOverlayQuickEditorState(null)
      setOverlayDragEnabledTarget(null)
    }
  }, [currentReadingPage, overlayQuickEditorState, readingViewMode, sectionImages])

  useEffect(() => {
    if (!overlayQuickEditorState) {
      setOverlayQuickEditorPlacement((prev) => (prev ? null : prev))
      return
    }

    setOverlayQuickEditorPlacement((prev) => {
      if (
        prev
        && prev.imageId === overlayQuickEditorState.imageId
        && prev.itemId === overlayQuickEditorState.itemId
      ) {
        return prev
      }

      const nextPlacement = resolveQuickEditorPlacement(overlayQuickEditorState)
      return {
        imageId: overlayQuickEditorState.imageId,
        itemId: overlayQuickEditorState.itemId,
        side: nextPlacement.side,
        align: nextPlacement.align,
      }
    })
  }, [overlayQuickEditorState])

  useEffect(() => {
    if (!isOverlayStateReady) return

    const snapshot: OcrOverlayStateSnapshot = {
      fontFamily: ocrOverlayFontFamily,
      fontScale: ocrOverlayFontScale,
      boxInsetPercent: ocrOverlayBoxInsetPercent,
      density: ocrOverlayDensity,
      overlayOpacity: ocrOverlayOpacity,
      globalShape: ocrOverlayGlobalShape,
      overridesByImageId: ocrOverlayOverridesByImageId,
      manualItemsByImageId: ocrOverlayManualItemsByImageId,
      hiddenItemIdsByImageId: ocrOverlayHiddenItemIdsByImageId,
    }
    const payload = buildOverlayStatePayload(snapshot)
    const serializedPayload = JSON.stringify(payload)

    if (serializedPayload === overlayStateLastSavedRef.current) {
      return
    }

    if (overlayStateSaveDebounceRef.current !== null) {
      clearTimeout(overlayStateSaveDebounceRef.current)
    }

    overlayStateSaveDebounceRef.current = setTimeout(() => {
      overlayStateSaveDebounceRef.current = null
      const serializedToPersist = serializedPayload

      void (async () => {
        try {
          const response = await fetch(`/api/sections/${sectionId}/ocr-overlay-state`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ state: payload }),
          })

          if (response.status === 401) {
            handleUnauthorized()
            return
          }

          if (!response.ok) {
            return
          }

          overlayStateLastSavedRef.current = serializedToPersist
        } catch {
        }
      })()
    }, 700)

    return () => {
      if (overlayStateSaveDebounceRef.current !== null) {
        clearTimeout(overlayStateSaveDebounceRef.current)
      }
    }
  }, [
    handleUnauthorized,
    isOverlayStateReady,
    ocrOverlayBoxInsetPercent,
    ocrOverlayDensity,
    ocrOverlayFontFamily,
    ocrOverlayFontScale,
    ocrOverlayGlobalShape,
    ocrOverlayOpacity,
    ocrOverlayHiddenItemIdsByImageId,
    ocrOverlayManualItemsByImageId,
    ocrOverlayOverridesByImageId,
    sectionId,
  ])

  useEffect(() => {
    return () => {
      if (overlayStateSaveDebounceRef.current !== null) {
        clearTimeout(overlayStateSaveDebounceRef.current)
      }
    }
  }, [])

  useEffect(() => {
    try {
      const stored = localStorage.getItem(`${READ_PAGES_LS_PREFIX}${sectionId}`)
      if (stored) {
        const ids = JSON.parse(stored) as number[]
        setReadPages(new Set(ids))
      }
    } catch {
    }
  }, [sectionId])

  useEffect(() => {
    if (!readingMode || readingViewMode !== 'paginated' || sectionImages.length === 0) return
    const image = sectionImages[currentReadingPage]
    if (!image) return
    setReadPages((prev) => {
      if (prev.has(image.id)) return prev
      const next = new Set(prev)
      next.add(image.id)
      try {
        localStorage.setItem(`${READ_PAGES_LS_PREFIX}${sectionId}`, JSON.stringify([...next]))
      } catch {
      }
      return next
    })
  }, [currentReadingPage, readingMode, readingViewMode, sectionImages, sectionId])

  useEffect(() => {
    if (!readingMode || readingViewMode !== 'scroll' || sectionImages.length === 0) return
    if (typeof IntersectionObserver === 'undefined') return

    const zone = readingInteractionZoneRef.current
    if (!zone) return

    const pageNodes = Array.from(zone.querySelectorAll<HTMLElement>('[data-reader-page-id]'))
    if (pageNodes.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        const newlyVisibleIds: number[] = []

        for (const entry of entries) {
          if (!entry.isIntersecting || entry.intersectionRatio < 0.12) continue
          const rawId = entry.target.getAttribute('data-reader-page-id')
          const imageId = rawId ? Number.parseInt(rawId, 10) : NaN
          if (!Number.isFinite(imageId)) continue
          newlyVisibleIds.push(imageId)
        }

        if (newlyVisibleIds.length === 0) return

        setReadPages((prev) => {
          let changed = false
          const next = new Set(prev)

          for (const imageId of newlyVisibleIds) {
            if (next.has(imageId)) continue
            next.add(imageId)
            changed = true
          }

          if (!changed) return prev

          try {
            localStorage.setItem(`${READ_PAGES_LS_PREFIX}${sectionId}`, JSON.stringify([...next]))
          } catch {
          }

          return next
        })
      },
      {
        root: zone,
        threshold: [0.12, 0.2, 0.35],
      }
    )

    pageNodes.forEach((node) => observer.observe(node))

    return () => observer.disconnect()
  }, [readingMode, readingViewMode, sectionImages, sectionId])

  useEffect(() => {
    if (sectionImages.length === 0) return
    const ratio = readPages.size / sectionImages.length
    const isDone = ratio >= SECTION_READ_THRESHOLD

    try {
      if (isDone) {
        localStorage.setItem(`${SECTION_READ_LS_PREFIX}${sectionId}`, 'done')
      } else {
        localStorage.removeItem(`${SECTION_READ_LS_PREFIX}${sectionId}`)
      }
    } catch {
    }

    if (typeof window !== 'undefined') {
      try {
        window.dispatchEvent(
          new CustomEvent('section-read-progress-updated', {
            detail: { sectionId, done: isDone },
          })
        )
      } catch {
      }
    }

    if (readProgressLastSyncedDoneRef.current === isDone) {
      return
    }

    readProgressLastSyncedDoneRef.current = isDone
    void fetch(`/api/sections/${sectionId}/read-progress`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ done: isDone }),
    }).catch(() => {
      readProgressLastSyncedDoneRef.current = null
    })
  }, [readPages, sectionImages, sectionId])

  const currentPage = sectionImages[currentReadingPage] ?? null
  const readingTranslatedAvailable = currentPage ? isImageTranslated(currentPage) : false
  const readingDisplayUrl = currentPage
    ? (
      readingTranslatedAvailable
        ? buildImageViewUrl(section!.id, currentPage.id, 'translated')
        : buildImageViewUrl(section!.id, currentPage.id, 'original')
    )
    : ''
  const shouldUseCurrentPageOcrOverlay = Boolean(
    currentPage
      && !readingTranslatedAvailable
  )
  const ocrOverlayQueuedImageIds = useMemo(
    () => new Set(ocrOverlayTranslateQueue),
    [ocrOverlayTranslateQueue]
  )
  const currentPageOverlayItems = useMemo(
    () => currentPage
      ? filterOverlayItemsByHiddenIds(
        mergeOverlayItems(
          mergeOverlayItems(
            toOverlaySeedItems(currentPage),
            ocrOverlayByImageId[currentPage.id] ?? []
          ),
          ocrOverlayManualItemsByImageId[currentPage.id] ?? []
        ),
        ocrOverlayHiddenItemIdsByImageId[currentPage.id] ?? []
      )
      : [],
    [
      currentPage,
      ocrOverlayByImageId,
      ocrOverlayHiddenItemIdsByImageId,
      ocrOverlayManualItemsByImageId,
    ]
  )
  const currentPageOverlayLoading = currentPage
    ? Boolean(
      ocrOverlayLoadingByImageId[currentPage.id]
      || ocrOverlayCreatingSelectionByImageId[currentPage.id]
      || ocrOverlayQueuedImageIds.has(currentPage.id)
    )
    : false
  const overlayFontFamilyCss = OCR_OVERLAY_FONT_FAMILIES[ocrOverlayFontFamily].css
  const overlayDensityLabel = `${Math.round(ocrOverlayDensity * 100)}%`
  const overlayOpacityLabel = `${Math.round(ocrOverlayOpacity * 100)}%`
  const overlayFontPercentLabel = toRelativePercent(ocrOverlayFontScale, OCR_OVERLAY_DEFAULT_FONT_SCALE)
  const overlaySelectionEnabled = isOverlaySelectionMode && !overlaySelectionDraft
  const currentPageOverlayOverrides = currentPage ? (ocrOverlayOverridesByImageId[currentPage.id] ?? {}) : {}
  const currentPageOverlayColors = currentPage ? (ocrOverlayColorsByImageId[currentPage.id] ?? {}) : {}
  const overlaySelectionDraftForCurrentPage = (
    overlaySelectionDraft
    && currentPage
    && overlaySelectionDraft.imageId === currentPage.id
  )
    ? overlaySelectionDraft
    : null
  const selectedOverlayOnCurrentPage = (
    selectedOverlayTarget && currentPage && selectedOverlayTarget.imageId === currentPage.id
  )
    ? selectedOverlayTarget
    : null
  const selectedOverlayOverrides = selectedOverlayTarget
    ? (ocrOverlayOverridesByImageId[selectedOverlayTarget.imageId] ?? {})
    : {}
  const selectedOverlayShape: OcrOverlayShape = selectedOverlayTarget
    ? (selectedOverlayOverrides[selectedOverlayTarget.itemId]?.shape ?? ocrOverlayGlobalShape)
    : ocrOverlayGlobalShape
  const selectedOverlayItemFontScale = selectedOverlayTarget
    ? clampRange(
      selectedOverlayOverrides[selectedOverlayTarget.itemId]?.fontScale ?? OCR_OVERLAY_ITEM_FONT_SCALE_DEFAULT,
      OCR_OVERLAY_ITEM_FONT_SCALE_MIN,
      OCR_OVERLAY_ITEM_FONT_SCALE_MAX
    )
    : OCR_OVERLAY_ITEM_FONT_SCALE_DEFAULT
  const selectedOverlayItemFontLabel = `${Math.round(selectedOverlayItemFontScale * 100)}%`
  const selectedOverlayItemSizeScale = selectedOverlayTarget
    ? clampRange(
      selectedOverlayOverrides[selectedOverlayTarget.itemId]?.sizeScale ?? OCR_OVERLAY_ITEM_SIZE_DEFAULT,
      OCR_OVERLAY_ITEM_SIZE_MIN,
      OCR_OVERLAY_ITEM_SIZE_MAX
    )
    : OCR_OVERLAY_ITEM_SIZE_DEFAULT
  const selectedOverlayItemSizeLabel = `${Math.round(selectedOverlayItemSizeScale * 100)}%`
  const selectedOverlayItemDensity = selectedOverlayTarget
    ? clampRange(
      selectedOverlayOverrides[selectedOverlayTarget.itemId]?.density ?? OCR_OVERLAY_ITEM_DENSITY_DEFAULT,
      OCR_OVERLAY_ITEM_DENSITY_MIN,
      OCR_OVERLAY_ITEM_DENSITY_MAX
    )
    : OCR_OVERLAY_ITEM_DENSITY_DEFAULT
  const selectedOverlayItemDensityLabel = `${Math.round(selectedOverlayItemDensity * 100)}%`
  const selectedOverlayDragEnabled = Boolean(
    selectedOverlayTarget
    && overlayDragEnabledTarget
    && selectedOverlayTarget.imageId === overlayDragEnabledTarget.imageId
    && selectedOverlayTarget.itemId === overlayDragEnabledTarget.itemId
  )
  const overlayQuickEditorForCurrentPage = (
    overlayQuickEditorState
    && currentPage
    && overlayQuickEditorState.imageId === currentPage.id
  )
    ? overlayQuickEditorState
    : null
  const quickEditorPlacementForCurrentPage = (
    overlayQuickEditorForCurrentPage
    && overlayQuickEditorPlacement
    && overlayQuickEditorPlacement.imageId === overlayQuickEditorForCurrentPage.imageId
    && overlayQuickEditorPlacement.itemId === overlayQuickEditorForCurrentPage.itemId
  )
    ? {
      side: overlayQuickEditorPlacement.side,
      align: overlayQuickEditorPlacement.align,
    }
    : resolveQuickEditorPlacement(overlayQuickEditorForCurrentPage)

  const resolveImageOverlayReferenceSize = useCallback((image: SectionImage | null): ImageNaturalSize | null => {
    if (!image) return null

    const measured = imageNaturalSizeById[image.id]
    if (measured && measured.width > 0 && measured.height > 0) {
      return measured
    }

    const rawWidth = toFiniteNumber(image.translated_width)
    const rawHeight = toFiniteNumber(image.translated_height)
    if (rawWidth !== null && rawHeight !== null && rawWidth > 0 && rawHeight > 0) {
      return { width: rawWidth, height: rawHeight }
    }

    return null
  }, [imageNaturalSizeById])

  const currentPageOverlayReferenceSize = resolveImageOverlayReferenceSize(currentPage)

  const queueState = useMemo(() => {
    if (!section) return null
    return getSectionQueueState(section, section)
  }, [section])
  const hasAnyFailedTranslation = useMemo(() => {
    return sectionImages.some((image) => {
      const translationStatus = normalizeStatus(image.translation_status)

      return (
        FAILED_TRANSLATION_STATUSES.has(translationStatus)
        || Boolean(image.translation_error)
      )
    })
  }, [sectionImages])
  const isRecentlyCreatedSection = useMemo(() => {
    if (!section?.created_at) return false
    const createdAtMs = new Date(section.created_at).getTime()
    if (!Number.isFinite(createdAtMs)) return false
    return Date.now() - createdAtMs <= 5 * 60 * 1000
  }, [section])
  const isSectionLoadingImagesInBackground = Boolean(
    section
    && sectionImages.length === 0
    && (queueState?.inQueueOrProcessing || isRecentlyCreatedSection)
  )
  const shouldPollSectionStatus = Boolean(
    queueState?.inQueueOrProcessing
    || isSectionLoadingImagesInBackground
  )
  const canShowReprocessButton = Boolean(
    !isAutoProcessingEnabled
    && section
    && !queueState?.inQueueOrProcessing
    && hasAnyFailedTranslation
  )
  const canShowProcessButton = Boolean(
    !isAutoProcessingEnabled
    && section
    && queueState?.canQueue
  )
  const latestJobSnapshot = useMemo(() => {
    if (!section?.jobs || section.jobs.length === 0) return null

    return section.jobs.reduce((latest, current) => {
      if (!latest) return current
      const latestId = toFiniteNumber(latest.id)
      const currentId = toFiniteNumber(current.id)
      if (currentId !== null && (latestId === null || currentId > latestId)) {
        return current
      }
      return latest
    }, section.jobs[0] ?? null)
  }, [section])
  const queueSnapshot = section?.queue ?? null
  const latestJobQueueSnapshot = latestJobSnapshot?.queue ?? null
  const hasLiveQueueSnapshot = queueSnapshot !== null
  const queueActiveJobId = hasLiveQueueSnapshot
    ? toFiniteNumber(queueSnapshot?.active_job_id)
    : toFiniteNumber(latestJobSnapshot?.id)
  const queueActiveJobStatus = hasLiveQueueSnapshot
    ? toStringValue(queueSnapshot?.active_job_status)
    : toStringValue(latestJobSnapshot?.status)
  const queuePosition = hasLiveQueueSnapshot
    ? toFiniteNumber(queueSnapshot?.queue_position)
    : toFiniteNumber(latestJobQueueSnapshot?.queue_position)
  const queueJobsAhead = hasLiveQueueSnapshot
    ? toFiniteNumber(queueSnapshot?.jobs_ahead)
    : firstDefined(toFiniteNumber(latestJobQueueSnapshot?.jobs_ahead), 0)
  const queueEstimatedWaitMinutes = hasLiveQueueSnapshot
    ? toFiniteNumber(queueSnapshot?.estimated_wait_minutes)
    : firstDefined(toFiniteNumber(latestJobQueueSnapshot?.estimated_wait_minutes), 0)
  const queueEstimatedStartRaw = hasLiveQueueSnapshot
    ? toStringValue(queueSnapshot?.estimated_start_at)
    : firstDefined(
      toStringValue(latestJobQueueSnapshot?.estimated_start_at),
      toStringValue(latestJobSnapshot?.estimated_start_at)
    )
  const queueEstimatedStartLabel = queueEstimatedStartRaw
    ? formatSectionDate(queueEstimatedStartRaw)
    : '—'
  const queueStatusLabel = queueActiveJobStatus
    ? formatStatus(queueActiveJobStatus)
    : 'Sem job ativo'
  const hasQueueImageCounters = derivedProcessingCount > 0 || derivedQueuedCount > 0
  const hasQueueRuntimeSignals = Boolean(
    hasQueueImageCounters
    || queueActiveJobId !== null
    || queuePosition !== null
    || (queueJobsAhead ?? 0) > 0
  )
  const shouldShowQueueInProgressBadge = Boolean(
    queueState?.inQueueOrProcessing
    && hasQueueRuntimeSignals
  )
  const trimmedSectionNameDraft = sectionNameDraft.trim()
  const hasPendingSectionNameChange = Boolean(
    section && trimmedSectionNameDraft.length > 0 && trimmedSectionNameDraft !== section.name
  )

  const handleSelectOverlayItem = useCallback((imageId: number, itemId: number) => {
    setSelectedOverlayTarget({ imageId, itemId })
    setOverlayQuickEditorState(null)
    setOverlayQuickEditorPlacement(null)
    setOverlayDragEnabledTarget(null)
  }, [])

  const handleClearOverlaySelection = useCallback(() => {
    setSelectedOverlayTarget(null)
    setOverlayQuickEditorState(null)
    setOverlayQuickEditorPlacement(null)
    setOverlayDragEnabledTarget(null)
  }, [])

  const handleDeleteSelectedOverlayItem = useCallback(() => {
    if (!selectedOverlayTarget) return
    const { imageId, itemId } = selectedOverlayTarget

    setOcrOverlayManualItemsByImageId((prev) => {
      const imageItems = prev[imageId] ?? []
      const nextImageItems = removeOverlayItem(imageItems, itemId)
      if (nextImageItems.length === imageItems.length) return prev

      const next = { ...prev }
      if (nextImageItems.length === 0) {
        delete next[imageId]
      } else {
        next[imageId] = nextImageItems
      }
      return next
    })

    setOcrOverlayByImageId((prev) => {
      const imageItems = prev[imageId] ?? []
      const nextImageItems = removeOverlayItem(imageItems, itemId)
      if (nextImageItems.length === imageItems.length) return prev

      const next = { ...prev }
      next[imageId] = nextImageItems
      return next
    })

    setOcrOverlayOverridesByImageId((prev) => {
      const imageOverrides = prev[imageId]
      if (!imageOverrides || !Object.prototype.hasOwnProperty.call(imageOverrides, itemId)) return prev

      const nextImageOverrides = { ...imageOverrides }
      delete nextImageOverrides[itemId]

      const next = { ...prev }
      if (Object.keys(nextImageOverrides).length === 0) {
        delete next[imageId]
      } else {
        next[imageId] = nextImageOverrides
      }
      return next
    })

    setOcrOverlayColorsByImageId((prev) => {
      const imageColors = prev[imageId]
      if (!imageColors || !Object.prototype.hasOwnProperty.call(imageColors, itemId)) return prev

      const nextImageColors = { ...imageColors }
      delete nextImageColors[itemId]

      const next = { ...prev }
      if (Object.keys(nextImageColors).length === 0) {
        delete next[imageId]
      } else {
        next[imageId] = nextImageColors
      }
      return next
    })

    setOcrOverlayHiddenItemIdsByImageId((prev) => {
      const imageHiddenIds = prev[imageId] ?? []
      if (imageHiddenIds.includes(itemId)) return prev

      return {
        ...prev,
        [imageId]: [...imageHiddenIds, itemId].sort((a, b) => a - b),
      }
    })

    setSelectedOverlayTarget(null)
    setOverlayQuickEditorState(null)
    setOverlayDragEnabledTarget(null)
  }, [selectedOverlayTarget])

  useEffect(() => {
    if (!selectedOverlayTarget && !overlayQuickEditorState) return

    const selectedOverlayItemKey = selectedOverlayTarget
      ? `${selectedOverlayTarget.imageId}:${selectedOverlayTarget.itemId}`
      : null

    const handleDocumentPointerDown = (event: PointerEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null
      if (!target) return
      if (target.closest('[data-ocr-overlay-quick-editor="true"]')) return
      if (selectedOverlayItemKey && target.closest(`[data-ocr-overlay-item-key="${selectedOverlayItemKey}"]`)) return
      handleClearOverlaySelection()
    }

    document.addEventListener('pointerdown', handleDocumentPointerDown, true)
    return () => {
      document.removeEventListener('pointerdown', handleDocumentPointerDown, true)
    }
  }, [handleClearOverlaySelection, overlayQuickEditorState, selectedOverlayTarget])

  const handleMoveOverlayItem = useCallback((imageId: number, itemId: number, dx: number, dy: number) => {
    setOcrOverlayOverridesByImageId((prev) => {
      const imageOverrides = prev[imageId] ?? {}
      return {
        ...prev,
        [imageId]: {
          ...imageOverrides,
          [itemId]: {
            ...imageOverrides[itemId],
            dx,
            dy,
          },
        },
      }
    })
  }, [])

  const handleResizeOverlayItem = useCallback((
    imageId: number,
    itemId: number,
    payload: { dx: number; dy: number; widthScale: number; heightScale: number }
  ) => {
    setOcrOverlayOverridesByImageId((prev) => {
      const imageOverrides = prev[imageId] ?? {}
      return {
        ...prev,
        [imageId]: {
          ...imageOverrides,
          [itemId]: {
            ...imageOverrides[itemId],
            dx: clampRange(payload.dx, -5000, 5000),
            dy: clampRange(payload.dy, -5000, 5000),
            widthScale: clampRange(payload.widthScale, OCR_OVERLAY_ITEM_AXIS_SCALE_MIN, OCR_OVERLAY_ITEM_AXIS_SCALE_MAX),
            heightScale: clampRange(payload.heightScale, OCR_OVERLAY_ITEM_AXIS_SCALE_MIN, OCR_OVERLAY_ITEM_AXIS_SCALE_MAX),
          },
        },
      }
    })
  }, [])

  const handleSetSelectedOverlayShape = useCallback((shape: OcrOverlayShape) => {
    if (!selectedOverlayTarget) return
    const { imageId, itemId } = selectedOverlayTarget

    setOcrOverlayOverridesByImageId((prev) => {
      const imageOverrides = prev[imageId] ?? {}
      return {
        ...prev,
        [imageId]: {
          ...imageOverrides,
          [itemId]: {
            ...imageOverrides[itemId],
            shape,
          },
        },
      }
    })
  }, [selectedOverlayTarget])

  const handleAdjustSelectedOverlayItemFont = useCallback((delta: number) => {
    if (!selectedOverlayTarget) return
    const { imageId, itemId } = selectedOverlayTarget

    setOcrOverlayOverridesByImageId((prev) => {
      const imageOverrides = prev[imageId] ?? {}
      const currentScale = clampRange(
        imageOverrides[itemId]?.fontScale ?? OCR_OVERLAY_ITEM_FONT_SCALE_DEFAULT,
        OCR_OVERLAY_ITEM_FONT_SCALE_MIN,
        OCR_OVERLAY_ITEM_FONT_SCALE_MAX
      )
      const nextScale = clampRange(
        currentScale + delta,
        OCR_OVERLAY_ITEM_FONT_SCALE_MIN,
        OCR_OVERLAY_ITEM_FONT_SCALE_MAX
      )

      return {
        ...prev,
        [imageId]: {
          ...imageOverrides,
          [itemId]: {
            ...imageOverrides[itemId],
            fontScale: nextScale,
          },
        },
      }
    })
  }, [selectedOverlayTarget])

  const handleResetSelectedOverlayItemAdjustments = useCallback(() => {
    if (!selectedOverlayTarget) return
    const { imageId, itemId } = selectedOverlayTarget

    setOcrOverlayOverridesByImageId((prev) => {
      const imageOverrides = prev[imageId] ?? {}
      return {
        ...prev,
        [imageId]: {
          ...imageOverrides,
          [itemId]: {
            ...imageOverrides[itemId],
            fontScale: OCR_OVERLAY_ITEM_FONT_SCALE_DEFAULT,
            sizeScale: OCR_OVERLAY_ITEM_SIZE_DEFAULT,
            widthScale: OCR_OVERLAY_ITEM_AXIS_SCALE_DEFAULT,
            heightScale: OCR_OVERLAY_ITEM_AXIS_SCALE_DEFAULT,
            density: OCR_OVERLAY_ITEM_DENSITY_DEFAULT,
          },
        },
      }
    })
  }, [selectedOverlayTarget])

  const handleAdjustSelectedOverlayItemSize = useCallback((delta: number) => {
    if (!selectedOverlayTarget) return
    const { imageId, itemId } = selectedOverlayTarget

    setOcrOverlayOverridesByImageId((prev) => {
      const imageOverrides = prev[imageId] ?? {}
      const currentScale = clampRange(
        imageOverrides[itemId]?.sizeScale ?? OCR_OVERLAY_ITEM_SIZE_DEFAULT,
        OCR_OVERLAY_ITEM_SIZE_MIN,
        OCR_OVERLAY_ITEM_SIZE_MAX
      )
      const nextScale = clampRange(
        currentScale + delta,
        OCR_OVERLAY_ITEM_SIZE_MIN,
        OCR_OVERLAY_ITEM_SIZE_MAX
      )

      return {
        ...prev,
        [imageId]: {
          ...imageOverrides,
          [itemId]: {
            ...imageOverrides[itemId],
            sizeScale: nextScale,
          },
        },
      }
    })
  }, [selectedOverlayTarget])

  const handleAdjustSelectedOverlayItemDensity = useCallback((delta: number) => {
    if (!selectedOverlayTarget) return
    const { imageId, itemId } = selectedOverlayTarget

    setOcrOverlayOverridesByImageId((prev) => {
      const imageOverrides = prev[imageId] ?? {}
      const currentDensity = clampRange(
        imageOverrides[itemId]?.density ?? OCR_OVERLAY_ITEM_DENSITY_DEFAULT,
        OCR_OVERLAY_ITEM_DENSITY_MIN,
        OCR_OVERLAY_ITEM_DENSITY_MAX
      )
      const nextDensity = clampRange(
        currentDensity + delta,
        OCR_OVERLAY_ITEM_DENSITY_MIN,
        OCR_OVERLAY_ITEM_DENSITY_MAX
      )

      return {
        ...prev,
        [imageId]: {
          ...imageOverrides,
          [itemId]: {
            ...imageOverrides[itemId],
            density: nextDensity,
          },
        },
      }
    })
  }, [selectedOverlayTarget])

  const handleToggleSelectedOverlayDrag = useCallback(() => {
    if (!selectedOverlayTarget) return

    setOverlayDragEnabledTarget((prev) => {
      if (
        prev
        && prev.imageId === selectedOverlayTarget.imageId
        && prev.itemId === selectedOverlayTarget.itemId
      ) {
        return null
      }

      return {
        imageId: selectedOverlayTarget.imageId,
        itemId: selectedOverlayTarget.itemId,
      }
    })
  }, [selectedOverlayTarget])

  const handleOpenOverlayQuickEditor = useCallback((payload: {
    imageId: number
    itemId: number
    leftPercent: number
    topPercent: number
  }) => {
    const nextPlacement = resolveQuickEditorPlacement(payload)
    setSelectedOverlayTarget({ imageId: payload.imageId, itemId: payload.itemId })
    setOverlayQuickEditorPlacement({
      imageId: payload.imageId,
      itemId: payload.itemId,
      side: nextPlacement.side,
      align: nextPlacement.align,
    })
    setOverlayDragEnabledTarget(null)
    setOverlayQuickEditorState(payload)
  }, [])

  const handleStartOverlayQuickEditorDrag = useCallback((
    imageId: number,
    event: React.PointerEvent<HTMLDivElement>
  ) => {
    const startState = overlayQuickEditorState
    if (!startState || startState.imageId !== imageId) return

    const host = document.querySelector(`[data-ocr-overlay-host="${imageId}"]`) as HTMLElement | null
    if (!host) return
    const hostRect = host.getBoundingClientRect()
    if (hostRect.width <= 0 || hostRect.height <= 0) return

    event.preventDefault()
    event.stopPropagation()

    const pointerTarget = event.currentTarget
    try {
      pointerTarget.setPointerCapture(event.pointerId)
    } catch {
    }

    const pointerId = event.pointerId
    let lastClientX = event.clientX
    let lastClientY = event.clientY

    const handlePointerMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return
      moveEvent.preventDefault()

      const deltaXPercent = ((moveEvent.clientX - lastClientX) / hostRect.width) * 100
      const deltaYPercent = ((moveEvent.clientY - lastClientY) / hostRect.height) * 100

      setOverlayQuickEditorState((prev) => {
        if (!prev || prev.imageId !== imageId) return prev
        return {
          ...prev,
          leftPercent: clampPercent(prev.leftPercent + deltaXPercent),
          topPercent: clampPercent(prev.topPercent + deltaYPercent),
        }
      })

      lastClientX = moveEvent.clientX
      lastClientY = moveEvent.clientY
    }

    const clearListeners = () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', clearListeners)
      window.removeEventListener('pointercancel', clearListeners)
      try {
        pointerTarget.releasePointerCapture(pointerId)
      } catch {
      }
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', clearListeners)
    window.addEventListener('pointercancel', clearListeners)
  }, [overlayQuickEditorState])

  const handleOverlaySelectionDraftReady = useCallback((payload: {
    imageId: number
    box: [number, number, number, number]
    leftPercent: number
    topPercent: number
  }) => {
    const image = sectionImages.find((entry) => entry.id === payload.imageId)
    const nextSourceLang = normalizeOverlaySelectionLanguage(
      image?.source_lang?.trim() || section?.source_lang || OCR_OVERLAY_SELECTION_SOURCE_DEFAULT,
      OCR_OVERLAY_SELECTION_SOURCE_DEFAULT,
      OCR_OVERLAY_SELECTION_LANGUAGES
    )
    const nextTargetLang = normalizeOverlaySelectionLanguage(
      image?.target_lang?.trim() || section?.target_lang || OCR_OVERLAY_SELECTION_TARGET_DEFAULT,
      OCR_OVERLAY_SELECTION_TARGET_DEFAULT,
      OCR_OVERLAY_SELECTION_TARGET_LANGUAGES
    )

    setOverlaySelectionSourceLang(nextSourceLang)
    setOverlaySelectionTargetLang(nextTargetLang)
    setSelectedOverlayTarget(null)
    setOverlayQuickEditorState(null)
    setOverlayDragEnabledTarget(null)
    setOverlaySelectionDraft(payload)
  }, [section, sectionImages])

  const handleOverlaySelectionDraftChange = useCallback((payload: {
    imageId: number
    box: [number, number, number, number]
    leftPercent: number
    topPercent: number
  }) => {
    setOverlaySelectionDraft((prev) => {
      if (!prev || prev.imageId !== payload.imageId) return prev
      return {
        ...prev,
        box: payload.box,
        leftPercent: payload.leftPercent,
        topPercent: payload.topPercent,
      }
    })
  }, [])

  const handleCreateOverlaySelectionBox = useCallback(async (
    payload: {
      imageId: number
      box: [number, number, number, number]
      sourceLang?: string
      targetLang?: string
    }
  ) => {
    if (!section) return

    const image = sectionImages.find((entry) => entry.id === payload.imageId)
    if (!image) return
    if (isImageTranslated(image)) return

    const referenceSize = resolveImageOverlayReferenceSize(image)
    if (!referenceSize) {
      toast.error('Não foi possível preparar a área para OCR.')
      return
    }

    const existingItemIds = [
      ...toOverlaySeedItems(image).map((item) => item.id),
      ...(ocrOverlayByImageId[image.id] ?? []).map((item) => item.id),
      ...(ocrOverlayManualItemsByImageId[image.id] ?? []).map((item) => item.id),
      ...(ocrOverlayHiddenItemIdsByImageId[image.id] ?? []),
    ]
    const nextManualItemId = existingItemIds.reduce(
      (maxValue, currentValue) => Math.max(maxValue, currentValue),
      0
    ) + 1

    const pendingItem: OcrOverlayItem = {
      id: nextManualItemId,
      box: payload.box,
      ocrText: 'OCR...',
      translatedText: 'OCR...',
    }

    setSelectedOverlayTarget({ imageId: image.id, itemId: nextManualItemId })
    setOverlayQuickEditorState(null)
    setOverlayDragEnabledTarget(null)
    setOcrOverlayHiddenItemIdsByImageId((prev) => {
      const imageHiddenIds = prev[image.id] ?? []
      if (!imageHiddenIds.includes(nextManualItemId)) return prev

      const nextImageHiddenIds = imageHiddenIds.filter((itemId) => itemId !== nextManualItemId)
      const next = { ...prev }
      if (nextImageHiddenIds.length === 0) {
        delete next[image.id]
      } else {
        next[image.id] = nextImageHiddenIds
      }
      return next
    })
    setOcrOverlayCreatingSelectionByImageId((prev) => ({ ...prev, [image.id]: true }))
    setOcrOverlayManualItemsByImageId((prev) => {
      const imageItems = prev[image.id] ?? []
      return {
        ...prev,
        [image.id]: upsertOverlayItem(imageItems, pendingItem),
      }
    })
    setOcrOverlayByImageId((prev) => {
      const hiddenIds = ocrOverlayHiddenItemIdsByImageId[image.id] ?? []
      const imageItems = prev[image.id] ?? filterOverlayItemsByHiddenIds(toOverlaySeedItems(image), hiddenIds)
      return {
        ...prev,
        [image.id]: upsertOverlayItem(imageItems, pendingItem),
      }
    })

    try {
      const sourceImageUrl = buildImageViewUrl(section.id, image.id, 'original')
      const croppedBlob = await cropImageAreaToBlob(sourceImageUrl, referenceSize, payload.box)
      const ocrFile = new File(
        [croppedBlob],
        `section-${section.id}-image-${image.id}-overlay-${nextManualItemId}.png`,
        { type: 'image/png' }
      )

      const ocrFormData = new FormData()
      ocrFormData.append('file', ocrFile)

      const ocrQueueResponse = await fetch('/api/ocr-image/queue', {
        method: 'POST',
        body: ocrFormData,
      })
      const ocrQueueData = (await ocrQueueResponse.json()) as OcrImageQueueResponse

      if (ocrQueueResponse.status === 401) {
        handleUnauthorized()
        throw new Error('Sessão expirada. Faça login novamente.')
      }
      if (!ocrQueueResponse.ok) {
        throw new Error(toErrorMessage(ocrQueueData, 'Falha ao enfileirar OCR da área selecionada.'))
      }

      const queueRedisPayload = asObjectRecord(ocrQueueData.redis) ?? {}
      const jobKey = toStringValue(ocrQueueData.job_id)
        ?? toStringValue(queueRedisPayload.job_key)
        ?? toStringValue((ocrQueueData as Record<string, unknown>).job_key)
      const queueKey = toStringValue(queueRedisPayload.queue_key)
        ?? toStringValue((ocrQueueData as Record<string, unknown>).queue_key)
      if (!jobKey) {
        throw new Error('A fila OCR não retornou job_key para polling.')
      }

      const pollStartedAt = Date.now()
      let finalJobPayload: Record<string, unknown> | null = null
      while (Date.now() - pollStartedAt <= OCR_QUEUE_POLL_TIMEOUT_MS) {
        const params = new URLSearchParams()
        params.set('job_key', jobKey)
        if (queueKey) {
          params.set('queue_key', queueKey)
        }

        const pollResponse = await fetch(`/api/ocr-image/job?${params.toString()}`, {
          cache: 'no-store',
        })
        const pollData = (await pollResponse.json()) as OcrImageJobPollResponse

        if (pollResponse.status === 401) {
          handleUnauthorized()
          throw new Error('Sessão expirada. Faça login novamente.')
        }

        if (pollResponse.ok) {
          const normalizedStatus = normalizeStatus(toStringValue(pollData.status))
          const jobPayload = asObjectRecord(pollData.job)

          if (normalizedStatus === 'done') {
            finalJobPayload = jobPayload
            break
          }

          if (normalizedStatus === 'failed' || normalizedStatus === 'timeout') {
            const errorMessage = toStringValue(jobPayload?.error_message)
              || toStringValue(pollData.message)
              || 'Falha no processamento OCR da área selecionada.'
            throw new Error(errorMessage)
          }
        }

        await new Promise((resolve) => window.setTimeout(resolve, OCR_QUEUE_POLL_INTERVAL_MS))
      }

      if (!finalJobPayload) {
        throw new Error('Timeout aguardando OCR da área selecionada na fila.')
      }

      const extractedText = toStringValue(finalJobPayload.extracted_text) ?? ''
      const baseText = extractedText || '[sem texto detectado]'

      let translatedText = baseText
      const sourceLang = normalizeOverlaySelectionLanguage(
        payload.sourceLang ?? image.source_lang?.trim() ?? section.source_lang ?? OCR_OVERLAY_SELECTION_SOURCE_DEFAULT,
        OCR_OVERLAY_SELECTION_SOURCE_DEFAULT,
        OCR_OVERLAY_SELECTION_LANGUAGES
      )
      const targetLang = normalizeOverlaySelectionLanguage(
        payload.targetLang ?? image.target_lang?.trim() ?? section.target_lang ?? OCR_OVERLAY_SELECTION_TARGET_DEFAULT,
        OCR_OVERLAY_SELECTION_TARGET_DEFAULT,
        OCR_OVERLAY_SELECTION_TARGET_LANGUAGES
      )
      const providerLang = resolveOcrOverlayProvider(section.provider_lang)
      const translateEndpoint = '/api/translate/text-batch'

      const translateResponse = await fetch(translateEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          source_lang: sourceLang,
          target_lang: targetLang,
          provider_lang: providerLang,
          texts: [baseText],
        }),
      })
      const translateData = (await translateResponse.json()) as OcrBatchTranslateResponse

      if (translateResponse.status === 401) {
        handleUnauthorized()
        throw new Error('Sessão expirada. Faça login novamente.')
      }
      if (!translateResponse.ok) {
        throw new Error(toErrorMessage(translateData, 'Falha ao traduzir o texto OCR da área selecionada.'))
      }

      const translatedItems = Array.isArray(translateData.translations)
        ? translateData.translations
          .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
          .filter(Boolean)
        : []
      if (translatedItems[0]) {
        translatedText = translatedItems[0]
      }

      const finalizedItem: OcrOverlayItem = {
        id: nextManualItemId,
        box: payload.box,
        ocrText: baseText,
        translatedText,
      }

      setOcrOverlayManualItemsByImageId((prev) => {
        const imageItems = prev[image.id] ?? []
        return {
          ...prev,
          [image.id]: upsertOverlayItem(imageItems, finalizedItem),
        }
      })
      setOcrOverlayByImageId((prev) => {
        const hiddenIds = ocrOverlayHiddenItemIdsByImageId[image.id] ?? []
        const imageItems = prev[image.id] ?? filterOverlayItemsByHiddenIds(toOverlaySeedItems(image), hiddenIds)
        return {
          ...prev,
          [image.id]: upsertOverlayItem(imageItems, finalizedItem),
        }
      })
    } catch (err) {
      setOcrOverlayManualItemsByImageId((prev) => {
        const imageItems = prev[image.id] ?? []
        const nextImageItems = removeOverlayItem(imageItems, nextManualItemId)
        if (nextImageItems.length === imageItems.length) return prev

        const next = { ...prev }
        if (nextImageItems.length === 0) {
          delete next[image.id]
        } else {
          next[image.id] = nextImageItems
        }
        return next
      })

      setOcrOverlayByImageId((prev) => {
        const imageItems = prev[image.id] ?? []
        const nextImageItems = removeOverlayItem(imageItems, nextManualItemId)
        if (nextImageItems.length === imageItems.length) return prev

        const next = { ...prev }
        next[image.id] = nextImageItems
        return next
      })

      const message = err instanceof Error ? err.message : 'Falha ao criar balão manual.'
      toast.error(message)
    } finally {
      setOcrOverlayCreatingSelectionByImageId((prev) => ({ ...prev, [image.id]: false }))
    }
  }, [
    handleUnauthorized,
    ocrOverlayByImageId,
    ocrOverlayHiddenItemIdsByImageId,
    ocrOverlayManualItemsByImageId,
    resolveImageOverlayReferenceSize,
    section,
    sectionImages,
  ])

  const handleConfirmOverlaySelectionDraft = useCallback(() => {
    if (!overlaySelectionDraft) {
      setIsOverlaySelectionMode(false)
      return
    }

    const payload = {
      imageId: overlaySelectionDraft.imageId,
      box: overlaySelectionDraft.box,
      sourceLang: overlaySelectionSourceLang,
      targetLang: overlaySelectionTargetLang,
    }

    setOverlaySelectionDraft(null)
    setIsOverlaySelectionMode(false)
    void handleCreateOverlaySelectionBox(payload)
  }, [
    handleCreateOverlaySelectionBox,
    overlaySelectionDraft,
    overlaySelectionSourceLang,
    overlaySelectionTargetLang,
  ])

  const handleDiscardOverlaySelectionDraft = useCallback(() => {
    setOverlaySelectionDraft(null)
    setIsOverlaySelectionMode(false)
  }, [])

  const canTranslateOverlayForImage = useCallback((image: SectionImage) => {
    if (isImageTranslated(image)) return false

    const hiddenIds = ocrOverlayHiddenItemIdsByImageId[image.id] ?? []
    const baseItems = filterOverlayItemsByHiddenIds(
      mergeOverlayItems(
        mergeOverlayItems(
          toOverlaySeedItems(image),
          ocrOverlayByImageId[image.id] ?? []
        ),
        ocrOverlayManualItemsByImageId[image.id] ?? []
      ),
      hiddenIds
    )

    if (baseItems.length === 0) return false
    if (!baseItems.some((item) => !item.translatedText)) return false
    if (ocrOverlayLoadingByImageId[image.id]) return false

    return true
  }, [
    ocrOverlayByImageId,
    ocrOverlayHiddenItemIdsByImageId,
    ocrOverlayLoadingByImageId,
    ocrOverlayManualItemsByImageId,
  ])

  const requestOverlayTranslationForImage = useCallback((image: SectionImage) => {
    if (!canTranslateOverlayForImage(image)) return

    setOcrOverlayTranslateQueue((prev) => (
      prev.includes(image.id)
        ? prev
        : [...prev, image.id]
    ))
  }, [canTranslateOverlayForImage])

  const ensureOverlayColorsForImage = useCallback(async (
    imageId: number,
    imageUrl: string,
    items: OcrOverlayItem[],
    referenceSize: ImageNaturalSize
  ) => {
    if (!imageUrl || items.length === 0 || referenceSize.width <= 0 || referenceSize.height <= 0) return
    if (ocrOverlayColorLoadingByImageId[imageId]) return

    const existing = ocrOverlayColorsByImageId[imageId]
    if (existing && items.every((item) => existing[item.id])) return

    setOcrOverlayColorLoadingByImageId((prev) => ({ ...prev, [imageId]: true }))

    try {
      const imageElement = await loadImageForSampling(imageUrl)
      const canvas = document.createElement('canvas')
      canvas.width = imageElement.naturalWidth
      canvas.height = imageElement.naturalHeight
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) return

      context.drawImage(imageElement, 0, 0, canvas.width, canvas.height)

      const scaleX = canvas.width / referenceSize.width
      const scaleY = canvas.height / referenceSize.height
      const imageOverrides = ocrOverlayOverridesByImageId[imageId] ?? {}
      const nextProfiles: Record<number, OcrOverlayItemColors> = {}

      for (const item of items) {
        const [rawX1, rawY1, rawX2, rawY2] = item.box
        const override = imageOverrides[item.id]
        const insetX = (rawX2 - rawX1) * (ocrOverlayBoxInsetPercent / 100)
        const insetY = (rawY2 - rawY1) * (ocrOverlayBoxInsetPercent / 100)
        let x1 = rawX1 + insetX + (override?.dx ?? 0)
        let y1 = rawY1 + insetY + (override?.dy ?? 0)
        let x2 = rawX2 - insetX + (override?.dx ?? 0)
        let y2 = rawY2 - insetY + (override?.dy ?? 0)

        x1 = clampRange(x1, 0, referenceSize.width)
        y1 = clampRange(y1, 0, referenceSize.height)
        x2 = clampRange(x2, 0, referenceSize.width)
        y2 = clampRange(y2, 0, referenceSize.height)
        if (x2 <= x1 || y2 <= y1) continue

        const itemSizeScale = clampRange(
          override?.sizeScale ?? OCR_OVERLAY_ITEM_SIZE_DEFAULT,
          OCR_OVERLAY_ITEM_SIZE_MIN,
          OCR_OVERLAY_ITEM_SIZE_MAX
        )
        const itemWidthScale = clampRange(
          override?.widthScale ?? OCR_OVERLAY_ITEM_AXIS_SCALE_DEFAULT,
          OCR_OVERLAY_ITEM_AXIS_SCALE_MIN,
          OCR_OVERLAY_ITEM_AXIS_SCALE_MAX
        )
        const itemHeightScale = clampRange(
          override?.heightScale ?? OCR_OVERLAY_ITEM_AXIS_SCALE_DEFAULT,
          OCR_OVERLAY_ITEM_AXIS_SCALE_MIN,
          OCR_OVERLAY_ITEM_AXIS_SCALE_MAX
        )

        let boxW = x2 - x1
        let boxH = y2 - y1
        const centerX = x1 + boxW / 2
        const centerY = y1 + boxH / 2

        boxW = boxW * itemSizeScale * itemWidthScale
        boxH = boxH * itemSizeScale * itemHeightScale
        x1 = centerX - boxW / 2
        y1 = centerY - boxH / 2
        x2 = centerX + boxW / 2
        y2 = centerY + boxH / 2

        if (x1 < 0) {
          const shift = -x1
          x1 += shift
          x2 += shift
        }
        if (x2 > referenceSize.width) {
          const shift = x2 - referenceSize.width
          x1 -= shift
          x2 -= shift
        }
        if (y1 < 0) {
          const shift = -y1
          y1 += shift
          y2 += shift
        }
        if (y2 > referenceSize.height) {
          const shift = y2 - referenceSize.height
          y1 -= shift
          y2 -= shift
        }

        x1 = clampRange(x1, 0, referenceSize.width)
        y1 = clampRange(y1, 0, referenceSize.height)
        x2 = clampRange(x2, 0, referenceSize.width)
        y2 = clampRange(y2, 0, referenceSize.height)
        if (x2 <= x1 || y2 <= y1) continue

        boxW = x2 - x1
        boxH = y2 - y1
        const innerX = x1 + boxW * 0.18
        const innerY = y1 + boxH * 0.18
        const innerW = Math.max(1, boxW * 0.64)
        const innerH = Math.max(1, boxH * 0.64)

        const sampled = sampleAverageColor(
          context,
          innerX * scaleX,
          innerY * scaleY,
          innerW * scaleX,
          innerH * scaleY
        )

        nextProfiles[item.id] = toOverlayColorProfile(sampled.red, sampled.green, sampled.blue)
      }

      setOcrOverlayColorsByImageId((prev) => ({
        ...prev,
        [imageId]: {
          ...(prev[imageId] ?? {}),
          ...nextProfiles,
        },
      }))
    } catch {
    } finally {
      setOcrOverlayColorLoadingByImageId((prev) => ({ ...prev, [imageId]: false }))
    }
  }, [
    ocrOverlayBoxInsetPercent,
    ocrOverlayColorLoadingByImageId,
    ocrOverlayColorsByImageId,
    ocrOverlayOverridesByImageId,
  ])

  const translateOcrBatchForImage = useCallback(async (image: SectionImage) => {
    const seedItems = toOverlaySeedItems(image)
    const currentItems = ocrOverlayByImageId[image.id] ?? []
    const manualItems = ocrOverlayManualItemsByImageId[image.id] ?? []
    const hiddenIds = ocrOverlayHiddenItemIdsByImageId[image.id] ?? []
    const baseItems = filterOverlayItemsByHiddenIds(
      mergeOverlayItems(
        mergeOverlayItems(seedItems, currentItems),
        manualItems
      ),
      hiddenIds
    )

    if (baseItems.length === 0) {
      setOcrOverlayByImageId((prev) => (
        Object.prototype.hasOwnProperty.call(prev, image.id)
          ? prev
          : { ...prev, [image.id]: [] }
      ))
      return
    }

    const sourceLang = image.source_lang?.trim() || section?.source_lang || 'auto'
    const targetLang = image.target_lang?.trim() || section?.target_lang || 'pt-BR'
    const providerLang = resolveOcrOverlayProvider(section?.provider_lang)
    const translateEndpoint = '/api/translate/text-batch'
    const pendingItems = baseItems.filter((item) => !item.translatedText)

    if (pendingItems.length === 0) {
      setOcrOverlayByImageId((prev) => ({ ...prev, [image.id]: baseItems }))
      return
    }

    setOcrOverlayLoadingByImageId((prev) => ({ ...prev, [image.id]: true }))

    try {
      const response = await fetch(translateEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          source_lang: sourceLang,
          target_lang: targetLang,
          provider_lang: providerLang,
          texts: pendingItems.map((item) => item.ocrText),
        }),
      })
      const data = (await response.json()) as OcrBatchTranslateResponse

      if (!response.ok) {
        throw new Error(toErrorMessage(data, 'Não foi possível traduzir os textos OCR em lote.'))
      }

      const translatedItems = Array.isArray(data.translations)
        ? data.translations.map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
        : []

      let translatedCursor = 0
      const mergedItems = baseItems.map((item) => {
        if (item.translatedText) return item
        const translatedText = translatedItems[translatedCursor] || item.ocrText
        translatedCursor += 1
        return {
          ...item,
          translatedText,
        }
      })

      setOcrOverlayByImageId((prev) => ({ ...prev, [image.id]: mergedItems }))
      setOcrOverlayManualItemsByImageId((prev) => {
        const imageManualItems = prev[image.id]
        if (!imageManualItems || imageManualItems.length === 0) return prev

        const nextImageManualItems = imageManualItems.map((manualItem) => {
          const mergedItem = mergedItems.find((item) => item.id === manualItem.id)
          return mergedItem ?? manualItem
        })

        return {
          ...prev,
          [image.id]: nextImageManualItems,
        }
      })
    } catch {
      const fallbackItems = baseItems.map((item) => ({
        ...item,
        translatedText: item.translatedText || item.ocrText,
      }))

      setOcrOverlayByImageId((prev) => ({ ...prev, [image.id]: fallbackItems }))
      setOcrOverlayManualItemsByImageId((prev) => {
        const imageManualItems = prev[image.id]
        if (!imageManualItems || imageManualItems.length === 0) return prev

        const nextImageManualItems = imageManualItems.map((manualItem) => {
          const fallbackItem = fallbackItems.find((item) => item.id === manualItem.id)
          return fallbackItem ?? manualItem
        })

        return {
          ...prev,
          [image.id]: nextImageManualItems,
        }
      })
    } finally {
      setOcrOverlayLoadingByImageId((prev) => ({ ...prev, [image.id]: false }))
    }
  }, [
    ocrOverlayByImageId,
    ocrOverlayHiddenItemIdsByImageId,
    ocrOverlayManualItemsByImageId,
    section,
  ])

  useEffect(() => {
    if (!readingMode || !currentPage) return
    if (!shouldUseCurrentPageOcrOverlay) return

    requestOverlayTranslationForImage(currentPage)
  }, [
    currentPage,
    readingMode,
    requestOverlayTranslationForImage,
    shouldUseCurrentPageOcrOverlay,
  ])

  useEffect(() => {
    if (ocrOverlayTranslateWorkerBusyRef.current) return
    if (ocrOverlayTranslateQueue.length === 0) return

    const nextImageId = ocrOverlayTranslateQueue[0]
    setOcrOverlayTranslateQueue((prev) => prev.slice(1))

    const nextImage = sectionImages.find((image) => image.id === nextImageId)
    if (!nextImage) return
    if (!canTranslateOverlayForImage(nextImage)) return

    ocrOverlayTranslateWorkerBusyRef.current = true
    void (async () => {
      try {
        await translateOcrBatchForImage(nextImage)
      } finally {
        ocrOverlayTranslateWorkerBusyRef.current = false
      }
    })()
  }, [
    canTranslateOverlayForImage,
    ocrOverlayTranslateQueue,
    sectionImages,
    translateOcrBatchForImage,
  ])

  useEffect(() => {
    if (!readingMode || !currentPage || !shouldUseCurrentPageOcrOverlay) return
    if (currentPageOverlayItems.length === 0 || !currentPageOverlayReferenceSize) return

    void ensureOverlayColorsForImage(
      currentPage.id,
      readingDisplayUrl,
      currentPageOverlayItems,
      currentPageOverlayReferenceSize
    )
  }, [
    currentPage,
    currentPageOverlayItems,
    currentPageOverlayReferenceSize,
    ensureOverlayColorsForImage,
    readingDisplayUrl,
    readingMode,
    shouldUseCurrentPageOcrOverlay,
  ])

  useEffect(() => {
    if (!section) return

    sectionImages.forEach((image) => {
      if (isImageTranslated(image)) return
      if (!isImageOcrReady(image)) return
      const items = filterOverlayItemsByHiddenIds(
        mergeOverlayItems(
          mergeOverlayItems(
            toOverlaySeedItems(image),
            ocrOverlayByImageId[image.id] ?? []
          ),
          ocrOverlayManualItemsByImageId[image.id] ?? []
        ),
        ocrOverlayHiddenItemIdsByImageId[image.id] ?? []
      )
      if (items.length === 0) return

      const referenceSize = resolveImageOverlayReferenceSize(image)
      if (!referenceSize) return

      const sourceUrl = buildImageViewUrl(section.id, image.id, 'original')
      void ensureOverlayColorsForImage(
        image.id,
        sourceUrl,
        items,
        referenceSize
      )
    })
  }, [
    ensureOverlayColorsForImage,
    ocrOverlayByImageId,
    ocrOverlayHiddenItemIdsByImageId,
    ocrOverlayManualItemsByImageId,
    resolveImageOverlayReferenceSize,
    section,
    sectionImages,
  ])

  useEffect(() => {
    if (!readingMode || !readingDisplayUrl) {
      setIsReadingImageLoading(false)
      return
    }

    setIsReadingImageLoading(!loadedImageUrls[readingDisplayUrl])
  }, [loadedImageUrls, readingDisplayUrl, readingMode])

  useEffect(() => {
    if (!readingMode || !section || sectionImages.length === 0) return

    const adjacentIndexes: number[] = []
    for (let offset = 1; offset <= READING_PRELOAD_RADIUS; offset++) {
      adjacentIndexes.push(currentReadingPage - offset, currentReadingPage + offset)
    }

    adjacentIndexes.forEach((pageIndex) => {
      const adjacentImage = sectionImages[pageIndex]
      if (!adjacentImage) return

      const adjacentUrl = isImageTranslated(adjacentImage)
        ? buildImageViewUrl(section.id, adjacentImage.id, 'translated')
        : buildImageViewUrl(section.id, adjacentImage.id, 'original')

      if (loadedImageUrls[adjacentUrl]) return

      const preloadImage = new Image()
      preloadImage.src = adjacentUrl
      preloadImage.onload = () => markImageAsLoaded(adjacentUrl)
      preloadImage.onerror = () => markImageAsLoaded(adjacentUrl)
    })
  }, [
    currentReadingPage,
    loadedImageUrls,
    markImageAsLoaded,
    readingMode,
    section,
    sectionImages,
  ])

  useEffect(() => {
    autoQueueAttemptedRef.current = false
    autoReprocessAttemptedRef.current = false
    autoReprocessAcceptedRef.current = false
  }, [sectionId])

  const handleQueueSection = useCallback(async (options?: QueueActionOptions): Promise<boolean> => {
    if (!section) return false

    setError('')
    if (!options?.silent) {
      setSuccess('')
    }
    setQueueActionLoading('queue')

    try {
      const response = await fetch(`/api/sections/${section.id}/queue?v2=true`, { method: 'POST' })
      const data = await response.json().catch(() => ({}))

      if (response.status === 401) {
        handleUnauthorized()
        return false
      }

      if (!response.ok) {
        throw new Error(toErrorMessage(data, 'Não foi possível processar a seção.'))
      }

      if (!options?.silent) {
        setSuccess(toErrorMessage(data, 'Seção enviada para processamento com sucesso.'))
      }
      triggerForcedPolling()
      await fetchSection({ silent: true })
      return true
    } catch (err) {
      const fallbackMessage = options?.automatic
        ? 'Erro ao iniciar processamento automático da seção.'
        : 'Erro ao processar seção.'
      setError(err instanceof Error ? err.message : fallbackMessage)
      return false
    } finally {
      setQueueActionLoading(null)
    }
  }, [fetchSection, handleUnauthorized, section, triggerForcedPolling])

  const handleReprocessSection = useCallback(async (options?: QueueActionOptions): Promise<boolean> => {
    if (!section) return false

    setError('')
    if (!options?.silent) {
      setSuccess('')
    }
    setQueueActionLoading('reprocess')

    const providerLang = resolveOcrOverlayProvider(section.provider_lang)

    try {
      const response = await fetch(
        `/api/sections/${section.id}/reprocess?v2=true&provider_lang=${encodeURIComponent(providerLang)}`,
        { method: 'POST' }
      )
      const data = await response.json().catch(() => ({}))

      if (response.status === 401) {
        handleUnauthorized()
        return false
      }

      if (!response.ok) {
        throw new Error(toErrorMessage(data, 'Não foi possível reprocessar a seção.'))
      }

      if (!options?.silent) {
        setSuccess(toErrorMessage(data, 'Reprocessamento iniciado com sucesso.'))
      }
      triggerForcedPolling()
      await fetchSection({ silent: true })
      return true
    } catch (err) {
      const fallbackMessage = options?.automatic
        ? 'Erro ao iniciar reprocessamento automático da seção.'
        : 'Erro ao reprocessar seção.'
      setError(err instanceof Error ? err.message : fallbackMessage)
      return false
    } finally {
      setQueueActionLoading(null)
    }
  }, [fetchSection, handleUnauthorized, section, triggerForcedPolling])

  useEffect(() => {
    if (!isAutoProcessingEnabled) return
    if (!section || isLoadingSection) return
    if (queueActionLoading !== null) return
    if (queueState?.inQueueOrProcessing) return

    if (hasAnyFailedTranslation) {
      if (!autoReprocessAttemptedRef.current) {
        autoReprocessAttemptedRef.current = true
        void (async () => {
          const ok = await handleReprocessSection({ silent: true, automatic: true })
          if (ok) {
            autoReprocessAcceptedRef.current = true
            return
          }
        })()
        return
      }
      return
    }

    if (queueState?.canQueue && !autoQueueAttemptedRef.current) {
      autoQueueAttemptedRef.current = true
      void handleQueueSection({ silent: true, automatic: true })
    }
  }, [
    handleQueueSection,
    handleReprocessSection,
    hasAnyFailedTranslation,
    isLoadingSection,
    queueActionLoading,
    queueState?.canQueue,
    queueState?.inQueueOrProcessing,
    isAutoProcessingEnabled,
    section,
  ])

  const handleDeleteSection = async () => {
    if (!section) return

    setError('')
    setSuccess('')
    setIsDeletingSection(true)

    try {
      const response = await fetch(`/api/sections/${section.id}`, {
        method: 'DELETE',
      })
      const data = (await response.json()) as DeleteSectionResponse

      if (response.status === 401) {
        handleUnauthorized()
        return
      }

      if (!response.ok) {
        throw new Error(toErrorMessage(data, 'Não foi possível remover a seção.'))
      }

      setIsDeleteDialogOpen(false)
      router.replace(backToLibraryHref)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao remover seção.')
    } finally {
      setIsDeletingSection(false)
    }
  }

  const handleStartSectionNameEdit = () => {
    if (!section) return
    setSectionNameDraft(section.name)
    sectionNameSyncedRef.current = section.name
    setIsEditingSectionName(true)
    setError('')
    setSuccess('')
  }

  const handleCancelSectionNameEdit = () => {
    if (section) {
      setSectionNameDraft(section.name)
      sectionNameSyncedRef.current = section.name
    }
    setIsEditingSectionName(false)
  }

  const handlePersistSectionCategory = useCallback(async (rawValue?: string) => {
    const normalizedCategory = normalizeSectionCategoryValue(rawValue ?? sectionCategoryDraft)
    setSectionCategoryDraft(normalizedCategory)

    if (normalizedCategory === sectionCategoryLastSavedRef.current) return true

    setIsSectionCategorySaving(true)
    const requestId = sectionCategorySaveRequestRef.current + 1
    sectionCategorySaveRequestRef.current = requestId

    try {
      const response = await fetch(`/api/sections/${sectionId}/category`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          category: normalizedCategory || null,
        }),
      })
      const data = (await response.json()) as SectionCategoryResponse

      if (response.status === 401) {
        handleUnauthorized()
        return false
      }

      if (!response.ok) {
        throw new Error(toErrorMessage(data, 'Não foi possível salvar a categoria.'))
      }

      if (requestId !== sectionCategorySaveRequestRef.current) return false

      const nextCategory = normalizeSectionCategoryValue(data.category)
      const nextOptions = normalizeSectionCategoryOptions(data.categories)
      const nextCategoryPreferences = normalizeSectionCategoryOverlayPreferences(
        data.category_preferences
      )
      setSectionCategoryDraft(nextCategory)
      setSectionCategoryOptions(nextOptions)
      setSectionCategoryOverlayPreferences(nextCategoryPreferences)
      setSectionCategoryQuery('')
      sectionCategoryLastSavedRef.current = nextCategory

      toast.success(data.message || 'Categoria salva com sucesso.')
      return true
    } catch (err) {
      if (requestId !== sectionCategorySaveRequestRef.current) return false
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar categoria.')
      return false
    } finally {
      if (requestId === sectionCategorySaveRequestRef.current) {
        setIsSectionCategorySaving(false)
      }
    }
  }, [handleUnauthorized, sectionCategoryDraft, sectionId])

  const filteredSectionCategoryOptions = useMemo(() => {
    const normalizedQuery = normalizeSectionCategoryValue(sectionCategoryQuery)
    if (!normalizedQuery) return sectionCategoryOptions

    const queryKey = toSectionCategoryKey(normalizedQuery)
    return sectionCategoryOptions.filter((category) => {
      return toSectionCategoryKey(category).includes(queryKey)
    })
  }, [sectionCategoryOptions, sectionCategoryQuery])

  const canCreateSectionCategoryFromQuery = useMemo(() => {
    const normalizedQuery = normalizeSectionCategoryValue(sectionCategoryQuery)
    if (!normalizedQuery) return false

    const queryKey = toSectionCategoryKey(normalizedQuery)
    return !sectionCategoryOptions.some((category) => toSectionCategoryKey(category) === queryKey)
  }, [sectionCategoryOptions, sectionCategoryQuery])

  const handleSelectSectionCategory = useCallback((category: string) => {
    const normalizedCategory = normalizeSectionCategoryValue(category)
    sectionCategorySkipCloseCommitRef.current = true
    setSectionCategoryQuery('')
    setIsSectionCategoryPopoverOpen(false)
    void handlePersistSectionCategory(normalizedCategory)
  }, [handlePersistSectionCategory])

  const handleOpenDeleteCategoryDialog = useCallback((category: string) => {
    const normalizedCategory = normalizeSectionCategoryValue(category)
    if (!normalizedCategory) return

    sectionCategorySkipCloseCommitRef.current = true
    setSectionCategoryQuery('')
    setIsSectionCategoryPopoverOpen(false)
    setCategoryToDelete(normalizedCategory)
    setIsDeleteCategoryDialogOpen(true)
  }, [])

  const handleDeleteCategory = useCallback(async () => {
    const normalizedCategory = normalizeSectionCategoryValue(categoryToDelete)
    if (!normalizedCategory) {
      setIsDeleteCategoryDialogOpen(false)
      return
    }

    setIsDeletingCategory(true)
    try {
      const response = await fetch(`/api/sections/${sectionId}/category`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ category: normalizedCategory }),
      })
      const data = (await response.json()) as SectionCategoryResponse

      if (response.status === 401) {
        handleUnauthorized()
        return
      }

      if (!response.ok) {
        throw new Error(toErrorMessage(data, 'Não foi possível excluir a categoria.'))
      }

      const nextCategory = normalizeSectionCategoryValue(data.category)
      const nextOptions = normalizeSectionCategoryOptions(data.categories)
      setSectionCategoryDraft(nextCategory)
      setSectionCategoryOptions(nextOptions)
      setSectionCategoryQuery('')
      sectionCategoryLastSavedRef.current = nextCategory
      setIsDeleteCategoryDialogOpen(false)
      setCategoryToDelete('')

      const deletedCountRaw = toFiniteNumber(data.deleted_sections_count)
      const deletedCount = deletedCountRaw === null ? 0 : Math.max(0, Math.floor(deletedCountRaw))
      toast.success(
        data.message
        || (deletedCount > 0
          ? `Categoria removida. ${deletedCount} seção(ões) ficaram sem categoria.`
          : 'Categoria removida com sucesso.')
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao excluir categoria.')
    } finally {
      setIsDeletingCategory(false)
    }
  }, [categoryToDelete, handleUnauthorized, sectionId])

  const handleSectionCategoryPopoverChange = useCallback((open: boolean) => {
    if (!open) {
      if (sectionCategorySkipCloseCommitRef.current) {
        sectionCategorySkipCloseCommitRef.current = false
      } else {
        const normalizedQuery = normalizeSectionCategoryValue(sectionCategoryQuery)
        if (normalizedQuery) {
          void handlePersistSectionCategory(normalizedQuery)
        }
      }
      setSectionCategoryQuery('')
    } else {
      setSectionCategoryQuery(sectionCategoryDraft)
    }

    setIsSectionCategoryPopoverOpen(open)
  }, [handlePersistSectionCategory, sectionCategoryDraft, sectionCategoryQuery])

  const handleRenameSection = async () => {
    if (!section) return

    const trimmedName = sectionNameDraft.trim()
    if (!trimmedName) {
      setError('Informe o nome da seção.')
      return
    }

    if (trimmedName === section.name) {
      setIsEditingSectionName(false)
      return
    }

    setError('')
    setSuccess('')
    setIsRenamingSection(true)

    try {
      const response = await fetch(`/api/sections/${section.id}/name`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: trimmedName }),
      })
      const data = (await response.json()) as RenameSectionResponse

      if (response.status === 401) {
        handleUnauthorized()
        return
      }

      if (!response.ok) {
        throw new Error(toErrorMessage(data, 'Não foi possível atualizar o nome da seção.'))
      }

      setSection((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          name: data.name ?? trimmedName,
          status: data.status ?? prev.status,
          updated_at: data.updated_at ?? prev.updated_at,
        }
      })
      setSectionNameDraft(data.name ?? trimmedName)
      setSuccess(data.message || 'Nome da seção atualizado com sucesso.')
      setIsEditingSectionName(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao atualizar nome da seção.')
    } finally {
      setIsRenamingSection(false)
    }
  }

  const openReadingPage = (pageIndex: number) => {
    const categoryDefaultReadingMode = sectionCategoryOverlayPreferences?.default_reading_mode
    if (categoryDefaultReadingMode === 'paginated' || categoryDefaultReadingMode === 'scroll') {
      setReadingViewMode(categoryDefaultReadingMode)
    }
    setCurrentReadingPage(pageIndex)
    setZoom(100)
    setIsOverlaySelectionMode(false)
    setOverlaySelectionDraft(null)
    setIsOverlayFontPopoverOpen(false)
    setSelectedOverlayTarget(null)
    setOverlayQuickEditorState(null)
    setOverlayDragEnabledTarget(null)
    setReadingMode(true)
  }

  const closeReadingMode = () => {
    setIsOverlayFontPopoverOpen(false)
    setIsOverlaySelectionMode(false)
    setOverlaySelectionDraft(null)
    setSelectedOverlayTarget(null)
    setOverlayQuickEditorState(null)
    setOverlayDragEnabledTarget(null)
    setReadingMode(false)
  }

  const goToPreviousPage = () => {
    setCurrentReadingPage((prev) => Math.max(0, prev - 1))
  }

  const goToNextPage = () => {
    setCurrentReadingPage((prev) => Math.min(sectionImages.length - 1, prev + 1))
  }

  const handleReadingTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (isOverlaySelectionMode) {
      readingTouchStartRef.current = null
      readingSwipeLockedRef.current = true
      return
    }

    const touchTarget = event.target instanceof HTMLElement ? event.target : null
    if (touchTarget?.closest('[data-ocr-overlay-interactive="true"]')) {
      readingTouchStartRef.current = null
      readingSwipeLockedRef.current = true
      return
    }

    if (event.touches.length !== 1) {
      readingTouchStartRef.current = null
      readingSwipeLockedRef.current = true
      return
    }

    const touch = event.touches[0]
    readingTouchStartRef.current = { x: touch.clientX, y: touch.clientY }
    readingSwipeLockedRef.current = false
  }

  const handleReadingTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    const start = readingTouchStartRef.current
    if (!start || readingSwipeLockedRef.current) return
    if (event.touches.length !== 1) {
      readingSwipeLockedRef.current = true
      return
    }

    const touch = event.touches[0]
    const deltaX = touch.clientX - start.x
    const deltaY = touch.clientY - start.y

    if (Math.abs(deltaY) > Math.abs(deltaX)) {
      readingSwipeLockedRef.current = true
    }
  }

  const handleReadingTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    const start = readingTouchStartRef.current
    const swipeLocked = readingSwipeLockedRef.current

    readingTouchStartRef.current = null
    readingSwipeLockedRef.current = false

    if (!start || swipeLocked || event.changedTouches.length === 0) {
      return
    }

    const touch = event.changedTouches[0]
    const deltaX = touch.clientX - start.x
    const deltaY = touch.clientY - start.y
    const absDeltaX = Math.abs(deltaX)
    const absDeltaY = Math.abs(deltaY)

    if (absDeltaX < SWIPE_TRIGGER_PX) return
    if (absDeltaX < absDeltaY * SWIPE_DIRECTION_RATIO) return

    if (deltaX < 0) {
      goToNextPage()
      return
    }

    goToPreviousPage()
  }

  useEffect(() => {
    if (!readingMode) return

    const zone = readingInteractionZoneRef.current
    if (!zone) return

    const handleTouchMove = (event: TouchEvent) => {
      if (event.touches.length > 1) {
        event.preventDefault()
      }
    }

    const handleGesture = (event: Event) => {
      event.preventDefault()
    }

    zone.addEventListener('touchmove', handleTouchMove, { passive: false })
    zone.addEventListener('gesturestart', handleGesture as EventListener, { passive: false })
    zone.addEventListener('gesturechange', handleGesture as EventListener, { passive: false })
    zone.addEventListener('gestureend', handleGesture as EventListener, { passive: false })

    return () => {
      zone.removeEventListener('touchmove', handleTouchMove)
      zone.removeEventListener('gesturestart', handleGesture as EventListener)
      zone.removeEventListener('gesturechange', handleGesture as EventListener)
      zone.removeEventListener('gestureend', handleGesture as EventListener)
    }
  }, [currentReadingPage, readingMode, readingViewMode])

  if (readingMode && section && currentPage) {
    const translatedAvailable = readingTranslatedAvailable
    const displayUrl = readingDisplayUrl

    const isCurrentProcessing = isImageProcessing(currentPage)

    return (
      <div className="fixed inset-0 bg-background z-70 flex flex-col">
        <div className="flex-none bg-card border-b border-border p-2 sm:p-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center justify-between gap-2 sm:gap-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={closeReadingMode}
                className="h-8 px-2 sm:h-9 sm:px-3"
              >
                <X className="h-4 w-4 sm:h-5 sm:w-5" />
                <span className="hidden sm:inline ml-2">Fechar</span>
              </Button>

              <div className="flex items-center gap-1 sm:gap-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setReadingViewMode((prev) => prev === 'paginated' ? 'scroll' : 'paginated')}
                  className={cn('h-8 w-8 p-0 sm:h-9 sm:w-9', readingViewMode === 'scroll' && 'bg-muted text-foreground')}
                  aria-label={readingViewMode === 'paginated' ? 'Alternar para scroll contínuo' : 'Alternar para paginação'}
                  title={readingViewMode === 'paginated' ? 'Scroll contínuo' : 'Paginação'}
                >
                  <Rows3 className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setZoom((value) => Math.max(25, value - 10))}
                  className="h-8 w-8 p-0 sm:h-9 sm:w-9"
                >
                  <ZoomOut className="h-4 w-4" />
                </Button>
                <span className="text-[11px] w-9 text-center sm:text-xs sm:w-10">{zoom}%</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setZoom((value) => Math.min(300, value + 10))}
                  className="h-8 w-8 p-0 sm:h-9 sm:w-9"
                >
                  <ZoomIn className="h-4 w-4" />
                </Button>
                {shouldUseCurrentPageOcrOverlay && (
                  <Popover
                    open={isOverlayFontPopoverOpen}
                    onOpenChange={setIsOverlayFontPopoverOpen}
                  >
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className={cn(
                          'h-8 min-w-12 gap-1 border-primary/40 bg-primary/12 px-2 text-primary hover:bg-primary/20 hover:text-primary sm:h-9 sm:min-w-14 sm:px-2.5',
                          isOverlayFontPopoverOpen && 'border-primary bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground'
                        )}
                        aria-label="Abrir ajuste de fonte do overlay OCR"
                      >
                        <span className="text-[11px] font-semibold leading-none">Aa</span>
                        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', isOverlayFontPopoverOpen && 'rotate-180')} />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      side="bottom"
                      align="end"
                      sideOffset={8}
                      className="z-[10000] w-56 p-2.5"
                    >
                      <div className="space-y-2.5">
                        <p className="text-[11px] text-muted-foreground">Tamanho da fonte</p>
                        <div className="flex items-center justify-between gap-1">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 w-7 p-0"
                            onClick={() => setOcrOverlayFontScale((value) => (
                              clampRange(value - OCR_OVERLAY_FONT_SCALE_STEP, OCR_OVERLAY_FONT_SCALE_MIN, OCR_OVERLAY_FONT_SCALE_MAX)
                            ))}
                            disabled={ocrOverlayFontScale <= OCR_OVERLAY_FONT_SCALE_MIN}
                            aria-label="Diminuir fonte do overlay OCR"
                          >
                            -
                          </Button>
                          <span className="min-w-[64px] text-center text-sm font-semibold text-foreground">
                            {overlayFontPercentLabel}%
                          </span>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 w-7 p-0"
                            onClick={() => setOcrOverlayFontScale((value) => (
                              clampRange(value + OCR_OVERLAY_FONT_SCALE_STEP, OCR_OVERLAY_FONT_SCALE_MIN, OCR_OVERLAY_FONT_SCALE_MAX)
                            ))}
                            disabled={ocrOverlayFontScale >= OCR_OVERLAY_FONT_SCALE_MAX}
                            aria-label="Aumentar fonte do overlay OCR"
                          >
                            +
                          </Button>
                        </div>
                        <div className="space-y-1">
                          <p className="text-[11px] text-muted-foreground">Tipo de fonte</p>
                          <Select
                            value={ocrOverlayFontFamily}
                            onValueChange={(value) => setOcrOverlayFontFamily(value as OcrOverlayFontFamily)}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue placeholder="Fonte" />
                            </SelectTrigger>
                            <SelectContent className="z-[10001]">
                              {Object.entries(OCR_OVERLAY_FONT_FAMILIES).map(([fontKey, fontConfig]) => (
                                <SelectItem
                                  key={fontKey}
                                  value={fontKey}
                                  className="text-xs"
                                  style={{ fontFamily: fontConfig.css }}
                                >
                                  {fontConfig.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <p className="text-[11px] text-muted-foreground">Texto exibido</p>
                          <div className="grid grid-cols-2 gap-1">
                            <Button
                              type="button"
                              size="sm"
                              variant={ocrOverlayTextMode === 'translated' ? 'default' : 'outline'}
                              className="h-8 text-xs"
                              onClick={() => setOcrOverlayTextMode('translated')}
                            >
                              Traduzido
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant={ocrOverlayTextMode === 'original' ? 'default' : 'outline'}
                              className="h-8 text-xs"
                              onClick={() => setOcrOverlayTextMode('original')}
                            >
                              Original
                            </Button>
                          </div>
                        </div>
                        <div className="space-y-1">
                          <p className="text-[11px] text-muted-foreground">Densidade</p>
                          <div className="flex items-center justify-between gap-1">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-7 w-7 p-0"
                              onClick={() => setOcrOverlayDensity((value) => (
                                clampRange(value - OCR_OVERLAY_DENSITY_STEP, OCR_OVERLAY_DENSITY_MIN, OCR_OVERLAY_DENSITY_MAX)
                              ))}
                              disabled={ocrOverlayDensity <= OCR_OVERLAY_DENSITY_MIN}
                              aria-label="Diminuir densidade do overlay OCR"
                            >
                              -
                            </Button>
                            <span className="min-w-[64px] text-center text-sm font-semibold text-foreground">
                              {overlayDensityLabel}
                            </span>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-7 w-7 p-0"
                              onClick={() => setOcrOverlayDensity((value) => (
                                clampRange(value + OCR_OVERLAY_DENSITY_STEP, OCR_OVERLAY_DENSITY_MIN, OCR_OVERLAY_DENSITY_MAX)
                              ))}
                              disabled={ocrOverlayDensity >= OCR_OVERLAY_DENSITY_MAX}
                              aria-label="Aumentar densidade do overlay OCR"
                            >
                              +
                            </Button>
                          </div>
                        </div>
                        <div className="space-y-1">
                          <p className="text-[11px] text-muted-foreground">Opacidade</p>
                          <div className="flex items-center justify-between gap-1">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-7 w-7 p-0"
                              onClick={() => setOcrOverlayOpacity((value) => (
                                clampRange(value - 0.05, OCR_OVERLAY_OPACITY_MIN, OCR_OVERLAY_OPACITY_MAX)
                              ))}
                              disabled={ocrOverlayOpacity <= OCR_OVERLAY_OPACITY_MIN}
                              aria-label="Diminuir opacidade do overlay OCR"
                            >
                              -
                            </Button>
                            <span className="min-w-[64px] text-center text-sm font-semibold text-foreground">
                              {overlayOpacityLabel}
                            </span>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-7 w-7 p-0"
                              onClick={() => setOcrOverlayOpacity((value) => (
                                clampRange(value + 0.05, OCR_OVERLAY_OPACITY_MIN, OCR_OVERLAY_OPACITY_MAX)
                              ))}
                              disabled={ocrOverlayOpacity >= OCR_OVERLAY_OPACITY_MAX}
                              aria-label="Aumentar opacidade do overlay OCR"
                            >
                              +
                            </Button>
                          </div>
                        </div>
                        <div className="space-y-1">
                          <p className="text-[11px] text-muted-foreground">Formato global</p>
                          <div className="grid grid-cols-2 gap-1">
                            <Button
                              type="button"
                              size="sm"
                              variant={ocrOverlayGlobalShape === 'rect' ? 'default' : 'outline'}
                              className="h-8 text-xs"
                              onClick={() => setOcrOverlayGlobalShape('rect')}
                            >
                              Retângulo
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant={ocrOverlayGlobalShape === 'oval' ? 'default' : 'outline'}
                              className="h-8 text-xs"
                              onClick={() => setOcrOverlayGlobalShape('oval')}
                            >
                              Oval
                            </Button>
                          </div>
                        </div>
                        <div className="space-y-1">
                          <p className="text-[11px] text-muted-foreground">Seleção de área</p>
                          <Button
                            type="button"
                            size="sm"
                            variant={isOverlaySelectionMode ? 'default' : 'outline'}
                            className="h-8 w-full text-xs"
                            onClick={() => {
                              setIsOverlayFontPopoverOpen(false)
                              setOverlaySelectionDraft(null)
                              setIsOverlaySelectionMode((value) => {
                                setSelectedOverlayTarget(null)
                                setOverlayQuickEditorState(null)
                                setOverlayDragEnabledTarget(null)
                                return !value
                              })
                            }}
                          >
                            {isOverlaySelectionMode ? 'Seleção ligada' : 'Selecionar área'}
                          </Button>
                          <p className="text-[10px] leading-snug text-muted-foreground">
                            Esta opção seleciona a área que deseja traduzir manualmente.
                          </p>
                        </div>
                        <p className="text-[10px] leading-snug text-muted-foreground">
                          2x no balão para editar. Ative "Arrastar" no menu para mover.
                        </p>
                      </div>
                    </PopoverContent>
                  </Popover>
                )}
              </div>
            </div>

            <div className="flex min-w-0 flex-wrap items-center gap-1 sm:justify-center sm:gap-2">
              {translatedAvailable && (
                <span className="text-[10px] sm:text-xs bg-green-500/20 text-green-500 dark:text-green-300 px-2 py-0.5 rounded-full">
                  Traduzida
                </span>
              )}
              {shouldUseCurrentPageOcrOverlay && !translatedAvailable && (
                <span className="text-[10px] sm:text-xs bg-blue-500/15 text-blue-600 dark:text-blue-300 px-2 py-0.5 rounded-full">
                  <span className="sm:hidden">
                    {currentPageOverlayLoading
                      ? 'OCR...'
                      : currentPageOverlayItems.length > 0
                        ? 'Overlay OCR'
                        : 'Sem boxes'}
                  </span>
                  <span className="hidden sm:inline">
                    {currentPageOverlayLoading
                      ? 'Carregando boxes...'
                      : currentPageOverlayItems.length > 0
                        ? 'Overlay OCR ativo'
                        : 'Sem boxes OCR'}
                  </span>
                </span>
              )}
              {isOverlaySelectionMode && shouldUseCurrentPageOcrOverlay && (
                <span className="text-[10px] sm:text-xs rounded-full border border-primary/40 bg-primary/15 px-2 py-0.5 text-primary">
                  Selecione arrastando
                </span>
              )}
              {isCurrentProcessing && (
                <span className="text-[10px] sm:text-xs bg-primary/20 text-primary px-2 py-0.5 rounded-full flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Processando
                </span>
              )}
            </div>
          </div>
        </div>

        {readingViewMode === 'paginated' ? (
          <>
            <div
              ref={readingInteractionZoneRef}
              className="relative flex-1 overflow-auto bg-muted/30"
              onTouchStart={handleReadingTouchStart}
              onTouchMove={handleReadingTouchMove}
              onTouchEnd={handleReadingTouchEnd}
              style={{ touchAction: 'pan-y' }}
            >
              {isOverlaySelectionMode && (
                <div className="pointer-events-none absolute inset-0 z-[1] bg-black/25" />
              )}
              <div className="min-h-full flex items-center justify-center p-2 sm:p-4">
                <div
                  className="relative w-full min-h-[280px] sm:min-h-[420px]"
                  style={{
                    maxWidth: `${Math.min(zoom * 6, 1200)}px`,
                  }}
                >
                  {isReadingImageLoading && (
                    <div className="absolute inset-0 z-10">
                      <Skeleton className="h-full w-full rounded-md" />
                    </div>
                  )}

                  <div
                    className="relative mx-auto w-full"
                    data-ocr-overlay-host={currentPage.id}
                    style={{
                      transform: `scale(${zoom / 100})`,
                      transformOrigin: 'top center',
                    }}
                  >
                    <img
                      key={displayUrl}
                      src={displayUrl}
                      alt={`Página ${currentPage.order_index + 1}`}
                      className={cn(
                        'w-full h-auto block mx-auto transition-opacity duration-200',
                        isReadingImageLoading ? 'opacity-0' : isCurrentProcessing ? 'opacity-40' : 'opacity-100'
                      )}
                      loading="eager"
                      decoding="async"
                      fetchPriority="high"
                      onLoad={(event) => {
                        markImageAsLoaded(displayUrl)
                        const nextReferenceSize = {
                          width: event.currentTarget.naturalWidth,
                          height: event.currentTarget.naturalHeight,
                        }
                        updateImageNaturalSize(
                          currentPage.id,
                          nextReferenceSize.width,
                          nextReferenceSize.height
                        )

                        if (
                          shouldUseCurrentPageOcrOverlay
                          && currentPageOverlayItems.length > 0
                          && nextReferenceSize.width > 0
                          && nextReferenceSize.height > 0
                        ) {
                          void ensureOverlayColorsForImage(
                            currentPage.id,
                            displayUrl,
                            currentPageOverlayItems,
                            nextReferenceSize
                          )
                        }
                      }}
                      onError={() => markImageAsLoaded(displayUrl)}
                    />

                    {shouldUseCurrentPageOcrOverlay && (currentPageOverlayItems.length > 0 || isOverlaySelectionMode) && (
                      <OcrTextOverlay
                        imageId={currentPage.id}
                        items={currentPageOverlayItems}
                        referenceSize={currentPageOverlayReferenceSize}
                        fontScale={ocrOverlayFontScale}
                        boxInsetPercent={ocrOverlayBoxInsetPercent}
                        overlayDensity={ocrOverlayDensity}
                        overlayOpacity={ocrOverlayOpacity}
                        globalShape={ocrOverlayGlobalShape}
                        fontFamilyCss={overlayFontFamilyCss}
                        visualScale={zoom / 100}
                        editable={ocrOverlayEditMode}
                        selectedItemId={selectedOverlayOnCurrentPage?.itemId ?? null}
                        itemOverrides={currentPageOverlayOverrides}
                        itemColors={currentPageOverlayColors}
                        onSelectItem={handleSelectOverlayItem}
                        onClearSelection={handleClearOverlaySelection}
                        onMoveItem={handleMoveOverlayItem}
                        onResizeItem={handleResizeOverlayItem}
                        onOpenQuickEditor={handleOpenOverlayQuickEditor}
                        dragEnabledItemId={(
                          overlayDragEnabledTarget && overlayDragEnabledTarget.imageId === currentPage.id
                            ? overlayDragEnabledTarget.itemId
                            : null
                        )}
                        selectionModeEnabled={overlaySelectionEnabled}
                        showTranslatingPlaceholder={currentPageOverlayLoading}
                        textMode={ocrOverlayTextMode}
                        onSelectionDraftReady={handleOverlaySelectionDraftReady}
                        selectionPreviewBox={overlaySelectionDraftForCurrentPage?.box ?? null}
                        onSelectionPreviewChange={handleOverlaySelectionDraftChange}
                      />
                    )}
                    {shouldUseCurrentPageOcrOverlay && currentPageOverlayLoading && currentPageOverlayItems.length === 0 && (
                      <div className="absolute right-2 top-2 z-20 rounded-full border border-blue-500/35 bg-blue-500/15 px-2 py-1 text-[10px] font-medium text-blue-600 dark:text-blue-300">
                        Carregando boxes...
                      </div>
                    )}

                    {overlaySelectionDraftForCurrentPage && (
                      <Popover
                        open
                        onOpenChange={(open) => {
                          if (!open) handleDiscardOverlaySelectionDraft()
                        }}
                      >
                        <PopoverAnchor asChild>
                          <div
                            className="absolute z-30 h-0 w-0"
                            style={{
                              left: `${overlaySelectionDraftForCurrentPage.leftPercent}%`,
                              top: `${overlaySelectionDraftForCurrentPage.topPercent}%`,
                            }}
                          />
                        </PopoverAnchor>
                        <PopoverContent
                          side="top"
                          align="center"
                          sideOffset={10}
                          data-ocr-overlay-selection-confirm="true"
                          className="z-[9999] w-[300px] max-w-[92vw] p-2"
                          onOpenAutoFocus={(event) => event.preventDefault()}
                          onInteractOutside={(event) => {
                            if (isOverlaySelectionPopoverInternalTarget(event.target)) {
                              event.preventDefault()
                            }
                          }}
                          onFocusOutside={(event) => {
                            if (isOverlaySelectionPopoverInternalTarget(event.target)) {
                              event.preventDefault()
                            }
                          }}
                        >
                          <div className="space-y-2">
                            <p className="text-[11px] font-medium text-foreground">Confirmar área selecionada?</p>
                            <div className="grid grid-cols-2 gap-2">
                              <div className="space-y-1">
                                <p className="text-[10px] text-muted-foreground">Entrada</p>
                                <Select
                                  value={overlaySelectionSourceLang}
                                  onValueChange={setOverlaySelectionSourceLang}
                                >
                                  <SelectTrigger data-ocr-overlay-selection-lang-select="true" className="h-7 px-2 text-[11px]">
                                    <SelectValue placeholder="Origem" />
                                  </SelectTrigger>
                                  <SelectContent data-ocr-overlay-selection-lang-select="true" className="z-[10050] max-h-52">
                                    {OCR_OVERLAY_SELECTION_LANGUAGES.map((language) => (
                                      <SelectItem key={`overlay-selection-source-${language.code}`} value={language.code}>
                                        {language.name}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="space-y-1">
                                <p className="text-[10px] text-muted-foreground">Saída</p>
                                <Select
                                  value={overlaySelectionTargetLang}
                                  onValueChange={setOverlaySelectionTargetLang}
                                >
                                  <SelectTrigger data-ocr-overlay-selection-lang-select="true" className="h-7 px-2 text-[11px]">
                                    <SelectValue placeholder="Destino" />
                                  </SelectTrigger>
                                  <SelectContent data-ocr-overlay-selection-lang-select="true" className="z-[10050] max-h-52">
                                    {OCR_OVERLAY_SELECTION_TARGET_LANGUAGES.map((language) => (
                                      <SelectItem key={`overlay-selection-target-${language.code}`} value={language.code}>
                                        {language.name}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>
                            <div className="flex items-center justify-end gap-2">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-[11px]"
                                onClick={handleDiscardOverlaySelectionDraft}
                              >
                                Descartar
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                className="h-7 px-2 text-[11px]"
                                onClick={handleConfirmOverlaySelectionDraft}
                              >
                                Confirmar
                              </Button>
                            </div>
                          </div>
                        </PopoverContent>
                      </Popover>
                    )}

                    {overlayQuickEditorForCurrentPage && selectedOverlayOnCurrentPage && (
                      <Popover
                        open
                        onOpenChange={(open) => {
                          if (!open) handleClearOverlaySelection()
                        }}
                      >
                        <PopoverAnchor asChild>
                          <div
                            className="absolute z-30 h-0 w-0"
                            style={{
                              left: `${overlayQuickEditorForCurrentPage.leftPercent}%`,
                              top: `${overlayQuickEditorForCurrentPage.topPercent}%`,
                            }}
                          />
                        </PopoverAnchor>
                        <PopoverContent
                          side={quickEditorPlacementForCurrentPage.side}
                          align={quickEditorPlacementForCurrentPage.align}
                          sideOffset={10}
                          sticky="always"
                          updatePositionStrategy="always"
                          avoidCollisions={false}
                          data-ocr-overlay-quick-editor="true"
                          className="z-[9999] w-[230px] p-2 data-[state=open]:animate-none data-[state=closed]:animate-none"
                          onOpenAutoFocus={(event) => event.preventDefault()}
                          onInteractOutside={(event) => {
                            const target = event.target instanceof HTMLElement ? event.target : null
                            if (target?.closest('[data-ocr-overlay-interactive="true"]')) {
                              event.preventDefault()
                            }
                          }}
                        >
                          <div className="space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <div
                                className="min-w-0 flex-1 cursor-move touch-none rounded border border-border/70 bg-muted/40 px-2 py-1"
                                onPointerDown={(event) => handleStartOverlayQuickEditorDrag(selectedOverlayOnCurrentPage.imageId, event)}
                              >
                                <p className="truncate text-[11px] font-semibold text-foreground">
                                  Balão #{selectedOverlayOnCurrentPage.itemId}
                                </p>
                              </div>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="h-6 px-1.5 text-[11px]"
                                onClick={handleClearOverlaySelection}
                              >
                                Fechar
                              </Button>
                            </div>

                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[11px] text-muted-foreground">Arrastar</span>
                              <Button
                                type="button"
                                size="sm"
                                variant={selectedOverlayDragEnabled ? 'default' : 'outline'}
                                className="h-6 px-2 text-[11px]"
                                onClick={handleToggleSelectedOverlayDrag}
                              >
                                {selectedOverlayDragEnabled ? 'Habilitado' : 'Desligado'}
                              </Button>
                            </div>

                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[11px] text-muted-foreground">Tipo</span>
                              <div className="flex items-center gap-1">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant={selectedOverlayShape === 'rect' ? 'default' : 'outline'}
                                  className="h-6 px-2 text-[11px]"
                                  onClick={() => handleSetSelectedOverlayShape('rect')}
                                >
                                  Ret
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant={selectedOverlayShape === 'oval' ? 'default' : 'outline'}
                                  className="h-6 px-2 text-[11px]"
                                  onClick={() => handleSetSelectedOverlayShape('oval')}
                                >
                                  Oval
                                </Button>
                              </div>
                            </div>

                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[11px] text-muted-foreground">Fonte</span>
                              <div className="flex items-center gap-1">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="h-6 w-6 p-0 text-[11px]"
                                  onClick={() => handleAdjustSelectedOverlayItemFont(-OCR_OVERLAY_ITEM_FONT_SCALE_STEP)}
                                  disabled={selectedOverlayItemFontScale <= OCR_OVERLAY_ITEM_FONT_SCALE_MIN}
                                >
                                  -
                                </Button>
                                <span className="min-w-[44px] text-center text-[11px] font-medium text-foreground">
                                  {selectedOverlayItemFontLabel}
                                </span>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="h-6 w-6 p-0 text-[11px]"
                                  onClick={() => handleAdjustSelectedOverlayItemFont(OCR_OVERLAY_ITEM_FONT_SCALE_STEP)}
                                  disabled={selectedOverlayItemFontScale >= OCR_OVERLAY_ITEM_FONT_SCALE_MAX}
                                >
                                  +
                                </Button>
                              </div>
                            </div>

                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[11px] text-muted-foreground">Tamanho</span>
                              <div className="flex items-center gap-1">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="h-6 w-6 p-0 text-[11px]"
                                  onClick={() => handleAdjustSelectedOverlayItemSize(-OCR_OVERLAY_ITEM_SIZE_STEP)}
                                  disabled={selectedOverlayItemSizeScale <= OCR_OVERLAY_ITEM_SIZE_MIN}
                                >
                                  -
                                </Button>
                                <span className="min-w-[44px] text-center text-[11px] font-medium text-foreground">
                                  {selectedOverlayItemSizeLabel}
                                </span>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="h-6 w-6 p-0 text-[11px]"
                                  onClick={() => handleAdjustSelectedOverlayItemSize(OCR_OVERLAY_ITEM_SIZE_STEP)}
                                  disabled={selectedOverlayItemSizeScale >= OCR_OVERLAY_ITEM_SIZE_MAX}
                                >
                                  +
                                </Button>
                              </div>
                            </div>

                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[11px] text-muted-foreground">Densidade</span>
                              <div className="flex items-center gap-1">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="h-6 w-6 p-0 text-[11px]"
                                  onClick={() => handleAdjustSelectedOverlayItemDensity(-OCR_OVERLAY_ITEM_DENSITY_STEP)}
                                  disabled={selectedOverlayItemDensity <= OCR_OVERLAY_ITEM_DENSITY_MIN}
                                >
                                  -
                                </Button>
                                <span className="min-w-[44px] text-center text-[11px] font-medium text-foreground">
                                  {selectedOverlayItemDensityLabel}
                                </span>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="h-6 w-6 p-0 text-[11px]"
                                  onClick={() => handleAdjustSelectedOverlayItemDensity(OCR_OVERLAY_ITEM_DENSITY_STEP)}
                                  disabled={selectedOverlayItemDensity >= OCR_OVERLAY_ITEM_DENSITY_MAX}
                                >
                                  +
                                </Button>
                              </div>
                            </div>

                            <div className="flex items-center justify-between gap-2">
                              <Button
                                type="button"
                                size="sm"
                                variant="destructive"
                                className="h-6 px-2 text-[11px]"
                                onClick={() => handleDeleteSelectedOverlayItem()}
                              >
                                Excluir
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="h-6 px-2 text-[11px]"
                                onClick={() => handleResetSelectedOverlayItemAdjustments()}
                              >
                                Resetar
                              </Button>
                            </div>
                          </div>
                        </PopoverContent>
                      </Popover>
                    )}
                  </div>

                  {isCurrentProcessing && (
                    <div className="absolute inset-0 z-20 bg-background/75 flex items-center justify-center">
                      <div className="text-center px-4">
                        <Loader2 className="h-10 w-10 sm:h-12 sm:w-12 animate-spin mx-auto text-primary mb-3" />
                        <p className="text-foreground font-medium text-sm sm:text-base">Processando página...</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {currentReadingPage === sectionImages.length - 1 && suggestedSections.length > 0 && (
              <div className="flex-none border-t border-border bg-card/95 px-3 py-2">
                {!showSuggestions ? (
                  
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShowSuggestions(true)}
                      className="flex flex-1 min-w-0 items-center gap-2.5 rounded-xl border border-border bg-muted/40 px-3 py-2 text-left transition-colors hover:bg-muted/70"
                    >
                      {suggestedSections[0].cover?.image_id ? (
                        <img
                          src={buildImageViewUrl(suggestedSections[0].id, suggestedSections[0].cover.image_id, 'original')}
                          alt=""
                          className="h-7 w-5 rounded object-cover shrink-0"
                          loading="lazy" decoding="async"
                        />
                      ) : (
                        <BookOpen className="h-4 w-4 shrink-0 text-muted-foreground/40" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] font-bold uppercase tracking-wide text-primary leading-none mb-0.5">Próximo</p>
                        <p className="truncate text-[11px] font-semibold text-foreground">{suggestedSections[0].name}</p>
                      </div>
                      <ChevronUp className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    </button>
                    <Link
                      href={`/inicio/secoes/${suggestedSections[0].id}`}
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm"
                    >
                      <ChevronRight className="h-5 w-5" />
                    </Link>
                  </div>
                ) : (
                  
                  <div className="overflow-hidden rounded-xl border border-border">
                    <div className="flex items-center justify-between border-b border-border bg-muted/30 px-3 py-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-[10px] text-muted-foreground shrink-0">Lendo</span>
                        <span className="truncate text-[10px] font-semibold text-foreground">{section?.name ?? '—'}</span>
                      </div>
                      <button type="button" onClick={() => setShowSuggestions(false)} className="ml-2 shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground">
                        <ChevronDown className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <Link
                      href={`/inicio/secoes/${suggestedSections[0].id}`}
                      className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/40 transition-colors group"
                    >
                      {suggestedSections[0].cover?.image_id ? (
                        <img src={buildImageViewUrl(suggestedSections[0].id, suggestedSections[0].cover.image_id, 'original')} alt="" className="h-9 w-7 rounded object-cover shrink-0" loading="lazy" decoding="async" />
                      ) : (
                        <div className="h-9 w-7 rounded bg-muted shrink-0 flex items-center justify-center">
                          <BookOpen className="h-3.5 w-3.5 text-muted-foreground/40" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] font-bold uppercase tracking-wide text-primary">Próximo</p>
                        <p className="truncate text-xs font-semibold text-foreground">{suggestedSections[0].name}</p>
                      </div>
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                        <ChevronRight className="h-4 w-4" />
                      </div>
                    </Link>
                    {suggestedSections.length > 1 && (
                      <div className="border-t border-border">
                        <div className="flex gap-0 overflow-x-auto snap-x snap-mandatory scrollbar-none divide-x divide-border">
                          {suggestedSections.map((s, idx) => {
                            const coverUrl = s.cover?.image_id ? buildImageViewUrl(s.id, s.cover.image_id, 'original') : null
                            return (
                              <Link key={s.id} href={`/inicio/secoes/${s.id}`} className="group relative shrink-0 snap-start w-20 overflow-hidden block">
                                <div className="relative aspect-3/4 w-full">
                                  {coverUrl ? (
                                    <img src={coverUrl} alt={s.name} className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-300" loading="lazy" decoding="async" />
                                  ) : (
                                    <div className="h-full w-full flex items-center justify-center bg-muted"><BookOpen className="h-4 w-4 text-muted-foreground/20" /></div>
                                  )}
                                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
                                  <div className="absolute top-1 left-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-black/50 px-1">
                                    <span className="text-[9px] font-bold text-white/80">{idx + 1}</span>
                                  </div>
                                  <div className="absolute inset-x-0 bottom-0 p-1.5">
                                    <p className="text-[9px] font-semibold leading-tight text-white line-clamp-2">{s.name}</p>
                                  </div>
                                </div>
                              </Link>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="flex-none bg-card border-t border-border p-3 sm:p-4">
              <div className="flex items-center justify-between gap-2 max-w-2xl mx-auto">
                <Button
                  variant="outline"
                  size="lg"
                  onClick={goToPreviousPage}
                  disabled={currentReadingPage === 0}
                  className="h-12 w-20 sm:w-24"
                >
                  <ChevronLeft className="h-5 w-5" />
                  <span className="hidden sm:inline ml-1">Ant.</span>
                </Button>

                <div className="flex-1 max-w-[180px] sm:max-w-[220px]">
                  <select
                    value={currentReadingPage}
                    onChange={(event) => setCurrentReadingPage(Number(event.target.value))}
                    className="w-full h-12 px-3 rounded-md border border-border bg-input text-foreground text-sm sm:text-base font-medium focus:outline-none focus:ring-2 focus:ring-ring appearance-none cursor-pointer text-center"
                    style={{
                      backgroundImage: `url(\"data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%239ca3af' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e\")`,
                      backgroundPosition: 'right 0.5rem center',
                      backgroundRepeat: 'no-repeat',
                      backgroundSize: '1.5em 1.5em',
                      paddingRight: '2.5rem',
                    }}
                  >
                    {sectionImages.map((image, idx) => (
                      <option key={image.id} value={idx}>
                        Página {image.order_index + 1}
                        {isImageTranslated(image) ? ' (Traduzida)' : ''}
                        {isImageProcessing(image) ? ' (Processando)' : ''}
                        {readPages.has(image.id) ? ' ✓' : ''}
                      </option>
                    ))}
                  </select>
                </div>

                {currentReadingPage === sectionImages.length - 1 ? (
                  <Button
                    size="lg"
                    onClick={closeReadingMode}
                    className="h-12 px-3 sm:px-4 bg-green-600 hover:bg-green-700 text-white min-w-[124px]"
                  >
                    <CheckCircle className="h-4 w-4 mr-1" />
                    <span>Concluir</span>
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="lg"
                    onClick={goToNextPage}
                    className="h-12 w-20 sm:w-24"
                  >
                    <span className="hidden sm:inline mr-1">Próx.</span>
                    <ChevronRight className="h-5 w-5" />
                  </Button>
                )}
              </div>
            </div>
          </>
        ) : (
          <div
            ref={readingInteractionZoneRef}
            className="relative flex-1 overflow-auto bg-muted/30"
            style={{ touchAction: 'pan-y' }}
          >
            {isOverlaySelectionMode && (
              <div className="pointer-events-none absolute inset-0 z-[1] bg-black/25" />
            )}
            <div className="flex flex-col items-center p-2 sm:p-4">
              {sectionImages.map((image) => {
                const imgTranslated = isImageTranslated(image)
                const imgUrl = imgTranslated
                  ? buildImageViewUrl(section.id, image.id, 'translated')
                  : buildImageViewUrl(section.id, image.id, 'original')
                const isProcessing = isImageProcessing(image)
                const shouldUseImageOcrOverlay = !imgTranslated
                const imageOverlayItems = filterOverlayItemsByHiddenIds(
                  mergeOverlayItems(
                    mergeOverlayItems(
                      toOverlaySeedItems(image),
                      ocrOverlayByImageId[image.id] ?? []
                    ),
                    ocrOverlayManualItemsByImageId[image.id] ?? []
                  ),
                  ocrOverlayHiddenItemIdsByImageId[image.id] ?? []
                )
                const imageOverlayReferenceSize = resolveImageOverlayReferenceSize(image)
                const imageOverlayLoading = Boolean(
                  ocrOverlayLoadingByImageId[image.id]
                  || ocrOverlayCreatingSelectionByImageId[image.id]
                  || ocrOverlayQueuedImageIds.has(image.id)
                )
                const overlayQuickEditorForImage = (
                  overlayQuickEditorState && overlayQuickEditorState.imageId === image.id
                )
                  ? overlayQuickEditorState
                  : null
                const quickEditorPlacementForImage = (
                  overlayQuickEditorForImage
                  && overlayQuickEditorPlacement
                  && overlayQuickEditorPlacement.imageId === overlayQuickEditorForImage.imageId
                  && overlayQuickEditorPlacement.itemId === overlayQuickEditorForImage.itemId
                )
                  ? {
                    side: overlayQuickEditorPlacement.side,
                    align: overlayQuickEditorPlacement.align,
                  }
                  : resolveQuickEditorPlacement(overlayQuickEditorForImage)
                const selectedOverlayOnImage = (
                  selectedOverlayTarget && selectedOverlayTarget.imageId === image.id
                )
                  ? selectedOverlayTarget
                  : null
                const isRevealed = revealedScrollImageIds.has(image.id)
                return (
                  <div
                    key={image.id}
                    ref={(el) => {
                      if (el && !isRevealed) {
                        scrollImageObserverRef.current?.observe(el)
                      }
                    }}
                    className="relative"
                    data-reader-page-id={image.id}
                    data-ocr-overlay-host={image.id}
                    data-scroll-image-id={image.id}
                    style={{ width: `${zoom}%`, minWidth: '100px' }}
                  >
                    {!isRevealed && (
                      <div className="w-full bg-muted/40" style={{ aspectRatio: '3/4' }} />
                    )}
                    <img
                      src={isRevealed ? imgUrl : undefined}
                      alt={`Página ${image.order_index + 1}`}
                      className={cn(
                        'w-full h-auto block transition-opacity duration-200',
                        !isRevealed && 'hidden',
                        isProcessing && 'opacity-40'
                      )}
                      decoding="async"
                      onLoad={(event) => {
                        markImageAsLoaded(imgUrl)
                        const nextReferenceSize = {
                          width: event.currentTarget.naturalWidth,
                          height: event.currentTarget.naturalHeight,
                        }
                        updateImageNaturalSize(
                          image.id,
                          nextReferenceSize.width,
                          nextReferenceSize.height
                        )

                        if (!shouldUseImageOcrOverlay) return
                        const hiddenIds = ocrOverlayHiddenItemIdsByImageId[image.id] ?? []
                        const hasSeedOverlay = filterOverlayItemsByHiddenIds(toOverlaySeedItems(image), hiddenIds).length > 0
                        const hasManualOverlay = filterOverlayItemsByHiddenIds(
                          ocrOverlayManualItemsByImageId[image.id] ?? [],
                          hiddenIds
                        ).length > 0
                        if (!hasSeedOverlay && !hasManualOverlay) {
                          return
                        }
                        requestOverlayTranslationForImage(image)

                        if (imageOverlayItems.length > 0) {
                          void ensureOverlayColorsForImage(
                            image.id,
                            imgUrl,
                            imageOverlayItems,
                            nextReferenceSize
                          )
                        }
                      }}
                    />
                    {shouldUseImageOcrOverlay && (imageOverlayItems.length > 0 || isOverlaySelectionMode) && (
                      <OcrTextOverlay
                        imageId={image.id}
                        items={imageOverlayItems}
                        referenceSize={imageOverlayReferenceSize}
                        fontScale={ocrOverlayFontScale}
                        boxInsetPercent={ocrOverlayBoxInsetPercent}
                        overlayDensity={ocrOverlayDensity}
                        overlayOpacity={ocrOverlayOpacity}
                        globalShape={ocrOverlayGlobalShape}
                        fontFamilyCss={overlayFontFamilyCss}
                        editable={ocrOverlayEditMode}
                        selectedItemId={selectedOverlayTarget?.imageId === image.id ? selectedOverlayTarget.itemId : null}
                        itemOverrides={ocrOverlayOverridesByImageId[image.id] ?? {}}
                        itemColors={ocrOverlayColorsByImageId[image.id] ?? {}}
                        onSelectItem={handleSelectOverlayItem}
                        onClearSelection={handleClearOverlaySelection}
                        onMoveItem={handleMoveOverlayItem}
                        onResizeItem={handleResizeOverlayItem}
                        onOpenQuickEditor={handleOpenOverlayQuickEditor}
                        dragEnabledItemId={(
                          overlayDragEnabledTarget && overlayDragEnabledTarget.imageId === image.id
                            ? overlayDragEnabledTarget.itemId
                            : null
                        )}
                        selectionModeEnabled={overlaySelectionEnabled}
                        showTranslatingPlaceholder={imageOverlayLoading}
                        textMode={ocrOverlayTextMode}
                        onSelectionDraftReady={handleOverlaySelectionDraftReady}
                        selectionPreviewBox={(
                          overlaySelectionDraft && overlaySelectionDraft.imageId === image.id
                            ? overlaySelectionDraft.box
                            : null
                        )}
                        onSelectionPreviewChange={handleOverlaySelectionDraftChange}
                      />
                    )}
                    {shouldUseImageOcrOverlay && imageOverlayLoading && imageOverlayItems.length === 0 && (
                      <div className="absolute right-2 top-2 rounded-full border border-blue-500/35 bg-blue-500/15 px-2 py-1 text-[10px] font-medium text-blue-600 dark:text-blue-300">
                        Carregando boxes...
                      </div>
                    )}
                    {overlaySelectionDraft && overlaySelectionDraft.imageId === image.id && (
                      <Popover
                        open
                        onOpenChange={(open) => {
                          if (!open) handleDiscardOverlaySelectionDraft()
                        }}
                      >
                        <PopoverAnchor asChild>
                          <div
                            className="absolute z-30 h-0 w-0"
                            style={{
                              left: `${overlaySelectionDraft.leftPercent}%`,
                              top: `${overlaySelectionDraft.topPercent}%`,
                            }}
                          />
                        </PopoverAnchor>
                        <PopoverContent
                          side="top"
                          align="center"
                          sideOffset={10}
                          data-ocr-overlay-selection-confirm="true"
                          className="z-[9999] w-[300px] max-w-[92vw] p-2"
                          onOpenAutoFocus={(event) => event.preventDefault()}
                          onInteractOutside={(event) => {
                            if (isOverlaySelectionPopoverInternalTarget(event.target)) {
                              event.preventDefault()
                            }
                          }}
                          onFocusOutside={(event) => {
                            if (isOverlaySelectionPopoverInternalTarget(event.target)) {
                              event.preventDefault()
                            }
                          }}
                        >
                          <div className="space-y-2">
                            <p className="text-[11px] font-medium text-foreground">Confirmar área selecionada?</p>
                            <div className="grid grid-cols-2 gap-2">
                              <div className="space-y-1">
                                <p className="text-[10px] text-muted-foreground">Entrada</p>
                                <Select
                                  value={overlaySelectionSourceLang}
                                  onValueChange={setOverlaySelectionSourceLang}
                                >
                                  <SelectTrigger data-ocr-overlay-selection-lang-select="true" className="h-7 px-2 text-[11px]">
                                    <SelectValue placeholder="Origem" />
                                  </SelectTrigger>
                                  <SelectContent data-ocr-overlay-selection-lang-select="true" className="z-[10050] max-h-52">
                                    {OCR_OVERLAY_SELECTION_LANGUAGES.map((language) => (
                                      <SelectItem key={`overlay-selection-source-scroll-${language.code}`} value={language.code}>
                                        {language.name}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="space-y-1">
                                <p className="text-[10px] text-muted-foreground">Saída</p>
                                <Select
                                  value={overlaySelectionTargetLang}
                                  onValueChange={setOverlaySelectionTargetLang}
                                >
                                  <SelectTrigger data-ocr-overlay-selection-lang-select="true" className="h-7 px-2 text-[11px]">
                                    <SelectValue placeholder="Destino" />
                                  </SelectTrigger>
                                  <SelectContent data-ocr-overlay-selection-lang-select="true" className="z-[10050] max-h-52">
                                    {OCR_OVERLAY_SELECTION_TARGET_LANGUAGES.map((language) => (
                                      <SelectItem key={`overlay-selection-target-scroll-${language.code}`} value={language.code}>
                                        {language.name}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>
                            <div className="flex items-center justify-end gap-2">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-[11px]"
                                onClick={handleDiscardOverlaySelectionDraft}
                              >
                                Descartar
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                className="h-7 px-2 text-[11px]"
                                onClick={handleConfirmOverlaySelectionDraft}
                              >
                                Confirmar
                              </Button>
                            </div>
                          </div>
                        </PopoverContent>
                      </Popover>
                    )}
                    {overlayQuickEditorForImage && selectedOverlayOnImage && (
                      <Popover
                        open
                        onOpenChange={(open) => {
                          if (!open) handleClearOverlaySelection()
                        }}
                      >
                        <PopoverAnchor asChild>
                          <div
                            className="absolute z-30 h-0 w-0"
                            style={{
                              left: `${overlayQuickEditorForImage.leftPercent}%`,
                              top: `${overlayQuickEditorForImage.topPercent}%`,
                            }}
                          />
                        </PopoverAnchor>
                        <PopoverContent
                          side={quickEditorPlacementForImage.side}
                          align={quickEditorPlacementForImage.align}
                          sideOffset={10}
                          sticky="always"
                          updatePositionStrategy="always"
                          avoidCollisions={false}
                          data-ocr-overlay-quick-editor="true"
                          className="z-[9999] w-[230px] p-2 data-[state=open]:animate-none data-[state=closed]:animate-none"
                          onOpenAutoFocus={(event) => event.preventDefault()}
                          onInteractOutside={(event) => {
                            const target = event.target instanceof HTMLElement ? event.target : null
                            if (target?.closest('[data-ocr-overlay-interactive="true"]')) {
                              event.preventDefault()
                            }
                          }}
                        >
                          <div className="space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <div
                                className="min-w-0 flex-1 cursor-move touch-none rounded border border-border/70 bg-muted/40 px-2 py-1"
                                onPointerDown={(event) => handleStartOverlayQuickEditorDrag(selectedOverlayOnImage.imageId, event)}
                              >
                                <p className="truncate text-[11px] font-semibold text-foreground">
                                  Balão #{selectedOverlayOnImage.itemId}
                                </p>
                              </div>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="h-6 px-1.5 text-[11px]"
                                onClick={handleClearOverlaySelection}
                              >
                                Fechar
                              </Button>
                            </div>

                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[11px] text-muted-foreground">Arrastar</span>
                              <Button
                                type="button"
                                size="sm"
                                variant={selectedOverlayDragEnabled ? 'default' : 'outline'}
                                className="h-6 px-2 text-[11px]"
                                onClick={handleToggleSelectedOverlayDrag}
                              >
                                {selectedOverlayDragEnabled ? 'Habilitado' : 'Desligado'}
                              </Button>
                            </div>

                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[11px] text-muted-foreground">Tipo</span>
                              <div className="flex items-center gap-1">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant={selectedOverlayShape === 'rect' ? 'default' : 'outline'}
                                  className="h-6 px-2 text-[11px]"
                                  onClick={() => handleSetSelectedOverlayShape('rect')}
                                >
                                  Ret
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant={selectedOverlayShape === 'oval' ? 'default' : 'outline'}
                                  className="h-6 px-2 text-[11px]"
                                  onClick={() => handleSetSelectedOverlayShape('oval')}
                                >
                                  Oval
                                </Button>
                              </div>
                            </div>

                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[11px] text-muted-foreground">Fonte</span>
                              <div className="flex items-center gap-1">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="h-6 w-6 p-0 text-[11px]"
                                  onClick={() => handleAdjustSelectedOverlayItemFont(-OCR_OVERLAY_ITEM_FONT_SCALE_STEP)}
                                  disabled={selectedOverlayItemFontScale <= OCR_OVERLAY_ITEM_FONT_SCALE_MIN}
                                >
                                  -
                                </Button>
                                <span className="min-w-[44px] text-center text-[11px] font-medium text-foreground">
                                  {selectedOverlayItemFontLabel}
                                </span>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="h-6 w-6 p-0 text-[11px]"
                                  onClick={() => handleAdjustSelectedOverlayItemFont(OCR_OVERLAY_ITEM_FONT_SCALE_STEP)}
                                  disabled={selectedOverlayItemFontScale >= OCR_OVERLAY_ITEM_FONT_SCALE_MAX}
                                >
                                  +
                                </Button>
                              </div>
                            </div>

                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[11px] text-muted-foreground">Tamanho</span>
                              <div className="flex items-center gap-1">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="h-6 w-6 p-0 text-[11px]"
                                  onClick={() => handleAdjustSelectedOverlayItemSize(-OCR_OVERLAY_ITEM_SIZE_STEP)}
                                  disabled={selectedOverlayItemSizeScale <= OCR_OVERLAY_ITEM_SIZE_MIN}
                                >
                                  -
                                </Button>
                                <span className="min-w-[44px] text-center text-[11px] font-medium text-foreground">
                                  {selectedOverlayItemSizeLabel}
                                </span>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="h-6 w-6 p-0 text-[11px]"
                                  onClick={() => handleAdjustSelectedOverlayItemSize(OCR_OVERLAY_ITEM_SIZE_STEP)}
                                  disabled={selectedOverlayItemSizeScale >= OCR_OVERLAY_ITEM_SIZE_MAX}
                                >
                                  +
                                </Button>
                              </div>
                            </div>

                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[11px] text-muted-foreground">Densidade</span>
                              <div className="flex items-center gap-1">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="h-6 w-6 p-0 text-[11px]"
                                  onClick={() => handleAdjustSelectedOverlayItemDensity(-OCR_OVERLAY_ITEM_DENSITY_STEP)}
                                  disabled={selectedOverlayItemDensity <= OCR_OVERLAY_ITEM_DENSITY_MIN}
                                >
                                  -
                                </Button>
                                <span className="min-w-[44px] text-center text-[11px] font-medium text-foreground">
                                  {selectedOverlayItemDensityLabel}
                                </span>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="h-6 w-6 p-0 text-[11px]"
                                  onClick={() => handleAdjustSelectedOverlayItemDensity(OCR_OVERLAY_ITEM_DENSITY_STEP)}
                                  disabled={selectedOverlayItemDensity >= OCR_OVERLAY_ITEM_DENSITY_MAX}
                                >
                                  +
                                </Button>
                              </div>
                            </div>

                            <div className="flex items-center justify-between gap-2">
                              <Button
                                type="button"
                                size="sm"
                                variant="destructive"
                                className="h-6 px-2 text-[11px]"
                                onClick={() => handleDeleteSelectedOverlayItem()}
                              >
                                Excluir
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="h-6 px-2 text-[11px]"
                                onClick={() => handleResetSelectedOverlayItemAdjustments()}
                              >
                                Resetar
                              </Button>
                            </div>
                          </div>
                        </PopoverContent>
                      </Popover>
                    )}
                    {shouldUseImageOcrOverlay && imageOverlayLoading && (
                      <div className="absolute right-2 top-2 rounded-full border border-blue-500/35 bg-blue-500/15 px-2 py-1 text-[10px] font-medium text-blue-600 dark:text-blue-300">
                        OCR...
                      </div>
                    )}
                    {isProcessing && (
                      <div className="absolute inset-0 bg-background/75 flex items-center justify-center">
                        <div className="text-center px-4">
                          <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary mb-2" />
                          <p className="text-foreground font-medium text-xs">Processando...</p>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}

              {sectionImages.length > 0 && (
              <div className="w-full pt-8 pb-4 flex flex-col items-center gap-4 border-t border-border mt-4">
                <div className="text-center space-y-1">
                  <p className="text-sm font-medium text-foreground">Chegou ao fim da seção!</p>
                  {section?.name && (
                    <p className="text-xs text-muted-foreground truncate max-w-[20ch]" title={section.name}>
                      {section.name}
                    </p>
                  )}
                </div>

                {suggestedSections.length > 0 && (
                  <div className="w-full max-w-xl">
                    {!showSuggestions ? (
                      
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setShowSuggestions(true)}
                          className="flex flex-1 min-w-0 items-center gap-3 rounded-2xl border border-border bg-muted/40 px-4 py-2.5 text-left transition-colors hover:bg-muted/70"
                        >
                          {suggestedSections[0].cover?.image_id ? (
                            <img
                              src={buildImageViewUrl(suggestedSections[0].id, suggestedSections[0].cover.image_id, 'original')}
                              alt=""
                              className="h-9 w-7 rounded-md object-cover shrink-0"
                              loading="lazy" decoding="async"
                            />
                          ) : (
                            <BookOpen className="h-5 w-5 shrink-0 text-muted-foreground/40" />
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-[11px] font-bold uppercase tracking-wide text-primary leading-none mb-0.5">Próximo</p>
                            <p className="truncate text-sm font-semibold text-foreground">{suggestedSections[0].name}</p>
                          </div>
                          <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
                        </button>
                        <Link
                          href={`/inicio/secoes/${suggestedSections[0].id}`}
                          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm hover:scale-105 transition-transform"
                        >
                          <ChevronRight className="h-6 w-6" />
                        </Link>
                      </div>
                    ) : (
                      
                      <div className="overflow-hidden rounded-2xl border border-border">
                        <div className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-2.5">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-xs text-muted-foreground shrink-0">Lendo</span>
                            <span className="truncate text-xs font-semibold text-foreground">{section?.name ?? '—'}</span>
                          </div>
                          <button type="button" onClick={() => setShowSuggestions(false)} className="ml-2 shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground">
                            <ChevronDown className="h-4 w-4" />
                          </button>
                        </div>
                        <Link
                          href={`/inicio/secoes/${suggestedSections[0].id}`}
                          className="flex items-center gap-4 px-4 py-3.5 hover:bg-muted/40 transition-colors group"
                        >
                          {suggestedSections[0].cover?.image_id ? (
                            <img src={buildImageViewUrl(suggestedSections[0].id, suggestedSections[0].cover.image_id, 'original')} alt="" className="h-12 w-9 rounded-lg object-cover shrink-0 shadow-sm" loading="lazy" decoding="async" />
                          ) : (
                            <div className="h-12 w-9 rounded-lg bg-muted shrink-0 flex items-center justify-center">
                              <BookOpen className="h-4 w-4 text-muted-foreground/40" />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-[11px] font-bold uppercase tracking-wide text-primary">Próximo</p>
                            <p className="truncate text-sm font-bold text-foreground">{suggestedSections[0].name}</p>
                          </div>
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm group-hover:scale-105 transition-transform">
                            <ChevronRight className="h-5 w-5" />
                          </div>
                        </Link>
                        {suggestedSections.length > 1 && (
                          <div className="border-t border-border">
                            <div className="flex gap-0 overflow-x-auto snap-x snap-mandatory scrollbar-none divide-x divide-border">
                              {suggestedSections.map((s, idx) => {
                                const coverUrl = s.cover?.image_id ? buildImageViewUrl(s.id, s.cover.image_id, 'original') : null
                                return (
                                  <Link key={s.id} href={`/inicio/secoes/${s.id}`} className="group relative shrink-0 snap-start w-24 overflow-hidden block">
                                    <div className="relative aspect-3/4 w-full">
                                      {coverUrl ? (
                                        <img src={coverUrl} alt={s.name} className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-300" loading="lazy" decoding="async" />
                                      ) : (
                                        <div className="h-full w-full flex items-center justify-center bg-muted"><BookOpen className="h-5 w-5 text-muted-foreground/20" /></div>
                                      )}
                                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
                                      <div className="absolute top-1.5 left-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-black/50 px-1">
                                        <span className="text-[9px] font-bold text-white/80">{idx + 1}</span>
                                      </div>
                                      <div className="absolute inset-x-0 bottom-0 p-2">
                                        <p className="text-[10px] font-semibold leading-tight text-white line-clamp-2">{s.name}</p>
                                      </div>
                                    </div>
                                  </Link>
                                )
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <Button
                  size="sm"
                  onClick={closeReadingMode}
                  className="bg-green-600 hover:bg-green-700 text-white gap-2"
                >
                  <CheckCircle className="h-4 w-4" />
                  Concluir leitura
                </Button>
              </div>
              )}
            </div>
          </div>
        )}

        {isOverlaySelectionMode && (
          <div
            className={cn(
              'pointer-events-none fixed inset-x-0 z-[9998] flex justify-center px-3',
              readingViewMode === 'paginated'
                ? 'bottom-[92px] sm:bottom-[104px]'
                : 'bottom-4 sm:bottom-6'
            )}
          >
            <div className="pointer-events-auto flex w-full max-w-md items-center justify-between gap-3 rounded-xl border border-primary/40 bg-background/95 px-3 py-2.5 shadow-xl backdrop-blur">
              <p className="min-w-0 truncate text-[12px] font-medium text-foreground">Seleção ativa</p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 shrink-0 px-3 text-xs"
                onClick={handleDiscardOverlaySelectionDraft}
              >
                Cancelar
              </Button>
            </div>
          </div>
        )}

      </div>
    )
  }

  return (
    <div className="space-y-4">
      <Card className="p-3 sm:p-5">
        {(() => {
          const hasQueueActionButtons = canShowProcessButton || canShowReprocessButton
          return (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm" className="shrink-0">
              <Link href={backToLibraryHref}>
                <ArrowLeft className="h-4 w-4" />
                <span className="hidden sm:inline">Voltar para biblioteca</span>
              </Link>
            </Button>

            <div className="flex-1" />

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="px-2 sm:px-3"
              title="Atualizar"
              onClick={() => void fetchSection()}
            >
              <RefreshCw className="h-4 w-4" />
              <span className="hidden sm:inline">Atualizar</span>
            </Button>

            {canShowProcessButton && (
              <Button
                type="button"
                size="sm"
                className="px-2 sm:px-3"
                title="Processar seção"
                disabled={queueActionLoading !== null}
                onClick={() => void handleQueueSection()}
              >
                {queueActionLoading === 'queue'
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <Play className="h-4 w-4" />}
                <span>
                  {queueActionLoading === 'queue' ? 'Processando...' : 'Processar'}
                </span>
              </Button>
            )}

            {canShowReprocessButton && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="px-2 sm:px-3"
                title="Reprocessar seção"
                disabled={queueActionLoading !== null}
                onClick={() => void handleReprocessSection()}
              >
                {queueActionLoading === 'reprocess'
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <RotateCcw className="h-4 w-4" />}
                <span>
                  {queueActionLoading === 'reprocess' ? 'Reprocessando...' : 'Reprocessar'}
                </span>
              </Button>
            )}

            {sectionImages.length > 0 && (
              <Button
                data-tour="reading-btn"
                type="button"
                variant="outline"
                size="sm"
                className="px-2 sm:px-3"
                title="Modo Leitura"
                onClick={() => openReadingPage(0)}
              >
                <BookOpen className="h-4 w-4" />
                <span className={cn(hasQueueActionButtons ? 'hidden sm:inline' : 'inline')}>
                  Modo Leitura
                </span>
              </Button>
            )}

          </div>
        </div>
          )
        })()}
      </Card>

      {error && (
        <Card className="p-3 text-sm text-destructive bg-destructive/10 border-destructive/30">
          {error}
        </Card>
      )}

      {success && (
        <Card className="p-3 text-sm text-green-600 dark:text-green-400 bg-green-500/10 border-green-500/30">
          {success}
        </Card>
      )}

      {isLoadingSection ? (
        <Card className="p-8">
          <div className="flex items-center justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            Carregando seção...
          </div>
        </Card>
      ) : !section ? (
        <Card className="p-6 text-sm text-muted-foreground">
          Não foi possível carregar a seção.
        </Card>
      ) : (
        <>
          <Card data-tour="section-info" className="p-4 sm:p-5 space-y-4">
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h1 className="text-xl sm:text-2xl font-semibold text-foreground">{section.name}</h1>
                  <p className="text-sm text-muted-foreground">Seção #{section.id}</p>
                  <div className="mt-2 max-w-sm space-y-1.5">
                    <label htmlFor="section-category-select" className="text-xs font-medium text-muted-foreground">
                      Categoria
                    </label>
                    <Popover
                      open={isSectionCategoryPopoverOpen}
                      onOpenChange={handleSectionCategoryPopoverChange}
                    >
                      <PopoverTrigger asChild>
                        <Button
                          ref={sectionCategoryTriggerRef}
                          id="section-category-select"
                          type="button"
                          variant="outline"
                          role="combobox"
                          aria-expanded={isSectionCategoryPopoverOpen}
                          className="h-9 w-full justify-between gap-2 px-3 text-left text-sm font-normal"
                          disabled={isSectionCategoryLoading || isSectionCategorySaving}
                        >
                          <span className={cn('truncate', !sectionCategoryDraft && 'text-muted-foreground')}>
                            {sectionCategoryDraft || 'Selecione ou crie uma categoria'}
                          </span>
                          {isSectionCategoryLoading || isSectionCategorySaving ? (
                            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                          ) : (
                            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                          )}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent
                        align="start"
                        side="bottom"
                        sideOffset={6}
                        className="max-w-[calc(100vw-1rem)] p-0"
                        style={
                          sectionCategoryPopoverWidth
                            ? { width: `${sectionCategoryPopoverWidth}px` }
                            : undefined
                        }
                      >
                        <Command shouldFilter={false}>
                          <CommandInput
                            value={sectionCategoryQuery}
                            onValueChange={setSectionCategoryQuery}
                            placeholder="Buscar ou criar categoria..."
                            maxLength={SECTION_CATEGORY_MAX_LENGTH}
                            autoFocus
                            onKeyDown={(event) => {
                              if (event.key !== 'Enter') return
                              if (!canCreateSectionCategoryFromQuery) return
                              event.preventDefault()
                              const normalizedQuery = normalizeSectionCategoryValue(sectionCategoryQuery)
                              if (!normalizedQuery) return
                              handleSelectSectionCategory(normalizedQuery)
                            }}
                          />
                          <CommandList className="max-h-56">
                            <CommandEmpty>Nenhuma categoria encontrada.</CommandEmpty>
                            {filteredSectionCategoryOptions.map((category) => {
                              const isActive = toSectionCategoryKey(category) === toSectionCategoryKey(sectionCategoryDraft)
                              return (
                                <CommandItem
                                  key={category}
                                  value={category}
                                  onSelect={() => handleSelectSectionCategory(category)}
                                  className="group text-sm"
                                >
                                  <Check className={cn('h-4 w-4 shrink-0', isActive ? 'opacity-100' : 'opacity-0')} />
                                  <span className="min-w-0 flex-1 truncate">{category}</span>
                                  <button
                                    type="button"
                                    className="ml-1 inline-flex h-6 w-6 items-center justify-center rounded-sm border border-transparent text-muted-foreground/80 transition hover:border-border hover:bg-muted hover:text-destructive"
                                    onPointerDown={(event) => {
                                      event.preventDefault()
                                      event.stopPropagation()
                                    }}
                                    onClick={(event) => {
                                      event.preventDefault()
                                      event.stopPropagation()
                                      handleOpenDeleteCategoryDialog(category)
                                    }}
                                    aria-label={`Excluir categoria ${category}`}
                                    title={`Excluir categoria ${category}`}
                                  >
                                    <X className="h-3.5 w-3.5" />
                                  </button>
                                </CommandItem>
                              )
                            })}
                            {canCreateSectionCategoryFromQuery && (
                              <CommandItem
                                value={`create:${sectionCategoryQuery}`}
                                onSelect={() => {
                                  const normalizedQuery = normalizeSectionCategoryValue(sectionCategoryQuery)
                                  if (!normalizedQuery) return
                                  handleSelectSectionCategory(normalizedQuery)
                                }}
                                className="text-sm"
                              >
                                <span className="truncate">
                                  Criar categoria "{normalizeSectionCategoryValue(sectionCategoryQuery)}"
                                </span>
                              </CommandItem>
                            )}
                            {sectionCategoryDraft && (
                              <CommandItem
                                value="clear-category"
                                onSelect={() => handleSelectSectionCategory('')}
                                className="text-sm text-muted-foreground"
                              >
                                Remover categoria
                              </CommandItem>
                            )}
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                    <p className="text-[11px] text-muted-foreground">
                      Digite para filtrar. Se não existir, selecione "Criar categoria". Ao fechar, salva automaticamente.
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    type="button"
                    variant={isEditingSectionName ? 'secondary' : 'outline'}
                    size="icon"
                    className="h-9 w-9"
                    onClick={() => {
                      if (isEditingSectionName) {
                        handleCancelSectionNameEdit()
                        return
                      }
                      handleStartSectionNameEdit()
                    }}
                    disabled={isRenamingSection}
                    aria-label={isEditingSectionName ? 'Fechar edição de nome' : 'Editar nome da seção'}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-9 w-9 border-destructive/25 text-destructive/70 hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => setIsDeleteDialogOpen(true)}
                    disabled={isDeletingSection}
                    aria-label="Excluir seção"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {isEditingSectionName && (
                <div className="rounded-lg border border-border bg-muted/20 p-3 sm:p-4 space-y-3">
                  <label className="text-sm font-medium text-foreground" htmlFor="section-name-update">
                    Alterar nome da seção
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
                    <Input
                      ref={sectionNameInputRef}
                      id="section-name-update"
                      value={sectionNameDraft}
                      onChange={(event) => setSectionNameDraft(event.target.value)}
                      placeholder="Ex: Capítulo 57 - Parte 2"
                      disabled={isRenamingSection}
                      className="h-10"
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter') return
                        event.preventDefault()
                        void handleRenameSection()
                      }}
                    />
                    <div className="flex items-center gap-2 sm:justify-end">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleCancelSectionNameEdit}
                        disabled={isRenamingSection}
                      >
                        Cancelar
                      </Button>
                      <Button
                        type="button"
                        onClick={() => void handleRenameSection()}
                        disabled={isRenamingSection || !hasPendingSectionNameChange}
                        className="min-w-[124px]"
                      >
                        {isRenamingSection ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Salvando...
                          </>
                        ) : (
                          'Salvar'
                        )}
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-1">
              <Badge variant="secondary">{formatStatus(section.status)}</Badge>
              <Badge variant="outline">{formatStatus(section.internal_status)}</Badge>
              {(() => {
                const priorityInfo = getSectionPriorityInfo(section.priority)
                return (
                  <Badge
                    variant="outline"
                    className={cn(priorityInfo.tier === 'admin' && 'border-primary/50 text-primary')}
                  >
                    {priorityInfo.badgeLabel}
                  </Badge>
                )
              })()}
              <Badge variant="outline">{section.source_lang} → {section.target_lang}</Badge>
              {derivedQueuedCount > 0 && (
                <Badge variant="outline">Fila {derivedQueuedCount}</Badge>
              )}
              {derivedProcessingCount > 0 && (
                <Badge variant="outline">Processando {derivedProcessingCount}</Badge>
              )}
              <Badge variant="outline">{formatProviderLabel(section.provider_lang)}</Badge>
              {sectionStats?.estimatedTotalCostUsd !== null && sectionStats?.estimatedTotalCostUsd !== undefined && (
                <Badge variant="secondary">
                  Custo est.: {sectionStats.estimatedTotalCostUsd.toLocaleString('en-US', {
                    style: 'currency',
                    currency: 'USD',
                    minimumFractionDigits: 6,
                    maximumFractionDigits: 6,
                  })}
                </Badge>
              )}
              {queueState?.completed && (
                <Badge variant="secondary">Concluída</Badge>
              )}
              {shouldShowQueueInProgressBadge && (
                <Badge variant="outline">Em fila/processando</Badge>
              )}
              {shouldPollSectionStatus && (
                <Badge variant="outline" className="gap-1">
                  <Loader2 className={cn('h-3 w-3', isPollingStatus && 'animate-spin')} />
                  Monitorando status
                </Badge>
              )}
            </div>

            {!queueState?.completed && shouldShowQueueInProgressBadge && (
              <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
                {queueActiveJobId !== null ? (
                  <>
                    <div className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
                      <span className="text-sm font-medium text-foreground">
                        {queueStatusLabel}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      {queuePosition !== null && (
                        <span>Posição na fila: <span className="font-medium text-foreground">#{queuePosition}</span></span>
                      )}
                      {(queueJobsAhead ?? 0) > 0 && (
                        <span>À frente: <span className="font-medium text-foreground">{queueJobsAhead}</span></span>
                      )}
                      {(queueEstimatedWaitMinutes ?? 0) > 0 && (
                        <span>Espera: <span className="font-medium text-foreground">~{queueEstimatedWaitMinutes} min</span></span>
                      )}
                      {queueEstimatedStartLabel !== '—' && (
                        <span>Início estimado: <span className="font-medium text-foreground">{queueEstimatedStartLabel}</span></span>
                      )}
                    </div>
                  </>
                ) : null}
              </div>
            )}

            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-xs text-muted-foreground">
                Criada em {formatSectionDate(section.created_at)} • Atualizada em {formatSectionDate(section.updated_at)}
                {' • '}
                {shouldPollSectionStatus ? 'Monitorando status' : 'Sem monitoramento ativo'}
                {lastStatusSyncAt
                  ? ` • ${new Date(lastStatusSyncAt).toLocaleTimeString('pt-BR')}`
                  : ''}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (!isStatsExpanded) {
                      setIsStatsLoading(true)
                    }
                    setIsStatsExpanded((prev) => !prev)
                  }}
                  className="h-7 px-2 text-xs"
                  disabled={isStatsLoading}
                >
                  {isStatsLoading
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <BarChart3 className="h-3.5 w-3.5" />}
                  {isStatsExpanded ? 'Ocultar estatísticas' : 'Estatísticas'}
                </Button>
              </div>
            </div>

            {isStatsExpanded && (
              <div className="relative rounded-lg border border-border bg-muted/20 p-3">
                {isStatsLoading && (
                  <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-background/60 backdrop-blur-[2px]">
                    <div className="flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground shadow-sm">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                      Carregando...
                    </div>
                  </div>
                )}
                {statsError && !isStatsLoading ? (
                  <p className="text-xs text-destructive">{statsError}</p>
                ) : null}
                {isStatsLoading && !sectionStats && (
                  <div className="space-y-2 animate-pulse">
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {[...Array(4)].map((_, i) => (
                        <div key={i} className="space-y-1">
                          <div className="h-2.5 w-20 rounded bg-muted-foreground/20" />
                          <div className="h-4 w-12 rounded bg-muted-foreground/20" />
                        </div>
                      ))}
                    </div>
                    <div className="h-2.5 w-48 rounded bg-muted-foreground/15" />
                  </div>
                )}
                {sectionStats ? (
                  <div className="space-y-2">
                    <div className="grid grid-cols-1 gap-2 text-xs text-muted-foreground sm:grid-cols-2 lg:grid-cols-4">
                      <div>
                        <p className="text-[11px] uppercase tracking-wide">Páginas traduzidas</p>
                        <p className="text-sm font-semibold text-foreground">
                          {sectionStats.completedPages.toLocaleString('pt-BR')}
                          <span className="text-muted-foreground font-normal"> / {sectionStats.totalPages.toLocaleString('pt-BR')}</span>
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] uppercase tracking-wide">Tempo total</p>
                        <p className="text-sm font-semibold text-foreground">
                          {sectionStats.totalElapsedMinutes.toLocaleString('pt-BR', {
                            minimumFractionDigits: 1,
                            maximumFractionDigits: 1,
                          })} min
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] uppercase tracking-wide">Tempo por página</p>
                        <p className="text-sm font-semibold text-foreground">
                          {sectionStats.avgElapsedSecondsPerPage.toLocaleString('pt-BR', {
                            minimumFractionDigits: 1,
                            maximumFractionDigits: 1,
                          })} s
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] uppercase tracking-wide">Balões detectados</p>
                        <p className="text-sm font-semibold text-foreground">
                          {sectionStats.totalDetections.toLocaleString('pt-BR')}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                      <span>OCR concluído: <span className="font-medium text-foreground">{sectionStats.ocrCompletedPages.toLocaleString('pt-BR')}</span></span>
                      <span>Páginas processadas: <span className="font-medium text-foreground">{sectionStats.completedPages.toLocaleString('pt-BR')}</span></span>
                      <span>Com tempo registrado: <span className="font-medium text-foreground">{sectionStats.pagesWithElapsedMs.toLocaleString('pt-BR')}</span></span>
                      {sectionStats.estimatedTotalCostUsd !== null
                        ? (
                          <span>
                            Custo estimado: <span className="font-medium text-foreground">
                              {sectionStats.estimatedTotalCostUsd.toLocaleString('en-US', {
                                style: 'currency',
                                currency: 'USD',
                                minimumFractionDigits: 6,
                                maximumFractionDigits: 6,
                              })}
                            </span>
                            {sectionStats.costModel ? ` (${sectionStats.costModel})` : ''}
                          </span>
                        )
                        : null}
                      {sectionStats.estimatedTotalCostUsd !== null
                        ? (
                          <span>
                            Tokens (in/out): <span className="font-medium text-foreground">
                              {sectionStats.estimatedInputTokens.toLocaleString('pt-BR')} / {sectionStats.estimatedOutputTokens.toLocaleString('pt-BR')}
                            </span>
                          </span>
                        )
                        : null}
                      {sectionStats.generatedAt
                        ? <span>Atualizado: <span className="font-medium text-foreground">{formatSectionDate(sectionStats.generatedAt)}</span></span>
                        : null}
                    </div>
                  </div>
                ) : null}
                {!isStatsLoading && !statsError && sectionStats && sectionStats.pagesWithElapsedMs === 0 && (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Ainda não há tempo de processamento consolidado para calcular média por página.
                  </p>
                )}
              </div>
            )}
          </Card>

          <Card className="p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-foreground">Páginas da seção</h2>
            </div>

            {sectionImages.length === 0 ? (
              isSectionLoadingImagesInBackground ? (
                <div className="flex items-start gap-2 rounded-md border border-blue-500/25 bg-blue-500/10 p-3 text-sm text-blue-700 dark:text-blue-300">
                  <Loader2 className="mt-0.5 h-4 w-4 animate-spin" />
                  <div className="space-y-1">
                    <p className="font-medium">Carregando dados da seção...</p>
                    <p className="text-xs text-blue-700/90 dark:text-blue-300/90">
                      O upload foi recebido e as páginas estão sendo preparadas em background. Isso pode levar alguns segundos.
                    </p>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Sem páginas cadastradas nesta seção.</p>
              )
            ) : (
              <>
                <div data-tour="images-grid" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                  {sectionImages.slice(0, sectionGridVisibleCount).map((image, idx) => {
                  const translatedAvailable = isImageTranslated(image)
                  const originalViewUrl = buildImageViewUrl(section.id, image.id, 'original')
                  const translatedViewUrl = buildImageViewUrl(section.id, image.id, 'translated')
                  const previewUrl = translatedAvailable ? translatedViewUrl : originalViewUrl
                  const isPreviewLoaded = Boolean(loadedImageUrls[previewUrl])
                  const isProcessing = isImageProcessing(image)
                  const shouldUseImageOcrOverlay = !translatedAvailable
                  const imageOverlayItems = filterOverlayItemsByHiddenIds(
                    mergeOverlayItems(
                      mergeOverlayItems(
                        toOverlaySeedItems(image),
                        ocrOverlayByImageId[image.id] ?? []
                      ),
                      ocrOverlayManualItemsByImageId[image.id] ?? []
                    ),
                    ocrOverlayHiddenItemIdsByImageId[image.id] ?? []
                  )
                  const imageOverlayReferenceSize = resolveImageOverlayReferenceSize(image)
                  const imageOverlayLoading = Boolean(
                    ocrOverlayLoadingByImageId[image.id]
                    || ocrOverlayCreatingSelectionByImageId[image.id]
                    || ocrOverlayQueuedImageIds.has(image.id)
                  )

                  return (
                    <article
                      key={image.id}
                      className="rounded-md border border-border p-2 space-y-2"
                    >
                      <div className="relative min-h-[180px] overflow-hidden rounded-md border border-border bg-muted/30">
                        {!isPreviewLoaded && (
                          <Skeleton className="absolute inset-0 rounded-none" />
                        )}
                        <img
                          src={previewUrl}
                          alt={`Página ${image.order_index + 1} - ${section.name}`}
                          className={cn(
                            'block h-auto w-full transition-opacity duration-200',
                            isPreviewLoaded ? (isProcessing ? 'opacity-40' : 'opacity-100') : 'opacity-0'
                          )}
                          loading="lazy"
                          decoding="async"
                          onLoad={(event) => {
                            markImageAsLoaded(previewUrl)
                            const nextReferenceSize = {
                              width: event.currentTarget.naturalWidth,
                              height: event.currentTarget.naturalHeight,
                            }
                            updateImageNaturalSize(
                              image.id,
                              nextReferenceSize.width,
                              nextReferenceSize.height
                            )

                            if (!shouldUseImageOcrOverlay) return

                            if (imageOverlayItems.length > 0) {
                              void ensureOverlayColorsForImage(
                                image.id,
                                previewUrl,
                                imageOverlayItems,
                                nextReferenceSize
                              )
                            }
                          }}
                          onError={() => markImageAsLoaded(previewUrl)}
                        />
                        {shouldUseImageOcrOverlay && imageOverlayItems.length > 0 && (
                          <OcrTextOverlay
                            imageId={image.id}
                            items={imageOverlayItems}
                            referenceSize={imageOverlayReferenceSize}
                            fontScale={ocrOverlayFontScale}
                            boxInsetPercent={ocrOverlayBoxInsetPercent}
                            overlayDensity={ocrOverlayDensity}
                            overlayOpacity={ocrOverlayOpacity}
                            globalShape={ocrOverlayGlobalShape}
                            fontFamilyCss={overlayFontFamilyCss}
                            editable={false}
                            itemOverrides={ocrOverlayOverridesByImageId[image.id] ?? {}}
                            itemColors={ocrOverlayColorsByImageId[image.id] ?? {}}
                            showTranslatingPlaceholder={imageOverlayLoading}
                            textMode={ocrOverlayTextMode}
                          />
                        )}
                        {shouldUseImageOcrOverlay && imageOverlayLoading && (
                          <div className="absolute right-2 top-2 rounded-full border border-blue-500/35 bg-blue-500/15 px-2 py-1 text-[10px] font-medium text-blue-600 dark:text-blue-300">
                            OCR...
                          </div>
                        )}
                        {isProcessing && (
                          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-background/65">
                            <div className="rounded-full border border-primary/30 bg-background/90 px-3 py-1.5 text-xs font-medium text-primary shadow-sm">
                              <Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin align-[-2px]" />
                              Processando
                            </div>
                          </div>
                        )}

                        <button
                          type="button"
                          onClick={() => openReadingPage(idx)}
                          className="absolute inset-0"
                          aria-label={`Ler página ${image.order_index + 1}`}
                        />
                      </div>

                      <div className="space-y-1">
                        <p className="text-sm font-medium text-foreground truncate" title={image.original_name}>
                          Pág. {image.order_index + 1}
                        </p>

                        <div className="flex flex-wrap gap-1">
                          {!translatedAvailable && (
                            <Badge variant="outline">{formatStatus(image.status)}</Badge>
                          )}
                          <Badge variant={translatedAvailable ? 'secondary' : 'outline'}>
                            {translatedAvailable ? 'Traduzida' : formatStatus(image.translation_status)}
                          </Badge>
                          {readPages.has(image.id) && (
                            <Badge variant="outline" className="border-green-500/60 text-green-600 dark:text-green-400">
                              Lida
                            </Badge>
                          )}
                        </div>
                      </div>

                      {}
                    </article>
                  )
                  })}
                </div>
                {sectionGridVisibleCount < sectionImages.length && (
                  <div className="mt-4 flex flex-col items-center gap-2">
                    <p className="text-xs text-muted-foreground">
                      {sectionGridVisibleCount} de {sectionImages.length} páginas
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-9 min-w-[220px] px-4"
                      onClick={() => {
                        setSectionGridVisibleCount((value) => (
                          Math.min(value + SECTION_GRID_LOAD_MORE_BATCH, sectionImages.length)
                        ))
                      }}
                    >
                      <ChevronDown className="h-4 w-4" />
                      Carregar mais
                    </Button>
                    <div className="h-px w-full max-w-sm bg-border/80" />
                  </div>
                )}
              </>
            )}
          </Card>

          {pageEndSuggestions.length > 0 && (
            <div className="space-y-2">
              <div className="rounded-2xl border border-border bg-card overflow-hidden">
                <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
                  <span className="text-[11px] text-muted-foreground">Lendo agora</span>
                  <span className="truncate text-[11px] font-semibold text-foreground">{section?.name ?? '—'}</span>
                </div>
                <Link
                  href={`/inicio/secoes/${pageEndSuggestions[0].id}?page=${libraryPage}`}
                  className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-muted/40 active:scale-[0.98]"
                >
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-primary">Próximo</p>
                    <p className="truncate text-sm font-bold text-foreground">{pageEndSuggestions[0].name}</p>
                  </div>
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
                    <ChevronRight className="h-5 w-5" />
                  </div>
                </Link>
              </div>

              <div className="overflow-hidden rounded-2xl border border-border bg-card">
                <div className="flex items-center justify-between border-b border-border px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/15">
                      <BookOpen className="h-3.5 w-3.5 text-primary" />
                    </span>
                    <span className="text-sm font-semibold text-foreground">Mais sugestões</span>
                  </div>
                  <span className="text-xs text-muted-foreground">{pageEndSuggestions.length} mangás</span>
                </div>

                <div className="relative">
                  <div
                    ref={suggestionsScrollRef}
                    onScroll={() => {
                      const el = suggestionsScrollRef.current
                      if (!el) return
                      setSuggestionsCanScrollLeft(el.scrollLeft > 4)
                      setSuggestionsCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4)
                    }}
                    className="flex overflow-x-auto snap-x snap-mandatory scrollbar-none divide-x divide-border"
                  >
                    {pageEndSuggestions.map((suggestion, idx) => {
                      const coverUrl = suggestion.cover?.image_id
                        ? buildImageViewUrl(suggestion.id, suggestion.cover.image_id, 'original')
                        : null
                      return (
                        <Link
                          key={suggestion.id}
                          href={`/inicio/secoes/${suggestion.id}?page=${libraryPage}`}
                          className="group relative shrink-0 snap-start w-40 sm:w-48 overflow-hidden block"
                        >
                          <div className="relative aspect-3/4 w-full">
                            {coverUrl ? (
                              <img
                                src={coverUrl}
                                alt={suggestion.name}
                                className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                                loading="lazy"
                                decoding="async"
                              />
                            ) : (
                              <div className="h-full w-full flex items-center justify-center bg-muted">
                                <BookOpen className="h-10 w-10 text-muted-foreground/20" />
                              </div>
                            )}
                            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />
                            <div className="absolute top-2 left-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-black/50 px-1.5 backdrop-blur-sm">
                              <span className="text-[10px] font-bold tabular-nums text-white/80">{idx + 1}</span>
                            </div>
                            <div className="absolute inset-x-0 bottom-0 p-3">
                              <p className="text-xs font-semibold leading-snug text-white line-clamp-2 drop-shadow">
                                {suggestion.name}
                              </p>
                            </div>
                          </div>
                        </Link>
                      )
                    })}
                  </div>

                  {suggestionsCanScrollLeft && (
                    <button
                      type="button"
                      onClick={() => suggestionsScrollRef.current?.scrollBy({ left: -200, behavior: 'smooth' })}
                      className="absolute left-1.5 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm transition-opacity hover:bg-black/80"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                  )}

                  {suggestionsCanScrollRight && (
                    <button
                      type="button"
                      onClick={() => suggestionsScrollRef.current?.scrollBy({ left: 200, behavior: 'smooth' })}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm transition-opacity hover:bg-black/80"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      <Dialog
        open={Boolean(limitModalState)}
        onOpenChange={(open) => {
          if (!open) {
            setLimitModalState(null)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{limitModalState?.title ?? 'Limite atingido'}</DialogTitle>
            <DialogDescription>{limitModalState?.description ?? ''}</DialogDescription>
          </DialogHeader>
          {limitModalState?.details && (
            <p className="text-xs text-muted-foreground">{limitModalState.details}</p>
          )}
          <div className="rounded-md border border-primary/30 bg-primary/10 px-3 py-2">
            <p className="text-sm font-medium text-foreground">Quer continuar traduzindo agora?</p>
            <p className="text-xs text-muted-foreground">
              Ajuste os limites locais da instância para continuar sem pausa.
            </p>
          </div>
          <DialogFooter className="flex-wrap gap-2 sm:justify-end">
            <Button type="button" variant="ghost" onClick={() => setLimitModalState(null)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={isDeleteCategoryDialogOpen}
        onOpenChange={(open) => {
          if (isDeletingCategory) return
          setIsDeleteCategoryDialogOpen(open)
          if (!open) {
            setCategoryToDelete('')
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir categoria</AlertDialogTitle>
            <AlertDialogDescription>
              A categoria "{categoryToDelete}" será excluída.
              Todas as seções vinculadas a essa categoria ficarão sem categoria.
              Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletingCategory}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault()
                void handleDeleteCategory()
              }}
              disabled={isDeletingCategory}
            >
              {isDeletingCategory ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Deletando...
                </>
              ) : (
                'Deletar'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={isDeleteDialogOpen}
        onOpenChange={(open) => {
          if (!isDeletingSection) {
            setIsDeleteDialogOpen(open)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir seção</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação vai remover a seção "{section?.name ?? `#${sectionId}`}" e todos os vínculos dela.
              Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletingSection}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault()
                void handleDeleteSection()
              }}
              disabled={isDeletingSection}
            >
              {isDeletingSection ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Excluindo...
                </>
              ) : (
                'Confirmar exclusão'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <SpotlightTour
        storageKey="tour-reader-v2"
        open={isTourOpen}
        onClose={() => setIsTourOpen(false)}
        steps={READER_TOUR_STEPS}
      />
    </div>
  )
}

const READER_TOUR_STEPS: TourStep[] = [
  {
    title: 'Página da seção',
    description: 'Bem-vindo! Aqui você gerencia as páginas deste capítulo — seleciona quais traduzir, acompanha o progresso e lê o resultado. Siga os passos para conhecer cada recurso.',
  },
  {
    title: 'Informações da seção',
    description: 'Veja o nome, status atual, idiomas e outros detalhes. As badges mostram em tempo real se há páginas na fila, sendo processadas ou com erro.',
    selector: 'section-info',
    tooltipSide: 'bottom',
  },
  {
    title: 'Visualize as páginas',
    description: 'As páginas da seção ficam listadas aqui com status e preview. Toque em qualquer página para abrir no leitor.',
    selector: 'images-grid',
    tooltipSide: 'top',
  },
  {
    title: 'Modo de leitura',
    description: 'Após a tradução, toque aqui para ler as páginas como um leitor de mangá. Você pode navegar por toque ou teclado, fazer zoom, e alternar entre paginação e scroll contínuo.',
    selector: 'reading-btn',
    tooltipSide: 'bottom',
  },
]
