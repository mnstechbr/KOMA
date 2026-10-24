# KOMA

[English](README.md) · **Português**

**Escolha a obra. O KOMA faz o resto.** O KOMA é uma biblioteca pessoal de mangás, manhwas e manhuas para o computador. Adicione uma obra e ele encontra os capítulos, baixa as páginas, lê o texto dos balões, traduz e entrega as páginas prontas para ler no seu idioma.

Funciona no Linux (x86_64) e no Windows 11. Projeto pessoal, software livre, sem conta e sem servidor.

## O que ele faz

- **Biblioteca:** busca pelo título, com capa, sinopse e nomes alternativos. Acompanha favoritos, "continuar lendo", capítulos novos e o progresso de cada capítulo. Ao adicionar uma obra, você pode escolher quais capítulos baixar e dizer em qual capítulo parou de ler: o KOMA prepara primeiro desse capítulo até o último, depois volta ao começo, e marca os anteriores como lidos.
- **Fontes:** MangaDex, o WEBTOON oficial (episódios gratuitos) e a publicação original quando ela tem páginas públicas (Naver Webtoon). O Shonen Jump+ entra só como índice de capítulos, porque as páginas dele são protegidas. **O KOMA não traz nenhuma fonte não oficial.** Você pode adicionar seus próprios sites em **Preferências → Fontes** (sites feitos com o tema Madara do WordPress, colando o link de uma obra), por sua conta.
- **Coleta rápida:** as páginas são baixadas várias ao mesmo tempo, e a procura diária por capítulos novos para no primeiro capítulo já conhecido.
- **OCR local:** detecção de balões, de texto fora deles e leitura PP-OCRv5 para alfabeto latino e coreano, no seu computador (processador ou, no perfil Máximo, a placa de vídeo).
- **Páginas traduzidas:** o texto original é apagado (com os modelos comic-text-detector e LaMa) e a tradução é desenhada dentro do balão. A página original fica a um clique.
- **Desempenho:** em **Preferências → Desempenho**, o KOMA escolhe um perfil para o seu computador (Leve, Equilibrado ou Máximo). Ele só usa a placa de vídeo quando ela é mais rápida que o processador e dá o mesmo resultado. Dá para limitar o uso a 100%, 75% ou 50% e deixar o KOMA desacelerar quando o computador esquentar. No Linux com placa NVIDIA, um complemento CUDA opcional (download à parte, fora do instalador) acelera o desenho no perfil Máximo.
- **Leitor:** rolagem contínua, rolagem automática com 15 velocidades (a barra de espaço pausa), rolagem com o botão do meio, "Refazer este capítulo", **editor de balões** (clique num balão, corrija o texto, só aquela página é desenhada de novo e a correção entra no glossário da obra) e **Reportar erro** (veja abaixo).
- **Segundo plano:** fechar a janela deixa o KOMA no ícone da bandeja. Ele pode iniciar com o computador, procura capítulos novos todo dia no horário que você escolher e mostra um aviso que abre o capítulo novo no leitor.
- **Ler no celular (opcional):** pelo Wi-Fi de casa, com QR code e código de acesso. No celular só dá para ler e marcar como lido; nada fica exposto na internet.
- **AniList (opcional):** ao marcar um capítulo como lido, o seu progresso no AniList sobe, pela autorização oficial do AniList.
- **Idiomas:** telas em português, inglês ou espanhol. Cada obra pode ser traduzida para português do Brasil, inglês, espanhol, francês, alemão ou italiano.
- **Dispositivo externo (opcional):** guarde os capítulos antigos num HD, SSD, pendrive, cartão de memória ou pasta de rede. Em **Preferências → Armazenamento → Dispositivo externo**, escolha o dispositivo na lista. Cada capítulo vira um arquivo `.cbz` nele (abre em qualquer leitor de quadrinhos), conferido byte a byte antes de sair do computador. No computador ficam só os capítulos mais novos de cada obra e os seguintes ao último que você leu (3 + 3 por padrão, ajustável). Com o dispositivo conectado, um capítulo antigo abre em segundos; sem ele, o KOMA pede para conectar. O dispositivo é reconhecido por um arquivo `koma-disco.json`, mesmo que o caminho ou a letra da unidade mude.
- **Armazenamento na nuvem (opcional):** Google Drive, OneDrive ou qualquer serviço do rclone. Cada capítulo vira um `.cbz`. Os capítulos podem ficar só na nuvem, com um cache limitado no computador.

## Quem traduz

Configure em **Preferências → Tradução**:

| Opção | Como funciona |
|---|---|
| **Google Tradutor (grátis)** | Sem conta nem chave. Fala por fala, sem o contexto do capítulo. |
| **DeepL API Free** | Grátis dentro da franquia mensal de uma conta DeepL API Free. A chave (termina em `:fx`) fica criptografada no KOMA, e as Preferências mostram quanto da franquia já foi usado. Fala por fala, sem o contexto do capítulo. |
| **Assinatura Claude ou ChatGPT** | Usa o login do [Claude Code](https://claude.com/claude-code) ou do Codex (que vem com o app do ChatGPT) deste computador. Não precisa de API key; consome o limite do seu plano. Traduz o capítulo inteiro com contexto e pode reler na imagem as falas borradas. |
| **KPassword** | DeepSeek, Xiaomi MiMo, OpenAI, Anthropic e Z.ai, com as chaves no cofre do KPassword, acessadas pelo Secrets Bridge (Linux). O KOMA nunca vê a chave. |
| **OpenRouter** | Chave guardada criptografada no KOMA; qualquer modelo do catálogo do OpenRouter. |

Com um modelo de IA, um segundo modelo pode revisar a tradução. Os tradutores grátis trabalham sozinhos, sem revisor. O texto só sai do computador depois que você autoriza o provedor. Em **Preferências → Desempenho** aparece quanto tempo cada etapa levou nos últimos capítulos.

## Instalar

### Windows 11

Baixe o `KOMA-Setup-<versão>.exe` na página de [Releases](https://github.com/mnstechbr/KOMA/releases) e execute. Ele instala para o seu usuário, sem pedir administrador, e guarda os dados em `%LOCALAPPDATA%\KOMA`. O instalador é gerado e testado no Windows 11 pelo GitHub Actions (instala, abre e desinstala mantendo a biblioteca). Se o firewall perguntar quando você ligar "Ler no celular", permita o KOMA nas redes privadas.

### Linux (a partir do código)

Requisitos: Linux x86_64, Node 24, npm, Git com [Git LFS](https://git-lfs.com/) e tar. O rclone é opcional (armazenamento na nuvem). Gerar o RPM também pede o `rpm-build`.

```bash
git lfs install
git clone https://github.com/mnstechbr/KOMA.git koma && cd koma
npm ci
npm ci --prefix desktop
node desktop/node_modules/electron/install.js
npm run desktop:resources
NEXT_TELEMETRY_DISABLED=1 SKIP_DB_BOOTSTRAP=1 npm run build
npm run desktop:prepare
npm run desktop:install
```

Depois, abra o **KOMA** pelo menu de aplicativos. Para conferir tudo antes de instalar, rode `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:desktop` e `npm run test:production`. `npm run desktop:rpm` gera um pacote RPM em `artifacts/rpm/`; `npm run desktop:windows` gera o instalador do Windows em `artifacts/`.

## Onde ficam os dados

| O quê | Linux | Windows |
|---|---|---|
| Biblioteca, banco SQLite e páginas | `~/.local/share/koma/library` | `%LOCALAPPDATA%\KOMA\library` |
| Aplicativo instalado | `~/.local/share/koma/app/current` | `%LOCALAPPDATA%\Programs\KOMA` |
| Diagnóstico | `~/.local/state/koma/logs/backend.log` | `%LOCALAPPDATA%\KOMA\logs` |
| Capítulos no dispositivo externo (opcional) | pasta `KOMA` no dispositivo | pasta `KOMA` no dispositivo |

No Linux, `XDG_DATA_HOME`, `XDG_CONFIG_HOME` e `XDG_STATE_HOME` são respeitados. Para fazer backup, feche o KOMA (Sair, no menu do ícone da bandeja) e copie a pasta `library` inteira.

## Privacidade

O KOMA não tem conta, servidor nem telemetria. A biblioteca, o OCR e o progresso de leitura ficam no seu computador. Só sai dele:
- os pedidos às fontes das obras;
- o texto dos balões enviado aos provedores de tradução que você autorizar;
- os capítulos enviados para a nuvem que você conectar (opcional);
- o seu progresso de leitura enviado ao AniList, se você conectar (opcional);
- as páginas mostradas no seu celular, na rede de casa, se você ligar "Ler no celular" (opcional);
- um relato de erro que você decidir enviar ao GitHub, aberto no navegador para você revisar (opcional).

## Reportar problemas

No leitor, o botão de bandeira reporta um erro de tradução numa página. A página passa a ser conferida no gate de qualidade de toda versão nova. **Reportar e enviar para o GitHub** abre no navegador uma [issue](https://github.com/mnstechbr/KOMA/issues/new/choose) já preenchida, só com texto (sem imagem, sem o nome da obra e sem links); você revisa e envia com a sua conta. Bugs do app vão pelo formulário **Bug do app**.

## Aviso legal

O KOMA não hospeda nem distribui obras e não traz nenhuma fonte não oficial. Ele lê páginas públicas pela sua própria conexão, para uso pessoal, como um navegador faria. Os sites que você adicionar são de sua responsabilidade. Respeite os direitos autorais e os termos de uso de cada site. Sempre que puder, apoie os autores lendo e comprando nas plataformas oficiais.

## Créditos

- Baseado no projeto open source [translate-manga-br](https://github.com/marco0antonio0/translate-manga-br) (licença MIT). A autoria original está preservada em [LICENSE](LICENSE) e [THIRD-PARTY-NOTICES](THIRD-PARTY-NOTICES).
- OCR: [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) (Apache-2.0); o modelo coreano foi convertido para ONNX por monkt/paddleocr-onnx.
- Detector de balões (`models/yolo.onnx`): herdado do translate-manga-br. Os metadados dizem que ele foi treinado com Ultralytics sob a licença AGPL-3.0, a mesma do KOMA.
- Apagamento do texto: [comic-text-detector](https://github.com/dmMaze/comic-text-detector) (GPL-3.0 na origem; conversão para ONNX por mayocream) e [LaMa](https://github.com/advimman/lama) (Apache-2.0; conversão para ONNX por Carve), baixados com SHA-256 fixado por `scripts/fetch-desktop-resources.mjs`.
- Fontes da interface: Dela Gothic One e IBM Plex Sans (SIL Open Font License 1.1).
- O planejamento da biblioteca se inspirou no [Suwayomi-Server](https://github.com/Suwayomi/Suwayomi-Server); nenhum código dele foi incorporado.

O histórico das versões (em português) está em [docs/koma/NOTAS-DE-VERSAO.md](docs/koma/NOTAS-DE-VERSAO.md).

## Autor

Criado por **Jean Vitor**, desenvolvedor full stack · [LinkedIn](https://www.linkedin.com/in/jean-vitor-16a19642a/) · [GitHub](https://github.com/mnstechbr)

Licença [GNU Affero General Public License v3.0 ou posterior](LICENSE) (AGPL-3.0-or-later). O código herdado do translate-manga-br mantém o aviso MIT, reproduzido no mesmo arquivo.
