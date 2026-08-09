#!/bin/bash
# ATAK VPS kesin deploy (fix-v14) — health 6.3.15-atk-ata-seri olmadan DONE yazmaz
set -euo pipefail
BRANCH=cursor/satis-merkezi-iskonto-prim-bd99
EXPECT_HEALTH=6.3.15-atk-ata-seri
EXPECT_BUILD=fix-v14
TMP=/tmp/atak-fix-$(date +%s)
OUT=/tmp/atak-deploy-result.txt
exec > >(tee "$OUT") 2>&1
echo "START $(date -Is)"
echo "EXPECT $EXPECT_HEALTH / $EXPECT_BUILD"

command -v curl >/dev/null
command -v tar >/dev/null
command -v python3 >/dev/null
if ! command -v rsync >/dev/null; then
  apt-get update -y && apt-get install -y rsync || yum install -y rsync || true
fi
command -v rsync >/dev/null

mkdir -p "$TMP" && cd "$TMP"
curl -fsSL "https://codeload.github.com/tahaatk-maker/ATAK-Satis-Pro/tar.gz/refs/heads/$BRANCH" | tar -xz
SRC=$(find "$TMP" -type d -name 'atak güncelll' | head -1)
test -f "$SRC/server.js"
test -f "$SRC/public/admin.html"
grep -q "$EXPECT_HEALTH" "$SRC/server.js"
grep -q "ATAK_ADMIN_BUILD=$EXPECT_BUILD" "$SRC/public/assets/admin.js"
grep -q "ATAK_PERSONEL_BUILD=$EXPECT_BUILD" "$SRC/public/assets/personel.js"
grep -q 'id="salesPayPlanToggleBtn"' "$SRC/public/admin.html"
grep -q 'id="salesPayPlanToggleBtn"' "$SRC/public/personel.html"
grep -q 'data-finance-jump="uninvoiced"' "$SRC/public/admin.html"
grep -q "admin.js?v=$EXPECT_BUILD" "$SRC/public/admin.html"
grep -q "personel.js?v=$EXPECT_BUILD" "$SRC/public/personel.html"
echo "SRC_OK=$SRC"
echo "SRC_ADMIN_MD5=$(md5sum "$SRC/public/assets/admin.js" | awk '{print $1}')"
echo "SRC_HTML_MD5=$(md5sum "$SRC/public/admin.html" | awk '{print $1}')"

# PM2 cwd + bilinen dizinler + server.js bulunan tüm adaylar
APP=$(pm2 jlist 2>/dev/null | python3 -c 'import sys,json
try:
 d=json.load(sys.stdin)
 p=next((x for x in d if x.get("name")=="atak"),None)
 print((p or {}).get("pm2_env",{}).get("pm_cwd") or "")
except Exception:
 print("")' || true)
[ -n "$APP" ] || APP=/root/atak-v10
echo "APP=$APP"

mapfile -t DIRS < <(
  {
    echo "$APP"
    echo /root/atak-v10
    echo /root/atakhome-platform
    find /root /var/www /home -maxdepth 4 -type f -name server.js 2>/dev/null | while read -r f; do
      d=$(dirname "$f")
      if [ -f "$d/public/admin.html" ] || [ -d "$d/public/assets" ]; then echo "$d"; fi
    done
  } | awk 'NF && !seen[$0]++'
)

SYNCED=0
for D in "${DIRS[@]}"; do
  [ -d "$D" ] || continue
  mkdir -p "$D/public/assets" "$D/data"
  if [ -f "$D/data/store.json" ]; then
    cp -a "$D/data/store.json" "$D/data/store.json.bak-$(date +%Y%m%d-%H%M%S)"
  fi
  rsync -a --delete --exclude data --exclude node_modules --exclude .env --exclude '*.bak-*' "$SRC"/ "$D"/
  echo "SYNCED $D admin_md5=$(md5sum "$D/public/assets/admin.js" | awk '{print $1}') html_md5=$(md5sum "$D/public/admin.html" | awk '{print $1}')"
  SYNCED=$((SYNCED+1))
done
[ "$SYNCED" -gt 0 ] || { echo "NO_DIRS"; exit 1; }

ENVF="$APP/.env"
[ -f "$ENVF" ] || ENVF=/root/atak-v10/.env
PORT_NOW=$(grep -E '^PORT=' "$ENVF" 2>/dev/null | tail -1 | cut -d= -f2 | tr -d '\r' || true)
[ -n "$PORT_NOW" ] || PORT_NOW=3100
echo "PORT=$PORT_NOW"

# Eski process temizliği
pm2 delete atak 2>/dev/null || true
sleep 1
pkill -f 'node .*server\.js' 2>/dev/null || true
sleep 1
for P in 3000 3100 "$PORT_NOW"; do
  PID=$(ss -lntp 2>/dev/null | awk -v p=":$P" '$4 ~ p {print}' | sed -n 's/.*pid=\([0-9]*\).*/\1/p' | head -1 || true)
  if [ -n "${PID:-}" ]; then
    CMD=$(ps -p "$PID" -o args= 2>/dev/null || true)
    echo "LISTEN $P pid=$PID cmd=$CMD"
    if echo "$CMD" | grep -qE 'server\.js|node'; then kill -9 "$PID" 2>/dev/null || true; fi
  fi
done
sleep 1

cd "$APP"
if [ ! -d "$APP/node_modules" ] && [ -f "$APP/package.json" ]; then
  npm install --omit=dev || npm install || true
fi
pm2 start "$APP/server.js" --name atak --cwd "$APP" --update-env
pm2 save || true

HEALTH=""
HEALTH_PORT=""
SEARCH_HTTP=""
ok=0
for i in 1 2 3 4 5 6 7 8 9 10; do
  sleep 1
  for P in "$PORT_NOW" 3100 3000; do
    HEALTH=$(curl -sS -m 3 "http://127.0.0.1:$P/health" 2>/dev/null || true)
    if echo "$HEALTH" | grep -q "$EXPECT_HEALTH"; then
      HEALTH_PORT=$P
      SEARCH_HTTP=$(curl -sS -m 3 -o /dev/null -w "%{http_code}" "http://127.0.0.1:$P/web-api/admin/customers/search?q=atak" || echo err)
      ok=1
      break 2
    fi
  done
  echo "WAIT_$i health=$HEALTH"
done

if [ "$ok" != "1" ]; then
  echo "FAIL_HEALTH_NOT_$EXPECT_HEALTH"
  pm2 describe atak || true
  pm2 logs atak --lines 40 --nostream || true
  FAIL_MSG="health_mismatch want=$EXPECT_HEALTH got=$HEALTH"
else
  FAIL_MSG=""
fi

PROOF="$APP/public/assets/_deploy-check.txt"
{
  echo "stamp=$(date -Is)"
  echo "build=$EXPECT_BUILD"
  echo "app=$APP"
  echo "synced=$SYNCED"
  echo "health_port=$HEALTH_PORT"
  echo "health=$HEALTH"
  echo "search_http=$SEARCH_HTTP"
  echo "admin_js_has_build=$(grep -c "ATAK_ADMIN_BUILD=$EXPECT_BUILD" "$APP/public/assets/admin.js" || true)"
  echo "admin_html_cache=$(grep -o "admin.js?v=[^\"]*" "$APP/public/admin.html" | head -1)"
  echo "has_kesilmeyen=$(grep -c 'data-finance-jump=\"uninvoiced\"' "$APP/public/admin.html" || true)"
  echo "has_search=$(grep -c customerSearchHandler "$APP/server.js" || true)"
  echo "admin_md5=$(md5sum "$APP/public/assets/admin.js" | awk '{print $1}')"
  echo "html_md5=$(md5sum "$APP/public/admin.html" | awk '{print $1}')"
  echo "server_md5=$(md5sum "$APP/server.js" | awk '{print $1}')"
  if [ -n "$FAIL_MSG" ]; then echo "status=FAIL $FAIL_MSG"; else echo "status=OK"; fi
  echo "DONE"
} | tee "$PROOF"

for D in /root/atak-v10 /root/atakhome-platform "$APP"; do
  [ -d "$D/public/assets" ] || continue
  cp -f "$PROOF" "$D/public/assets/_deploy-check.txt" 2>/dev/null || true
  cp -f "$OUT" "$D/public/assets/_deploy-log.txt" 2>/dev/null || true
done

echo "PUBLIC https://panel.atakhome.com.tr/web-admin-assets/_deploy-check.txt"
echo "PUBLIC https://atakhome.com.tr/assets/_deploy-check.txt"
echo "CHECK_HEALTH https://panel.atakhome.com.tr/health  (must contain $EXPECT_HEALTH)"
echo "CHECK_HTML https://panel.atakhome.com.tr/web-admin  (must contain fix-v5 and Kesilmeyen)"

if [ -n "$FAIL_MSG" ]; then
  echo "DEPLOY_FAILED"
  exit 2
fi
echo "DEPLOY_OK"
