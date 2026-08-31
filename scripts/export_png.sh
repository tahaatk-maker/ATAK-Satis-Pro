#!/usr/bin/env bash
set -euo pipefail
OUT="${1:-/workspace/assets/export}"
BASE="${2:-http://127.0.0.1:4173}"
mkdir -p "$OUT"

shot() {
  local name="$1" url="$2"
  local dir="/tmp/chrome-$name"
  rm -rf "$dir"
  timeout 18s google-chrome \
    --headless=new \
    --no-sandbox \
    --disable-gpu \
    --disable-dev-shm-usage \
    --hide-scrollbars \
    --user-data-dir="$dir" \
    --force-device-scale-factor=4 \
    --window-size=341,190 \
    --virtual-time-budget=4000 \
    --screenshot="$OUT/$name.png" \
    "$url" >/dev/null 2>&1 || true
  rm -rf "$dir"
  echo "wrote $OUT/$name.png"
}

for id in 1 2 3 4; do
  shot "satici-${id}-on" "$BASE/export.html?id=${id}&side=front"
  shot "satici-${id}-arka" "$BASE/export.html?id=${id}&side=back"
done
