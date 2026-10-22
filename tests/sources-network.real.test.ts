import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { it, expect } from 'vitest'
import { naverChapters, naverPages } from '../lib/backend/works/naver'
import { sourceBytes } from '../lib/backend/works/source-http'
import { parseTencentIndex, parseLezhinIndex } from '../lib/backend/works/official-index'
import { readNuxtData } from '../lib/backend/works/public-data'
import { parseKuaikanChapters, parseKuaikanPages } from '../lib/backend/works/kuaikan'
import { parseJumpPages, jumpChapters } from '../lib/backend/works/jump-plus'

it.skipIf(process.env.KOMA_REAL_SOURCES !== '1')(
  'consulta a publicação original e baixa uma página pública',
  async () => {
    const output = path.resolve('artifacts/fontes-reais-0.4.2')
    await fs.mkdir(output, { recursive: true })
    const evidence: { checkedAt: string; original?: unknown } = { checkedAt: new Date().toISOString() }
    const original = await naverChapters('https://comic.naver.com/webtoon/list?titleId=807777')
    const chapter = original.chapters.at(-1)!
    const pages = await naverPages(chapter.sourceId)
    const image = await sourceBytes(pages[0].url, true)
    const metadata = await sharp(image.bytes).metadata()
    await fs.writeFile(path.join(output, 'naver-publica-original.jpg'), image.bytes)
    evidence.original = {
      source: chapter.sourceId,
      total: original.total,
      publicEpisodes: original.chapters.length,
      paidEpisodes: original.paid,
      pageCount: pages.length,
      downloadedSample: 1,
      width: metadata.width,
      height: metadata.height,
    }
    await fs.writeFile(path.join(output, 'resultado.json'), JSON.stringify(evidence, null, 2))
    console.log(JSON.stringify(evidence.original))
  },
  300000,
)

it.skipIf(process.env.KOMA_REAL_SOURCES !== '1')(
  'consulta originais japoneses e chineses e verifica páginas públicas',
  async () => {
    const output = path.resolve('artifacts/fontes-reais-0.4.2')
    await fs.mkdir(output, { recursive: true })
    const topic = 'https://www.kuaikanmanhua.com/web/topic/21881'
    const data = parseKuaikanChapters((await sourceBytes(topic)).bytes.toString('utf8'), topic)
    console.log('Kuaikan', data.title, data.total, data.chapters.length)
    const url = 'https://www.kuaikanmanhua.com/web/comic/682701'
    const html = (await sourceBytes(url)).bytes.toString('utf8')
    await fs.writeFile(path.join(output, 'kuaikan-publica.html'), html)
    const pages = parseKuaikanPages(html, url)
    const image = await sourceBytes(pages[0].url, true)
    await fs.writeFile(path.join(output, 'kuaikan-original.jpg'), image.bytes)
    const chinese = {
      source: topic,
      listed: data.chapters.length,
      declared: data.total,
      chapter: url,
      previewPages: pages.length,
      completeChapter: false,
      sample: await sharp(image.bytes).metadata(),
    }
    const jp = 'https://shonenjumpplus.com/episode/17107094910795721445'
    const japanese = await jumpChapters(jp)
    const jpPages = parseJumpPages((await sourceBytes(jp)).bytes.toString('utf8'), jp)
    const jpImage = await sourceBytes(jpPages[0].url, true)
    await fs.writeFile(path.join(output, 'jump-original.jpg'), jpImage.bytes)
    await fs.writeFile(
      path.join(output, 'originais-jp-cn.json'),
      JSON.stringify(
        {
          checkedAt: new Date().toISOString(),
          chinese,
          japanese: { source: jp, listed: japanese.length, pages: jpPages.length, sample: await sharp(jpImage.bytes).metadata() },
        },
        null,
        2,
      ),
    )
    console.log('Jump+', japanese.length, jpPages.length)
  },
  300000,
)

it.skipIf(process.env.KOMA_LOCAL_SOURCE_PROBE !== '1')('inspeciona dados públicos previamente obtidos sem executar scripts', async () => {
  const topic = await fs.readFile('/tmp/koma-work-kuaikan.html', 'utf8')
  const parsed = readNuxtData(topic)
  await fs.writeFile('/tmp/koma-nuxt-topic.json', JSON.stringify(parsed, null, 2))
  const index = parseKuaikanChapters(topic, 'https://www.kuaikanmanhua.com/web/topic/21881')
  expect(index.chapters.length).toBeGreaterThan(0)
  const html = await fs.readFile('/tmp/koma-kuaikan-chapter.html', 'utf8')
  await fs.writeFile('/tmp/koma-nuxt-chapter.json', JSON.stringify(readNuxtData(html), null, 2))
  const images = parseKuaikanPages(html, 'https://www.kuaikanmanhua.com/web/comic/682701')
  expect(images.length).toBeGreaterThan(0)
  const tencent = parseTencentIndex(await fs.readFile('/tmp/koma-work-tencent.html', 'utf8'), 'https://ac.qq.com/Comic/comicInfo/id/645654')
  const lezhin = parseLezhinIndex(await fs.readFile('/tmp/koma-work-lezhin.html', 'utf8'))
  await fs.mkdir('artifacts/fontes-reais-0.4.2', { recursive: true })
  await fs.writeFile(
    'artifacts/fontes-reais-0.4.2/indices-publicos.json',
    JSON.stringify(
      {
        kuaikan: { listed: index.chapters.length, total: index.total, pages: images.length, first: images[0] },
        tencent: { listed: tencent.length },
        lezhin,
      },
      null,
      2,
    ),
  )
  expect(tencent.length).toBeGreaterThan(100)
  expect(lezhin.total).toBeGreaterThan(100)
})
