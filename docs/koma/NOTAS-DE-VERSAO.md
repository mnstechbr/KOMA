# Notas de versão do KOMA

Histórico das entregas, mantido do antigo README. O README atual está em [README.pt-BR.md](../../README.pt-BR.md).


## 1.0.0 — versão estável

Primeira versão estável do repositório público.

- Nenhuma fonte não oficial incluída; fontes personalizadas (tema Madara) em Preferências → Fontes.
- Páginas baixadas em paralelo; procura diária de capítulos novos que para no primeiro já conhecido.
- OCR de páginas muito altas cerca de 5 vezes mais rápido.
- Editor de balões e "Reportar erro" no leitor, com envio opcional ao GitHub (só texto).
- Segundo plano: bandeja, iniciar com o computador, procura diária e avisos de capítulo novo.
- "Já está lendo?" ao adicionar uma obra.
- DeepL API Free como mais uma opção grátis de tradução, ao lado do Google Tradutor.
- Ler no celular pelo Wi-Fi de casa (QR code e código de acesso).
- Progresso no AniList (opcional) e painel com o tempo de cada etapa.
- Licença AGPL-3.0-or-later.

## Reproduzir o pacote

Requer Node **24**, npm, Git, tar e, para o RPM, `rpm-build`. O uso diário não requer esses componentes instalados separadamente. Compatibilidade de empacotamento validada somente em Fedora 44 x86_64.

```bash
npm ci
npm ci --prefix desktop
node desktop/node_modules/electron/install.js
npm run desktop:resources
npm run typecheck
npm run lint
npm test
npm run test:desktop
NEXT_TELEMETRY_DISABLED=1 SKIP_DB_BOOTSTRAP=1 npm run build
npm run desktop:prepare
npm run test:production
npm run desktop:install
```

O download de modelos verifica hashes e tamanhos do commit original; o runtime Node verifica SHA-256 da distribuição oficial. O pacote verifica ABI e rejeita links simbólicos que escapem de sua pasta. Não inclui `storage`, `.env` ou código-fonte capturado pelo tracing. Builds ficam em `artifacts/`, ignorado pelo Git.

`npm start` abre o último pacote preparado. O script de instalação copia uma versão nova e troca o link `current`, preservando versões anteriores e dados. Feche o aplicativo antes de atualizar. Para desfazer uma atualização, aponte `current` para uma versão anterior compatível; alterações futuras de schema exigirão backup antes de downgrade.

Para gerar um RPM local:

```bash
npm run desktop:rpm
```

O resultado está em `artifacts/rpm/RPMS/x86_64/`. A instalação por usuário já atende à abertura pelo menu. O RPM foi gerado e verificado; a instalação via gerenciador de pacotes em uma máquina limpa permanece pendente. Não instale as duas variantes simultaneamente, pois usam o mesmo perfil e atalho.

## Remover e preservar dados

`bash scripts/uninstall-desktop.sh` remove o atalho da instalação por usuário. Preserva biblioteca e pacotes para recuperação. Não apaga arquivos pessoais nem versões automaticamente. Na variante RPM, os dados também ficam fora de `/opt/koma`.

Para uma cópia de segurança manual desta versão, feche o KOMA e copie **toda a pasta library** para outro local. A chave `instance.key` é necessária para recuperar credenciais criptografadas. Backup/restauração pela interface ainda será implementado e validado.

## Adicionar e atualizar uma obra

1. Em **Minha biblioteca → Adicionar obra**, pesquise o nome conhecido. A busca consulta **MangaDex e um site não oficial** independentemente, com prioridade para correspondências exatas e identificação da fonte.
2. Confira capa, sinopse e nomes alternativos e clique em **Adicionar à biblioteca**. A fila coleta os capítulos disponíveis, preserva as imagens originais e prepara o texto em PT-BR. Capítulos já em português brasileiro são baixados sem chamadas aos modelos. Os demais usam OCR local e a adaptação/revisão configuradas pelo KPassword.
3. Abra a obra para acompanhar o progresso e ler os capítulos prontos. **Atualizar obra** busca novos capítulos dessa obra; **Atualizar biblioteca** faz isso para todas. Capítulos prontos e progresso de leitura são preservados. Pausar, fechar e reabrir o aplicativo preserva as etapas concluídas.

A preparação depende da disponibilidade da fonte, rede, OCR, modelos e autorizações. Não há promessa de todos os capítulos traduzidos instantaneamente. Arquivos locais continuam disponíveis em **Importar arquivos do computador (opcional)**. O leitor alterna entre original e camadas de diálogo em PT-BR, sem alterar o arquivo original.

## O que já foi verificado

70 testes de domínio, 4 testes de processos e abertura externa controlada, typecheck, lint sem erros (16 avisos herdados) e build de produção. Foram executadas 55 verificações HTTP e testes na janela Electron, incluindo obra → capítulo → leitura, original, progresso e configuração do cofre. Testes de rede encontraram a obra principal de *Eminence in Shadow*, descobriram 100 capítulos na consulta e verificaram atualização sem duplicatas. Um capítulo real já em PT-BR, com 39 páginas, foi baixado automaticamente e aberto pela API de leitura, sem chamadas aos modelos. Dados desses testes ficaram em bibliotecas temporárias.

A adaptação real com DeepSeek e a revisão com MiMo foram verificadas anteriormente com três falas próprias. Isso não certifica a qualidade editorial de capítulos completos. Veja [docs/koma/VALIDACAO.md](docs/koma/VALIDACAO.md) para evidências e limites.

## Biblioteca e direção da tradução

Favoritos e última abertura ficam no SQLite. Contadores usam obras, capítulos e páginas efetivamente registrados, com progresso real. O leitor e a importação de arquivos vieram do projeto de origem e foram preservados. Login, cadastro, usuários, leitura pública por link, extensão do Chrome e arquivos de Docker do projeto de origem foram removidos do código.

A adaptação contextual por DeepSeek/MiMo foi conectada ao adaptador MCP do KPassword, testada com respostas simuladas e com a amostra real em inglês. Isso não comprova ainda qualidade editorial em capítulos completos. O motor envia falas em lotes com contexto vizinho, glossário e vozes configuradas, e pode executar revisão separada contra o original. Recusa, resposta incompleta, IDs alterados e incerteza declarada pelo modelo impedem a aplicação da tradução. Metadados de modelo, duração e tokens são retornados pela API e exibidos no teste das preferências. Veja [TRADUCAO.md](docs/koma/TRADUCAO.md).

## Próximas entregas

A biblioteca possui obras e capítulos separados, busca externa com aliases, primeiro conector MangaDex, fila persistente por página, favoritos, pausa/retomada e atualização incremental. Permanecem pendentes: integração de fontes Suwayomi e outros catálogos, avaliação ampla da busca multilíngue ([requisitos](docs/koma/DESCOBERTA.md)), CBZ/ZIP, retomada exata de rolagem e zoom, avaliação editorial JA/KO/ZH, JEV, memória/glossário por obra, contexto entre páginas, inpainting, fontes oficiais, backup/restauração pela interface e Windows 11. O OCR sintético confirma execução, sem garantir detecção completa em páginas reais.


## Fontes na 0.4.2

A sincronização deixou de consultar exclusivamente o MangaDex. Os três vínculos de site não oficial confirmados pelo usuário são incorporados às obras correspondentes, sem alterar os capítulos prontos. É possível vincular outra fonte da mesma obra nos detalhes. A página **Fontes de obras** informa as capacidades reais por serviço.

- **Naver Webtoon:** índice e imagens públicas; episódios pagos são excluídos da coleta. O OCR instalado não reconhece Hangul com segurança e pode exigir uma versão alternativa.
- **Shonen Jump+:** índice percorrido pelos episódios da mesma série e páginas públicas.
- **Site não oficial (tema Madara):** índice e páginas; entradas contendo apenas créditos/banner não são capítulos completos.
- **Kuaikan, Tencent e Lezhin:** consulta de índices públicos. A prévia Kuaikan de duas imagens não é uma leitura integral; a consulta completa exige verificação da fonte e não é contornada.
- **KakaoPage e MANGA Plus:** integração de capítulos/páginas pendente. A busca textual consulta MangaDex e um site não oficial; não representa uma busca global de todas as plataformas.

A união dos índices preserva capítulos já baixados, volumes e alternativas. Um capítulo estrangeiro sem texto reconhecido não é marcado como tradução pronta. Tiras verticais passam por OCR em janelas sobrepostas, sem alterar o original.

## Recuperação de falhas na 0.4.1

A fila alterna entre obras a cada página. Um balão ilegível recebe uma tentativa adicional de OCR local usando o idioma da versão coletada. Trechos ainda incertos permanecem no original; os reconhecidos e as próximas páginas continuam. O capítulo fica disponível como **Leitura com pendências**, sem se declarar totalmente traduzido. Falhas compatíveis podem tentar até duas versões alternativas do mesmo capítulo no MangaDex; tentativas anteriores e arquivos são preservados. Atualizar/retomar repete as pendências e preserva páginas prontas.

A publicação original e a edição licenciada são identificadas pelos vínculos da obra e apresentadas nos detalhes. Na versão 0.4.1, esses vínculos ainda não possuíam conector de download. As capacidades atuais estão na seção Fontes e na tela do aplicativo; consultar um vínculo público não equivale a importar todos os capítulos dessa publicação. Esses conectores e os acessos necessários são trabalho pendente, sem promessa de cobertura de todas as fontes.

## Páginas traduzidas na 0.4.8

- **Narração e legendas:** além dos balões, um detector de linhas de texto (PP-OCR) encontra texto sobre o desenho; o OCR passa a ler linha a linha, sem cortar palavras nas bordas.
- **Imagem final em PT-BR:** o texto original é apagado (cor do balão em fundo liso; reconstrução pelos pixels vizinhos em fundo desenhado) e a tradução é escrita encaixada, com contorno quando está sobre a arte. As imagens ficam em `library/sections/<n>/translated/`; o botão **Ver original** continua disponível.
- **Páginas antigas:** são atualizadas automaticamente em segundo plano, reaproveitando as traduções existentes; só o texto novo vai ao modelo.

## Preparação e fontes na 0.4.4

- **Tradução que avança:** uma fala marcada como incerta pelo modelo não descarta mais a página; a tradução é aplicada e a dúvida fica registrada. Páginas descartadas pela regra anterior voltaram à fila automaticamente.
- **Mais rápido:** o OCR local roda junto do download (até 3 em paralelo) e a tradução envia até 8 páginas por chamada, com até 3 obras em paralelo depois da primeira autorização do KPassword.
- **OCR melhor:** balões que o detector cortava ao meio são unidos antes do reconhecimento, evitando frases truncadas.
- **Várias fontes por obra:** ao atualizar, o KOMA pesquisa o mesmo título no WEBTOON oficial (inglês, episódios gratuitos), sites não oficiais, além do MangaDex e das publicações originais suportadas. Se uma fonte falhar, até 6 versões do mesmo capítulo são tentadas, com preferência por PT-BR e pela publicação oficial. Sites protegidos por bloqueio anti-bot não são contornados.
- **Fonte original primeiro:** cada capítulo usa primeiro a publicação original (Naver Webtoon, Shonen Jump+), pesquisada também pelo título em coreano quando o MangaDex não informa o vínculo. Se o episódio é pago ou indisponível, segue para PT-BR, edição oficial traduzida, MangaDex e demais sites. KakaoPage e ComicWalker protegem as imagens e não são extraídos.
- **OCR coreano:** modelo PP-OCRv5 coreano local; capítulos originais coreanos (Naver) são lidos e traduzidos direto do original.
- **Revisão com MiMo 2.6 Flash** (`mimo-v2.6-flash`), adaptação com DeepSeek.
- **Projeto na raiz:** o código fica diretamente em `KOMA/`, sem a pasta `app/` aninhada.

## Recuperação da preparação na 0.4.3

Downloads e tradução agora têm filas independentes: até três obras baixam originais enquanto uma página passa por OCR/adaptação/revisão. Um bloqueio do KPassword não impede baixar os demais capítulos. Os detalhes mostram páginas e capítulos com originais baixados separadamente dos prontos para ler em PT-BR. A cota do cofre gera espera compartilhada e persistente, com horário da próxima tentativa; retomar a obra não contorna esse limite. Sem Retry-After no protocolo, cota esgotada aguarda uma hora; falhas temporárias aguardam um minuto.

Respostas válidas de adaptação/revisão ficam em checkpoints locais para não pagar novamente uma etapa concluída quando a próxima falha. O limite de saída solicitado foi reduzido proporcionalmente ao tamanho do lote, preservando a rejeição de respostas incompletas. Quando há alternativa compatível, capítulos coreanos usam essa alternativa antes do download, pois o OCR instalado não reconhece Hangul com segurança.

A busca por título consulta MangaDex e um site não oficial independentemente, identifica a fonte em cada resultado e permite adicionar obras de ambos. A indisponibilidade de um catálogo não esconde os resultados do outro. As outras plataformas listadas em Fontes mantêm as capacidades informadas; isso não representa cobertura de centenas de sites nem acesso a capítulos pagos.

Recusa, revogação ou configuração de provedor inválida suspendem apenas a tradução, até uma retomada explícita; os downloads não são pausados por esses erros. A migração recupera pausas automáticas da versão anterior por revogação, mantendo a tradução bloqueada. A pausa manual da obra continua parando os dois estágios.
