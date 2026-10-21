export interface ResolvedImageFile {
  filePath: string
  mime: string
  size: number
}

export type ImageKind = 'original' | 'translated'


export interface SectionLangs {
  sourceLang: string
  targetLang: string
  providerLang: string
}

export interface CreateSectionData extends SectionLangs {
  name: string
}

export interface SectionImageFileInput {
  name: string
  type: string
  buffer: Buffer
}

export interface PendingSectionImage {
  id: number
  order_index: number
  original_path: string
  mime: string
}


export interface OcrDetection {
  det_id?: number
  cls_name?: string
  conf?: number
  box?: [number, number, number, number]
  ocr_text?: string
  ocr_error?: string
  lines?: Array<[number, number, number, number]>
  background?: string
  foreground?: string
  /** Metade de cima de um balão cortado entre duas imagens: o texto já inclui a metade de baixo. */
  continued?: boolean
  /** Metade de baixo de um balão cortado entre duas imagens: usa a tradução da metade de cima. */
  continues?: boolean
  /** O modelo achou a leitura do OCR duvidosa: a IA lê o recorte da imagem. */
  doubtful?: boolean
  /** O recorte já foi lido pela IA (não repete). */
  seen?: boolean
}
