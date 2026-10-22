const { app, BrowserWindow, dialog, Menu, Notification, Tray, nativeImage, shell, session } = require('electron')
// Rótulos do menu da janela nos idiomas da interface.
const MENU_LABELS = {
  en: {
    Biblioteca: 'Library',
    Preferências: 'Settings',
    'Abrir pasta de diagnóstico': 'Open diagnostics folder',
    Sair: 'Quit',
    Editar: 'Edit',
    Desfazer: 'Undo',
    Refazer: 'Redo',
    Recortar: 'Cut',
    Copiar: 'Copy',
    Colar: 'Paste',
    'Selecionar tudo': 'Select all',
    Exibir: 'View',
    Recarregar: 'Reload',
    'Tela cheia': 'Full screen',
  },
  es: {
    Biblioteca: 'Biblioteca',
    Preferências: 'Preferencias',
    'Abrir pasta de diagnóstico': 'Abrir carpeta de diagnóstico',
    Sair: 'Salir',
    Editar: 'Editar',
    Desfazer: 'Deshacer',
    Refazer: 'Rehacer',
    Recortar: 'Cortar',
    Copiar: 'Copiar',
    Colar: 'Pegar',
    'Selecionar tudo': 'Seleccionar todo',
    Exibir: 'Ver',
    Recarregar: 'Recargar',
    'Tela cheia': 'Pantalla completa',
  },
}
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { startBackend } = require('./backend.cjs')
const { allowedExternalLink } = require('./external-links.cjs')
const { desktopPaths, bundledNode } = require('./paths.cjs')
const { labels, noticeText, syncAutostart } = require('./background.cjs')
const { startMobileServer } = require('./mobile-server.cjs')

const { configDir, dataDir, logDir } = desktopPaths(process.env, process.platform, os.homedir())
for (const dir of [configDir, dataDir, logDir]) fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
app.setName('KOMA')
if (process.platform === 'linux') app.setDesktopName('koma.desktop')
app.setPath('userData', configDir)
app.commandLine.appendSwitch('lang', 'pt-BR')

let window
let backend
let quitting = false
let logFd
// Segundo plano: com a bandeja ligada, fechar a janela só a esconde; "--hidden"
// (início com o computador) abre direto na bandeja.
let tray = null
let backgroundTasks = null
const startHidden = process.argv.includes('--hidden')
const showWindow = () => {
  if (!window) return
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}
async function startBackground(token, language) {
  const text = labels(language)
  const bundleRoot = path.resolve(__dirname, '../../..')
  const icon = nativeImage.createFromPath(path.join(__dirname, 'koma.png')).resize({ width: 22, height: 22 })
  const setTray = (enabled) => {
    if (enabled && !tray) {
      tray = new Tray(icon)
      tray.setToolTip('KOMA')
      tray.setContextMenu(
        Menu.buildFromTemplate([
          { label: text.open, click: showWindow },
          { type: 'separator' },
          { label: text.quit, click: () => app.quit() },
        ]),
      )
      tray.on('click', showWindow)
    } else if (!enabled && tray) {
      tray.destroy()
      tray = null
    }
  }
  const fetchSettings = async (notices) => {
    const response = await fetch(`${backend.url}/api/local/background${notices ? '?notices=1' : ''}`, {
      headers: { Cookie: `koma-session=${token}` },
      signal: AbortSignal.timeout(15000),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.json()
  }
  const apply = (settings) => {
    setTray(settings.tray)
    try {
      syncAutostart({
        enabled: settings.tray && settings.autostart,
        platform: process.platform,
        env: process.env,
        home: os.homedir(),
        bundleRoot,
        app,
      })
    } catch (error) {
      console.error('[KOMA] Início com o computador não foi ajustado', error.message)
    }
    for (const notice of settings.notices || []) {
      if (!settings.notify || !Notification.isSupported()) continue
      const { title, body } = noticeText(notice, language)
      const shown = new Notification({ title, body, icon: path.join(__dirname, 'koma.png') })
      shown.on('click', () => {
        showWindow()
        void window?.loadURL(`${backend.url}/inicio/obras/${notice.workId}/ler/${notice.chapterId}`)
      })
      shown.show()
    }
  }
  // "Ler no celular": servidor da rede de casa, ligado só quando a opção está ativa.
  let mobile = null
  let mobileKey = ''
  const syncMobile = async () => {
    const response = await fetch(`${backend.url}/api/local/mobile`, {
      headers: { Cookie: `koma-session=${token}` },
      signal: AbortSignal.timeout(15000),
    })
    if (!response.ok) return
    const settings = await response.json()
    const key = settings.enabled ? `${settings.port}:${settings.token}:${settings.code}` : ''
    if (key === mobileKey) return
    if (mobile) {
      await mobile.stop()
      mobile = null
    }
    mobileKey = key
    if (!key) return
    try {
      mobile = await startMobileServer({
        port: settings.port,
        token: settings.token,
        code: settings.code,
        backendUrl: backend.url,
        sessionToken: token,
        language,
      })
    } catch (error) {
      mobileKey = ''
      console.error('[KOMA] Leitura no celular não abriu', error.message)
    }
  }
  try {
    apply(await fetchSettings(false))
  } catch {
    setTray(true)
  }
  void syncMobile().catch(() => undefined)
  // A cada minuto (e logo depois de mudar a opção na tela): preferências e capítulos novos prontos.
  const poll = () => {
    void fetchSettings(true)
      .then(apply)
      .catch(() => {
        /* Serviço ocupado: tenta no próximo minuto. */
      })
    void syncMobile().catch(() => undefined)
  }
  setInterval(() => {
    if (!quitting) poll()
  }, 60000).unref()
  // Bandeja e início com o computador seguem a tela em poucos segundos (sem os avisos, que ficam no minuto).
  setInterval(() => {
    if (!quitting) {
      void syncMobile().catch(() => undefined)
      void fetchSettings(false)
        .then(apply)
        .catch(() => undefined)
    }
  }, 5000).unref()
  app.on('before-quit', () => {
    if (mobile) void mobile.stop()
  })
  // Ao sair: aplica a última escolha de início com o computador antes de desligar o serviço.
  const finalSync = () =>
    Promise.race([fetchSettings(false).then(apply), new Promise((resolve) => setTimeout(resolve, 3000))]).catch(() => undefined)
  return { poll, finalSync }
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showWindow())
  app.on('window-all-closed', () => {
    if (!tray) app.quit()
  })
  process.on('SIGTERM', () => app.quit())
  process.on('SIGINT', () => app.quit())
  app.on('before-quit', (event) => {
    if (quitting) return
    event.preventDefault()
    quitting = true
    void (async () => {
      if (backgroundTasks) await backgroundTasks.finalSync()
      if (backend) await backend.stop()
      if (logFd !== undefined) fs.closeSync(logFd)
      app.quit()
    })()
  })

  void app
    .whenReady()
    .then(async () => {
      const logFile = path.join(logDir, 'backend.log')
      if (fs.existsSync(logFile) && fs.statSync(logFile).size > 5 * 1024 * 1024) {
        fs.copyFileSync(logFile, `${logFile}.1`)
        fs.truncateSync(logFile)
      }
      logFd = fs.openSync(logFile, 'a', 0o600)
      const bundleRoot = path.resolve(__dirname, '../../..')
      backend = await startBackend({
        nodePath: bundledNode(bundleRoot, process.platform),
        serverDir: path.join(bundleRoot, 'server'),
        dataDir,
        logFd,
        automation: process.env.KOMA_AUTOMATION_DISABLED !== '1',
      })
      if (quitting) {
        await backend.stop()
        return
      }
      backend.child.once('exit', () => {
        if (!quitting) {
          dialog.showErrorBox('KOMA', 'O serviço local encerrou. Abra o KOMA novamente. Seus arquivos permanecem salvos.')
          app.quit()
        }
      })
      session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
      session.defaultSession.setPermissionCheckHandler(() => false)
      const localSession = await backend.bootstrap()
      await session.defaultSession.cookies.set({
        url: backend.url,
        name: 'koma-session',
        value: localSession.sessionToken,
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        path: '/',
      })
      const language = ['pt-BR', 'en', 'es'].includes(localSession.language) ? localSession.language : 'pt-BR'
      await session.defaultSession.cookies.set({
        url: backend.url,
        name: 'koma-lang',
        value: language,
        secure: false,
        sameSite: 'lax',
        path: '/',
      })
      const label = (text) => (MENU_LABELS[language] || {})[text] || text
      if (quitting) return
      window = new BrowserWindow({
        title: 'KOMA',
        width: 1360,
        height: 900,
        minWidth: 800,
        minHeight: 600,
        backgroundColor: '#101013',
        show: false,
        icon: path.join(__dirname, 'koma.png'),
        webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true },
      })
      const sameOrigin = (url) => {
        try {
          return new URL(url).origin === backend.url
        } catch {
          return false
        }
      }
      window.webContents.on('will-navigate', (event, url) => {
        if (!sameOrigin(url)) {
          event.preventDefault()
          if (allowedExternalLink(url)) void shell.openExternal(url)
        }
      })
      window.webContents.setWindowOpenHandler(({ url }) => {
        if (allowedExternalLink(url)) void shell.openExternal(url)
        return { action: 'deny' }
      })
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([
          {
            label: 'KOMA',
            submenu: [
              { label: label('Biblioteca'), click: () => window.loadURL(`${backend.url}/inicio/secoes`) },
              { label: label('Preferências'), click: () => window.loadURL(`${backend.url}/inicio/preferencias`) },
              { label: label('Abrir pasta de diagnóstico'), click: () => shell.openPath(logDir) },
              { type: 'separator' },
              { label: label('Sair'), accelerator: 'CmdOrCtrl+Q', click: () => app.quit() },
            ],
          },
          {
            label: label('Editar'),
            submenu: [
              { label: label('Desfazer'), role: 'undo' },
              { label: label('Refazer'), role: 'redo' },
              { type: 'separator' },
              { label: label('Recortar'), role: 'cut' },
              { label: label('Copiar'), role: 'copy' },
              { label: label('Colar'), role: 'paste' },
              { label: label('Selecionar tudo'), role: 'selectAll' },
            ],
          },
          {
            label: label('Exibir'),
            submenu: [
              { label: label('Recarregar'), role: 'reload' },
              { label: label('Tela cheia'), role: 'togglefullscreen' },
            ],
          },
        ]),
      )
      window.on('close', (event) => {
        if (!quitting && tray) {
          event.preventDefault()
          window.hide()
        }
      })
      await window.loadURL(backend.url)
      if (quitting) return
      const background = process.env.KOMA_DESKTOP_TEST === '1' ? null : await startBackground(localSession.sessionToken, language)
      backgroundTasks = background
      // Aberto escondido só quando a bandeja existe; sem ela a janela precisa aparecer.
      if (!startHidden || !tray) window.show()
      if (background) background.poll()
      // Usado somente pela verificação automatizada do pacote, sem habilitar IPC no renderer.
      if (process.env.KOMA_DESKTOP_TEST === '1') {
        await require('./window-checks.cjs').runWindowChecks(window, logDir)
        app.quit()
      }
    })
    .catch(async (error) => {
      if (process.env.KOMA_DESKTOP_TEST === '1') {
        fs.writeFileSync(path.join(logDir, 'window-test-error.txt'), error.message)
        if (backend) await backend.stop()
        app.exit(1)
        return
      }
      if (!quitting) dialog.showErrorBox('Não foi possível abrir o KOMA', `${error.message}\nDiagnóstico: ${logDir}`)
      app.quit()
    })
}
