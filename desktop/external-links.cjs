// Somente os perfis públicos do criador e o projeto que serviu de base podem ser abertos fora da janela.
const profiles = new Set(['https://www.linkedin.com/in/jean-vitor-16a19642a/', 'https://github.com/mnstechbr', 'https://github.com/marco0antonio0/translate-manga-br'])
// Formulário de issue do KOMA, já preenchido pelo "Reportar erro" (a pessoa revisa e envia no navegador).
const ISSUE_FORM = 'https://github.com/mnstechbr/KOMA/issues/new'
function allowedExternalLink(value) {
  try {
    const url = new URL(value)
    if (!url.hash && url.origin + url.pathname === ISSUE_FORM && !url.username && !url.password) return true
    return !url.search && !url.hash && profiles.has(url.href)
  } catch { return false }
}
module.exports = { allowedExternalLink }
