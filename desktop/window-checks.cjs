const fs = require('node:fs')
const path = require('node:path')
const { setTimeout: delay } = require('node:timers/promises')

async function waitFor(window, expression, label, timeout = 10000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await window.webContents.executeJavaScript(expression)) return
    await delay(100)
  }
  throw new Error(`Verificação visual falhou: ${label}`)
}

async function runWindowChecks(window, logDir) {
  await waitFor(window, `document.querySelector('[data-library-state="ready"]') !== null`, 'biblioteca carregada')
  const checks = ['biblioteca aberta sem cadastro']
  const libraryUrl = window.webContents.getURL()
  if(process.env.KOMA_DESKTOP_TEST_REAL_LIBRARY === '1') {
    const records=[]
    for(const id of [1,2,3]) {
      await window.loadURL(new URL(`/inicio/obras/${id}`,libraryUrl).href)
      await waitFor(window, `document.querySelector('[data-work-detail="ready"]') !== null`, 'obra real carregada')
      await window.webContents.executeJavaScript(`Promise.all(Array.from(document.images,image=>image.decode().catch(()=>{})))`)
      const detail=await window.webContents.executeJavaScript(`fetch('/api/local/works/${id}').then(response=>response.json()).then(detail=>({title:detail.work.title,cataloged:detail.chapters.length,ready:detail.work.readyChapters}))`)
      records.push(detail)
      fs.writeFileSync(path.join(logDir,`obra-real-${id}.png`),(await window.webContents.capturePage()).toPNG())
    }
    await window.loadURL(new URL('/inicio/fontes',libraryUrl).href)
    await waitFor(window,`document.body.innerText.includes('Tencent Dongman') && document.body.innerText.includes('Kuaikan Manhua')`,'fontes dos três países')
    fs.writeFileSync(path.join(logDir,'fontes-reais.png'),(await window.webContents.capturePage()).toPNG())
    fs.writeFileSync(path.join(logDir,'biblioteca-real.json'),JSON.stringify({records,checkedAt:new Date().toISOString()},null,2))
    return
  }
  await window.webContents.executeJavaScript(`Promise.all(Array.from(document.images, image => image.decode().catch(() => {})))`)
  await delay(250)
  const text = await window.webContents.executeJavaScript('document.body.innerText')
  fs.writeFileSync(path.join(logDir, 'window-test.png'), (await window.webContents.capturePage()).toPNG())
  if (process.env.KOMA_DESKTOP_TEST_ACTIONS === '1') {
    const before = await window.webContents.executeJavaScript(`document.querySelector('.koma-favorite')?.getAttribute('aria-pressed')`)
    if (before == null) throw new Error('O teste exige obras sintéticas na biblioteca temporária.')
    await window.webContents.executeJavaScript(`document.querySelector('.koma-favorite').click()`)
    await waitFor(window, `document.querySelector('.koma-favorite').getAttribute('aria-pressed') !== ${JSON.stringify(before)} && !document.querySelector('.koma-favorite').disabled`, 'favorito salvo')
    checks.push('favorito da obra salvo pela interface')
    await window.webContents.executeJavaScript(`document.querySelector('.koma-search input').focus()`)
    await window.webContents.insertText('busca-sem-resultado-koma')
    await waitFor(window, `document.querySelectorAll('.koma-book').length === 0`, 'busca local')
    await window.webContents.executeJavaScript(`document.querySelector('#clear-work-search').click()`)
    await waitFor(window, `document.querySelectorAll('.koma-book').length === 4`, 'limpeza da busca')
    checks.push('busca local por título e limpeza do filtro')
    window.setMinimumSize(360,600); window.setSize(390,844)
    await delay(250)
    if (!(await window.webContents.executeJavaScript('document.documentElement.scrollWidth <= window.innerWidth'))) throw new Error('Biblioteca ultrapassa janela estreita.')
    fs.writeFileSync(path.join(logDir, 'window-mobile.png'), (await window.webContents.capturePage()).toPNG())
    checks.push('biblioteca de obras em janela estreita')
    window.setSize(1360,900)
    await window.webContents.executeJavaScript(`document.querySelector('.koma-book h3 a').click()`)
    await waitFor(window, `document.querySelector('[data-work-detail="ready"]') !== null`, 'detalhes da obra')
    fs.writeFileSync(path.join(logDir, 'window-work.png'), (await window.webContents.capturePage()).toPNG())
    await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('a')).find(a => a.href.includes('/ler/')).click()`)
    await waitFor(window, `document.querySelector('[data-work-reader="ready"]') !== null && document.querySelector('svg tspan')?.textContent.includes('Olá')`, 'leitor em português')
    checks.push('obra abre a lista de capítulos e a leitura traduzida')
    fs.writeFileSync(path.join(logDir, 'window-reader.png'), (await window.webContents.capturePage()).toPNG())
    await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Ver original').click()`)
    await waitFor(window, `document.querySelector('svg[aria-label]') === null`, 'alternar original')
    checks.push('original preservado acessível no leitor')
    await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Marcar como lido').click()`)
    await waitFor(window, `Array.from(document.querySelectorAll('button')).some(b => b.textContent === 'Leitura concluída')`, 'progresso salvo')
    checks.push('progresso de leitura salvo pela interface')
    await window.loadURL(new URL('/inicio/obras/nova',libraryUrl).href)
    await waitFor(window, `document.querySelector('#catalog-query') !== null`, 'adicionar obra')
    checks.push('ação principal abre busca por obra, sem cadastro de capítulos')
    if (process.env.KOMA_DESKTOP_TEST_CATALOG === '1') {
      await window.webContents.executeJavaScript(`document.querySelector('#catalog-query').focus()`)
      await window.webContents.insertText('Eminence in Shadow')
      await window.webContents.executeJavaScript(`document.querySelector('[data-work-search] form').requestSubmit()`)
      await waitFor(window, `document.querySelector('[data-source-id="77bee52c-d2d6-44ad-a33a-1734c1fe696a"]') !== null`, 'busca no catálogo real', 45000)
      await window.webContents.executeJavaScript(`document.querySelector('[data-source-id="77bee52c-d2d6-44ad-a33a-1734c1fe696a"]').click()`)
      await waitFor(window, `document.querySelector('#add-work') !== null`, 'prévia da obra')
      checks.push('busca real distingue Eminence in Shadow dos derivados e abre capa/sinopse')
      await window.webContents.executeJavaScript(`document.querySelector('#add-work').click()`)
      await waitFor(window, `document.querySelector('[data-work-detail="ready"]') !== null`, 'adicionar uma obra inteira', 20000)
      checks.push('adicionar obra grava biblioteca e abre acompanhamento sem importar capítulos')
    }
    await window.loadURL(libraryUrl)
    await waitFor(window, `document.querySelector('[data-library-state="ready"]') !== null`, 'retorno à biblioteca')
  }
  if (process.env.KOMA_DESKTOP_TEST_TRANSLATION === '1') {
    const preferencesUrl = new URL('/inicio/preferencias', libraryUrl).href
    await window.loadURL(preferencesUrl)
    await waitFor(window, `document.querySelector('#adaptation-model') !== null`, 'preferências do cofre')
    await window.webContents.executeJavaScript(`document.querySelector('[data-pref-section="translation"]').open = true; document.querySelector('#adaptation-model').focus()`)
    await window.webContents.insertText('modelo-sintetico-sem-chamada')
    await window.webContents.executeJavaScript(`document.querySelector('#review-enabled').click(); document.querySelector('#consent-deepseek').click(); document.querySelector('#kpassword-enabled').click()`)
    await waitFor(window, `document.querySelector('#kpassword-enabled').checked && !document.querySelector('#save-kpassword-settings').disabled`, 'configuração editada')
    await window.webContents.executeJavaScript(`document.querySelector('#save-kpassword-settings').click()`)
    await waitFor(window, `document.querySelector('[role="status"]')?.textContent.includes('Preferências salvas')`, 'preferências salvas')
    await window.loadURL(preferencesUrl)
    await waitFor(window, `document.querySelector('#adaptation-model')?.value === 'modelo-sintetico-sem-chamada' && document.querySelector('#kpassword-enabled').checked`, 'configuração persistida')
    await window.webContents.executeJavaScript(`document.querySelector('[data-pref-section="translation"]').open = true`)
    checks.push('provedor e modelo salvos pela interface sem API key')
    await window.webContents.executeJavaScript(`document.querySelector('#consent-deepseek').click()`)
    await waitFor(window, `document.querySelector('#kpassword-enabled').checked === false`, 'revogação desativa o motor')
    await window.webContents.executeJavaScript(`document.querySelector('#save-kpassword-settings').click()`)
    await waitFor(window, `document.querySelector('[role="status"]')?.textContent.includes('Preferências salvas')`, 'revogação salva')
    const disabled = await window.webContents.executeJavaScript(`fetch('/api/local/translation').then(r => r.json()).then(v => !v.settings.enabled && !v.settings.consent.deepseek)`)
    if (!disabled) throw new Error('Revogação do provedor não persistiu.')
    checks.push('revogação pela interface bloqueia o motor no backend')
    const noSecretInput = await window.webContents.executeJavaScript(`document.querySelectorAll('input[type="password"]').length === 0 && document.querySelector('#adaptation-credential') !== null`)
    if (!noSecretInput) throw new Error('Preferências devem usar referência do cofre.')
    checks.push('configuração do cofre sem campo de API key')
    fs.writeFileSync(path.join(logDir, 'window-translation.png'), (await window.webContents.capturePage()).toPNG())
    window.setMinimumSize(360, 600); window.setSize(390, 844)
    await delay(300)
    if (!(await window.webContents.executeJavaScript('document.documentElement.scrollWidth <= window.innerWidth'))) throw new Error('Preferências ultrapassam a janela estreita.')
    checks.push('preferências do cofre cabem em janela estreita')
    fs.writeFileSync(path.join(logDir, 'window-translation-mobile.png'), (await window.webContents.capturePage()).toPNG())
    window.setSize(1360, 900)
    await window.loadURL(libraryUrl)
  }
  await window.loadURL(new URL('/inicio/sobre',libraryUrl).href)
  await waitFor(window, `document.querySelector('[data-koma-about]') !== null`, 'sobre o KOMA')
  const about = await window.webContents.executeJavaScript(`({text:document.querySelector('[data-koma-about]').innerText,href:Array.from(document.querySelectorAll('a')).find(a=>a.textContent.includes('LinkedIn de Jean'))?.href})`)
  if (!about.text.includes('Jean Vitor') || !about.text.includes('Desenvolvedor Full Stack') || about.text.includes('Marco Antonio') || about.href !== 'https://www.linkedin.com/in/jean-vitor-16a19642a/') throw new Error('A autoria do KOMA não corresponde ao criador informado.')
  checks.push('autoria Jean Vitor e LinkedIn corretos na tela Sobre')
  fs.writeFileSync(path.join(logDir,'window-about.png'),(await window.webContents.capturePage()).toPNG())
  await window.loadURL(libraryUrl)
  fs.writeFileSync(path.join(logDir, 'window-test.json'), JSON.stringify({ title: window.getTitle(), text, url: libraryUrl, checks }, null, 2))
}

module.exports = { runWindowChecks }
