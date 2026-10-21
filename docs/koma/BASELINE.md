# Baseline do KOMA — 18/10/2026

Base: [translate-manga-br](https://github.com/marco0antonio0/translate-manga-br), commit `9c7e2706d894a53df1a8bb0ccd6270a8196aaad5`, tag local `baseline-original-2026-10-18`. Remoto original preservado como `upstream`. Licença MIT e autoria preservadas em `LICENSE`.

## Evidência anterior às alterações

- Fedora 44 KDE, x86_64; Intel i7-11800H, 16 CPUs lógicas, aproximadamente 15 GiB de RAM. Memória disponível na coleta: 5,6 GiB.
- GPU PCI: NVIDIA RTX 3070 Mobile / Max-Q. A coleta inicial no sandbox não alcançou o driver. Verificação posterior no host confirmou RTX 3070 Laptop, **8.192 MiB de VRAM**, driver **615.78.08**. O pipeline atual fixa CPU; GPU para inferência ainda não validada.
- Node 24.18.0, npm 11.16.0. `npm ci`: 723 pacotes instalados a partir do lockfile.
- `npm test`: 6 arquivos, **18 testes passaram**. A suíte cobre migrations limpas, segredos, origens, upload, tipos de provedor e estado de overlay; não mede qualidade OCR/tradução, retomada precisa ou instalação desktop.
- `npm run typecheck`: passou. O comentário antigo em `AGENT.md` sobre ignorar erros TS não corresponde ao `next.config.mjs` atual.
- `npm run lint`: nenhum erro; 16 avisos herdados de `no-img-element`.
- Build de produção: passou. O primeiro build no sandbox falhou por bloqueio de porta interna do Turbopack; repetido com essa permissão, passou. Há aviso de tracing abrangente; não confundir com falha do produto.
- Servidor original iniciado em produção em `127.0.0.1:3081`. Setup, login, importação de PNG e listagem da biblioteca passaram por HTTP.
- Todos os modelos LFS baixados do mesmo commit e verificados pelo tamanho e SHA-256 registrados nos ponteiros. Sem Git LFS, um clone comum traz apenas ponteiros e o OCR não funciona.
- Imagem sintética própria: OCR retornou `HELLO WORLD` e `KOMATEST`, com ruído de borda `——`; tempo interno de 364 ms, aproximadamente 620 ms via HTTP na primeira chamada. Detecção YOLO: **zero balões**, 140 ms. Isso confirma inferência, não qualidade em mangás reais.
- Nenhuma imagem ou diálogo foi enviado a serviços externos. Qualidade de tradução e benchmarks JA/KO/ZH permanecem **não validados**.

## Diagnóstico técnico

| Área | Evidência e consequência |
|---|---|
| Arquitetura | Next.js 16.2.7 / React 19; APIs e inferência no mesmo processo. Preservar antes de separar serviços. |
| Dados | better-sqlite3, WAL e quatro migrations transacionais. Banco, imagens e chave eram relativos ao checkout. Necessário separar dados do pacote. |
| Renderização | Overlay e editor existentes; não há inpainting no pipeline de capítulos. Originais e itens OCR armazenados separadamente. |
| Leitor | Modos paginado/rolagem, lazy loading e overlays existem. Componente com mais de 7.000 linhas; zoom por escala e progresso por páginas não demonstram retomada exata em pixels. |
| Fila | Processamento de capítulos em promises no processo web, concorrência padrão 10; OCR de recorte executa antes de registrar o job como concluído. Persistência de estado não equivale a worker durável com retomada. |
| Tradução | Google e OpenRouter, por texto, sem memória de obra/glossário. Falhas retornam original e podem entrar no cache como tradução; precisa correção futura. |
| Offline | Biblioteca/OCR locais; tradução depende de APIs. Nenhum motor Ollama/llama.cpp implementado. |
| Privacidade | Analytics no layout, tradução externa por padrão, CORS amplo e rotas de compartilhamento herdadas. O perfil desktop precisa restringir essas superfícies. |
| Upload | Arquivos de capítulos aceitos com pouca validação de conteúdo e extensão; ampliar limites e validação antes de CBZ/ZIP. Não há importador CBZ validado. |
| Segurança | AES-GCM para segredos e verificações de origem em algumas rotas; proxy não impõe origem de escrita globalmente. Esta inspeção não é auditoria exaustiva de segurança. |
| Distribuição | `output: standalone` existe; bibliotecas carregadas por `dlopen` exigem cópia explícita (também reconhecido pelo Dockerfile original). Não basta copiar `server.js`. |

## Referências e decisões

[Suwayomi-Server](https://github.com/Suwayomi/Suwayomi-Server) é referência de biblioteca, categorias, atualizações, downloads autorizados e backups. Backend Kotlin/JVM e APIs para clientes; seus bundles incluem JRE e Electron. Integrá-lo agora adicionaria outro runtime e sincronização entre duas bibliotecas sem resolver OCR/tradução. Manter como referência de contratos e avaliar adaptador opcional posteriormente, em loopback, com capacidades por fonte e consentimento. Não incorporar mecanismos de contorno de acesso. Licença MPL-2.0; código copiado exigiria análise e atribuição por arquivo, sem apresentá-lo como MIT.

[comic-translate](https://github.com/ogkalu2/comic-translate), atualmente Apache-2.0, é referência para máscaras, inpainting e revisão. Nenhum código foi copiado. Licenças dos pesos devem ser verificadas separadamente antes de distribuir publicamente modelos.

Electron é a primeira opção de janela: carrega o Next standalone preservando APIs e módulos nativos. Um Node separado incorporado usa a mesma ABI de build para SQLite/ONNX/Sharp, sem recompilação para a ABI do Electron. Custo: runtime maior. Tauri exigiria igualmente um sidecar Node e dependências WebKitGTK no Fedora; não remove esse backend. Fontes: [Electron segurança](https://www.electronjs.org/docs/latest/tutorial/security), [Tauri sidecars](https://v2.tauri.app/develop/sidecar/), [Next standalone](https://nextjs.org/docs/app/api-reference/config/next-config-js/output).

A evolução visual seguirá preto/grafite/carmim, tipografia editorial e movimento reduzido, após a entrega local. [Motion](https://motion.dev/), [One Page Love](https://onepagelove.com/) consultados; Awwwards indisponível na consulta. Sem mudança visual ampla nesta etapa.

## Sequência verificável

1. Produção local, dados externos ao pacote, consentimento, janela e ciclo de vida desktop.
2. Biblioteca e leitor: modelo obra/capítulo, rolagem padrão, zoom por ponto, retomada exata e backups restauráveis.
3. Tradução: provedor local, amostras sintéticas JA/KO/ZH, glossário/contexto e erros explícitos; medir qualidade e recursos.
4. Máscaras/inpainting e revisão por etapas recuperáveis.
5. Fontes oficiais por capacidades comprovadas, notificações e estatísticas baseadas em eventos.

A primeira entrega não significa conclusão de todas as nove etapas do prompt. Testes de pacote, consentimento e ciclo de vida devem ser registrados após implementação. Não publicar biblioteca, modelos ou código automaticamente.
