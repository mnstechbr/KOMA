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
    'A placa de vídeo deste computador dá resultados diferentes do processador e perderia falas.':
      "This computer's graphics card gives results different from the processor and would miss speech bubbles.",
    'a placa de vídeo dá resultados errados e fica sem uso': 'the graphics card gives wrong results and is not used',
    dedicada: 'dedicated',
    integrada: 'integrated',
    '{cores} núcleos · {memory} GB de memória': '{cores} cores · {memory} GB of memory',
    'verificando a placa de vídeo…': 'checking the graphics card…',
    'placa de vídeo disponível': 'graphics card available',
    'sem placa de vídeo compatível': 'no compatible graphics card',
    'Em qualquer perfil, o KOMA trabalha com prioridade baixa: o que você estiver usando vem primeiro.':
      'In every profile, KOMA runs at low priority: whatever you are using comes first.',
    'Aceleração CUDA (opcional)': 'CUDA acceleration (optional)',
    'Complemento para placas NVIDIA: no perfil Máximo, o apagamento do texto (máscara e LaMa) passa a usar CUDA; a leitura continua na placa via WebGPU.':
      'Add-on for NVIDIA cards: in the Maximum profile, text erasing (mask and LaMa) uses CUDA; reading stays on the card through WebGPU.',
    'Agora não': 'Not now',
    'Antes de baixar, saiba exatamente o que muda:': 'Before downloading, here is exactly what changes:',
    'Baixando: {done} de {total} GB': 'Downloading: {done} of {total} GB',
    'Baixando o CUDA': 'Downloading CUDA',
    'Baixar aceleração CUDA (opcional)': 'Download CUDA acceleration (optional)',
    'Baixar {size} GB': 'Download {size} GB',
    'Cancelar (dá para retomar depois)': 'Cancel (you can resume later)',
    'Conferindo os arquivos…': 'Checking the files…',
    'Dá para desligar ou remover a qualquer momento.': 'You can turn it off or remove it at any time.',
    'Desligado: o desenho usa a placa via WebGPU.': 'Off: drawing uses the card through WebGPU.',
    'Download de {size} GB dos servidores oficiais da NVIDIA (PyPI) e da Microsoft (NuGet), conferidos por SHA-256.':
      'Downloads {size} GB from the official NVIDIA (PyPI) and Microsoft (NuGet) servers, checked by SHA-256.',
    'Em uso agora.': 'In use now.',
    'Entra em uso quando o perfil for Máximo.': 'Used when the profile is Maximum.',
    'Extraindo e conferindo os arquivos…': 'Extracting and checking the files…',
    'Ganho medido numa RTX 3070, no perfil Máximo: 14 a 22% menos tempo em mangá e tiras longas; manhwa igual. Em outras placas o ganho pode ser maior, menor ou nenhum.':
      'Gain measured on an RTX 3070 in the Maximum profile: 14 to 22% less time on manga and long strips; manhwa the same. On other cards the gain may be larger, smaller or none.',
    Instalar: 'Install',
    'Licenças:': 'Licenses:',
    'Li e aceito as licenças da NVIDIA para baixar e usar essas bibliotecas.':
      'I have read and accept the NVIDIA licenses to download and use these libraries.',
    'Não há espaço livre suficiente em disco.': 'There is not enough free disk space.',
    'O CUDA falhou e o desenho voltou para a placa via WebGPU: {error}':
      'CUDA failed and drawing went back to the card through WebGPU: {error}',
    'Ocupa {size} GB em disco, em {dir}. Livre agora: {free} GB.': 'Takes {size} GB of disk space, in {dir}. Free now: {free} GB.',
    'O download falhou: {error}': 'The download failed: {error}',
    'O texto lido não muda. As páginas desenhadas podem ter diferenças mínimas de arredondamento (cerca de 0,4% dos pixels, invisíveis).':
      'The text read does not change. Drawn pages may have tiny rounding differences (about 0.4% of pixels, invisible).',
    'Remover o CUDA e liberar {size} GB': 'Remove CUDA and free {size} GB',
    'Retomar o download do CUDA': 'Resume the CUDA download',
    'Só funciona com placa NVIDIA. Se algum arquivo faltar ou o CUDA falhar, o KOMA volta sozinho para o WebGPU e avisa aqui.':
      'Works only with NVIDIA cards. If a file is missing or CUDA fails, KOMA goes back to WebGPU on its own and tells you here.',
    'Usa cerca de 1,1 GB a mais de memória enquanto prepara capítulos.': 'Uses about 1.1 GB more memory while preparing chapters.',
    'Usar CUDA no desenho (perfil Máximo)': 'Use CUDA for drawing (Maximum profile)',
    'Não foi possível concluir.': 'Could not finish.',
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
    'A placa de vídeo deste computador dá resultados diferentes do processador e perderia falas.':
      'La tarjeta gráfica de este equipo da resultados distintos a los del procesador y perdería diálogos.',
    'a placa de vídeo dá resultados errados e fica sem uso': 'la tarjeta gráfica da resultados erróneos y no se usa',
    dedicada: 'dedicada',
    integrada: 'integrada',
    '{cores} núcleos · {memory} GB de memória': '{cores} núcleos · {memory} GB de memoria',
    'verificando a placa de vídeo…': 'comprobando la tarjeta gráfica…',
    'placa de vídeo disponível': 'tarjeta gráfica disponible',
    'sem placa de vídeo compatível': 'sin tarjeta gráfica compatible',
    'Em qualquer perfil, o KOMA trabalha com prioridade baixa: o que você estiver usando vem primeiro.':
      'En cualquier perfil, KOMA trabaja con prioridad baja: lo que estés usando va primero.',
    'Aceleração CUDA (opcional)': 'Aceleración CUDA (opcional)',
    'Complemento para placas NVIDIA: no perfil Máximo, o apagamento do texto (máscara e LaMa) passa a usar CUDA; a leitura continua na placa via WebGPU.':
      'Complemento para tarjetas NVIDIA: en el perfil Máximo, el borrado del texto (máscara y LaMa) usa CUDA; la lectura sigue en la tarjeta mediante WebGPU.',
    'Agora não': 'Ahora no',
    'Antes de baixar, saiba exatamente o que muda:': 'Antes de descargar, esto es exactamente lo que cambia:',
    'Baixando: {done} de {total} GB': 'Descargando: {done} de {total} GB',
    'Baixando o CUDA': 'Descargando CUDA',
    'Baixar aceleração CUDA (opcional)': 'Descargar aceleración CUDA (opcional)',
    'Baixar {size} GB': 'Descargar {size} GB',
    'Cancelar (dá para retomar depois)': 'Cancelar (se puede reanudar después)',
    'Conferindo os arquivos…': 'Comprobando los archivos…',
    'Dá para desligar ou remover a qualquer momento.': 'Se puede desactivar o quitar en cualquier momento.',
    'Desligado: o desenho usa a placa via WebGPU.': 'Desactivado: el dibujo usa la tarjeta mediante WebGPU.',
    'Download de {size} GB dos servidores oficiais da NVIDIA (PyPI) e da Microsoft (NuGet), conferidos por SHA-256.':
      'Descarga {size} GB de los servidores oficiales de NVIDIA (PyPI) y Microsoft (NuGet), comprobados por SHA-256.',
    'Em uso agora.': 'En uso ahora.',
    'Entra em uso quando o perfil for Máximo.': 'Se usa cuando el perfil es Máximo.',
    'Extraindo e conferindo os arquivos…': 'Extrayendo y comprobando los archivos…',
    'Ganho medido numa RTX 3070, no perfil Máximo: 14 a 22% menos tempo em mangá e tiras longas; manhwa igual. Em outras placas o ganho pode ser maior, menor ou nenhum.':
      'Ganancia medida en una RTX 3070 en el perfil Máximo: de 14 a 22% menos tiempo en manga y tiras largas; manhwa igual. En otras tarjetas la ganancia puede ser mayor, menor o nula.',
    Instalar: 'Instalar',
    'Licenças:': 'Licencias:',
    'Li e aceito as licenças da NVIDIA para baixar e usar essas bibliotecas.':
      'He leído y acepto las licencias de NVIDIA para descargar y usar estas bibliotecas.',
    'Não há espaço livre suficiente em disco.': 'No hay suficiente espacio libre en disco.',
    'O CUDA falhou e o desenho voltou para a placa via WebGPU: {error}':
      'CUDA falló y el dibujo volvió a la tarjeta mediante WebGPU: {error}',
    'Ocupa {size} GB em disco, em {dir}. Livre agora: {free} GB.': 'Ocupa {size} GB en disco, en {dir}. Libre ahora: {free} GB.',
    'O download falhou: {error}': 'La descarga falló: {error}',
    'O texto lido não muda. As páginas desenhadas podem ter diferenças mínimas de arredondamento (cerca de 0,4% dos pixels, invisíveis).':
      'El texto leído no cambia. Las páginas dibujadas pueden tener diferencias mínimas de redondeo (cerca del 0,4% de los píxeles, invisibles).',
    'Remover o CUDA e liberar {size} GB': 'Quitar CUDA y liberar {size} GB',
    'Retomar o download do CUDA': 'Reanudar la descarga de CUDA',
    'Só funciona com placa NVIDIA. Se algum arquivo faltar ou o CUDA falhar, o KOMA volta sozinho para o WebGPU e avisa aqui.':
      'Solo funciona con tarjetas NVIDIA. Si falta algún archivo o CUDA falla, KOMA vuelve solo a WebGPU y lo avisa aquí.',
    'Usa cerca de 1,1 GB a mais de memória enquanto prepara capítulos.': 'Usa cerca de 1,1 GB más de memoria mientras prepara capítulos.',
    'Usar CUDA no desenho (perfil Máximo)': 'Usar CUDA en el dibujo (perfil Máximo)',
    'Não foi possível concluir.': 'No se pudo completar.',
  },
}
