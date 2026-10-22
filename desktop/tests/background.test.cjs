const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { noticeText, launcherCommand, syncAutostart } = require('../background.cjs')

test('aviso de capítulo novo no idioma da interface', () => {
  assert.deepEqual(noticeText({ title: 'Obra', number: '12', count: 1 }, 'pt-BR'), {
    title: 'Capítulo novo pronto',
    body: 'Obra · Cap. 12',
  })
  assert.deepEqual(noticeText({ title: 'Obra', number: '12', count: 3 }, 'en'), { title: '3 new chapters ready', body: 'Obra · Ch. 12' })
})

test('início com o computador usa o atalho instalado e abre escondido', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'koma-autostart-'))
  const env = { XDG_DATA_HOME: path.join(home, 'data'), XDG_CONFIG_HOME: path.join(home, 'config') }
  fs.mkdirSync(path.join(home, 'data/applications'), { recursive: true })
  fs.writeFileSync(path.join(home, 'data/applications/koma.desktop'), '[Desktop Entry]\nExec="/opt/koma/koma"\n')
  assert.equal(launcherCommand(env, home, '/bundle'), '"/opt/koma/koma"')
  syncAutostart({ enabled: true, platform: 'linux', env, home, bundleRoot: '/bundle' })
  const file = path.join(home, 'config/autostart/koma.desktop')
  assert.match(fs.readFileSync(file, 'utf8'), /^Exec="\/opt\/koma\/koma" --hidden$/m)
  syncAutostart({ enabled: false, platform: 'linux', env, home, bundleRoot: '/bundle' })
  assert.equal(fs.existsSync(file), false)
  fs.rmSync(home, { recursive: true, force: true })
})
