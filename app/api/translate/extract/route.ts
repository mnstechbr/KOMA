import { NextRequest, NextResponse } from 'next/server'
import { recoverOcr } from '@/lib/server/ocr-recovery'
import { extractTextBoxesNode } from '@/lib/server/manga-ocr-node'
import { parseUploadedImageRequest } from '@/lib/server/uploaded-image-request'

export async function POST(request: NextRequest) {
  try {
    const image = await parseUploadedImageRequest(request)

    if (!image) {
      return NextResponse.json(
        { error: 'Nenhuma imagem enviada. Envie multipart/form-data, uma imagem direta ou JSON com dataUrl/base64.' },
        { status: 400 }
      )
    }

    const language = request.nextUrl.searchParams.get('source_lang') || 'auto'
    if (!/^(auto|[a-z]{2,3}(?:-[a-zA-Z]{2,8})?)$/.test(language)) return NextResponse.json({error:'Idioma inválido.'},{status:400})
    const result = await extractTextBoxesNode(image.buffer,language)
    if (request.nextUrl.searchParams.get('recover') === '1') return NextResponse.json({...result,detections:await recoverOcr(image.buffer,result.detections,language)})
    return NextResponse.json(result)
  } catch (error) {
    console.error('extract route error:', error)
    const message = error instanceof Error && error.message.includes('multipart/form-data')
      ? error.message
      : 'Erro ao processar extração.'
    const status = message === 'Erro ao processar extração.' ? 500 : 400
    return NextResponse.json({ error: message }, { status })
  }
}
