#!/bin/bash
set -euo pipefail
echo "=== ATAK BASIT DEPLOY BASLADI ==="
BRANCH="cursor/satis-merkezi-iskonto-prim-bd99"
EXPECT_V="6.3.71-finans-raporlari"
EXPECT_B="fix-v70"
APP="${APP_DIR:-/root/atak-v10}"

echo "1) Eski /tmp temiz"
rm -rf /tmp/atak-deploy-src /tmp/atak-src.tgz
mkdir -p /tmp/atak-deploy-src

echo "2) Kod indir"
curl -fL "https://codeload.github.com/tahaatk-maker/ATAK-Satis-Pro/tar.gz/refs/heads/${BRANCH}" -o /tmp/atak-src.tgz
tar -xzf /tmp/atak-src.tgz -C /tmp/atak-deploy-src
SRC=$(find /tmp/atak-deploy-src -type d -name 'atak güncelll' | head -1)
echo "SRC=$SRC"
test -f "$SRC/server.js"
test -f "$SRC/public/assets/admin.js"

echo "3) Kaynak surum kontrol"
head -1 "$SRC/public/assets/admin.js"
grep -E "version:|build:" "$SRC/server.js" | head -2
grep -q "$EXPECT_B" "$SRC/public/assets/admin.js"
grep -q "$EXPECT_V" "$SRC/server.js"
grep -q "build:'$EXPECT_B'" "$SRC/server.js"
echo "   kaynak OK"

echo "4) Yedek + kopyala (data dokunulmaz)"
mkdir -p "$APP/data" "$APP/public/assets"
if [ -f "$APP/data/store.json" ]; then
  cp -a "$APP/data/store.json" "$APP/data/store.json.bak-$(date +%Y%m%d-%H%M%S)"
  echo "   store.json yedeklendi"
fi
# Tum olasi app koklerine yaz
for D in "$APP" /root/atak-v10 /root/atakhome-platform; do
  [ -d "$D" ] || continue
  echo "   SYNC -> $D"
  rsync -a --delete --exclude data --exclude node_modules --exclude .env --exclude '*.bak-*' "$SRC"/ "$D"/
  # Zorla kritik dosyalar
  cp -f "$SRC/server.js" "$D/server.js"
  cp -f "$SRC/public/admin.html" "$D/public/admin.html"
  cp -f "$SRC/public/assets/admin.js" "$D/public/assets/admin.js"
  cp -f "$SRC/public/assets/admin.css" "$D/public/assets/admin.css"
done

echo "5) Disk kontrol ($APP)"
head -1 "$APP/public/assets/admin.js"
grep -E "version:|build:" "$APP/server.js" | head -2
grep -q "$EXPECT_V" "$APP/server.js"
grep -q "build:'$EXPECT_B'" "$APP/server.js"
grep -q "ATAK_ADMIN_BUILD=$EXPECT_B" "$APP/public/assets/admin.js"
echo "   disk OK"

echo "6) Port 3100 temizle + pm2 yeniden"
pm2 delete atak 2>/dev/null || true
sleep 1
# eski process kaldiysa oldur
for P in 3100 3000; do
  PID=$(ss -lntp 2>/dev/null | awk -v p=":$P" '$4 ~ p{print}' | sed -n 's/.*pid=\([0-9]*\).*/\1/p' | head -1 || true)
  if [ -n "${PID:-}" ]; then
    echo "   kill pid $PID on $P"
    kill -9 "$PID" 2>/dev/null || true
  fi
done
sleep 1
cd "$APP"
pm2 start "$APP/server.js" --name atak --cwd "$APP" --update-env
pm2 save || true
sleep 3

echo "7) Health"
H1=$(curl -sS -m 5 http://127.0.0.1:3100/health || true)
H2=$(curl -sS -m 5 https://panel.atakhome.com.tr/health || true)
echo "LOCAL  $H1"
echo "PUBLIC $H2"
echo "$H1" | grep -q "$EXPECT_V"
echo "$H1" | grep -q "$EXPECT_B"
echo "=== BASARILI: $EXPECT_V / $EXPECT_B ==="
echo "Tarayicida Ctrl+Shift+R yap"
