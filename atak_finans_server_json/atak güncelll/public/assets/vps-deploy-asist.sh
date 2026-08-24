#!/bin/bash
# Asist fatura+stok paneli — sadece ERP (atak). Vitrin/commerce'e DOKUNMAZ.
# data/store.json ASLA değiştirilmez / restore edilmez.
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
log "NOT: store.json / ürün yedegi DOKUNULMAZ"

# PM2 atak: cwd + script
PM_CWD=""; PM_SCRIPT=""
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
[ -n "$APP" ] || APP=/root/atakhome-platform
[ -d "$APP" ] || APP=/root/atak-v10
log "PM_CWD=${PM_CWD:-?} PM_SCRIPT=${PM_SCRIPT:-?}"
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
log "   kaynak OK"

copy_critical(){
  local D="$1"
  mkdir -p "$D/public/assets" "$D/lib"
  cp -f "$SRC/server.js" "$D/server.js"
  cp -f "$SRC/public/admin.html" "$D/public/admin.html"
  cp -f "$SRC/public/assets/admin.js" "$D/public/assets/admin.js"
  cp -f "$SRC/public/assets/admin.css" "$D/public/assets/admin.css"
  [ -f "$SRC/lib/purchase-csv.js" ] && mkdir -p "$D/lib" && cp -f "$SRC/lib/purchase-csv.js" "$D/lib/purchase-csv.js"
  [ -f "$SRC/lib/istikbal-category.js" ] && cp -f "$SRC/lib/istikbal-category.js" "$D/lib/istikbal-category.js"
  [ -f "$SRC/lib/stock-cost.js" ] && cp -f "$SRC/lib/stock-cost.js" "$D/lib/stock-cost.js"
}

log "2) kopyala (data / node_modules / .env dokunulmaz — store ASLA kopyalanmaz)"
SYNCED=0
SEEN_LIST=""
for D in "$APP" "${PM_CWD:-}" /root/atakhome-platform /root/atak-v10; do
  [ -n "$D" ] && [ -d "$D" ] || continue
  case " $SEEN_LIST " in *" $D "*) continue ;; esac
  SEEN_LIST="$SEEN_LIST $D"
  case "$D" in *commerce*|*checkout*|*vitrin*) log "SKIP_SHOP $D"; continue ;; esac
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --exclude data --exclude node_modules --exclude .env --exclude '*.bak-*' "$SRC"/ "$D"/
  fi
  copy_critical "$D"
  grep -q "$EXPECT_V" "$D/server.js" || die "disk version yanlis: $D"
  log "   SYNCED $D"
  SYNCED=$((SYNCED+1))
done
[ "$SYNCED" -gt 0 ] || die "ERP klasoru bulunamadi"

if [ -n "${PM_SCRIPT:-}" ] && [ -f "$PM_SCRIPT" ]; then
  case "$PM_SCRIPT" in
    *.js)
      cp -f "$SRC/server.js" "$PM_SCRIPT"
      grep -q "$EXPECT_V" "$PM_SCRIPT" || die "PM_SCRIPT version yanlis"
      log "   PM_SCRIPT OK"
      ;;
  esac
fi

log "3) sadece atak restart (store dokunulmaz)"
START_DIR="$APP"
[ -f "$START_DIR/server.js" ] || die "start dir server.js yok: $START_DIR"
pm2 restart atak --update-env || {
  cd "$START_DIR"
  pm2 start server.js --name atak --update-env || die "pm2 start fail"
}
pm2 save >/dev/null 2>&1 || true
sleep 4

log "4) health"
H1=$(curl -sS -m 10 http://127.0.0.1:3100/health 2>/dev/null || true)
log "HEALTH=$H1"
echo "$H1" | grep -q "$EXPECT_V" || die "health version yok"
echo "$H1" | grep -q "$EXPECT_B" || die "health build yok"

log "5) panel HTML"
HTML=$(curl -sS -m 12 https://panel.atakhome.com.tr/web-admin || true)
echo "$HTML" | grep -q 'purchaseBothBtn\|Fatura Ve Stok Aktarım' || die "panel HTML Asist butonu yok — Ctrl+Shift+R"
log "=== BASARILI: Asist yayinda ($EXPECT_V) — store dokunulmadi ==="
log "Log: $OUT"
