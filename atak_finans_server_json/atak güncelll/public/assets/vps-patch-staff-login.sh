#!/bin/bash
# Sifre-mail API: 3100'u tutan ESKI node'u oldurur, yeni server.js baslatir.
# store.json / musteri / stok DOKUNULMAZ. atakhome-web ve commerce DOKUNULMAZ.
#   curl -fsSL "https://raw.githubusercontent.com/tahaatk-maker/ATAK-Satis-Pro/cursor/satis-fatura-oncelik-474e/atak_finans_server_json/atak%20g%C3%BCncelll/public/assets/vps-patch-staff-login.sh" | bash
set -euo pipefail
BRANCH="${ATAK_BRANCH:-cursor/satis-fatura-oncelik-474e}"
EXPECT="6.3.264-satis-fatura"
log(){ echo "$*"; }
die(){
  echo "FAIL: $*"
  echo "---- pm2 atak logs ----"
  pm2 logs atak --lines 80 --nostream 2>/dev/null || true
  echo "---- 3100 ----"
  ss -lntp 2>/dev/null | grep 3100 || netstat -lntp 2>/dev/null | grep 3100 || true
  echo "---- disk version ----"
  grep -n "version:'" /root/atakhome-platform/server.js /root/atak-v10/server.js 2>/dev/null | head
  exit 1
}

log "=== PATCH STAFF LOGIN API $(date -Is) ==="
log "store.json DOKUNULMAZ — store.json bir komut degil, veri dosyasidir"
log "ONCEKI HEALTH=$(curl -sS -m 8 http://127.0.0.1:3100/health 2>/dev/null | head -c 220)"
log "3100 SIMDI: $(ss -lntp 2>/dev/null | grep 3100 || echo yok)"

PM_CWD=""
if command -v pm2 >/dev/null && command -v python3 >/dev/null; then
  PM_CWD=$(pm2 jlist 2>/dev/null | python3 -c 'import sys,json
try:
 d=json.load(sys.stdin)
 p=next((x for x in d if x.get("name")=="atak"),None)
 print(((p or {}).get("pm2_env") or {}).get("pm_cwd") or "")
except Exception:
 print("")' || true)
fi
log "PM2_CWD=${PM_CWD:-bos}"

rm -rf /tmp/atak-patch-src /tmp/atak-patch.tgz
mkdir -p /tmp/atak-patch-src
curl -4 -fL --connect-timeout 20 --max-time 120 \
  "https://codeload.github.com/tahaatk-maker/ATAK-Satis-Pro/tar.gz/refs/heads/${BRANCH}" \
  -o /tmp/atak-patch.tgz || die "github indirilemedi"
tar -xzf /tmp/atak-patch.tgz -C /tmp/atak-patch-src
SRC=$(find /tmp/atak-patch-src -type d -name 'atak güncelll' | head -1)
[ -n "$SRC" ] && [ -f "$SRC/server.js" ] || die "kaynak server.js yok"
grep -q "$EXPECT" "$SRC/server.js" || die "kaynak surum yanlis"
grep -q "staff-send-login" "$SRC/server.js" || die "kaynakta API yok"
[ -f "$SRC/lib/session-actor.js" ] || die "kaynakta session-actor yok"
[ -f "$SRC/lib/digital-planet.js" ] || die "kaynakta digital-planet yok"
log "SRC=$SRC"

copy_one(){
  local D="$1"
  [ -d "$D" ] || return 0
  mkdir -p "$D/public/assets" "$D/lib"
  cp -f "$SRC/server.js" "$D/server.js"
  cp -f "$SRC/public/admin.html" "$D/public/admin.html"
  cp -f "$SRC/public/assets/admin.js" "$D/public/assets/admin.js"
  [ -f "$SRC/public/personel.html" ] && cp -f "$SRC/public/personel.html" "$D/public/personel.html"
  [ -f "$SRC/public/assets/personel.js" ] && cp -f "$SRC/public/assets/personel.js" "$D/public/assets/personel.js"
  [ -f "$SRC/public/assets/personel-shell.css" ] && cp -f "$SRC/public/assets/personel-shell.css" "$D/public/assets/personel-shell.css"
  [ -f "$SRC/public/fatura.html" ] && cp -f "$SRC/public/fatura.html" "$D/public/fatura.html"
  [ -f "$SRC/public/assets/fatura.js" ] && cp -f "$SRC/public/assets/fatura.js" "$D/public/assets/fatura.js"
  [ -f "$SRC/public/assets/fatura.css" ] && cp -f "$SRC/public/assets/fatura.css" "$D/public/assets/fatura.css"
  cp -a "$SRC/lib/." "$D/lib/"
  [ -f "$SRC/qnb-solist-adapter.js" ] && cp -f "$SRC/qnb-solist-adapter.js" "$D/qnb-solist-adapter.js"
  [ -f "$SRC/customer-excel-import.js" ] && cp -f "$SRC/customer-excel-import.js" "$D/customer-excel-import.js"
  grep -q "staff-send-login" "$D/server.js" || die "kopya API yok: $D"
  grep -q "$EXPECT" "$D/server.js" || die "kopya surum yanlis: $D"
  log "COPIED $D  $(grep -o "version:'[^']*'" "$D/server.js" | head -1)  $(wc -c < "$D/server.js") bytes"
}

copy_one "$PM_CWD"
copy_one /root/atakhome-platform
copy_one /root/atak-v10

START="${PM_CWD:-/root/atakhome-platform}"
[ -f "$START/server.js" ] || START=/root/atakhome-platform
[ -f "$START/server.js" ] || START=/root/atak-v10
grep -q "$EXPECT" "$START/server.js" || die "start dir surum yanlis"
log "START=$START disk=$(grep -o "version:'[^']*'" "$START/server.js" | head -1)"

kill_3100(){
  local i p args
  for i in 1 2 3 4 5 6; do
    p=$(ss -lntp 2>/dev/null | grep ':3100' | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2 || true)
    if [ -z "$p" ] && command -v fuser >/dev/null; then
      p=$(fuser 3100/tcp 2>/dev/null | awk '{print $NF}' | head -1 || true)
    fi
    [ -n "$p" ] || return 0
    args=$(ps -o args= -p "$p" 2>/dev/null | head -c 200 || true)
    case "$args" in
      *atakhome-web*|*atakhome-commerce*|*commerce*)
        log "SKIP kill pid=$p (shop): $args"
        return 0
        ;;
    esac
    log "KILL 3100 pid=$p $args"
    kill "$p" 2>/dev/null || true
    sleep 1
    kill -9 "$p" 2>/dev/null || true
    sleep 1
  done
}

log "pm2 delete atak + 3100 serbest"
pm2 delete atak >/dev/null 2>&1 || true
sleep 1
kill_3100
if ss -lntp 2>/dev/null | grep -q ':3100'; then
  die "3100 hala dolu — eski node olmedi"
fi
log "3100 BOS"

cd "$START"
pm2 start "$START/server.js" --name atak --cwd "$START" --update-env || die "pm2 start fail"
pm2 save >/dev/null 2>&1 || true
sleep 6
pm2 describe atak | grep -E 'status|script path|exec cwd|unstable|restarts|pid' || true
pm2 list

H=$(curl -sS -m 10 http://127.0.0.1:3100/health || true)
log "SONRA HEALTH=$H"
echo "$H" | grep -q "$EXPECT" || die "health hala eski (3100 eski process). admin.js yine de kopyalandi — panelde Ctrl+F5: sifre butonu sifirlama linki dener. SMTP: smtp.hostinger.com"

CODE=$(curl -sS -m 8 -o /tmp/atak-sl.body -w "%{http_code}" -X POST http://127.0.0.1:3100/web-api/admin/staff-send-login -H "Content-Type: application/json" -d "{}" || true)
log "POST /web-api/admin/staff-send-login HTTP=$CODE $(head -c 160 /tmp/atak-sl.body 2>/dev/null)"
[ "$CODE" = "404" ] && die "hala 404"
[ "$CODE" = "000" ] && die "yanit yok"
log "=== BASARILI: sifre API acik (HTTP $CODE, 401/400 normal) ==="
log "Panel: Ctrl+F5 sonra Kullanicilar → sifre gonder"
log "store.json calistirmayin — o bir dosya, komut degil"
