# KPassword: limites que bloqueiam a preparação no KOMA

Investigação de 19/10/2026, baseada na biblioteca em produção e na implementação local do KPassword. Nenhum arquivo do KPassword foi alterado.

As três obras possuem capítulos bloqueados com `quota_exceeded` na adaptação DeepSeek. Também há falhas temporárias de conexão na revisão MiMo. O erro de cota não informa qual limite foi atingido.

O Secrets Bridge aplica 60 chamadas/minuto por credencial e 524.288 tokens de saída reservados/hora por credencial. A reserva considera o `max_tokens` solicitado (8.192 por padrão), inclusive em erros, e não o consumo real. Assim, 64 chamadas com reserva de 8.192 atingem o teto horário, mesmo com respostas pequenas. A chamada seguinte é recusada até a janela liberar saldo. Renovar a autorização não elimina o limite central.

O KOMA usa o adaptador MCP pelo socket local; o teto adicional de 131.072 tokens/hora por token HTTP pertence a outro transporte e não foi identificado como causa deste incidente.

## Ajuste solicitado ao KPassword

- Permitir limites configuráveis para aplicações autorizadas e processamento contínuo, mantendo limites seguros por padrão.
- Distinguir os limites de chamadas/minuto, reserva/hora e concorrência em erros estruturados; informar saldo, escopo e `retry_after` ou horário de liberação.
- Revisar a contabilização: reconciliar a reserva com o uso confirmado quando disponível e explicitar a política de cobrança de reservas em falhas.
- Preservar autorização por aplicação/modelo/credencial, revogação, isolamento de processos e ausência de exposição de API keys.

Evidências no projeto KPassword: `src-tauri/src/secrets_bridge/broker.rs` (função `consume` e bloco `Usage` em `execute`), `src-tauri/src/secrets_bridge/universal.rs` (`Token::reserve`, transporte HTTP) e `docs/integrations/UNIVERSAL-BRIDGE.md` (limites automáticos).

O KOMA está sendo corrigido separadamente para baixar originais sem depender da tradução, reduzir reservas de saída, salvar etapas já concluídas e aguardar a liberação sem repetir chamadas por capítulo. Isso reduz o impacto, mas não altera o limite do cofre nem permite determinar qual janela causou o erro atual.
