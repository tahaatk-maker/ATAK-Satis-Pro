#!/bin/bash
# Asist fatura+stok paneli — sadece ERP (atak). Vitrin/commerce'e DOKUNMAZ.
# data/store.json ASLA değiştirilmez / restore edilmez.
# Hostinger Web Terminal:
#   curl -fsSL "https://raw.githubusercontent.com/tahaatk-maker/ATAK-Satis-Pro/cursor/satis-fatura-oncelik-474e/atak_finans_server_json/atak%20g%C3%BCncelll/public/assets/vps-deploy-asist.sh" | bash
set -euo pipefail
OUT=/tmp/atak-asist-deploy.txt
: > "$OUT"
log(){ echo "$*" | tee -a "$OUT"; }
die(){ log "FAIL: $*"; exit 1; }

BRANCH="${ATAK_BRANCH:-cursor/satis-fatura-oncelik-474e}"
EXPECT_V="${EXPECT_HEALTH:-6.3.265-eva-normal}"
EXPECT_B="${EXPECT_BUILD:-fix-v268}"

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
grep -q "ATAK_FATURA_BUILD=$EXPECT_B" "$SRC/public/assets/fatura.js" || die "kaynak fatura build yanlis"
grep -q 'purchaseBothBtn' "$SRC/public/admin.html" || die "Asist butonu kaynakta yok"
grep -q "staff-send-login" "$SRC/server.js" || die "kaynakta sifre API yok"
[ -f "$SRC/lib/session-actor.js" ] || die "kaynakta session-actor yok"
[ -f "$SRC/lib/stock-decrease.js" ] || die "kaynakta stock-decrease yok"
[ -f "$SRC/lib/digital-planet.js" ] || die "kaynakta digital-planet yok"
grep -q "staffMailSendPassBtn" "$SRC/public/admin.html" || die "kaynakta sifre butonu yok"
log "   kaynak OK"

copy_critical(){
  local D="$1"
  mkdir -p "$D/public/assets" "$D/lib"
  cp -f "$SRC/server.js" "$D/server.js"
  cp -f "$SRC/public/admin.html" "$D/public/admin.html"
  cp -f "$SRC/public/assets/admin.js" "$D/public/assets/admin.js"
  cp -f "$SRC/public/assets/admin.css" "$D/public/assets/admin.css"
  [ -f "$SRC/public/personel.html" ] && cp -f "$SRC/public/personel.html" "$D/public/personel.html"
  [ -f "$SRC/public/assets/personel.js" ] && cp -f "$SRC/public/assets/personel.js" "$D/public/assets/personel.js"
  [ -f "$SRC/public/assets/personel-shell.css" ] && cp -f "$SRC/public/assets/personel-shell.css" "$D/public/assets/personel-shell.css"
  [ -f "$SRC/public/fatura.html" ] && cp -f "$SRC/public/fatura.html" "$D/public/fatura.html"
  [ -f "$SRC/public/assets/fatura.js" ] && cp -f "$SRC/public/assets/fatura.js" "$D/public/assets/fatura.js"
  [ -f "$SRC/public/assets/fatura.css" ] && cp -f "$SRC/public/assets/fatura.css" "$D/public/assets/fatura.css"
  [ -f "$SRC/lib/purchase-csv.js" ] && mkdir -p "$D/lib" && cp -f "$SRC/lib/purchase-csv.js" "$D/lib/purchase-csv.js"
  [ -f "$SRC/lib/istikbal-category.js" ] && cp -f "$SRC/lib/istikbal-category.js" "$D/lib/istikbal-category.js"
  [ -f "$SRC/lib/stock-cost.js" ] && cp -f "$SRC/lib/stock-cost.js" "$D/lib/stock-cost.js"
  [ -f "$SRC/lib/staff-email.js" ] && cp -f "$SRC/lib/staff-email.js" "$D/lib/staff-email.js"
  [ -f "$SRC/lib/session-actor.js" ] && cp -f "$SRC/lib/session-actor.js" "$D/lib/session-actor.js"
  [ -f "$SRC/lib/stock-decrease.js" ] && cp -f "$SRC/lib/stock-decrease.js" "$D/lib/stock-decrease.js"
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
  grep -q "staff-send-login" "$D/server.js" || die "disk sifre API yok: $D"
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

log "3) atak yeniden baslat (store dokunulmaz)"
START_DIR="$APP"
[ -f "$START_DIR/server.js" ] || die "start dir server.js yok: $START_DIR"
grep -q "staff-send-login" "$START_DIR/server.js" || die "start dir sifre API yok"
log "3100 ONCE: $(ss -lntp 2>/dev/null | grep 3100 || echo yok)"
cd "$START_DIR"
pm2 delete atak >/dev/null 2>&1 || true
sleep 1
# Eski node 3100'u birakmazsa yeni process crash loop yapar; health 6.3.256 kalir.
for i in 1 2 3 4 5 6; do
  p=$(ss -lntp 2>/dev/null | grep ':3100' | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2 || true)
  [ -n "$p" ] || break
  args=$(ps -o args= -p "$p" 2>/dev/null || true)
  case "$args" in *atakhome-web*|*atakhome-commerce*) log "SKIP 3100 pid=$p $args"; break ;; esac
  log "KILL 3100 pid=$p $args"
  kill "$p" 2>/dev/null || true
  sleep 1
  kill -9 "$p" 2>/dev/null || true
  sleep 1
done
ss -lntp 2>/dev/null | grep -q ':3100' && die "3100 hala dolu"
pm2 start "$START_DIR/server.js" --name atak --cwd "$START_DIR" --update-env || die "pm2 start fail"
pm2 save >/dev/null 2>&1 || true
sleep 6
pm2 describe atak | grep -E 'status|script path|exec cwd|unstable|restarts|pid' || true

log "4) health"
H1=$(curl -sS -m 10 http://127.0.0.1:3100/health 2>/dev/null || true)
log "HEALTH=$H1"
echo "$H1" | grep -q "$EXPECT_V" || die "health version yok — pm2 cwd yanlis olabilir"
echo "$H1" | grep -q "$EXPECT_B" || die "health build yok"

log "4b) sifre API (404 olmamali)"
SL_CODE=$(curl -sS -m 8 -o /tmp/atak-sl.body -w "%{http_code}" -X POST http://127.0.0.1:3100/web-api/admin/staff-send-login -H "Content-Type: application/json" -d "{}" || true)
log "STAFF_SEND_LOGIN_HTTP=$SL_CODE body=$(head -c 180 /tmp/atak-sl.body 2>/dev/null || true)"
[ "$SL_CODE" = "404" ] && die "sifre API hala 404 — yanlis server.js calisiyor"
[ "$SL_CODE" = "000" ] && die "sifre API yanit yok"

log "5) panel HTML"
HTML=$(curl -sS -m 12 https://panel.atakhome.com.tr/web-admin || true)
echo "$HTML" | grep -q 'purchaseBothBtn\|Fatura Ve Stok Aktarım' || die "panel HTML Asist butonu yok — Ctrl+Shift+R"
log "=== BASARILI: Asist yayinda ($EXPECT_V) — store dokunulmadi ==="
log "Log: $OUT"
