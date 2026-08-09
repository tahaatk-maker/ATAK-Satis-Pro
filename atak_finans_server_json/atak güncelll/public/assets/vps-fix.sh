#!/bin/bash
# ATAK VPS kesin deploy — çıktıyı public/_deploy-check.txt'e yazar
set -e
BRANCH=cursor/satis-merkezi-iskonto-prim-bd99
TMP=/tmp/atak-fix-$(date +%s)
OUT=/tmp/atak-deploy-result.txt
exec > >(tee "$OUT") 2>&1
echo "START $(date -Is)"

mkdir -p "$TMP" && cd "$TMP"
curl -fsSL "https://codeload.github.com/tahaatk-maker/ATAK-Satis-Pro/tar.gz/refs/heads/$BRANCH" | tar -xz
SRC=$(find "$TMP" -type d -name 'atak güncelll' | head -1)
test -f "$SRC/server.js"
echo "SRC=$SRC"
grep -o "6.3.5-customer-search" "$SRC/server.js" | head -1

APP=$(pm2 jlist 2>/dev/null | python3 -c 'import sys,json
d=json.load(sys.stdin)
p=next((x for x in d if x.get("name")=="atak"),None)
print((p or {}).get("pm2_env",{}).get("pm_cwd") or "")' || true)
[ -n "$APP" ] || APP=/root/atak-v10
echo "APP=$APP"

# Her iki dizine de yaz (nginx hangisini kullanırsa)
for D in "$APP" /root/atak-v10 /root/atakhome-platform; do
  [ -d "$D" ] || continue
  mkdir -p "$D/public/assets" "$D/data"
  if [ -f "$D/data/store.json" ]; then
    cp -a "$D/data/store.json" "$D/data/store.json.bak-$(date +%Y%m%d-%H%M%S)"
  fi
  rsync -a --exclude data --exclude node_modules --exclude .env "$SRC"/ "$D"/
  echo "SYNCED $D"
done

# .env PORT — 3100 veya 3000
ENVF="$APP/.env"
[ -f "$ENVF" ] || ENVF=/root/atak-v10/.env
PORT_NOW=$(grep -E '^PORT=' "$ENVF" 2>/dev/null | tail -1 | cut -d= -f2 || true)
[ -n "$PORT_NOW" ] || PORT_NOW=3100
echo "PORT=$PORT_NOW"

# Eski process'i tamamen kaldır ve yeniden başlat
pm2 delete atak 2>/dev/null || true
sleep 1
# Orphan dinleyenleri öldürme (dikkatli)
for P in 3000 3100; do
  PID=$(ss -lntp 2>/dev/null | awk -v p=":$P" '$4 ~ p {print}' | sed -n 's/.*pid=\([0-9]*\).*/\1/p' | head -1)
  if [ -n "$PID" ]; then
    CMD=$(ps -p "$PID" -o args= 2>/dev/null || true)
    echo "LISTEN $P pid=$PID cmd=$CMD"
    if echo "$CMD" | grep -qE 'server\.js|atak'; then
      kill "$PID" 2>/dev/null || true
    fi
  fi
done
sleep 1

cd "$APP"
# package type module ise .js uzantısı sorun çıkarabilir — klasik start
pm2 start "$APP/server.js" --name atak --cwd "$APP" --update-env
pm2 save || true
sleep 2

HEALTH=""
for P in "$PORT_NOW" 3100 3000; do
  HEALTH=$(curl -sS -m 3 "http://127.0.0.1:$P/health" || true)
  if echo "$HEALTH" | grep -q ok; then
    echo "HEALTH_PORT=$P"
    echo "$HEALTH"
    SEARCH=$(curl -sS -m 3 -o /dev/null -w "%{http_code}" "http://127.0.0.1:$P/web-api/admin/customers/search?q=atak" || echo err)
    echo "SEARCH_HTTP=$SEARCH"
    break
  fi
done

{
  echo "stamp=$(date -Is)"
  echo "app=$APP"
  echo "health=$HEALTH"
  echo "personel=$(grep -o 'fix-v[0-9]*\|pay-split-v[0-9]*' "$APP/public/personel.html" | head -1)"
  echo "admin=$(grep -o 'fix-v[0-9]*\|pay-split-v[0-9]*' "$APP/public/admin.html" | head -1)"
  echo "has_inline=$(grep -c posPayTilesInline "$APP/public/personel.html" || true)"
  echo "has_search=$(grep -c customerSearchHandler "$APP/server.js" || true)"
  echo "DONE"
} | tee "$APP/public/assets/_deploy-check.txt"
cp -f "$APP/public/assets/_deploy-check.txt" /root/atakhome-platform/public/assets/_deploy-check.txt 2>/dev/null || true
cp -f "$APP/public/assets/_deploy-check.txt" /root/atak-v10/public/assets/_deploy-check.txt 2>/dev/null || true
cp -f "$OUT" "$APP/public/assets/_deploy-log.txt" 2>/dev/null || true
echo "PUBLIC https://atakhome.com.tr/assets/_deploy-check.txt"
echo "PUBLIC https://panel.atakhome.com.tr/web-admin-assets/_deploy-check.txt"
echo DONE
