import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'
if (!process.argv.includes('--image'))
  throw new Error('Informe --image CAMINHO --language CODIGO. Executa somente OCR local, sem modelos externos.')
const imagePath = process.argv[process.argv.indexOf('--image') + 1]
const language = process.argv[process.argv.indexOf('--language') + 1] || 'auto'
const bundle = process.argv.includes('--bundle')
  ? process.argv[process.argv.indexOf('--bundle') + 1]
  : (await fs.readFile('artifacts/latest-bundle.txt', 'utf8')).trim()
const require = createRequire(import.meta.url)
const { startBackend } = require(path.join(bundle, 'electron/resources/app/backend.cjs'))
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'koma-ocr-recovery-'))
const log = await fs.open(path.join(temp, 'backend.log'), 'a')
const backend = await startBackend({
  nodePath: path.join(bundle, 'runtime/node'),
  serverDir: path.join(bundle, 'server'),
  dataDir: temp,
  logFd: log.fd,
  automation: false,
})
try {
  const session = await backend.bootstrap()
  const form = new FormData()
  form.append('file', new Blob([await fs.readFile(imagePath)], { type: 'image/jpeg' }), 'pagina.jpg')
  const response = await fetch(`${backend.url}/api/translate/extract?source_lang=${encodeURIComponent(language)}&recover=1`, {
    method: 'POST',
    headers: { Cookie: `koma-session=${session.sessionToken}`, Origin: backend.url },
    body: form,
  })
  const data = await response.json()
  if (!response.ok || !Array.isArray(data.detections)) throw new Error('A extração local não concluiu.')
  const evidence = {
    status: response.status,
    language,
    detections: data.detections.length,
    uncertain: data.detections.filter((d) => d.ocr_error || !d.ocr_text?.trim()).length,
    externalModelCalls: 0,
  }
  await fs.writeFile(path.join(temp, 'resultados.json'), JSON.stringify(evidence, null, 2))
  await fs.writeFile(path.join(temp, 'deteccoes.json'), JSON.stringify(data, null, 2))
  console.log(JSON.stringify({ ...evidence, evidence: path.join(temp, 'resultados.json') }))
} finally {
  await backend.stop()
  await log.close()
}
