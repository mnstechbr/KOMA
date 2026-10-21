#!/usr/bin/env bash
set -euo pipefail
KOMA_SOURCE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KOMA_BUNDLE="${1:-$(cat "$KOMA_SOURCE_ROOT/artifacts/latest-bundle.txt")}"
KOMA_DATA_BASE="${XDG_DATA_HOME:-$HOME/.local/share}"
KOMA_INSTALL_ROOT="$KOMA_DATA_BASE/koma/app"
KOMA_RELEASE="$KOMA_INSTALL_ROOT/releases/$(basename "$KOMA_BUNDLE")"
test -x "$KOMA_BUNDLE/koma"
mkdir -p "$KOMA_INSTALL_ROOT/releases" "$KOMA_DATA_BASE/applications"
if [ -e "$KOMA_RELEASE" ]; then
  echo 'Esta versão já está instalada; use um pacote novo para atualizar.' >&2
  exit 1
fi
cp -a "$KOMA_BUNDLE" "$KOMA_RELEASE"
ln -s "$KOMA_RELEASE" "$KOMA_INSTALL_ROOT/current.new"
mv -Tf "$KOMA_INSTALL_ROOT/current.new" "$KOMA_INSTALL_ROOT/current"
# Exec é interpretado pelo padrão Desktop Entry, não pelo shell.
KOMA_EXEC="${KOMA_INSTALL_ROOT//\\/\\\\}/current/koma"
KOMA_EXEC="${KOMA_EXEC//\"/\\\"}"
KOMA_EXEC="${KOMA_EXEC//\`/\\\`}"
KOMA_EXEC="${KOMA_EXEC//\$/\\\$}"
KOMA_EXEC="${KOMA_EXEC//%/%%}"
cat > "$KOMA_DATA_BASE/applications/koma.desktop" <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=KOMA
Comment=Biblioteca pessoal e tradução de mangás em português brasileiro
Exec="$KOMA_EXEC"
Icon=$KOMA_INSTALL_ROOT/current/electron/resources/app/koma.png
Terminal=false
Categories=Graphics;Viewer;
StartupWMClass=KOMA
EOF
chmod 644 "$KOMA_DATA_BASE/applications/koma.desktop"
if command -v update-desktop-database >/dev/null; then update-desktop-database "$KOMA_DATA_BASE/applications"; fi
echo "KOMA instalado. Abra pelo menu de aplicativos. Dados preservados em $KOMA_DATA_BASE/koma/library."
