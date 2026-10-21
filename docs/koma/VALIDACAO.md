# Ressalva da auditoria — 18/10/2026, 21:54 BRT


## 0.4.2 — coleta e contagens verificadas

O pacote de produção foi executado com cópia consistente da biblioteca real. A sincronização encontrou 100 registros em Eminence (incluindo partes/especiais), 193 em Crônicas e 70 em Divine Demon. Os 95 capítulos previamente prontos foram preservados e um segundo refresh não duplicou IDs. A comprovação do catálogo não comprova tradução dos capítulos novos. Na biblioteca instalada, os capítulos 24 de Crônicas (44 páginas) e 2 de Divine Demon (24 páginas) ficaram prontos desde o backup; o leitor e todas as 68 imagens retornaram HTTP 200. As duas versões coletadas já eram PT-BR, sem comprovação de nova tradução por LLM. Evidência: `artifacts/fontes-reais-0.4.2/biblioteca-instalada.json`. A versão instalada também foi aberta em janela Electron com a biblioteca pessoal; capturas e contagens estão em `artifacts/fontes-reais-0.4.2/janela/logs/`.

A coleta real dos links do site não oficial baixou 36 imagens do capítulo 85 de Eminence, 14 do capítulo 32 de Crônicas e 193 do capítulo 6 de Divine Demon. Todas passaram pela leitura de dimensões e hash SHA-256. Esses downloads de amostra não utilizaram modelos nem foram contados como capítulos traduzidos. A entrada 193 de Crônicas contém créditos/banner e é rejeitada como história incompleta.

Na Naver foram consultados 193 episódios: 187 públicos e seis pagos. O capítulo público 187 retornou 115 páginas; uma imagem foi baixada e validada. No Jump+, uma série japonesa retornou 12 episódios e 30 páginas para o primeiro episódio; uma imagem pública foi validada. Na Kuaikan foram lidas 109 entradas e uma imagem de prévia, sem declarar capítulo completo. Os índices públicos de amostra retornaram 956 entradas na Tencent e 135 episódios na Lezhin. Isso não certifica coleta integral nessas plataformas.

Na mesma tira real de Divine Demon (800 × 13.957 px), o pacote 0.4.1 detectou zero balões. O OCR em janelas da 0.4.2 detectou 15, sem falas vazias após a recuperação local. Esse ensaio não usou LLM nem certifica a qualidade editorial da tradução. A fila mantém até três obras em andamento, com uma operação por obra e serialização das chamadas editoriais, para que uma resposta externa não segure downloads independentes. As barras usam capítulos prontos, incluindo os ainda sem contagem de páginas no denominador total.

Artefatos locais, fora do Git: `artifacts/fontes-reais-0.4.2/resultado.json`, `biblioteca-producao.json`, `originais-jp-cn.json`, `indices-publicos.json`, `ocr-antes-depois.json` e `ocr-deteccoes-0.4.2.json`. As imagens publicadas permanecem exclusivamente nos artefatos locais e na biblioteca pessoal.

As verificações anteriores **não comprovam catálogo completo nem conclusão da tradução dos capítulos com erro**. O confronto somente leitura com o backup da 0.4.1 encontrou 137 registros (100/32/5) e 95 prontos (71/23/1), todos identificados como PT-BR na fonte. Dos 29 capítulos de Eminence anteriormente em erro, **zero passaram a prontos**. Os três novos prontos desde o backup foram Crônicas 21 e 23 e Divine Demon 1, todos já em PT-BR, sem demonstração de tradução automática de capítulo estrangeiro completo.

O teste de OCR de uma página (Eminence 21.5, volume 5) não certificou fidelidade nem conclusão de capítulo. A falha de completude permanece: a consulta direta encontrou Crônicas com 193 episódios na Naver e Divine Demon com 70 no KakaoPage; o KOMA contém apenas 32 e 5 registros dessas obras. Nos links do site não oficial enviados pelo usuário, a consulta atual encontrou 93 entradas até o número 85 para Eminence, 193 para Crônicas e 70 para Divine Demon. Partes/especiais não devem ser somados como capítulos completos sem reconciliação.

Relatório local detalhado e listas por capítulo: `artifacts/audits/20261018-catalogo/RELATORIO.md`, `capitulos.csv`, `auditoria.json` e `comparacao-fontes.json`. Script reproduzível sem rede/LLM: `scripts/audit-library.py`. A aplicação instalada não foi modificada nesta auditoria.

---

# Correção 0.4.1 — fila, OCR e identidade do KOMA

- Diagnóstico na biblioteca pessoal: *The Eminence in Shadow* tinha 71 capítulos prontos e 29 em erro; predominavam balões sem texto reconhecido. As outras obras aguardavam a fila sequencial. Configurações DeepSeek/MiMo estavam ativadas e autorizadas.
- **70 testes de domínio** e **4 de processos/links externos**. Regressões de migração de erros da 0.4, preservação de prontos/lidos, recuperação local, tradução apenas de balões reconhecidos, continuidade das demais páginas, alternância de obras e arquivo de tentativas anteriores. Typecheck, lint e build conferidos.
- **55 verificações HTTP**: acrescentam leitura parcial com aviso e autoria Jean Vitor/LinkedIn. [Resultado](evidencias/producao-0.4.1.json).
- **OCR real em página anteriormente afetada**, inteiramente local: antes, 3 de 9 balões sem reconhecimento; após a correção, 9 reconhecidos e nenhum vazio/erro declarado. Nenhuma chamada a modelo externo nesse ensaio. Isso demonstra recuperação nessa página, sem certificar a fidelidade de todas as falas. [Resultado](evidencias/ocr-recuperacao-0.4.1.json).
- **13 verificações na janela Electron**, com biblioteca sintética: leitor parcial, original, progresso, preferências e autoria/LinkedIn na tela Sobre. [Resultado](evidencias/interface-0.4.1.json), [Sobre](evidencias/sobre-jean-vitor-0.4.1.png).
- **Atualização instalada e reaberta**, com backup integral em `artifacts/backups/library-antes-0.4.1-20261018-213959` (3 obras e 92 capítulos já prontos no momento da cópia). Integridade do banco, migração 6, preferências do KPassword e todos os capítulos anteriormente prontos conferidos. [Preservação](evidencias/preservacao-0.4.1.json).
- RPM `koma-0.4.1-1.fc44.x86_64.rpm`: `digests OK`, SHA-256 `ecc97437203f9e3ec5dde74d07abfe78055d17891e6eabf4c066f9dde264a97a`. Gerado localmente, sem instalação no banco do sistema.
- Identidade do aplicativo: Jean Vitor, idealizador e desenvolvedor full stack; LinkedIn informado pelo usuário. Tela Sobre, rodapé, metadados e apresentação da extensão atualizados. Foto e apresentação pessoal herdadas removidas. LICENSE e THIRD-PARTY-NOTICES preservam a proveniência exigida pela licença MIT.

**Fontes:** vínculos originais identificados para KadoComi (*Eminence*), Naver (*Crônicas*) e KakaoPage (*Divine Demon*). A sincronização consulta esses vínculos públicos antes do catálogo alternativo e informa os limites nos detalhes. **Os downloads continuam no MangaDex**; a checagem dos vínculos não implementa a leitura nesses três serviços. Não afirmar coleta completa das publicações originais ou cobertura de todas as fontes. Alternativas automáticas nesta entrega são versões do mesmo capítulo disponíveis no MangaDex, com tentativas limitadas e arquivos anteriores preservados.

---

# Validação do KOMA 0.4 — 18/10/2026

História verificada: pesquisar a obra → conferir metadados → adicionar uma vez → coletar capítulos → preparar páginas → ler → atualizar sem duplicar ou perder progresso.

- **65 testes de domínio**: incluem as regressões anteriores, obras e aliases, deduplicação, identidade capítulo/volume, isolamento por proprietário, atualização incremental, recuperação de fila/página e preservação dos originais. O worker usa SQLite e arquivos reais nos testes, com fonte/OCR/LLM controlados. Traduções prontas não são refeitas após falha/retomada; recusa do cofre pausa a obra.
- **3 testes de processos** passaram após a retomada: inicialização/encerramento, perda do processo pai e falha sem supervisor órfão. Typecheck e build de produção passaram. Lint: zero erros e 16 avisos herdados. A geração mantém a lista explícita de arquivos para mitigar o aviso herdado de tracing.
- **53 verificações HTTP**, sem requisições externas: autenticação/origem, configurações do cofre, busca por obra, adição idempotente, capítulos pendentes sem falso estado de leitura, leitor com camadas, progresso, pausa, refresh individual/global e persistência após reiniciar. [Resultado](evidencias/producao-0.4.json).
- **12 verificações na janela Electron**: biblioteca sem cadastro, favoritos, busca, janela estreita, obra → capítulo → leitor em PT-BR, original, progresso e preferências do cofre. Imagens e obras dessas capturas são próprias/sintéticas, em biblioteca temporária. [Resultado](evidencias/interface-0.4.json), [biblioteca](evidencias/biblioteca-0.4.png), [obra](evidencias/obra-0.4.png), [leitor](evidencias/leitor-0.4.png).
- **10 verificações na janela com catálogo real**: pesquisa *Eminence in Shadow*, seleção da obra principal, capa/sinopse, adição pela interface e abertura dos detalhes. Biblioteca temporária; processamento externo desativado nesse ensaio de interface. [Resultado](evidencias/interface-catalogo-0.4.json).
- **10 verificações de rede reais no MangaDex**: obra principal e aliases, capa válida, adição, descoberta automática de **100 capítulos** naquele ensaio, pausa, atualização individual/global sem duplicatas e persistência. Sem chamadas aos modelos. Essa contagem é uma observação da fonte no momento do teste, não garantia de disponibilidade permanente. [Resultado](evidencias/catalogo-real-0.4.json).
- **Download/leitura reais**: retomada da fila baixou automaticamente um capítulo selecionado com **39 páginas**, leitor HTTP 200 e primeira imagem original HTTP 200. A versão já era **PT-BR**, portanto **zero chamadas aos modelos**, sem exercício real de OCR/tradução nesse capítulo. Os arquivos permaneceram somente na biblioteca temporária, sem inclusão de páginas publicadas no Git. [Resultado](evidencias/leitura-real-0.4.json).

- **Instalação pessoal 0.4 concluída** e janela real abriu diretamente na biblioteca vazia com **Adicionar obra**, sem dados de teste. Migração 5 aplicada; integridade SQLite, usuários, importações anteriores e configuração do KPassword conferidos contra o backup `artifacts/backups/library-antes-0.4-20261018-204040`. Nenhum consentimento alterado. [Conferência](evidencias/instalacao-0.4.json).
- RPM **koma-0.4.0-1.fc44.x86_64.rpm** gerado; `rpm -K`: `digests OK`. SHA-256: `a789a731662c0d736d37c9cdcd7089c02f8c9ba4749946cd00b256a5fa465bd6`. Não instalado no banco do sistema nem validado em Fedora limpo/Windows.

## Limites desta entrega

MangaDex é o primeiro conector real; Suwayomi permanece referência e integração futura. A busca usa aliases fornecidos pela fonte e não tem cobertura multilíngue geral medida. O número de capítulos e o acesso dependem da fonte. A preparação é progressiva, com checkpoints locais; não é instantânea. O aplicativo processa enquanto está aberto.

A adaptação/revisão real dos modelos permanece comprovada pela amostra própria da 0.3 abaixo; o fluxo completo de OCR → LLM → composição foi exercitado com dependências controladas. Não foi certificada a qualidade editorial de capítulos JA/KO/ZH. Não há JEV, inpainting, memória narrativa entre páginas, backup pela interface ou validação Windows. Os diálogos são camadas sobre o original imutável. Páginas sem detecção de diálogos recebem aviso no leitor. A fila impede o reaproveitamento de uma página sem resultado válido, mas uma interrupção durante chamada externa pode exigir nova tentativa com consumo de cota.

As evidências históricas abaixo descrevem as versões anteriores e seus limites à época.

---

# Validação do KOMA 0.3 — 18/10/2026

- **47 testes de domínio e transporte simulado**: falas em contexto, revisão contra originais, preservação de IDs, bloqueio de resposta truncada/incerta, consentimento por provedor, alteração de preferências durante a chamada, fila serial, transporte MCP sem entrega de chave e identificação conjunta de provedor/credencial. Esses testes simulam os modelos e o transporte; não medem qualidade editorial real.
- **3 testes de processos**, typecheck e build de produção passaram. Lint: zero erros e 16 avisos herdados. Sockets/processos dos testes precisaram de execução fora do sandbox.
- **39 verificações HTTP no pacote**: preservam os fluxos da 0.2 e acrescentam configuração sem segredo, autorizações próprias, rejeição de campo de API key, rejeição de origem externa, ausência de fallback silencioso e persistência das preferências. OCR sintético em CPU executado; original preservado byte a byte.
- Pacote final instalado por usuário em `~/.local/share/koma/app/current` e aberto pelo atalho. As 39 verificações passaram novamente nessa instalação (OCR sintético: 62 ms; sem comparação de desempenho). Backup anterior em `artifacts/backups/library-antes-0.3-20261018-163808`. Modelos do ensaio real preenchidos nas preferências pessoais sem sobrescrever configuração existente e mantendo consentimentos/tradução desativados. Sem imagens sintéticas na biblioteca pessoal.
- RPM final `koma-0.3.0-1.fc44.x86_64.rpm` gerado e `rpm -K`: `digests OK`. SHA-256: `320b63eeb190fce165adc614c40caa7d08d7313fd66aa53bbc210a5a57935944`. Não instalado no banco de pacotes do sistema nem certificado em Fedora limpo/Windows.
- **12 verificações na janela Electron**: as oito anteriores mais configuração de modelo sem API key, persistência após reabrir preferências, revogação pelo formulário conferida na API e tela de preferências em janela estreita. [Resultado](evidencias/interface-0.3.json), [preferências](evidencias/preferencias-cofre-0.3.png), [janela estreita](evidencias/preferencias-estreitas-0.3.png). Todos os dados foram sintéticos e temporários.
- **Conexão real KOMA → conector MCP instalado**: a primeira tentativa retornou HTTP **503** com a ponte inativa ([evidência](evidencias/cofre-conexao-0.3.json)). Após o usuário ativá-la, inicialização/ping retornaram **200**, sem consumo de cota ([evidência](evidencias/cofre-conexao-ativa-0.3.json)).
- **Tradução real de amostra própria**: três falas em inglês adaptadas com `deepseek-v4-pro` e revisadas com `mimo-v2.6-pro`, HTTP **200**, três resultados associados aos IDs esperados e ambas as etapas com modelo/duração/tokens informados. O ensaio que passou informou 585 + 636 tokens; não é o total de todas as tentativas. A tentativa anterior detectou JSON inválido e foi corrigida com modo JSON explícito, mantendo a validação estrita. [Resultado](evidencias/traducao-real-0.3.json). Sem chaves exportadas, dados pessoais, imagens ou mangás enviados.
- Novas importações podem usar KPassword. A adaptação envia lotes de falas e contexto vizinho, com glossário/vozes globais e revisão opcional separada. JEV, memória/glossário por obra, correção independente de OCR, ordenação de leitura entre páginas, limpeza/inpainting e histórico durável do novo motor permanecem pendentes.
- O requisito de descoberta por títulos originais, ingleses, brasileiros e aliases foi registrado em [DESCOBERTA.md](DESCOBERTA.md). A busca existente ainda filtra somente a biblioteca; descoberta externa multilíngue não foi entregue nesta fase.

Não há aprovação de qualidade de dublagem: amostras editoriais JA/KO/ZH e capítulos completos continuam necessários. Nenhuma chave foi copiada do KPassword para o KOMA. A instalação preserva os dados fora do pacote e começa com a integração desativada. O ensaio real usa sua própria biblioteca temporária, sem habilitar os consentimentos pessoais.

---

## Registro histórico da entrega 0.2

# Validação do KOMA 0.2 — 18/10/2026

- Abertura automática: sem nome, e-mail, senha ou telas de cadastro. Perfil interno idempotente; proprietário existente reaproveitado sem mover capítulos ou reescrever credenciais. Sessão HttpOnly inicializada por segredo efêmero exclusivo da janela; requisições sem sessão/segredo continuam bloqueadas.
- **25 testes de domínio**, **3 testes de processos**, typecheck e build passaram. Lint: zero erros e os mesmos 16 avisos herdados.
- **29 verificações de produção** passaram no pacote preparado e instalado: abertura direta, cadastro bloqueado, origem/Host, importação, original preservado, OCR CPU, consentimento, favoritos, progresso e segunda inicialização com o mesmo perfil.
- **8 verificações na janela real**: abertura, favorito, busca, limpar filtros, filtro de leitura, largura de 390 pixels sem rolagem horizontal, abertura do leitor e retorno à biblioteca. Evidência: [resultado](evidencias/interface-0.2.json).
- Inspeção visual em desktop e janela estreita: [coleção sintética](evidencias/colecao-0.2.png), [janela estreita](evidencias/janela-estreita-0.2.png), [primeira abertura real sem cadastro](evidencias/abertura-sem-cadastro-0.2.png). As quatro capas foram geradas por SVG próprio e importadas somente numa biblioteca temporária. Não são obras reais nem dados inseridos na coleção do usuário.
- Instalação atualizada por usuário, com backup fechado em `artifacts/backups/`. A biblioteca real tinha zero capítulos/imagens antes e continuou com zero; somente o perfil interno foi criado. Nenhuma amostra de teste foi transferida para ela.
- RPM 0.2 gerado; `rpm -K`: `digests OK`. SHA-256: `b71d81099d4635951ffaad001ea3ffe87b6415d0cd2d5693638a76889dbae098`. Instalação sistêmica em Fedora limpo ainda não certificada; a variante ativa é a instalação por usuário.
- DeepSeek/MiMo/JEV foram pesquisados e a direção de tradução foi registrada em [TRADUCAO.md](TRADUCAO.md). Ainda não há integração direta desses serviços nem chamadas pagas/imagens enviadas a eles. IA local passou a ser alternativa, conforme a preferência atual do usuário.

As preferências desktop não mostram cadastro/perfil, usuários, logout ou a configuração de extensão. A biblioteca usa dados reais para busca, ordenação, favoritos e última abertura. Modelo completo de obras/capítulos, sinopses, fontes oficiais e o novo motor contextual continuam pendentes; o leitor/editor herdado foi preservado nesta entrega.

---

## Registro histórico da entrega 0.1

# Validação da primeira entrega — 18/10/2026

## Resultado

- `npm test`: **21 testes passaram**, incluindo os 18 herdados e regressões de consentimento, revogação e falha de provedor sem cache do original.
- `npm run test:desktop`: **3 testes passaram**: prontidão/encerramento, morte do pai e falhas de inicialização sem supervisor órfão.
- `npm run typecheck`: passou. `npm run lint`: zero erros, 16 avisos herdados. Build Next de produção passou; permanece aviso de tracing amplo, mitigado no pacote por lista explícita de arquivos e validação dos links.
- Smoke HTTP de produção: **22 verificações passaram** no pacote preparado, no instalado em `~/.local/share/koma/app/current` e no conteúdo extraído do RPM em `/tmp/koma-rpm-validation/opt/koma`. Sem dependência dos `node_modules` do checkout.
- OCR da imagem sintética `HELLO WORLD`: **69 ms** internos na instalação por usuário. A amostra do baseline tinha duas linhas e uma borda; tempos não constituem comparação de desempenho entre versões.
- Preservação do original verificada byte a byte. Banco, biblioteca, progresso e revogação de consentimento sobreviveram à segunda inicialização.
- Janela Electron real abriu em PT-BR, carregou `/setup` e fechou o backend. [Captura da primeira execução](evidencias/primeira-execucao.png).
- Atalho validado com `desktop-file-validate` e aberto com `gio launch ~/.local/share/applications/koma.desktop`. O ensaio anterior com `gtk-launch` não produziu evidência de abertura; a validação registrada usa `gio launch`.
- Duas aberturas com o mesmo perfil criaram apenas um backend. Encerramento durante o carregamento foi exercitado e corrigido para não abrir diálogo de erro durante a saída.
- Instalação e remoção de atalho testadas com `XDG_DATA_HOME` temporário; arquivo-sentinela da biblioteca permaneceu intacto.
- RPM `koma-0.1.0-1.fc44.x86_64.rpm`: aproximadamente **253 MiB**, extraído e testado; `rpm -K` retornou `digests OK`. SHA-256: `e2b0cf1e5f4c60012efc891ed8015295a14ef7233a5754c8f9f272eac0373794`.

## Limites

A instalação diária ativa é a variante **por usuário**, sem sudo. O RPM não foi instalado na base de pacotes do sistema nem em uma VM Fedora limpa; não afirmar certificação de instalação RPM completa. O pacote não é assinado. Windows 11 ainda não testado.

Nenhum texto ou imagem da biblioteca foi enviado a Google/OpenRouter. A tradução foi testada com mocks para bloqueio, autorização e falha; a qualidade de tradução real permanece pendente. O teste sintético não valida qualidade editorial em JA/KO/ZH nem detecção em páginas reais. O pipeline atual continua em CPU, mesmo com GPU de 8 GiB confirmada no host.

Ainda não há inpainting, IA local de tradução, conectores oficiais, backup pela interface ou worker durável com retomada por etapa. O progresso herdado registra leitura, sem demonstrar retomada exata de rolagem. A revisão de React verificou cleanup de efeitos, mensagens acessíveis, estado de salvamento e autorização no servidor; não houve substituição visual ampla.

O pacote remove dependências do checkout: foi corrigida a cópia de symlinks que inicialmente apontava para `.next/standalone`, e a verificação de empacotamento agora rejeita qualquer link que escape da pasta do pacote. A cópia integral do ONNX/Sharp/SQLite inclui os binários usados em execução; GPU CUDA/TensorRT é excluída deste pacote CPU.
