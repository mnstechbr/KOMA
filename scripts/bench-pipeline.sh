#!/usr/bin/env bash
# Mede OCR + máscara + LaMa + desenho em capítulos reais (tests/pipeline-benchmark.real.test.ts),
# um capítulo e um perfil por processo, com prioridade baixa e limites de memória e CPU
# para não travar o PC. Imagens, falas e resultados ficam em KOMA_BENCH_DIR, fora do repositório.
#
#   scripts/bench-pipeline.sh                      # linha de base (baseline), Equilibrado e Máximo
#   scripts/bench-pipeline.sh teste                # nova rodada e comparação com a linha de base
#   scripts/bench-pipeline.sh teste "maximo"       # só um perfil
set -euo pipefail
NAME=${1:-baseline}
PROFILES=${2:-"equilibrado maximo"}
export KOMA_BENCH_DIR=${KOMA_BENCH_DIR:-$HOME/.cache/koma-bench}
export KOMA_INPAINT_THREADS=${KOMA_INPAINT_THREADS:-8}
cd "$(dirname "$0")/.."

limited() {
  nice -n 15 systemd-run --user --scope -q -p MemoryMax=6G -p CPUQuota=800% \
    env OMP_NUM_THREADS=8 "$@" npx vitest run tests/pipeline-benchmark.real.test.ts
}

rm -f "$KOMA_BENCH_DIR/$NAME/summary.txt"
if [ ! -d "$KOMA_BENCH_DIR/chapters" ]; then
  limited KOMA_BENCH_PIPELINE=prepare
fi
for profile in $PROFILES; do
  for manifest in "$KOMA_BENCH_DIR"/chapters/*/manifest.json; do
    label=$(basename "$(dirname "$manifest")")
    available=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)
    if [ "$available" -lt 2048 ]; then
      echo "Memória disponível em ${available} MB: medição interrompida." >&2
      exit 1
    fi
    limited KOMA_BENCH_PIPELINE=run KOMA_BENCH_NAME="$NAME" KOMA_BENCH_PROFILE="$profile" KOMA_BENCH_LABEL="$label"
  done
done
if [ "$NAME" != baseline ] && [ -d "$KOMA_BENCH_DIR/baseline" ]; then
  limited KOMA_BENCH_PIPELINE=compare KOMA_BENCH_NAME="$NAME"
fi
cat "$KOMA_BENCH_DIR/$NAME/summary.txt"
