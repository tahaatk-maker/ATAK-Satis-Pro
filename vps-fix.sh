#!/bin/bash
# Hostinger: once "echo BASLIYOR" gorunmeli. Sessiz curl | bash IPv6'da takilabiliyor.
set -euo pipefail
echo "ATAK deploy basliyor $(date -Is)"
INNER=/tmp/atak-inner-vps-fix.sh
curl_get(){
  curl -4 -fL --connect-timeout 20 --max-time 120 --retry 2 --retry-delay 2 --progress-bar "$@"
}
echo "Asil script indiriliyor..."
if ! curl_get -o "$INNER" "https://github.com/tahaatk-maker/ATAK-Satis-Pro/raw/cursor/fatura-ayri-sekme-474e/atak_finans_server_json/atak%20g%C3%BCncelll/public/assets/vps-fix.sh"; then
  echo "github.com olmadi, raw.githubusercontent deneniyor"
  curl_get -o "$INNER" "https://raw.githubusercontent.com/tahaatk-maker/ATAK-Satis-Pro/cursor/fatura-ayri-sekme-474e/atak_finans_server_json/atak%20g%C3%BCncelll/public/assets/vps-fix.sh"
fi
echo "Script indi $(wc -c < "$INNER") byte"
bash "$INNER"
