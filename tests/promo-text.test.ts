import { expect, it } from 'vitest'
import { isPromoText } from '../lib/promo-text'

it('reconhece propaganda de sites e grupos', () => {
  for (const text of ['Read at ASURASCANS.COM', 'mangayy. org', 'MangaYY.Org', 'join our discord', 'read on mangapark.to', 'newtoki.me', 'LikeManga.Ink', 'LIKE MANGA.I NK', 'GENZ\nTOONS\n.ORG', 'NEWTOKL69.COM', 'HTTPS//NENTK.COM', 'URASCANS.CM']) expect(isPromoText(text), text).toBe(true)
})

it('não confunde fala comum com endereço de site', () => {
  for (const text of [
    '...A LIFE BY THE BLADE LEAVES ITS MARK. TO THINK I STILL FEEL THE URGE TO COMPETE.',
    "DON'T TELL ME... THE GOD OF BATTLE?", 'WAIT, ME TOO?', 'I GAVE IT TO HIM. ME? NEVER.', 'ALL THE WAY. TO THE TOP!', 'HE SAID. IO SONO.',
    // Traduções em português: "com" e "site" são palavras comuns.
    'EU VOU TE ESMAGAR EM PEDACINHOS, COM CERTEZA!', 'ISSO QUER DIZER QUE, COM A UNIFICAÇÃO DE PUNHO-MAGIA, ATÉ SETE CAMADAS É POSSÍVEL!',
    'Ele parou. Com isso, acabou.', 'Valha-me Deus... Como ele pôde?', 'Entrei no site. Nada.',
  ]) expect(isPromoText(text), text).toBe(false)
})
