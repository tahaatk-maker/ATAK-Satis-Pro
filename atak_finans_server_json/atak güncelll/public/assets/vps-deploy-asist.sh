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
EXPECT_V="${EXPECT_HEALTH:-6.3.256-pp-stok}"
EXPECT_B="${EXPECT_BUILD:-fix-v256}"

log "=== ATAK ASIST DEPLOY ==="
log "BRANCH=$BRANCH"
log "EXPECT $EXPECT_V / $EXPECT_B"

# PM2 atak: cwd + script + port
PM_CWD=""; PM_SCRIPT=""; PM_NAME="atak"
if command -v pm2 >/dev/null 2>&1 && command -v python3 >/dev/null 2>&1; then
  eval "$(pm2 jlist 2>/dev/null | python3 -c '
import sys,json,shlex
try:
  d=json.load(sys.stdin)
  p=next((x for x in d if x.get("name")=="atak"),None)
  if not p:
    print("PM_CWD="); print("PM_SCRIPT="); raise SystemExit
  env=p.get("pm2_env") or {}
  cwd=env.get("pm_cwd") or ""
  script=env.get("pm_exec_path") or env.get("script") or "server.js"
  print("PM_CWD="+shlex.quote(cwd))
  print("PM_SCRIPT="+shlex.quote(script))
except Exception:
  print("PM_CWD="); print("PM_SCRIPT=")
' || true)"
fi

APP="${PM_CWD:-}"
[ -n "$APP" ] || APP=/root/atak-v10
[ -d /root/atakhome-platform ] && [ ! -f "$APP/server.js" ] && APP=/root/atakhome-platform
log "PM_CWD=${PM_CWD:-?} PM_SCRIPT=${PM_SCRIPT:-?}"
log "APP=$APP"

# 3100 dinleyen süreç (eski orphan olabilir)
if command -v ss >/dev/null 2>&1; then
  log "PORT3100: $(ss -tlnp 2>/dev/null | grep ':3100' || echo 'yok')"
elif command -v lsof >/dev/null 2>&1; then
  log "PORT3100: $(lsof -iTCP:3100 -sTCP:LISTEN 2>/dev/null || echo 'yok')"
fi

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
[ -f "$SRC/lib/istikbal-category.js" ] || die "istikbal-category.js kaynakta yok"
log "   kaynak OK"

copy_critical(){
  local D="$1"
  mkdir -p "$D/public/assets" "$D/lib" "$D/data"
  cp -f "$SRC/server.js" "$D/server.js"
  cp -f "$SRC/public/admin.html" "$D/public/admin.html"
  cp -f "$SRC/public/assets/admin.js" "$D/public/assets/admin.js"
  cp -f "$SRC/public/assets/admin.css" "$D/public/assets/admin.css"
  cp -f "$SRC/lib/purchase-csv.js" "$D/lib/purchase-csv.js"
  cp -f "$SRC/lib/istikbal-category.js" "$D/lib/istikbal-category.js"
  [ -f "$SRC/lib/stock-cost.js" ] && cp -f "$SRC/lib/stock-cost.js" "$D/lib/stock-cost.js"
}

log "2) kopyala (data / node_modules / .env dokunulmaz)"
SYNCED=0
# Önce PM2 cwd, sonra bilinen ERP kökleri (tekrarlar atlanır)
SEEN_LIST=""
for D in "$APP" "${PM_CWD:-}" /root/atakhome-platform /root/atak-v10; do
  [ -n "$D" ] && [ -d "$D" ] || continue
  case " $SEEN_LIST " in *" $D "*) continue ;; esac
  SEEN_LIST="$SEEN_LIST $D"
  case "$D" in *commerce*|*checkout*|*vitrin*) log "SKIP_SHOP $D"; continue ;; esac
  if [ -f "$D/data/store.json" ]; then
    cp -a "$D/data/store.json" "$D/data/store.json.bak-asist-$(date +%Y%m%d-%H%M%S)"
    log "   store yedek: $D"
  fi
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --exclude data --exclude node_modules --exclude .env --exclude '*.bak-*' "$SRC"/ "$D"/
  fi
  # Kritik dosyaları her zaman zorla kopyala (rsync/symlink sapması olmasın)
  copy_critical "$D"
  grep -q "$EXPECT_V" "$D/server.js" || die "disk version yanlis: $D"
  grep -q "build:'$EXPECT_B'" "$D/server.js" || die "disk build yanlis: $D"
  grep -q 'purchaseBothBtn' "$D/public/admin.html" || die "disk Asist butonu yok: $D"
  log "   SYNCED $D  version=$(grep -o "version:'[^']*'" "$D/server.js" | head -1)"
  SYNCED=$((SYNCED+1))
done
[ "$SYNCED" -gt 0 ] || die "ERP klasoru bulunamadi"

# PM2 script yolu ayrı bir dosyaysa onu da güncelle
if [ -n "${PM_SCRIPT:-}" ] && [ -f "$PM_SCRIPT" ]; then
  case "$PM_SCRIPT" in
    *.js)
      if ! grep -q "$EXPECT_V" "$PM_SCRIPT" 2>/dev/null; then
        log "   PM_SCRIPT eski, server.js ile degistiriliyor: $PM_SCRIPT"
        cp -f "$SRC/server.js" "$PM_SCRIPT"
      fi
      grep -q "$EXPECT_V" "$PM_SCRIPT" || die "PM_SCRIPT version yanlis: $PM_SCRIPT"
      log "   PM_SCRIPT OK: $PM_SCRIPT"
      ;;
  esac
fi

log "3) sert restart (web/commerce dokunulmaz)"
# Eski süreç bazen restart ile eski kodu tutuyor — delete + start
pm2 stop atak >/dev/null 2>&1 || true
sleep 1
# 3100 hâlâ doluysa orphan öldür (sadece node, dikkatli)
if command -v fuser >/dev/null 2>&1; then
  fuser -k 3100/tcp >/dev/null 2>&1 || true
elif command -v lsof >/dev/null 2>&1; then
  PIDS=$(lsof -t -iTCP:3100 -sTCP:LISTEN 2>/dev/null || true)
  [ -n "${PIDS:-}" ] && kill $PIDS 2>/dev/null || true
fi
sleep 1
pm2 delete atak >/dev/null 2>&1 || true
sleep 1

START_DIR="$APP"
[ -f "$START_DIR/server.js" ] || die "start dir server.js yok: $START_DIR"
grep -q "$EXPECT_V" "$START_DIR/server.js" || die "start dir version yanlis"
cd "$START_DIR"
pm2 start server.js --name atak --update-env || die "pm2 start atak fail"
pm2 save >/dev/null 2>&1 || true
sleep 5

log "4) health (retry)"
H1=""
for i in 1 2 3 4 5 6; do
  H1=$(curl -sS -m 8 http://127.0.0.1:3100/health 2>/dev/null || true)
  log "   try$i HEALTH=${H1:0:180}"
  echo "$H1" | grep -q "$EXPECT_V" && break
  sleep 2
done
log "HEALTH=$H1"
echo "$H1" | grep -q "$EXPECT_V" || die "health version yok — disk: $(grep -o "version:'[^']*'" "$START_DIR/server.js" | head -1) cwd=$START_DIR"
echo "$H1" | grep -q "$EXPECT_B" || die "health build yok"
echo "$H1" | grep -q '"storeOk":false' && die "storeOk=false"

# Ürün kartları boşsa otomatik yedekten geri yükle (deploy sonrası productCount=0 felaketi)
DATA_DIR="$START_DIR/data"
if echo "$H1" | grep -q '"productCount":0'; then
  log "UYARI: productCount=0 — yedekten geri yukleme deneniyor"
  BEST=""
  BEST_N=0
  for CAND in \
    $(ls -1t "$DATA_DIR"/store.json.bak-asist-* 2>/dev/null | head -5) \
    $(ls -1t "$DATA_DIR"/backups/store-*.json 2>/dev/null | head -8)
  do
    [ -f "$CAND" ] || continue
    N=$(python3 -c "import json,sys; s=json.load(open(sys.argv[1])); print(len(s.get('products') or []))" "$CAND" 2>/dev/null || echo 0)
    log "   aday $CAND products=$N"
    if [ "${N:-0}" -gt "$BEST_N" ]; then BEST="$CAND"; BEST_N="$N"; fi
  done
  if [ -n "$BEST" ] && [ "$BEST_N" -gt 100 ]; then
    cp -a "$DATA_DIR/store.json" "$DATA_DIR/store.json.bak-empty-$(date +%Y%m%d-%H%M%S)" 2>/dev/null || true
    cp -a "$BEST" "$DATA_DIR/store.json"
    log "   RESTORE $BEST ($BEST_N urun)"
    pm2 restart atak --update-env >/dev/null 2>&1 || true
    sleep 4
    H1=$(curl -sS -m 8 http://127.0.0.1:3100/health 2>/dev/null || true)
    log "HEALTH_AFTER_RESTORE=$H1"
  else
    log "FAIL: dolu yedek bulunamadi (productCount=0). Elle restore gerekli."
    die "productCount=0 ve yedek yok"
  fi
fi
echo "$H1" | grep -q '"productCount":0' && die "productCount hala 0"

log "5) panel HTML"
HTML=$(curl -sS -m 12 https://panel.atakhome.com.tr/web-admin || true)
echo "$HTML" | grep -q 'purchaseBothBtn\|Fatura Ve Stok Aktarım' || die "panel HTML Asist butonu yok — Ctrl+Shift+R deneyin"
log "=== BASARILI: Asist alis paneli yayinda ($EXPECT_V) ==="
log "Panel: https://panel.atakhome.com.tr/web-admin → Alış Faturaları"
log "Log: $OUT"
