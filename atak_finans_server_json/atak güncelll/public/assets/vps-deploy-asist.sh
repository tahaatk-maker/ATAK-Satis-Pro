#!/bin/bash
# Asist fatura+stok paneli — sadece ERP (atak). Vitrin/commerce'e DOKUNMAZ.
# Hostinger Web Terminal:
#   curl -fsSL "https://raw.githubusercontent.com/tahaatk-maker/ATAK-Satis-Pro/cursor/asist-fatura-aktarim-474e/atak_finans_server_json/atak%20g%C3%BCncelll/public/assets/vps-deploy-asist.sh" | bash
set -euo pipefail
OUT=/tmp/atak-asist-deploy.txt
: > "$OUT"
log(){ echo "$*" | tee -a "$OUT"; }
die(){ log "FAIL: $*"; exit 1; }

BRANCH="${ATAK_BRANCH:-cursor/asist-fatura-aktarim-474e}"
EXPECT_V="${EXPECT_HEALTH:-6.3.254-kategori-tahmin}"
EXPECT_B="${EXPECT_BUILD:-fix-v254}"

log "=== ATAK ASIST DEPLOY ==="
log "BRANCH=$BRANCH"
log "EXPECT $EXPECT_V / $EXPECT_B"

APP=""
if command -v pm2 >/dev/null 2>&1 && command -v python3 >/dev/null 2>&1; then
  APP=$(pm2 jlist 2>/dev/null | python3 -c 'import sys,json
try:
 d=json.load(sys.stdin)
 p=next((x for x in d if x.get("name")=="atak"),None)
 print((p or {}).get("pm2_env",{}).get("pm_cwd") or "")
except Exception:
 print("")' || true)
fi
[ -n "${APP:-}" ] || APP=/root/atak-v10
[ -d /root/atakhome-platform ] && [ ! -f "$APP/server.js" ] && APP=/root/atakhome-platform
log "APP=$APP"

log "1) GitHub paket"
rm -rf /tmp/atak-asist-src /tmp/atak-asist.tgz
mkdir -p /tmp/atak-asist-src
curl -4 -fL --connect-timeout 20 --max-time 120 \
  "https://codeload.github.com/tahaatk-maker/ATAK-Satis-Pro/tar.gz/refs/heads/${BRANCH}" \
  -o /tmp/atak-asist.tgz || die "github indirilemedi"
tar -xzf /tmp/atak-asist.tgz -C /tmp/atak-asist-src || die "tar acilamadi"
SRC=$(find /tmp/atak-asist-src -type d -name 'atak güncelll' | head -1)
log "SRC=$SRC"
[ -n "$SRC" ] && [ -f "$SRC/server.js" ] || die "kaynak yok"
grep -q "$EXPECT_V" "$SRC/server.js" || die "kaynak version yanlis"
grep -q "build:'$EXPECT_B'" "$SRC/server.js" || die "kaynak build yanlis"
grep -q "ATAK_ADMIN_BUILD=$EXPECT_B" "$SRC/public/assets/admin.js" || die "kaynak admin build yanlis"
grep -q 'purchaseBothBtn' "$SRC/public/admin.html" || die "Asist butonu kaynakta yok"
grep -q 'purchaseAsistBoard' "$SRC/public/admin.html" || die "Asist board kaynakta yok"
log "   kaynak OK"

log "2) kopyala (data / node_modules / .env dokunulmaz)"
SYNCED=0
for D in "$APP" /root/atak-v10 /root/atakhome-platform; do
  [ -d "$D" ] || continue
  case "$D" in *commerce*|*checkout*|*vitrin*) log "SKIP_SHOP $D"; continue ;; esac
  mkdir -p "$D/public/assets" "$D/data"
  if [ -f "$D/data/store.json" ]; then
    cp -a "$D/data/store.json" "$D/data/store.json.bak-asist-$(date +%Y%m%d-%H%M%S)"
    log "   store yedek: $D"
  fi
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --exclude data --exclude node_modules --exclude .env --exclude '*.bak-*' "$SRC"/ "$D"/
  else
    cp -f "$SRC/server.js" "$D/server.js"
    cp -f "$SRC/public/admin.html" "$D/public/admin.html"
    mkdir -p "$D/public/assets"
    cp -f "$SRC/public/assets/admin.js" "$D/public/assets/admin.js"
    cp -f "$SRC/public/assets/admin.css" "$D/public/assets/admin.css"
    [ -f "$SRC/lib/purchase-csv.js" ] && mkdir -p "$D/lib" && cp -f "$SRC/lib/purchase-csv.js" "$D/lib/purchase-csv.js"
  fi
  grep -q "$EXPECT_V" "$D/server.js" || die "disk version yanlis: $D"
  grep -q 'purchaseBothBtn' "$D/public/admin.html" || die "disk Asist butonu yok: $D"
  log "   SYNCED $D"
  SYNCED=$((SYNCED+1))
done
[ "$SYNCED" -gt 0 ] || die "ERP klasoru bulunamadi"

log "3) sadece atak restart (web/commerce dokunulmaz)"
pm2 restart atak --update-env || die "pm2 restart atak fail"
sleep 4

log "4) health"
H1=$(curl -sS -m 10 http://127.0.0.1:3100/health 2>/dev/null || curl -sS -m 10 https://panel.atakhome.com.tr/health || true)
log "HEALTH=$H1"
echo "$H1" | grep -q "$EXPECT_V" || die "health version yok"
echo "$H1" | grep -q "$EXPECT_B" || die "health build yok"
echo "$H1" | grep -q '"storeOk":false' && die "storeOk=false"

log "5) panel HTML"
HTML=$(curl -sS -m 12 https://panel.atakhome.com.tr/web-admin || true)
echo "$HTML" | grep -q 'purchaseBothBtn\|Fatura Ve Stok Aktarım' || die "panel HTML Asist butonu yok — Ctrl+Shift+R deneyin"
log "=== BASARILI: Asist alis paneli yayinda ($EXPECT_V) ==="
log "Panel: https://panel.atakhome.com.tr/web-admin → Alış Faturaları"
log "Log: $OUT"
