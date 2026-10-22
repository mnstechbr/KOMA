import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { getDataDir } from '../shared/data-paths'
import { worksRepository } from './repository'
import { coverBytes } from './mangadex'
import { catalogMetadata, validateCatalogId } from './catalog'
import { sourceBytes } from './source-http'

export async function getCatalogWork(id: string) {
  validateCatalogId(id)
  const cached = worksRepository.cached(id)
  if (cached && (cached.source === 'mangadex' || cached.description)) return cached
  const work = await catalogMetadata(id)
  worksRepository.cache(work)
  return work
}
export async function getCover(id: string) {
  validateCatalogId(id)
  const root = path.join(getDataDir(), 'covers')
  const file = path.join(root, `${id}.jpg`)
  try {
    return await fs.readFile(file)
  } catch {
    /* Buscar apenas a capa da obra validada. */
  }
  const work = await getCatalogWork(id)
  const data = work.source !== 'mangadex' && work.coverSourceUrl ? await sourceBytes(work.coverSourceUrl, true) : await coverBytes(work)
  if (!data) return null
  const bytes = await sharp(data.bytes, { limitInputPixels: 50000000 })
    .resize({ width: 320, withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer()
  await fs.mkdir(root, { recursive: true, mode: 0o700 })
  const temporary = `${file}.${process.pid}.tmp`
  await fs.writeFile(temporary, bytes)
  await fs.rename(temporary, file)
  return bytes
}
