#!/usr/bin/env bash
set -euo pipefail
KOMA_DATA_BASE="${XDG_DATA_HOME:-$HOME/.local/share}"
rm -f "$KOMA_DATA_BASE/applications/koma.desktop"
# Preserva todas as versões e a biblioteca; permite recuperar uma instalação.
echo "Atalho removido. Biblioteca e pacotes preservados em $KOMA_DATA_BASE/koma."
