import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'

// Teste opt-in: envia somente esta amostra própria, consome cota e requer a
// autorização normal do KPassword. Nunca usa a biblioteca pessoal.
const args = process.argv.slice(2)
const option = (name) => args[args.indexOf(name) + 1]
const adaptationModel = args.includes('--adaptation-model') ? option('--adaptation-model') : ''
const reviewModel = args.includes('--review-model') ? option('--review-model') : ''
if (!args.includes('--real') || !adaptationModel || !reviewModel) {
  console.log('Uso: node scripts/smoke-translation-real.mjs --real --adaptation-model ID_DEEPSEEK --review-model ID_MIMO [--bundle CAMINHO]')
  console.log('Consome cota. Ative o KPassword e confira as autorizações no cofre. Não informe API keys.')
  process.exit(1)
}
const root = path.resolve(import.meta.dirname, '..')
const bundle = args.includes('--bundle') ? path.resolve(option('--bundle')) : (await fs.readFile(path.join(root, 'artifacts/latest-bundle.txt'), 'utf8')).trim()
const require = createRequire(import.meta.url)
const { startBackend } = require(path.join(bundle, 'electron/resources/app/backend.cjs'))
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'koma-traducao-real-'))
const log = await fs.open(path.join(temp, 'backend.log'), 'a')
const backend = await startBackend({ nodePath: path.join(bundle, 'runtime/node'), serverDir: path.join(bundle, 'server'), dataDir: temp, logFd: log.fd })
const source = ['Oh, great. Another locked door.', "Stay behind me. I'm not losing anyone else.", "Relax, big guy. I've got this."]
try {
  const session = await backend.bootstrap()
  const headers = { Cookie: `koma-session=${session.sessionToken}`, Origin: backend.url, 'Content-Type': 'application/json' }
  const settings = {
    enabled: true,
    translation: { provider: 'deepseek', model: adaptationModel, credentialId: '' },
    review: { enabled: true, provider: 'mimo', model: reviewModel, credentialId: '' },
    consent: { deepseek: true, mimo: true }, glossary: '',
    voices: 'Amostra sintética própria: a primeira fala expressa sarcasmo diante de uma porta trancada; a segunda é séria e protetora; a terceira é confiante e coloquial.',
  }
  const save = await fetch(`${backend.url}/api/local/translation`, { method: 'PUT', headers, body: JSON.stringify(settings) })
  if (!save.ok) throw new Error('Não foi possível preparar as preferências temporárias.')
  console.log('Amostra temporária pronta. Aguardando as autorizações no KPassword.')
  const response = await fetch(`${backend.url}/api/translate/text-batch`, { method: 'POST', headers, body: JSON.stringify({ provider_lang: 'kpassword', source_lang: 'en', target_lang: 'pt-BR', texts: source }) })
  const result = await response.json()
  const passed = response.ok && result.translations?.length === source.length && result.steps?.length === 2 && result.steps[0].provider === 'deepseek' && result.steps[1].provider === 'mimo'
  const evidence = { status: response.status, passed, source, result }
  await fs.writeFile(path.join(temp, 'resultados.json'), JSON.stringify(evidence, null, 2))
  console.log(JSON.stringify(evidence, null, 2))
  console.log(`Evidência: ${temp}`)
  if (!passed) process.exitCode = 1
} finally { await backend.stop(); await log.close() }
