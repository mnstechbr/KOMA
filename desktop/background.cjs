const fs = require('node:fs')
const path = require('node:path')

// Textos dos avisos e do menu da bandeja nos idiomas da interface.
const LABELS = {
  'pt-BR': {
    open: 'Abrir o KOMA',
    quit: 'Sair',
    one: 'Capítulo novo pronto',
    many: '{n} capítulos novos prontos',
    chapter: 'Cap. {n}',
    special: 'Especial',
  },
  en: { open: 'Open KOMA', quit: 'Quit', one: 'New chapter ready', many: '{n} new chapters ready', chapter: 'Ch. {n}', special: 'Special' },
  es: {
    open: 'Abrir KOMA',
    quit: 'Salir',
    one: 'Capítulo nuevo listo',
    many: '{n} capítulos nuevos listos',
    chapter: 'Cap. {n}',
    special: 'Especial',
  },
}
function labels(language) {
  return LABELS[language] || LABELS['pt-BR']
}

/** Título e texto do aviso de capítulo novo (um aviso por obra). */
function noticeText(notice, language) {
  const text = labels(language)
  const title = notice.count > 1 ? text.many.replace('{n}', String(notice.count)) : text.one
  const chapter = notice.number ? text.chapter.replace('{n}', notice.number) : text.special
  return { title, body: `${notice.title} · ${chapter}` }
}

/** Comando que abre o KOMA instalado, lido do atalho do menu de aplicativos. */
function launcherCommand(env, home, bundleRoot) {
  const data = env.XDG_DATA_HOME || path.join(home, '.local/share')
  for (const file of [path.join(data, 'applications/koma.desktop'), '/usr/share/applications/koma.desktop']) {
    try {
      const line = fs
        .readFileSync(file, 'utf8')
        .split('\n')
        .find((item) => item.startsWith('Exec='))
      if (line)
        return line
          .slice(5)
          .replace(/\s+%[fFuU]$/, '')
          .trim()
    } catch {
      /* Sem atalho: usa o lançador do pacote. */
    }
  }
  return `"${path.join(bundleRoot, 'koma')}"`
}

/** Atalho de início automático do Linux (~/.config/autostart), escondido na bandeja. */
function autostartEntry(command) {
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=KOMA',
    'Comment=Biblioteca pessoal de mangás',
    `Exec=${command} --hidden`,
    'Terminal=false',
    'X-GNOME-Autostart-enabled=true',
    '',
  ].join('\n')
}

/** Liga ou desliga o início com o computador. Só escreve quando muda. */
function syncAutostart({ enabled, platform, env, home, bundleRoot, app }) {
  if (platform !== 'linux') {
    if (app.getLoginItemSettings().openAtLogin !== enabled) app.setLoginItemSettings({ openAtLogin: enabled, args: ['--hidden'] })
    return
  }
  const file = path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'autostart', 'koma.desktop')
  if (!enabled) {
    fs.rmSync(file, { force: true })
    return
  }
  const content = autostartEntry(launcherCommand(env, home, bundleRoot))
  let current = ''
  try {
    current = fs.readFileSync(file, 'utf8')
  } catch {
    /* Ainda não existe. */
  }
  if (current === content) return
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content, { mode: 0o644 })
}

module.exports = { labels, noticeText, launcherCommand, autostartEntry, syncAutostart }
