#!/usr/bin/env bash
# Hermes 桌面端中文界面 — one-line installer (macOS / Linux)
#
#   curl -fsSL https://raw.githubusercontent.com/yehaicheng258-arch/hermes-desktop-zh-ui/main/install.sh | bash
#
# Copies dist/plugin.js into $HERMES_HOME/desktop-plugins/zh-ui/plugin.js.
# The app watches that folder and hot-loads the plugin within a few seconds.
set -euo pipefail

REF="${1:-main}"
ROOT="${HERMES_HOME:-$HOME/.hermes}"

if [ ! -d "$ROOT" ]; then
  echo "Hermes data dir not found: $ROOT" >&2
  echo "Set HERMES_HOME to your Hermes home and retry." >&2
  exit 1
fi

DIR="$ROOT/desktop-plugins/zh-ui"
mkdir -p "$DIR"

URL="https://raw.githubusercontent.com/yehaicheng258-arch/hermes-desktop-zh-ui/$REF/dist/plugin.js"
echo "downloading $URL"
if command -v curl >/dev/null 2>&1; then
  curl -fsSL "$URL" -o "$DIR/plugin.js"
else
  wget -qO "$DIR/plugin.js" "$URL"
fi

SIZE=$(wc -c < "$DIR/plugin.js" | tr -d ' ')
echo "installed -> $DIR/plugin.js ($SIZE bytes)"
echo 'Switch to the Hermes window: a "中" chip appears in the status bar (a few seconds).'
echo 'Named profile? Use <HERMES_HOME>/profiles/<name>/desktop-plugins/zh-ui/ instead.'
