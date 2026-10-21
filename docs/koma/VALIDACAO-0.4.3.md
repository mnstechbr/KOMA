# Recuperação da preparação — KOMA 0.4.3

Verificação em 19/10/2026, às 07:43 (America/Sao_Paulo). A versão corrigida está instalada e executando a biblioteca original. O KPassword não foi alterado.

## Problema e correção

A tradução retornava `quota_exceeded`, enquanto o pipeline só baixava a próxima página depois de OCR, adaptação e revisão da anterior. Falhas de revisão também descartavam adaptações válidas ainda não aplicadas. Mais tarde, o cofre passou a informar `permission_revoked`; a versão anterior pausava a obra inteira automaticamente.

Downloads agora seguem em até três obras, independentemente da preparação de texto. A tradução fica serializada, salva respostas válidas em checkpoints locais e aplica espera persistente compartilhada. Cota esgotada aguarda uma hora, pois o protocolo não informa a janela atingida. Recusa/revogação exige retomada explícita e suspende apenas a tradução; a pausa manual da obra continua disponível separadamente. Alternativas compatíveis podem substituir versões coreanas antes da coleta, pois o OCR instalado não reconhece Hangul com segurança.

A busca consulta MangaDex e um site não oficial independentemente. Ambos permitem adicionar obras; vínculos conhecidos reutilizam obras existentes. Os recursos das demais fontes continuam discriminados na tela Fontes; não foi implementada cobertura de centenas de sites.

## Verificação do fluxo completo

| Etapa | Resultado | Evidência |
|---|---|---|
| Interface | Passou | Janela Electron do pacote instalado abriu as três obras e a tela Fontes; capturas em `artifacts/recuperacao-0.4.3/ui-state/logs/`. |
| Interface → API | Passou | Biblioteca, detalhes, contadores de download e bloqueio de tradução carregados na janela real. |
| API → catálogos | Passou | Busca HTTP retornou resultados dos dois serviços; metadados, capítulos e capa do site não oficial verificados. |
| Fila → arquivos | Passou | Amostra em cópia consistente completou capítulos de 19, 13 e 193 páginas das três obras, sem chamadas a modelos. |
| Banco → resposta → tela | Passou | Contadores de originais baixados separados de páginas preparadas; motivo da suspensão e ação de retomada de tradução exibidos. |
| Preservação | Passou | Os 106 capítulos prontos mantiveram identidade, fonte, seção e progresso; 3.459 arquivos desses capítulos existem e seus checkpoints permanecem prontos. |

90 testes automatizados passaram; quatro testes de rede permanecem opt-in. O teste real da busca passou separadamente. Quatro testes desktop e 55 verificações HTTP/OCR passaram. Typecheck e build passaram. Lint sem erros, com 16 avisos herdados de imagens. `git diff --check` sem problemas.

## Biblioteca em produção após ativação

| Obra | Páginas baixadas antes | Páginas baixadas na captura | Aumento | Capítulos prontos preservados |
|---|---:|---:|---:|---:|
| The Eminence in Shadow | 2.393 | 2.487 | 94 | 71 |
| Crônicas da Facção Demoníaca | 1.106 | 1.201 | 95 | 30 |
| The Divine Demon’s Grand Ascension | 433 | 1.018 | 585 | 5 |

As três obras estavam sem pausa e baixando páginas na captura. Esses números são observações, não a conclusão integral das obras: os downloads continuam com o aplicativo aberto. Capítulos indisponíveis na fonte e pendências editoriais não são declarados prontos.

A tradução continua bloqueada por autorização revogada no KPassword, sem novas solicitações automáticas. Após autorizar o cofre, usar **Retomar tradução** na obra. Download concluído não significa tradução concluída. Não foi afirmada qualidade editorial de capítulos completos.

Backups consistentes anteriores à atualização e evidências estruturadas estão em `artifacts/recuperacao-0.4.3/`. Release final: `~/.local/share/koma/app/releases/koma-1792406563439`. O relatório para ajuste do cofre está em [RELATORIO-KPASSWORD.md](RELATORIO-KPASSWORD.md).
