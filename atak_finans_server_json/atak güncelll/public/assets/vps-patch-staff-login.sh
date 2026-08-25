#!/bin/bash
# Sadece calisan ERP'ye sifre-mail API'sini koyar. store.json DOKUNULMAZ.
#   curl -fsSL "https://raw.githubusercontent.com/tahaatk-maker/ATAK-Satis-Pro/cursor/asist-fatura-aktarim-474e/atak_finans_server_json/atak%20g%C3%BCncelll/public/assets/vps-patch-staff-login.sh" | bash
set -euo pipefail
BRANCH="${ATAK_BRANCH:-cursor/asist-fatura-aktarim-474e}"
EXPECT="6.3.258-staff-mail"
log(){ echo "$*"; }
die(){ echo "FAIL: $*"; exit 1; }

log "=== PATCH STAFF LOGIN API $(date -Is) ==="
log "store.json DOKUNULMAZ — sadece server.js + admin paneli kopyalanir"
log "ONCEKI HEALTH=$(curl -sS -m 8 http://127.0.0.1:3100/health 2>/dev/null | head -c 220)"

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
log "SRC=$SRC"

copy_one(){
  local D="$1"
  [ -d "$D" ] || return 0
  mkdir -p "$D/public/assets" "$D/lib"
  cp -f "$SRC/server.js" "$D/server.js"
  cp -f "$SRC/public/admin.html" "$D/public/admin.html"
  cp -f "$SRC/public/assets/admin.js" "$D/public/assets/admin.js"
  [ -f "$SRC/lib/staff-email.js" ] && cp -f "$SRC/lib/staff-email.js" "$D/lib/staff-email.js"
  grep -q "staff-send-login" "$D/server.js" || die "kopya API yok: $D"
  log "COPIED $D  $(grep -o "version:'[^']*'" "$D/server.js" | head -1)"
}

copy_one "$PM_CWD"
copy_one /root/atakhome-platform
copy_one /root/atak-v10

START="${PM_CWD:-/root/atakhome-platform}"
[ -f "$START/server.js" ] || START=/root/atakhome-platform
[ -f "$START/server.js" ] || START=/root/atak-v10
grep -q "staff-send-login" "$START/server.js" || die "start dir API yok"
log "START=$START"

cd "$START"
pm2 delete atak >/dev/null 2>&1 || true
sleep 1
pm2 start server.js --name atak --update-env || die "pm2 start fail"
pm2 save >/dev/null 2>&1 || true
sleep 5

H=$(curl -sS -m 10 http://127.0.0.1:3100/health || true)
log "SONRA HEALTH=$H"
echo "$H" | grep -q "$EXPECT" || die "health hala eski — calisan process yeni server.js degil"

CODE=$(curl -sS -m 8 -o /tmp/atak-sl.body -w "%{http_code}" -X POST http://127.0.0.1:3100/web-api/admin/staff-send-login -H "Content-Type: application/json" -d "{}" || true)
log "POST /web-api/admin/staff-send-login HTTP=$CODE $(head -c 160 /tmp/atak-sl.body 2>/dev/null)"
[ "$CODE" = "404" ] && die "hala 404"
[ "$CODE" = "000" ] && die "yanit yok"
log "=== BASARILI: sifre API acik (HTTP $CODE, 401/400 normal) ==="
log "Panel: Ctrl+F5 sonra Kullanicilar → sifre gonder"
