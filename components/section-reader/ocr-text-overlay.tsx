'use client'
// Sobreposição do texto do OCR sobre a página (leitor de seções), separada de
// section-reader.tsx sem mudar o comportamento.

import { Fragment, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

import {
  OCR_OVERLAY_FONT_SCALE_MIN,
  OCR_OVERLAY_FONT_SCALE_MAX,
  OCR_OVERLAY_DEFAULT_FONT_SCALE,
  OCR_OVERLAY_DEFAULT_SHAPE,
  OCR_OVERLAY_BOX_INSET_MIN,
  OCR_OVERLAY_BOX_INSET_MAX,
  OCR_OVERLAY_ITEM_FONT_SCALE_MIN,
  OCR_OVERLAY_ITEM_FONT_SCALE_MAX,
  OCR_OVERLAY_ITEM_FONT_SCALE_DEFAULT,
  OCR_OVERLAY_DENSITY_MIN,
  OCR_OVERLAY_DENSITY_MAX,
  OCR_OVERLAY_OPACITY_MIN,
  OCR_OVERLAY_OPACITY_MAX,
  OCR_OVERLAY_OPACITY_DEFAULT,
  OCR_OVERLAY_ITEM_DENSITY_MIN,
  OCR_OVERLAY_ITEM_DENSITY_MAX,
  OCR_OVERLAY_ITEM_DENSITY_DEFAULT,
  OCR_OVERLAY_ITEM_SIZE_MIN,
  OCR_OVERLAY_ITEM_SIZE_MAX,
  OCR_OVERLAY_ITEM_SIZE_DEFAULT,
  OCR_OVERLAY_ITEM_AXIS_SCALE_MIN,
  OCR_OVERLAY_ITEM_AXIS_SCALE_MAX,
  OCR_OVERLAY_ITEM_AXIS_SCALE_DEFAULT,
  OCR_OVERLAY_QUICK_EDITOR_DOUBLE_TAP_MS,
  OCR_OVERLAY_QUICK_EDITOR_TAP_MOVE_PX,
  clampPercent,
  clampRange,
  type OcrOverlayItem,
  type OcrOverlayShape,
  type OcrOverlayTextMode,
  type OcrOverlayItemOverride,
  type OcrOverlayItemColors,
  type ImageNaturalSize,
} from './model'


export function OcrTextOverlay({
  imageId,
  items,
  referenceSize,
  fontScale,
  boxInsetPercent,
  overlayDensity,
  overlayOpacity = OCR_OVERLAY_OPACITY_DEFAULT,
  globalShape = OCR_OVERLAY_DEFAULT_SHAPE,
  fontFamilyCss,
  visualScale = 1,
  editable = false,
  selectedItemId = null,
  itemOverrides = {},
  itemColors = {},
  onSelectItem,
  onClearSelection,
  onMoveItem,
  onResizeItem,
  onOpenQuickEditor,
  dragEnabledItemId = null,
  selectionModeEnabled = false,
  showTranslatingPlaceholder = false,
  textMode = 'translated',
  onSelectionDraftReady,
  selectionPreviewBox = null,
  onSelectionPreviewChange,
}: {
  imageId: number
  items: OcrOverlayItem[]
  referenceSize: ImageNaturalSize | null
  fontScale: number
  boxInsetPercent: number
  overlayDensity: number
  overlayOpacity?: number
  globalShape?: OcrOverlayShape
  fontFamilyCss: string
  visualScale?: number
  editable?: boolean
  selectedItemId?: number | null
  itemOverrides?: Record<number, OcrOverlayItemOverride>
  itemColors?: Record<number, OcrOverlayItemColors>
  onSelectItem?: (imageId: number, itemId: number) => void
  onClearSelection?: () => void
  onMoveItem?: (imageId: number, itemId: number, dx: number, dy: number) => void
  onResizeItem?: (
    imageId: number,
    itemId: number,
    payload: { dx: number; dy: number; widthScale: number; heightScale: number }
  ) => void
  onOpenQuickEditor?: (payload: { imageId: number; itemId: number; leftPercent: number; topPercent: number }) => void
  dragEnabledItemId?: number | null
  selectionModeEnabled?: boolean
  showTranslatingPlaceholder?: boolean
  textMode?: OcrOverlayTextMode
  onSelectionDraftReady?: (payload: {
    imageId: number
    box: [number, number, number, number]
    leftPercent: number
    topPercent: number
  }) => void
  selectionPreviewBox?: [number, number, number, number] | null
  onSelectionPreviewChange?: (payload: {
    imageId: number
    box: [number, number, number, number]
    leftPercent: number
    topPercent: number
  }) => void
}) {
  const overlayRef = useRef<HTMLDivElement | null>(null)
  const lastTapRef = useRef<{ itemId: number; at: number; x: number; y: number } | null>(null)
  const [overlaySize, setOverlaySize] = useState<ImageNaturalSize | null>(null)
  const [selectionDraft, setSelectionDraft] = useState<{
    startX: number
    startY: number
    currentX: number
    currentY: number
  } | null>(null)

  useEffect(() => {
    const element = overlayRef.current
    if (!element) return

    const updateSize = () => {
      setOverlaySize({
        width: element.clientWidth,
        height: element.clientHeight,
      })
    }

    updateSize()

    const observer = new ResizeObserver(() => updateSize())
    observer.observe(element)
    window.addEventListener('resize', updateSize)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateSize)
    }
  }, [])

  if (!referenceSize) return null
  if (items.length === 0 && !selectionModeEnabled && !selectionPreviewBox) return null

  const { width: refWidth, height: refHeight } = referenceSize
  if (refWidth <= 0 || refHeight <= 0) return null

  const safeFontScale = clampRange(fontScale, OCR_OVERLAY_FONT_SCALE_MIN, OCR_OVERLAY_FONT_SCALE_MAX)
  const safeBoxInsetPercent = clampRange(boxInsetPercent, OCR_OVERLAY_BOX_INSET_MIN, OCR_OVERLAY_BOX_INSET_MAX)
  const safeOverlayDensity = clampRange(overlayDensity, OCR_OVERLAY_DENSITY_MIN, OCR_OVERLAY_DENSITY_MAX)
  const safeOverlayOpacity = clampRange(overlayOpacity, OCR_OVERLAY_OPACITY_MIN, OCR_OVERLAY_OPACITY_MAX)
  const safeVisualScale = clampRange(visualScale, 0.1, 6)
  const ratioX = overlaySize?.width ? (overlaySize.width / refWidth) * safeVisualScale : safeVisualScale
  const ratioY = overlaySize?.height ? (overlaySize.height / refHeight) * safeVisualScale : safeVisualScale
  const selectionPreviewData = (() => {
    if (!selectionPreviewBox) return null
    const [rawX1, rawY1, rawX2, rawY2] = selectionPreviewBox
    const x1 = clampRange(Math.min(rawX1, rawX2), 0, refWidth)
    const y1 = clampRange(Math.min(rawY1, rawY2), 0, refHeight)
    const x2 = clampRange(Math.max(rawX1, rawX2), 0, refWidth)
    const y2 = clampRange(Math.max(rawY1, rawY2), 0, refHeight)
    if (x2 <= x1 || y2 <= y1) return null

    return {
      x1,
      y1,
      x2,
      y2,
      left: `${clampPercent((x1 / refWidth) * 100)}%`,
      top: `${clampPercent((y1 / refHeight) * 100)}%`,
      width: `${clampPercent(((x2 - x1) / refWidth) * 100)}%`,
      height: `${clampPercent(((y2 - y1) / refHeight) * 100)}%`,
      leftPercent: clampPercent(((x1 + x2) / 2 / refWidth) * 100),
      topPercent: clampPercent((y1 / refHeight) * 100),
    }
  })()

  const handleResizeSelectionPreview = (
    corner: 'top-left' | 'bottom-right',
    event: React.PointerEvent<HTMLDivElement>
  ) => {
    if (!selectionPreviewData || !onSelectionPreviewChange) return
    event.preventDefault()
    event.stopPropagation()

    const pointerTarget = event.currentTarget
    try {
      pointerTarget.setPointerCapture(event.pointerId)
    } catch {
    }

    const pointerId = event.pointerId
    const minScreenPx = 18
    const anchorX = corner === 'top-left' ? selectionPreviewData.x2 : selectionPreviewData.x1
    const anchorY = corner === 'top-left' ? selectionPreviewData.y2 : selectionPreviewData.y1

    const getOverlayRect = () => {
      const rect = overlayRef.current?.getBoundingClientRect()
      if (!rect || rect.width <= 0 || rect.height <= 0) return null
      return rect
    }

    const getPointerCoords = (clientX: number, clientY: number) => {
      const rect = getOverlayRect()
      if (!rect) return null
      const px = clampRange(clientX - rect.left, 0, rect.width)
      const py = clampRange(clientY - rect.top, 0, rect.height)
      const x = clampRange((px / rect.width) * refWidth, 0, refWidth)
      const y = clampRange((py / rect.height) * refHeight, 0, refHeight)
      const minW = Math.max(1, (minScreenPx / rect.width) * refWidth)
      const minH = Math.max(1, (minScreenPx / rect.height) * refHeight)
      return { x, y, minW, minH }
    }

    const emitBox = (x1: number, y1: number, x2: number, y2: number) => {
      const nextX1 = Math.round(clampRange(Math.min(x1, x2), 0, refWidth))
      const nextY1 = Math.round(clampRange(Math.min(y1, y2), 0, refHeight))
      const nextX2 = Math.round(clampRange(Math.max(x1, x2), 0, refWidth))
      const nextY2 = Math.round(clampRange(Math.max(y1, y2), 0, refHeight))
      if (nextX2 <= nextX1 || nextY2 <= nextY1) return

      onSelectionPreviewChange({
        imageId,
        box: [nextX1, nextY1, nextX2, nextY2],
        leftPercent: clampPercent(((nextX1 + nextX2) / 2 / refWidth) * 100),
        topPercent: clampPercent((nextY1 / refHeight) * 100),
      })
    }

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const coords = getPointerCoords(moveEvent.clientX, moveEvent.clientY)
      if (!coords) return

      if (corner === 'top-left') {
        const nextX1 = clampRange(coords.x, 0, anchorX - coords.minW)
        const nextY1 = clampRange(coords.y, 0, anchorY - coords.minH)
        emitBox(nextX1, nextY1, anchorX, anchorY)
        return
      }

      const nextX2 = clampRange(coords.x, anchorX + coords.minW, refWidth)
      const nextY2 = clampRange(coords.y, anchorY + coords.minH, refHeight)
      emitBox(anchorX, anchorY, nextX2, nextY2)
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
  }

  const handleOverlayPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return
    if (!selectionModeEnabled || !onSelectionDraftReady) {
      onClearSelection?.()
      return
    }

    event.preventDefault()
    event.stopPropagation()
    const pointerTarget = event.currentTarget
    try {
      pointerTarget.setPointerCapture(event.pointerId)
    } catch {
    }

    const overlayElement = overlayRef.current
    const overlayRect = overlayElement?.getBoundingClientRect()
    if (!overlayRect || overlayRect.width <= 0 || overlayRect.height <= 0) {
      return
    }
    const pointerId = event.pointerId

    const resolveOverlayRect = () => {
      const activeRect = overlayRef.current?.getBoundingClientRect()
      if (activeRect && activeRect.width > 0 && activeRect.height > 0) {
        return activeRect
      }
      return overlayRect
    }

    const startX = clampRange(event.clientX - overlayRect.left, 0, overlayRect.width)
    const startY = clampRange(event.clientY - overlayRect.top, 0, overlayRect.height)
    setSelectionDraft({
      startX,
      startY,
      currentX: startX,
      currentY: startY,
    })

    const finalizeSelection = (clientX: number, clientY: number) => {
      const activeRect = resolveOverlayRect()
      const endX = clampRange(clientX - activeRect.left, 0, activeRect.width)
      const endY = clampRange(clientY - activeRect.top, 0, activeRect.height)
      const leftPx = Math.min(startX, endX)
      const topPx = Math.min(startY, endY)
      const widthPx = Math.abs(endX - startX)
      const heightPx = Math.abs(endY - startY)

      setSelectionDraft(null)
      if (widthPx < 12 || heightPx < 12) return

      const x1 = clampRange((leftPx / activeRect.width) * refWidth, 0, refWidth)
      const y1 = clampRange((topPx / activeRect.height) * refHeight, 0, refHeight)
      const x2 = clampRange(((leftPx + widthPx) / activeRect.width) * refWidth, 0, refWidth)
      const y2 = clampRange(((topPx + heightPx) / activeRect.height) * refHeight, 0, refHeight)
      if (x2 <= x1 || y2 <= y1) return

      onSelectionDraftReady({
        imageId,
        box: [
          Math.round(x1),
          Math.round(y1),
          Math.round(x2),
          Math.round(y2),
        ],
        leftPercent: clampPercent(((x1 + x2) / 2 / refWidth) * 100),
        topPercent: clampPercent((y1 / refHeight) * 100),
      })
    }

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const activeRect = resolveOverlayRect()
      const nextX = clampRange(moveEvent.clientX - activeRect.left, 0, activeRect.width)
      const nextY = clampRange(moveEvent.clientY - activeRect.top, 0, activeRect.height)
      setSelectionDraft({
        startX,
        startY,
        currentX: nextX,
        currentY: nextY,
      })
    }

    const clearPointerListeners = () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerCancel)
      try {
        pointerTarget.releasePointerCapture(pointerId)
      } catch {
      }
    }

    const handlePointerUp = (upEvent: PointerEvent) => {
      clearPointerListeners()
      finalizeSelection(upEvent.clientX, upEvent.clientY)
    }

    const handlePointerCancel = () => {
      clearPointerListeners()
      setSelectionDraft(null)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerCancel)
  }

  return (
    <div
      ref={overlayRef}
      data-ocr-overlay-interactive="true"
      onPointerDown={handleOverlayPointerDown}
      className={cn(
        'absolute inset-0 z-10',
        (editable || Boolean(onOpenQuickEditor) || selectionModeEnabled)
          ? 'pointer-events-auto'
          : 'pointer-events-none',
        selectionModeEnabled && 'cursor-crosshair touch-none'
      )}
    >
      {selectionModeEnabled && (
        <div className="pointer-events-none absolute inset-0 z-[5] bg-black/35" />
      )}
      {selectionPreviewData && (
        <>
          <div
            className="pointer-events-none absolute z-[38] rounded-[4px] border border-primary bg-primary/20 ring-1 ring-primary/60"
            style={{
              left: selectionPreviewData.left,
              top: selectionPreviewData.top,
              width: selectionPreviewData.width,
              height: selectionPreviewData.height,
            }}
          />
          {onSelectionPreviewChange && (
            <>
              <div
                className="absolute z-[39] h-8 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary bg-background shadow-md touch-none cursor-nwse-resize"
                style={{
                  left: `${clampPercent((selectionPreviewData.x1 / refWidth) * 100)}%`,
                  top: `${clampPercent((selectionPreviewData.y1 / refHeight) * 100)}%`,
                }}
                onPointerDown={(event) => handleResizeSelectionPreview('top-left', event)}
                aria-label="Redimensionar canto superior esquerdo"
                role="button"
              />
              <div
                className="absolute z-[39] h-8 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary bg-background shadow-md touch-none cursor-nwse-resize"
                style={{
                  left: `${clampPercent((selectionPreviewData.x2 / refWidth) * 100)}%`,
                  top: `${clampPercent((selectionPreviewData.y2 / refHeight) * 100)}%`,
                }}
                onPointerDown={(event) => handleResizeSelectionPreview('bottom-right', event)}
                aria-label="Redimensionar canto inferior direito"
                role="button"
              />
            </>
          )}
        </>
      )}
      {selectionDraft && (
        <div
          className="pointer-events-none absolute z-40 rounded-[4px] border border-primary/80 bg-primary/20"
          style={{
            left: `${Math.min(selectionDraft.startX, selectionDraft.currentX)}px`,
            top: `${Math.min(selectionDraft.startY, selectionDraft.currentY)}px`,
            width: `${Math.abs(selectionDraft.currentX - selectionDraft.startX)}px`,
            height: `${Math.abs(selectionDraft.currentY - selectionDraft.startY)}px`,
          }}
        />
      )}
      {items.map((item) => {
        const [x1, y1, x2, y2] = item.box
        const boxWidth = x2 - x1
        const boxHeight = y2 - y1
        if (boxWidth <= 0 || boxHeight <= 0) return null

        const insetX = (boxWidth * safeBoxInsetPercent) / 100
        const insetY = (boxHeight * safeBoxInsetPercent) / 100

        let adjustedX1 = x1 + insetX
        let adjustedY1 = y1 + insetY
        let adjustedX2 = x2 - insetX
        let adjustedY2 = y2 - insetY

        adjustedX1 = clampRange(adjustedX1, 0, refWidth)
        adjustedX2 = clampRange(adjustedX2, 0, refWidth)
        adjustedY1 = clampRange(adjustedY1, 0, refHeight)
        adjustedY2 = clampRange(adjustedY2, 0, refHeight)

        if (adjustedX2 - adjustedX1 < 2 || adjustedY2 - adjustedY1 < 2) {
          adjustedX1 = x1
          adjustedY1 = y1
          adjustedX2 = x2
          adjustedY2 = y2
        }

        const adjustedWidth = adjustedX2 - adjustedX1
        const adjustedHeight = adjustedY2 - adjustedY1
        if (adjustedWidth <= 0 || adjustedHeight <= 0) return null

        const override = itemOverrides[item.id]
        const offsetX = override?.dx ?? 0
        const offsetY = override?.dy ?? 0
        const itemFontScale = clampRange(
          override?.fontScale ?? OCR_OVERLAY_ITEM_FONT_SCALE_DEFAULT,
          OCR_OVERLAY_ITEM_FONT_SCALE_MIN,
          OCR_OVERLAY_ITEM_FONT_SCALE_MAX
        )
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
        const itemDensity = clampRange(
          override?.density ?? OCR_OVERLAY_ITEM_DENSITY_DEFAULT,
          OCR_OVERLAY_ITEM_DENSITY_MIN,
          OCR_OVERLAY_ITEM_DENSITY_MAX
        )
        const shape = override?.shape ?? globalShape

        let movedX1 = adjustedX1 + offsetX
        let movedX2 = adjustedX2 + offsetX
        let movedY1 = adjustedY1 + offsetY
        let movedY2 = adjustedY2 + offsetY

        if (movedX1 < 0) {
          const shift = -movedX1
          movedX1 += shift
          movedX2 += shift
        }
        if (movedX2 > refWidth) {
          const shift = movedX2 - refWidth
          movedX1 -= shift
          movedX2 -= shift
        }
        if (movedY1 < 0) {
          const shift = -movedY1
          movedY1 += shift
          movedY2 += shift
        }
        if (movedY2 > refHeight) {
          const shift = movedY2 - refHeight
          movedY1 -= shift
          movedY2 -= shift
        }

        movedX1 = clampRange(movedX1, 0, refWidth)
        movedY1 = clampRange(movedY1, 0, refHeight)
        movedX2 = clampRange(movedX2, 0, refWidth)
        movedY2 = clampRange(movedY2, 0, refHeight)

        let movedWidth = movedX2 - movedX1
        let movedHeight = movedY2 - movedY1
        if (movedWidth <= 0 || movedHeight <= 0) return null

        const centerX = movedX1 + movedWidth / 2
        const centerY = movedY1 + movedHeight / 2
        movedWidth = movedWidth * itemSizeScale * itemWidthScale
        movedHeight = movedHeight * itemSizeScale * itemHeightScale
        movedX1 = centerX - movedWidth / 2
        movedX2 = centerX + movedWidth / 2
        movedY1 = centerY - movedHeight / 2
        movedY2 = centerY + movedHeight / 2

        if (movedX1 < 0) {
          const shift = -movedX1
          movedX1 += shift
          movedX2 += shift
        }
        if (movedX2 > refWidth) {
          const shift = movedX2 - refWidth
          movedX1 -= shift
          movedX2 -= shift
        }
        if (movedY1 < 0) {
          const shift = -movedY1
          movedY1 += shift
          movedY2 += shift
        }
        if (movedY2 > refHeight) {
          const shift = movedY2 - refHeight
          movedY1 -= shift
          movedY2 -= shift
        }

        movedX1 = clampRange(movedX1, 0, refWidth)
        movedY1 = clampRange(movedY1, 0, refHeight)
        movedX2 = clampRange(movedX2, 0, refWidth)
        movedY2 = clampRange(movedY2, 0, refHeight)
        movedWidth = movedX2 - movedX1
        movedHeight = movedY2 - movedY1
        if (movedWidth <= 0 || movedHeight <= 0) return null

        const left = clampPercent((movedX1 / refWidth) * 100)
        const top = clampPercent((movedY1 / refHeight) * 100)
        const width = clampPercent((movedWidth / refWidth) * 100)
        const height = clampPercent((movedHeight / refHeight) * 100)
        const hasTranslatedText = item.translatedText.trim().length > 0
        const hasOcrText = item.ocrText.trim().length > 0
        const originalTextValue = item.ocrText || item.translatedText
        const translatedTextValue = (
          showTranslatingPlaceholder
          && hasOcrText
          && !hasTranslatedText
        )
          ? 'Traduzindo...'
          : (item.translatedText || item.ocrText)
        const textValue = textMode === 'original'
          ? originalTextValue
          : translatedTextValue
        const displayedWidth = Math.max(1, movedWidth * ratioX)
        const displayedHeight = Math.max(1, movedHeight * ratioY)
        const baseFontPxUnscaled = movedHeight * 0.23 * Math.min(ratioX, ratioY) * OCR_OVERLAY_DEFAULT_FONT_SCALE
        const baseFontPx = movedHeight * 0.23 * Math.min(ratioX, ratioY) * safeFontScale
        const compactText = textValue.replace(/\s+/g, ' ').trim()
        const explicitLineCount = Math.max(1, textValue.split('\n').length)
        const approxCharsPerLine = Math.max(1, Math.floor(displayedWidth / Math.max(1, baseFontPxUnscaled * 0.56)))
        const longestWordLength = compactText
          .split(/\s+/)
          .reduce((max, token) => Math.max(max, token.length), 1)
        const estimatedLineCount = Math.max(
          explicitLineCount,
          Math.ceil(Math.max(1, compactText.length) / approxCharsPerLine)
        )
        const maxFontByHeight = displayedHeight / Math.max(1, estimatedLineCount * 1.2)
        const maxFontByWidth = displayedWidth / Math.max(2, longestWordLength * 0.62)
        const fitFontSize = Math.min(baseFontPx, maxFontByHeight, maxFontByWidth)
        const fontSize = clampRange(fitFontSize * itemFontScale, 2, 120)
        const sampledColors = itemColors[item.id]
        const effectiveDensity = clampRange(
          safeOverlayDensity * itemDensity,
          OCR_OVERLAY_DENSITY_MIN,
          OCR_OVERLAY_DENSITY_MAX * OCR_OVERLAY_ITEM_DENSITY_MAX
        )
        const baseAlpha = sampledColors?.baseAlpha ?? 0.88
        const backgroundAlpha = clampRange(baseAlpha * effectiveDensity * safeOverlayOpacity, 0.08, 0.98)
        const backgroundColor = sampledColors
          ? `rgba(${sampledColors.red}, ${sampledColors.green}, ${sampledColors.blue}, ${backgroundAlpha})`
          : `rgba(255, 255, 255, ${backgroundAlpha})`
        const textColor = sampledColors?.textColor ?? 'rgba(15,23,42,0.96)'
        const isSelected = editable && selectedItemId === item.id
        const isDragEnabledForItem = editable && dragEnabledItemId === item.id
        const showResizeHandles = Boolean(
          editable
          && isSelected
          && onResizeItem
          && !selectionModeEnabled
          && !selectionPreviewData
        )

        const handleResizePointerDown = (
          corner: 'top-left' | 'bottom-right',
          event: React.PointerEvent<HTMLDivElement>
        ) => {
          if (!onResizeItem) return
          event.preventDefault()
          event.stopPropagation()

          const pointerTarget = event.currentTarget
          try {
            pointerTarget.setPointerCapture(event.pointerId)
          } catch {
          }

          const pointerId = event.pointerId
          const minScreenPx = 18
          const anchorX = corner === 'top-left' ? movedX2 : movedX1
          const anchorY = corner === 'top-left' ? movedY2 : movedY1
          const baseWidth = Math.max(1, adjustedWidth)
          const baseHeight = Math.max(1, adjustedHeight)
          const baseCenterX = adjustedX1 + adjustedWidth / 2
          const baseCenterY = adjustedY1 + adjustedHeight / 2

          const getOverlayRect = () => {
            const rect = overlayRef.current?.getBoundingClientRect()
            if (!rect || rect.width <= 0 || rect.height <= 0) return null
            return rect
          }

          const handlePointerMove = (moveEvent: PointerEvent) => {
            const rect = getOverlayRect()
            if (!rect) return

            const pointerPxX = clampRange(moveEvent.clientX - rect.left, 0, rect.width)
            const pointerPxY = clampRange(moveEvent.clientY - rect.top, 0, rect.height)
            const pointerX = clampRange((pointerPxX / rect.width) * refWidth, 0, refWidth)
            const pointerY = clampRange((pointerPxY / rect.height) * refHeight, 0, refHeight)
            const minWidth = Math.max(1, (minScreenPx / rect.width) * refWidth)
            const minHeight = Math.max(1, (minScreenPx / rect.height) * refHeight)

            let targetWidth: number
            let targetHeight: number
            if (corner === 'top-left') {
              targetWidth = clampRange(anchorX - pointerX, minWidth, refWidth)
              targetHeight = clampRange(anchorY - pointerY, minHeight, refHeight)
            } else {
              targetWidth = clampRange(pointerX - anchorX, minWidth, refWidth)
              targetHeight = clampRange(pointerY - anchorY, minHeight, refHeight)
            }

            const nextWidthScale = clampRange(
              targetWidth / Math.max(1, baseWidth * itemSizeScale),
              OCR_OVERLAY_ITEM_AXIS_SCALE_MIN,
              OCR_OVERLAY_ITEM_AXIS_SCALE_MAX
            )
            const nextHeightScale = clampRange(
              targetHeight / Math.max(1, baseHeight * itemSizeScale),
              OCR_OVERLAY_ITEM_AXIS_SCALE_MIN,
              OCR_OVERLAY_ITEM_AXIS_SCALE_MAX
            )
            const nextWidth = baseWidth * itemSizeScale * nextWidthScale
            const nextHeight = baseHeight * itemSizeScale * nextHeightScale

            let nextX1 = corner === 'top-left' ? anchorX - nextWidth : anchorX
            let nextY1 = corner === 'top-left' ? anchorY - nextHeight : anchorY
            let nextX2 = corner === 'top-left' ? anchorX : anchorX + nextWidth
            let nextY2 = corner === 'top-left' ? anchorY : anchorY + nextHeight

            if (nextX1 < 0) {
              const shift = -nextX1
              nextX1 += shift
              nextX2 += shift
            }
            if (nextX2 > refWidth) {
              const shift = nextX2 - refWidth
              nextX1 -= shift
              nextX2 -= shift
            }
            if (nextY1 < 0) {
              const shift = -nextY1
              nextY1 += shift
              nextY2 += shift
            }
            if (nextY2 > refHeight) {
              const shift = nextY2 - refHeight
              nextY1 -= shift
              nextY2 -= shift
            }

            nextX1 = clampRange(nextX1, 0, refWidth)
            nextX2 = clampRange(nextX2, 0, refWidth)
            nextY1 = clampRange(nextY1, 0, refHeight)
            nextY2 = clampRange(nextY2, 0, refHeight)

            const nextCenterX = (nextX1 + nextX2) / 2
            const nextCenterY = (nextY1 + nextY2) / 2
            const nextDx = clampRange(nextCenterX - baseCenterX, -5000, 5000)
            const nextDy = clampRange(nextCenterY - baseCenterY, -5000, 5000)

            onResizeItem(imageId, item.id, {
              dx: nextDx,
              dy: nextDy,
              widthScale: nextWidthScale,
              heightScale: nextHeightScale,
            })
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
        }

        const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
          if (selectionModeEnabled) return
          if (!editable && !onOpenQuickEditor) return

          if (onOpenQuickEditor) {
            const now = Date.now()
            const previousTap = lastTapRef.current
            const isSameItem = previousTap?.itemId === item.id
            const isQuickDoubleTap = Boolean(
              previousTap
                && isSameItem
                && (now - previousTap.at) <= OCR_OVERLAY_QUICK_EDITOR_DOUBLE_TAP_MS
                && Math.abs(event.clientX - previousTap.x) <= OCR_OVERLAY_QUICK_EDITOR_TAP_MOVE_PX
                && Math.abs(event.clientY - previousTap.y) <= OCR_OVERLAY_QUICK_EDITOR_TAP_MOVE_PX
            )

            if (isQuickDoubleTap) {
              lastTapRef.current = null
              event.preventDefault()
              event.stopPropagation()
              onOpenQuickEditor({
                imageId,
                itemId: item.id,
                leftPercent: clampPercent(left + width / 2),
                topPercent: clampPercent(top),
              })
              return
            }

            lastTapRef.current = {
              itemId: item.id,
              at: now,
              x: event.clientX,
              y: event.clientY,
            }
          }

          if (!editable || !onMoveItem) return
          if (dragEnabledItemId !== item.id) return

          event.preventDefault()
          event.stopPropagation()

          const pointerTarget = event.currentTarget
          const pointerId = event.pointerId
          try {
            pointerTarget.setPointerCapture(pointerId)
          } catch {
          }

          onSelectItem?.(imageId, item.id)

          const startClientX = event.clientX
          const startClientY = event.clientY
          const startDx = offsetX
          const startDy = offsetY
          const renderedRect = overlayRef.current?.getBoundingClientRect()
          const renderedWidth = Math.max(1, renderedRect?.width ?? displayedWidth)
          const renderedHeight = Math.max(1, renderedRect?.height ?? displayedHeight)

          const handlePointerMove = (moveEvent: PointerEvent) => {
            moveEvent.preventDefault()
            const deltaClientX = moveEvent.clientX - startClientX
            const deltaClientY = moveEvent.clientY - startClientY
            const nextDx = startDx + (deltaClientX * refWidth) / renderedWidth
            const nextDy = startDy + (deltaClientY * refHeight) / renderedHeight
            onMoveItem(imageId, item.id, nextDx, nextDy)
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
        }

        return (
          <Fragment key={item.id}>
            <div
              data-ocr-overlay-interactive="true"
              data-ocr-overlay-item-key={`${imageId}:${item.id}`}
              onPointerDown={handlePointerDown}
              className={cn(
                'absolute z-20 flex items-center justify-center overflow-hidden px-1 text-center font-semibold select-none',
                shape === 'oval' ? 'rounded-[999px]' : 'rounded-[4px]',
                (selectionModeEnabled || Boolean(selectionPreviewData))
                  ? 'pointer-events-none'
                  : editable
                    ? isDragEnabledForItem
                      ? 'cursor-grab active:cursor-grabbing pointer-events-auto touch-none'
                      : 'cursor-pointer pointer-events-auto'
                    : onOpenQuickEditor
                      ? 'cursor-pointer pointer-events-auto'
                      : 'pointer-events-none',
                isSelected && 'ring-2 ring-primary/60'
              )}
              style={{
                left: `${left}%`,
                top: `${top}%`,
                width: `${width}%`,
                height: `${height}%`,
                backgroundColor,
                borderColor: 'transparent',
                borderWidth: 0,
                filter: 'none',
                backdropFilter: 'none',
              }}
            >
              <span
                className="w-full overflow-hidden whitespace-pre-wrap break-words"
                style={{
                  fontSize: `${fontSize}px`,
                  lineHeight: 1.12,
                  color: textColor,
                  fontFamily: fontFamilyCss,
                  textShadow: 'none',
                  filter: 'none',
                  WebkitTextStroke: '0 transparent',
                }}
              >
                {textValue}
              </span>
            </div>
            {showResizeHandles && (
              <>
                <div
                  data-ocr-overlay-interactive="true"
                  data-ocr-overlay-item-key={`${imageId}:${item.id}`}
                  className="absolute z-[41] h-8 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary bg-background shadow-md touch-none cursor-nwse-resize"
                  style={{
                    left: `${left}%`,
                    top: `${top}%`,
                  }}
                  onPointerDown={(event) => handleResizePointerDown('top-left', event)}
                  aria-label="Redimensionar balão pelo canto superior esquerdo"
                  role="button"
                />
                <div
                  data-ocr-overlay-interactive="true"
                  data-ocr-overlay-item-key={`${imageId}:${item.id}`}
                  className="absolute z-[41] h-8 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary bg-background shadow-md touch-none cursor-nwse-resize"
                  style={{
                    left: `${clampPercent(left + width)}%`,
                    top: `${clampPercent(top + height)}%`,
                  }}
                  onPointerDown={(event) => handleResizePointerDown('bottom-right', event)}
                  aria-label="Redimensionar balão pelo canto inferior direito"
                  role="button"
                />
              </>
            )}
          </Fragment>
        )
      })}
    </div>
  )
}
