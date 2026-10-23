import type { Catalog } from '../core'

export const performanceMessages: Catalog = {
  en: {
    Desempenho: 'Performance',
    'Quanto do computador o KOMA usa para preparar capítulos': 'How much of the computer KOMA uses to prepare chapters',
    'Não foi possível consultar o desempenho.': 'Could not load the performance settings.',
    'Salvo. A preparação passa a usar este perfil em alguns segundos.': 'Saved. Preparation switches to this profile in a few seconds.',
    Leve: 'Light',
    Equilibrado: 'Balanced',
    Máximo: 'Maximum',
    'Automático (recomendado)': 'Automatic (recommended)',
    'O KOMA escolhe pelo computador. Agora: {profile}.': 'KOMA picks based on your computer. Now: {profile}.',
    'Para computadores com até 4 núcleos ou até 8 GB de memória. Prepara devagar e deixa o computador livre.':
      'For computers with up to 4 cores or up to 8 GB of memory. Prepares slowly and keeps the computer free.',
    'Usa só o processador, com várias páginas ao mesmo tempo.': 'Uses only the processor, with several pages at a time.',
    'Placa de vídeo não disponível neste computador.': 'No graphics card available on this computer.',
    'Lê e desenha as páginas na placa de vídeo, várias vezes mais rápido que o Equilibrado.':
      'Reads and draws pages on the graphics card, several times faster than Balanced.',
    'A placa de vídeo deste computador é mais lenta que o processador.': "This computer's graphics card is slower than the processor.",
    'placa de vídeo {n}× mais rápida que o processador': 'graphics card {n}× faster than the processor',
    'a placa de vídeo é mais lenta que o processador e fica sem uso': 'the graphics card is slower than the processor and is not used',
    dedicada: 'dedicated',
    integrada: 'integrated',
    '{cores} núcleos · {memory} GB de memória': '{cores} cores · {memory} GB of memory',
    'verificando a placa de vídeo…': 'checking the graphics card…',
    'placa de vídeo disponível': 'graphics card available',
    'sem placa de vídeo compatível': 'no compatible graphics card',
    'Em qualquer perfil, o KOMA trabalha com prioridade baixa: o que você estiver usando vem primeiro.':
      'In every profile, KOMA runs at low priority: whatever you are using comes first.',
  },
  es: {
    Desempenho: 'Rendimiento',
    'Quanto do computador o KOMA usa para preparar capítulos': 'Cuánto del equipo usa KOMA para preparar capítulos',
    'Não foi possível consultar o desempenho.': 'No se pudo consultar el rendimiento.',
    'Salvo. A preparação passa a usar este perfil em alguns segundos.': 'Guardado. La preparación usará este perfil en unos segundos.',
    Leve: 'Ligero',
    Equilibrado: 'Equilibrado',
    Máximo: 'Máximo',
    'Automático (recomendado)': 'Automático (recomendado)',
    'O KOMA escolhe pelo computador. Agora: {profile}.': 'KOMA elige según tu equipo. Ahora: {profile}.',
    'Para computadores com até 4 núcleos ou até 8 GB de memória. Prepara devagar e deixa o computador livre.':
      'Para equipos con hasta 4 núcleos o hasta 8 GB de memoria. Prepara despacio y deja el equipo libre.',
    'Usa só o processador, com várias páginas ao mesmo tempo.': 'Usa solo el procesador, con varias páginas a la vez.',
    'Placa de vídeo não disponível neste computador.': 'No hay tarjeta gráfica disponible en este equipo.',
    'Lê e desenha as páginas na placa de vídeo, várias vezes mais rápido que o Equilibrado.':
      'Lee y dibuja las páginas en la tarjeta gráfica, varias veces más rápido que Equilibrado.',
    'A placa de vídeo deste computador é mais lenta que o processador.':
      'La tarjeta gráfica de este equipo es más lenta que el procesador.',
    'placa de vídeo {n}× mais rápida que o processador': 'tarjeta gráfica {n}× más rápida que el procesador',
    'a placa de vídeo é mais lenta que o processador e fica sem uso': 'la tarjeta gráfica es más lenta que el procesador y no se usa',
    dedicada: 'dedicada',
    integrada: 'integrada',
    '{cores} núcleos · {memory} GB de memória': '{cores} núcleos · {memory} GB de memoria',
    'verificando a placa de vídeo…': 'comprobando la tarjeta gráfica…',
    'placa de vídeo disponível': 'tarjeta gráfica disponible',
    'sem placa de vídeo compatível': 'sin tarjeta gráfica compatible',
    'Em qualquer perfil, o KOMA trabalha com prioridade baixa: o que você estiver usando vem primeiro.':
      'En cualquier perfil, KOMA trabaja con prioridad baja: lo que estés usando va primero.',
  },
}
