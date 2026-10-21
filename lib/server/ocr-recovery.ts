import sharp from 'sharp'
import { recognizeImageTextNode } from './manga-ocr-node'
import type { OcrDetection } from '@/lib/backend/sections/sections.types'

// Uma tentativa local adicional, apenas nos balões incertos. Nunca usa LLM
// para adivinhar o que não foi reconhecido e nunca modifica a página original.
export async function recoverOcr(bytes: Buffer, detections: OcrDetection[], language: string) {
  const image = await sharp(bytes).metadata()
  const recovered: OcrDetection[] = []
  for (const detection of detections) {
    if (!detection.ocr_error && detection.ocr_text?.trim()) { recovered.push(detection); continue }
    if (!detection.box || !image.width || !image.height) { recovered.push(detection); continue }
    const [x1,y1,x2,y2] = detection.box
    const left = Math.max(0,Math.floor(x1)); const top = Math.max(0,Math.floor(y1))
    const width = Math.min(image.width-left,Math.ceil(x2)-left); const height = Math.min(image.height-top,Math.ceil(y2)-top)
    if (width < 2 || height < 2) { recovered.push(detection); continue }
    const crop = await sharp(bytes).extract({left,top,width,height}).resize({width:Math.min(1200,width*2)}).normalize().sharpen().png().toBuffer()
    try {
      const result = await recognizeImageTextNode(crop,12,language)
      const text = result.extracted_text.trim()
      recovered.push(text && !result.ocr_error && /[\p{L}\p{N}]/u.test(text) ? {...detection,ocr_text:text,ocr_error:''} : detection)
    } catch { recovered.push(detection) }
  }
  return recovered
}
