#!/bin/bash
# Kısa adres — Hostinger terminale yalnız bu dosyanın curl satırını yapıştırın.
set -euo pipefail
URL="https://raw.githubusercontent.com/tahaatk-maker/ATAK-Satis-Pro/cursor/fatura-ayri-sekme-474e/atak_finans_server_json/atak%20g%C3%BCncelll/public/assets/vps-fix.sh"
echo "ATAK deploy basliyor..."
curl -fsSL "$URL" | bash
