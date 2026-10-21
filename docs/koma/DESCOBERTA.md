# Descoberta de obras e títulos alternativos

Requisito confirmado pelo usuário em 18/10/2026: pesquisar uma obra pelo nome conhecido no Brasil deve encontrar a mesma obra mesmo quando o catálogo usa inglês, japonês, coreano, chinês ou romanização. Na versão 0.4, a busca externa consulta o MangaDex e a biblioteca local pesquisa títulos e aliases das obras adicionadas. A agregação de múltiplos catálogos descrita adiante permanece planejada.

## Entrega 0.4

O fluxo principal é **Adicionar obra → pesquisar → conferir capa/sinopse → Adicionar à biblioteca**. Um ID MangaDex estável identifica a obra; títulos semelhantes não são fundidos. A consulta retorna títulos originais e alternativos fornecidos pela fonte, sem inventar aliases com LLM. A ordenação valoriza correspondência exata e normaliza acentos, caixa e pontuação. A sinopse pode estar no idioma fornecido pelo catálogo, identificado na prévia; a interface permanece em PT-BR.

A fila consulta todas as páginas do feed disponível, consolida versões repetidas por capítulo/volume e prioriza PT-BR, inglês e outros idiomas. Sufixos como `1.10` e `1.1` e numeração reiniciada por volume são preservados. Publicações externas sem páginas disponíveis não são anunciadas como downloads. Limites de paginação ou falhas de fonte são apresentados, sem declarar uma coleta parcial como completa.

Adicionar repetidamente a mesma obra não duplica a biblioteca. Atualizações individual/global acrescentam capítulos novos, preservando os já preparados e lidos. A listagem e a disponibilidade para leitura são estados distintos: capítulos aparecem na descoberta e ficam legíveis ao concluir sua preparação. Não há etapa manual obrigatória por capítulo.

A consulta real de **Eminence in Shadow** encontrou a obra principal antes dos derivados, capa, sinopse e aliases; naquele ensaio foram descobertos 100 capítulos consolidados. Isso demonstra esse caso, sem medir cobertura geral de nomes brasileiros, mangás, manhwas e manhuas. A fonte pode não conhecer determinado apelido, não conter a obra ou não disponibilizar seus capítulos. A integração Suwayomi ainda não está implementada.

## Identidade da obra

Cada obra terá um ID interno estável, separado de seus títulos. Guardar títulos originais, oficiais traduzidos, romanizações, abreviações e aliases da comunidade com idioma e fonte. IDs dos catálogos e das fontes entram como referências; não usar o título como chave única. Preservar grafia original para exibição, mesmo que o índice normalize maiúsculas, espaços, pontuação e acentos.

Obras, adaptações, remakes, sequências, spin-offs e edições precisam de relações explícitas. Um nome parecido não basta para fundir resultados. Títulos alternativos informados manualmente pelo usuário também devem ser pesquisáveis, sem afirmar que são oficiais.

## Busca planejada

1. Consultar o índice local de todos os títulos e aliases, incluindo correspondências exatas e normalizadas.
2. Consultar catálogos de metadados e fontes habilitadas. Consultas remotas devem respeitar autorização, limites e disponibilidade de cada conector.
3. Quando houver correspondência confiável de identidade, pesquisar as fontes pelos títulos associados. Uma fonte sem resultados para o nome PT-BR pode encontrar a obra pelo título inglês ou romanizado.
4. Ordenar resultados por evidência: IDs compartilhados, aliases exatos, autoria, ano, país/idioma de origem, tipo e relação editorial. Capa pode ajudar a comparação; não é prova isolada, pois varia por edição.
5. Mostrar o nome que correspondeu à consulta, os nomes alternativos, origem dos metadados e a fonte onde há capítulos disponíveis. Interface e explicações em PT-BR; nomes próprios preservam sua grafia.
6. Quando a correspondência for incerta ou houver várias obras homônimas, apresentar opções ao usuário. Nunca mesclar bibliotecas, baixar outra obra ou anunciar correspondência confirmada apenas por aproximação textual ou decisão de LLM.

LLM pode auxiliar a expansão de candidatos e a interpretação, mas uma tradução inventada de título não se torna um alias confirmado. Metadados encontrados, disponibilidade dos capítulos e idioma dos capítulos são informações distintas. Encontrar a obra não significa que ela tenha publicação em PT-BR.

## Evidências exigidas antes de considerar a busca pronta

Montar amostras reais verificadas de mangá, manhwa e manhua com títulos muito diferentes entre idiomas; incluir nomes brasileiros não literais, romanizações variantes, homônimos, obras curtas com nomes genéricos, adaptações e continuações. Medir se a obra correta aparece entre os primeiros resultados e quantas correspondências erradas são sugeridas. Exercitar indisponibilidade de catálogo, limite de requisições, ausência de aliases e correção manual. Não atribuir porcentagens de precisão sem esse conjunto e os resultados medidos.

Suwayomi permanece uma referência para conectores e organização de biblioteca. A identidade consolidada da obra e seus aliases precisam existir no KOMA mesmo quando diferentes fontes usam nomes distintos.


## Correção 0.4.1

A sincronização atualiza os metadados e identifica os vínculos de publicação original e edição licenciada. Esses vínculos têm status de consulta e de disponibilidade de conector exibidos nos detalhes. Para as três obras testadas, apontam para KadoComi, Naver e KakaoPage. **Não são conectores de download desses serviços**. As páginas ainda vêm do MangaDex. As versões alternativas do mesmo capítulo são guardadas para recuperação limitada, sem trocar de obra por título parecido. Tentativas anteriores são arquivadas com seus originais e checkpoints.
