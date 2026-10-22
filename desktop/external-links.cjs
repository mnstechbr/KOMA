// Somente os perfis públicos do criador e o projeto que serviu de base podem ser abertos fora da janela.
const profiles = new Set([
  'https://www.linkedin.com/in/jean-vitor-16a19642a/',
  'https://github.com/mnstechbr',
  'https://github.com/marco0antonio0/translate-manga-br',
])
// Formulário de issue do KOMA, já preenchido pelo "Reportar erro" (a pessoa revisa e envia no navegador).
const ISSUE_FORM = 'https://github.com/mnstechbr/KOMA/issues/new'
function allowedExternalLink(value) {
  try {
    const url = new URL(value)
    if (!url.hash && url.origin + url.pathname === ISSUE_FORM && !url.username && !url.password) return true
    // Autorização do KOMA no AniList (o site mostra o token para colar no app).
    if (
      !url.hash &&
      url.origin + url.pathname === 'https://anilist.co/api/v2/oauth/authorize' &&
      /^\d+$/.test(url.searchParams.get('client_id') || '') &&
      url.searchParams.get('response_type') === 'token'
    )
      return true
    return !url.search && !url.hash && profiles.has(url.href)
  } catch {
    return false
  }
}
module.exports = { allowedExternalLink }
