// Somente os perfis públicos do criador e o projeto que serviu de base podem ser abertos fora da janela.
const profiles = new Set(['https://www.linkedin.com/in/jean-vitor-16a19642a/', 'https://github.com/mnstechbr', 'https://github.com/marco0antonio0/translate-manga-br'])
function allowedExternalLink(value) {
  try { const url = new URL(value); return !url.search && !url.hash && profiles.has(url.href) } catch { return false }
}
module.exports = { allowedExternalLink }
