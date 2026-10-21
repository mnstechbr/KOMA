# KOMA

[English](README.md) · **Português**

**Escolha uma obra. O KOMA cuida do resto.** O KOMA é uma biblioteca pessoal de mangás, manhwas e manhuas para desktop. Você adiciona uma obra e ele encontra os capítulos, baixa as páginas, reconhece o texto dos balões, traduz com o modelo de IA que você escolher e entrega as páginas prontas para ler no seu idioma.

> Projeto pessoal e experimental. Testado no Fedora 44 (Linux x86_64). Há um instalador para Windows 11 em versão experimental, ainda não testado num Windows de verdade.

## O que ele faz

- **Biblioteca de obras:** busca por título, capa, sinopse e nomes alternativos. Tem favoritos, "continuar lendo", novidades e progresso por capítulo.
- **Coleta em várias fontes:** procura primeiro a publicação original (Naver Webtoon, Shonen Jump+) e depois versões no seu idioma, edições oficiais e MangaDex. Se uma fonte falhar, tenta outra versão do mesmo capítulo. O KOMA não traz nenhuma fonte não oficial. Você pode adicionar seus próprios sites em **Preferências → Fontes** (qualquer site feito com o tema Madara do WordPress, colando o link de uma obra), por sua conta.
- **OCR local:** detecção de balões (YOLO) e de texto solto, com reconhecimento PP-OCRv5 para alfabeto latino e coreano. Tudo roda no computador.
- **Tradução por capítulo:** o capítulo inteiro vai numa chamada, com as falas vizinhas, o glossário e as vozes dos personagens como contexto. Um modelo pode traduzir e outro revisar.
- **Páginas traduzidas de verdade:** o texto original é apagado e a tradução é desenhada dentro do balão. O original continua disponível com um clique.
- **Leitor:** rolagem contínua, rolagem automática com 15 velocidades (barra de espaço para pausar) e clique do meio para rolar.
- **Idiomas:** interface em português, inglês ou espanhol. As obras podem ser traduzidas para português (Brasil), inglês, espanhol, francês, alemão ou italiano, escolhido por obra.
- **Armazenamento na nuvem (opcional):** Google Drive, OneDrive ou qualquer serviço do rclone. Cada capítulo vira um `.cbz` que abre em qualquer leitor de quadrinhos. Os capítulos podem ficar só na nuvem, com um cache limitado no computador.

## Quem traduz

Configure em **Preferências → Adaptação e revisão**:

| Opção | Como funciona |
|---|---|
| **Assinatura Claude ou ChatGPT** | Usa o login do [Claude Code](https://claude.com/claude-code) ou do Codex (que vem com o app do ChatGPT) deste computador. Não precisa de API key; consome o limite do seu plano. |
| **KPassword** | DeepSeek, Xiaomi MiMo, OpenAI, Anthropic e Z.ai com as chaves guardadas no cofre do KPassword, via Secrets Bridge. O KOMA nunca vê a chave. |
| **OpenRouter ou Google (legado)** | Para capítulos importados manualmente. |

O envio de texto a qualquer provedor fica bloqueado até você autorizar.

## Instalar a partir do código

Requisitos: Linux x86_64, Node 24, npm, Git com [Git LFS](https://git-lfs.com/) e tar. O rclone é opcional (armazenamento na nuvem). Para gerar o RPM, também é preciso o `rpm-build`.

```bash
git lfs install
git clone <este repositório> koma && cd koma
npm ci
npm ci --prefix desktop
node desktop/node_modules/electron/install.js
npm run desktop:resources
NEXT_TELEMETRY_DISABLED=1 SKIP_DB_BOOTSTRAP=1 npm run build
npm run desktop:prepare
npm run desktop:install
```

Depois, abra **KOMA** pelo menu de aplicativos. Para conferir antes de instalar, rode `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:desktop` e `npm run test:production`. O comando `npm run desktop:rpm` gera um pacote RPM em `artifacts/rpm/`.

## Windows 11 (experimental)

Baixe o `KOMA-Setup-<versão>.exe` na página de [Releases](https://github.com/mnstechbr/KOMA/releases). Ele instala para o seu usuário, sem pedir administrador, e guarda os dados em `%LOCALAPPDATA%\KOMA`. Como ainda não foi testado num Windows de verdade, [abra uma issue](https://github.com/mnstechbr/KOMA/issues) se algo falhar. Para gerar o instalador, rode `npm run build` e depois `npm run desktop:windows`, no Linux ou no Windows; ele fica em `artifacts/`.

## Onde ficam os dados

| O quê | Onde |
|---|---|
| Biblioteca, banco SQLite e páginas | `~/.local/share/koma/library` |
| Aplicativo instalado | `~/.local/share/koma/app/current` |
| Diagnóstico | `~/.local/state/koma/logs/backend.log` |

Respeita `XDG_DATA_HOME`, `XDG_CONFIG_HOME` e `XDG_STATE_HOME`. Para fazer backup, feche o KOMA e copie a pasta `library` inteira.

## Privacidade

Não há conta, servidor nem telemetria do KOMA. A biblioteca, o OCR e o progresso ficam no seu computador. Saem dele apenas:
- as consultas às fontes das obras;
- os textos dos balões enviados aos provedores de tradução que você autorizar;
- os capítulos enviados à nuvem que você conectar.

## Aviso legal

O KOMA não hospeda nem distribui obras. Ele acessa páginas públicas pela sua conexão, para uso pessoal, como um navegador faria. Respeite os direitos autorais e os termos de uso de cada site. Sempre que possível, apoie os autores lendo e comprando nas plataformas oficiais.

## Créditos

- Baseado no projeto open source [translate-manga-br](https://github.com/marco0antonio0/translate-manga-br) (licença MIT). A autoria original está preservada em [LICENSE](LICENSE) e [THIRD-PARTY-NOTICES](THIRD-PARTY-NOTICES).
- OCR: [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) (Apache-2.0); o modelo coreano foi convertido para ONNX por monkt/paddleocr-onnx.
- Detector de balões (`models/yolo.onnx`): herdado do translate-manga-br. Os metadados dizem que ele foi treinado com Ultralytics sob a licença AGPL-3.0, a mesma do KOMA.
- Apagamento do texto: [comic-text-detector](https://github.com/dmMaze/comic-text-detector) (GPL-3.0 na origem; conversão para ONNX por mayocream) e [LaMa](https://github.com/advimman/lama) (Apache-2.0; conversão para ONNX por Carve), baixados com SHA-256 fixado por `scripts/fetch-desktop-resources.mjs`.
- Fontes da interface: Dela Gothic One e IBM Plex Sans (SIL Open Font License 1.1).
- O planejamento da biblioteca se inspirou no [Suwayomi-Server](https://github.com/Suwayomi/Suwayomi-Server); nenhum código dele foi incorporado.

O histórico das versões está em [docs/koma/NOTAS-DE-VERSAO.md](docs/koma/NOTAS-DE-VERSAO.md).

## Autor

Criado por **Jean Vitor**, desenvolvedor full stack · [LinkedIn](https://www.linkedin.com/in/jean-vitor-16a19642a/) · [GitHub](https://github.com/mnstechbr)

Licença [GNU Affero General Public License v3.0 ou posterior](LICENSE) (AGPL-3.0-or-later). O código herdado do translate-manga-br mantém o aviso MIT, reproduzido no mesmo arquivo.
