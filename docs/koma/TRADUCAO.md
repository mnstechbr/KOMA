# Direção da tradução — adaptação brasileira

Preferência confirmada pelo usuário em 18/10/2026: aproveitar suas cotas diretas de **DeepSeek e Xiaomi MiMo** para gerar e revisar diálogos; IA local é alternativa, sem limitar a qualidade principal à GPU disponível. O objetivo é naturalidade próxima de um roteiro de dublagem brasileira, preservando conteúdo, intenção, personalidade, ironia e registro de cada personagem. Humor e gírias devem ser compatíveis com a cena; não acrescentar piadas, memes ou informações ausentes do original.

## Divisão planejada

- Coleta: conectores de fontes, HTTP, cache e validação de metadados. LLM só quando interpretação adicional for necessária.
- Detecção/OCR: YOLO/PaddleOCR local, com incerteza explícita.
- Adaptação: DeepSeek ou MiMo escolhido nas preferências, com cenas ordenadas, falas vizinhas, glossário e memória resumida da obra. Revisão editorial separada da geração inicial.
- Limpeza: máscaras, inpainting e tipografia; originais imutáveis. LLM não substitui o motor de imagens.
- Revisão/decisão: **JEV oficial da TypeSafe** como avaliador de perguntas estreitas (escolha entre alternativas, notas por rubrica, necessidade de revisão e localização em imagem, conforme capacidades do modelo). Ele não gera os diálogos nem edita pixels.

A qualidade exige comparar amostras JA/KO/ZH → PT-BR, incluindo humor, ironia, tensão e linguagem coloquial. Concordância entre modelos não prova fidelidade. Baixa confiança, contexto ausente ou OCR duvidoso devem encaminhar para revisão. A revisão não deve preencher falas ilegíveis por invenção.

## Integração na versão 0.3

Usar as contas diretas dos provedores para consumir suas cotas, com credenciais mantidas no **KPassword**, projeto do usuário: [mnstechbr/KPassword](https://github.com/mnstechbr/KPassword). A integração implementada usa o adaptador MCP oficial do Secrets Bridge local. O KOMA configura provedor, modelo e referência opcional da credencial, sem copiar a chave para seu SQLite, arquivo `.env`, navegador ou logs. O adaptador Python mantém o token temporário de transporte; o KOMA recebe as respostas das ferramentas. O KPassword realiza a chamada e entrega a resposta. O armazenamento criptografado herdado de OpenRouter não é uma integração com esse cofre.

Em **Preferências → Tradução e credenciais**: escolha modelos para adaptação e revisão, informe glossário/vozes, autorize explicitamente os provedores e salve. Se houver uma única credencial da família na ponte, seu ID pode ficar vazio; duplicatas exigem UUID. O modelo deve existir na conta; não há descoberta automática de modelos pelo Bridge. O botão de verificação envia somente inicialização/ping local; o teste de tradução envia o texto exibido e consome cota. As novas importações selecionam KPassword quando ativado; capítulos anteriores mantêm o provedor gravado.

O motor aceita até 300 falas e divide lotes de até 20 falas/12 mil caracteres, com três falas vizinhas de cada lado quando disponíveis. São textos da requisição/página, sem memória persistente entre capítulos. IDs preservam a ligação com os balões. A revisão opcional recebe originais e proposta; resposta truncada, balões ausentes/duplicados ou `needsReview` interrompem a aplicação. Isso é sinalização solicitada ao modelo, não garantia independente de detecção de erros de OCR. Não há cache contextual nesta versão. Glossário e vozes são globais; a organização por obra permanece pendente.

Modelo solicitado, modelo retornado quando informado, duração e tokens são devolvidos pela API e exibidos no teste da tela. Não há ainda histórico durável de custo/etapas, medição de qualidade, JEV, memória entre páginas ou edição de pixels no novo motor.

A autorização atual de Google/OpenRouter não será interpretada como autorização automática para novos serviços ou envio de imagens ao JEV. Não alternar provedores silenciosamente. Exibir modelo utilizado, falha, duração e consumo quando o provedor informar; não inventar saldo de cota.

### Contrato do KPassword consultado em 18/10/2026

Foi consultado o código local em `~/Projetos/KPassword` (versão declarada 1.7.0, HEAD `52a4dff`), especialmente `tools/kpassword_mcp.py`, `src-tauri/src/secrets_bridge/` e `docs/integrations/UNIVERSAL-BRIDGE.md`. Nenhuma chave foi exportada para o KOMA ou para as ferramentas deste trabalho. A primeira verificação encontrou a ponte inativa (HTTP 503). Após ativação pelo usuário, inicialização/ping passaram (HTTP 200) e o fluxo completo foi verificado com uma amostra sintética própria.

- No Linux, o Bridge oferece socket Unix privado e MCP/gateway em loopback. Tokens de transporte são temporários e vinculados ao processo; devem ficar apenas no backend que faz as chamadas.
- DeepSeek e MiMo já possuem perfis no Bridge (`DEEPSEEK_API_KEY` e `MIMO_API_KEY`/`XIAOMI_API_KEY`). Duplicatas exigem referência explícita da credencial.
- JEV ainda precisa de validação de protocolo, autenticação, endpoint e limites de imagens. A configuração JSON genérica do cofre é uma possibilidade, sem compatibilidade comprovada nesta entrega.
- A autorização acontece na interface do KPassword. Recusa, expiração, revogação ou ponte indisponível devem interromper o processamento com mensagem em PT-BR, sem pedir a chave nem trocar silenciosamente de serviço.
- A ponte ativa pode manter chaves na memória do backend do KPassword mesmo com sua interface bloqueada; revogar a ponte encerra as permissões. Ela não isola uma aplicação comprometida de toda ameaça da mesma conta ou de root.
- Os limites atuais do Bridge (1 MiB por pedido e 4 MiB por resposta JSON) precisam ser considerados antes de enviar cenas ou imagens.

### Ensaio real com o cofre ativo

Foram enviadas três falas sintéticas próprias em inglês, com indicação de sarcasmo, seriedade e coloquialidade. A primeira tentativa foi rejeitada por JSON inválido, sem aplicar a tradução. A requisição passou a exigir `response_format: {type: 'json_object'}`, além das instruções e da validação de IDs. A segunda tentativa concluiu **adaptação com DeepSeek V4 Pro** (`deepseek-v4-pro`, 585 tokens informados, cerca de 7 s) e **revisão com MiMo V2.6 Pro** (`mimo-v2.6-pro`, 636 tokens informados, cerca de 6,6 s). Esses números pertencem ao ensaio que passou; não representam o consumo total incluindo a tentativa anterior.

Exemplo: “Relax, big guy. I've got this.” → “Relaxa, grandão. Deixa comigo.” [Evidência completa](evidencias/traducao-real-0.3.json). Isso valida o encadeamento de transporte, contas diretas, estrutura, revisão e metadados; **não certifica qualidade de dublagem, precisão de OCR nem fidelidade editorial em capítulos JA/KO/ZH**. Nenhum mangá pessoal ou imagem foi enviado. JEV ainda não foi chamado. As configurações e os consentimentos pessoais não são habilitados pelo script de teste, que usa uma biblioteca temporária.

O teste real é opt-in: `node scripts/smoke-translation-real.mjs --real --adaptation-model deepseek-v4-pro --review-model mimo-v2.6-pro`. Consome cota e continua sujeito às autorizações do KPassword. As referências oficiais de JSON são [DeepSeek](https://api-docs.deepseek.com/api/create-chat-completion/) e [MiMo](https://mimo.mi.com/docs/en-US/quick-start/usage-guide/text-generation/structured-output).

Fontes consultadas: [DeepSeek API](https://api-docs.deepseek.com/api/list-models/), [Xiaomi MiMo](https://platform.xiaomimimo.com/docs/en-US/usage-guide/passing-back-reasoning_content), [TypeSafe](https://docs.typesafe.ai/introduction), [imagens](https://docs.typesafe.ai/images), [coleção jev-skill](https://github.com/wuyoscar/jev-skill). A coleção foi consultada como referência, sem instalação de skills ou execução de chamadas JEV.


## Preparação automática por obra na 0.4

Adicionar uma obra cria uma fila persistente em SQLite: descoberta, capítulos, download dos originais, OCR, adaptação/revisão e leitura. O worker retoma páginas concluídas sem repetir tradução salva. O aplicativo precisa estar aberto para processar; ao reabrir, a fila continua. Atualizar consulta novos capítulos sem apagar os existentes. Pausar preserva o resultado válido de uma chamada em andamento e interrompe a próxima etapa. Recusa de permissão no cofre pausa a obra; não há fallback de provedor.

Capítulos cuja versão selecionada já é PT-BR dispensam OCR/tradução e consumo de modelos. Outros usam o mesmo motor contextual DeepSeek/MiMo da 0.3. Falas ilegíveis ou respostas inválidas interrompem a aplicação da página e sinalizam a necessidade de conferência. Páginas sem balões detectados preservam o original e recebem aviso no leitor; isso não prova ausência de texto.

O leitor usa camadas SVG sobre o original, cor estimada do fundo e tipografia ajustada ao balão. **Não há inpainting**: fundos complexos e textos fora de balões podem exigir edição adicional. O contexto é limitado à página/lotes; não há memória narrativa entre capítulos. A validação real de download/leitura de 39 páginas já em PT-BR não exercitou OCR ou LLM. O pipeline de retomada/edição foi testado com imagens e respostas controladas; avaliação editorial com capítulos reais JA/KO/ZH ainda está pendente.


## Recuperação de OCR e continuidade na 0.4.1

O OCR recebe o idioma da versão coletada (não o idioma original da obra quando a página já é uma tradução). Para idiomas latinos, usa o reconhecedor latino disponível. Balões incertos recebem uma tentativa adicional de leitura local com recorte ampliado/contraste. O texto não reconhecido não é enviado à LLM para adivinhação. Diálogos reconhecidos são traduzidos, enquanto balões ainda incertos permanecem visíveis no original, com aviso. A falha editorial de uma página não cancela as seguintes. O capítulo parcial pode ser aberto como **Leitura com pendências** e não entra na contagem de capítulos inteiramente prontos.

A fila alterna entre obras por página concluída; chamadas em andamento continuam sujeitas ao tempo dos provedores e à autorização do cofre. Atualizar/retomar reabre pendências sem refazer páginas prontas. Tentativas de versões alternativas são limitadas e preservam arquivos de tentativas anteriores.
