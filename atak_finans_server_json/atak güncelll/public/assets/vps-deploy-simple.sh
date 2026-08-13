#!/bin/bash
set -euo pipefail
OUT=/tmp/atak-ok.txt
: > "$OUT"
log(){ echo "$*" | tee -a "$OUT"; }
die(){ log "FAIL: $*"; exit 1; }

log "=== ATAK DEPLOY ==="
BRANCH="cursor/satis-merkezi-iskonto-prim-bd99"
EXPECT_V="6.3.76-malzeme-adi"
EXPECT_B="fix-v75"
APP="${APP_DIR:-/root/atak-v10}"
[ -d /root/atakhome-platform ] && [ ! -f "$APP/server.js" ] && APP=/root/atakhome-platform

log "APP=$APP"
log "EXPECT $EXPECT_V / $EXPECT_B"

log "1) temizle"
rm -rf /tmp/atak-deploy-src /tmp/atak-src.tgz
mkdir -p /tmp/atak-deploy-src

log "2) indir"
curl -fL "https://codeload.github.com/tahaatk-maker/ATAK-Satis-Pro/tar.gz/refs/heads/${BRANCH}" -o /tmp/atak-src.tgz || die "github indirilemedi"
tar -xzf /tmp/atak-src.tgz -C /tmp/atak-deploy-src || die "tar acilamadi"
SRC=$(find /tmp/atak-deploy-src -type d -name 'atak güncelll' | head -1)
log "SRC=$SRC"
[ -n "$SRC" ] || die "kaynak klasor yok"
[ -f "$SRC/server.js" ] || die "server.js yok"
[ -f "$SRC/public/assets/admin.js" ] || die "admin.js yok"

log "3) kaynak kontrol"
head -1 "$SRC/public/assets/admin.js" | tee -a "$OUT"
grep -E "version:|build:" "$SRC/server.js" | head -2 | tee -a "$OUT"
grep -q "$EXPECT_B" "$SRC/public/assets/admin.js" || die "kaynak admin build yanlis"
grep -q "$EXPECT_V" "$SRC/server.js" || die "kaynak version yanlis"
grep -q "build:'$EXPECT_B'" "$SRC/server.js" || die "kaynak build yanlis"
log "   kaynak OK"

log "4) kopyala (data dokunulmaz)"
mkdir -p "$APP/data" "$APP/public/assets"
if [ -f "$APP/data/store.json" ]; then
  cp -a "$APP/data/store.json" "$APP/data/store.json.bak-$(date +%Y%m%d-%H%M%S)"
  log "   store.json yedek"
fi
for D in "$APP" /root/atak-v10 /root/atakhome-platform; do
  [ -d "$D" ] || continue
  log "   SYNC -> $D"
  rsync -a --delete --exclude data --exclude node_modules --exclude .env --exclude '*.bak-*' "$SRC"/ "$D"/
  cp -f "$SRC/server.js" "$D/server.js"
  cp -f "$SRC/public/admin.html" "$D/public/admin.html"
  cp -f "$SRC/public/assets/admin.js" "$D/public/assets/admin.js"
  cp -f "$SRC/public/assets/admin.css" "$D/public/assets/admin.css"
  cp -f "$SRC/public/assets/personel.js" "$D/public/assets/personel.js" 2>/dev/null || true
done

log "5) disk kontrol"
head -1 "$APP/public/assets/admin.js" | tee -a "$OUT"
grep -E "version:|build:" "$APP/server.js" | head -2 | tee -a "$OUT"
grep -q "$EXPECT_V" "$APP/server.js" || die "disk version yanlis"
grep -q "build:'$EXPECT_B'" "$APP/server.js" || die "disk build yanlis"
grep -q "ATAK_ADMIN_BUILD=$EXPECT_B" "$APP/public/assets/admin.js" || die "disk admin build yanlis"
log "   disk OK"

log "6) npm + pm2"
cd "$APP"
if [ ! -d node_modules ]; then
  log "   npm install"
  npm install --omit=dev --no-audit --no-fund || die "npm install fail"
fi
pm2 delete atak 2>/dev/null || true
sleep 1
for P in 3100 3000; do
  PID=$(ss -lntp 2>/dev/null | awk -v p=":$P" '$4 ~ p{print}' | sed -n 's/.*pid=\([0-9]*\).*/\1/p' | head -1 || true)
  if [ -n "${PID:-}" ]; then
    log "   kill $PID :$P"
    kill -9 "$PID" 2>/dev/null || true
  fi
done
sleep 1
pm2 start "$APP/server.js" --name atak --cwd "$APP" --update-env || die "pm2 start fail"
pm2 save || true
sleep 5

log "7) health (/health — /web-api/health DEGIL)"
H1=$(curl -sS -m 8 http://127.0.0.1:3100/health || true)
log "LOCAL=$H1"
echo "$H1" | grep -q "$EXPECT_V" || die "health version yok: $H1"
echo "$H1" | grep -q "$EXPECT_B" || die "health build yok: $H1"
log "=== BASARILI $EXPECT_V / $EXPECT_B ==="
echo OK > /tmp/atak-deploy-OK
log "Log dosyasi: $OUT"
