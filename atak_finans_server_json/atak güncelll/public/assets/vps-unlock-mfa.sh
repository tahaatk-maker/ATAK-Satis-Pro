#!/bin/bash
# Acil: giriş kodu kilidini kapat (SMTP olmadan admin girişi)
set -euo pipefail
OUT=/tmp/atak-unlock.txt
: > "$OUT"
log(){ echo "$*" | tee -a "$OUT"; }
die(){ log "FAIL: $*"; exit 1; }

log "=== ATAK MFA UNLOCK ==="
APP=""
for D in /root/atak-v10 /root/atakhome-platform /root/atak; do
  if [ -f "$D/server.js" ]; then APP="$D"; break; fi
done
[ -n "$APP" ] || die "uygulama klasoru bulunamadi"
log "APP=$APP"
cd "$APP"

touch .env
if grep -q '^ATAK_MFA_ENABLED=' .env; then
  sed -i 's/^ATAK_MFA_ENABLED=.*/ATAK_MFA_ENABLED=0/' .env
else
  echo 'ATAK_MFA_ENABLED=0' >> .env
fi
log "ATAK_MFA_ENABLED=0 yazildi"
grep '^ATAK_MFA_ENABLED=' .env | tee -a "$OUT"

pm2 restart atak --update-env || die "pm2 restart fail"
sleep 2
H=$(curl -sS http://127.0.0.1:3100/health 2>/dev/null || curl -sS https://panel.atakhome.com.tr/health 2>/dev/null || echo '{}')
log "HEALTH=$H"
echo "$H" | grep -q '"mfa":false' && log "=== BASARILI: simdi sifreyle girin ===" || log "UYARI: mfa hala true olabilir — pm2 log atak --lines 30"
cat "$OUT"
