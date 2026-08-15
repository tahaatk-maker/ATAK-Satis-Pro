# ATAK VPS kesin deploy (fix-v89) — health 6.3.90-mobilya-alis-v2 olmadan DONE yazmaz
set -euo pipefail
BRANCH="${ATAK_BRANCH:-cursor/satis-merkezi-iskonto-prim-bd99}"
EXPECT_HEALTH=6.3.119-eski-duzen
EXPECT_BUILD=fix-v119
TMP=/tmp/atak-fix-$(date +%s)
OUT=/tmp/atak-deploy-result.txt

STEP="baslangic"
trap 'code=$?; echo ""; echo "HATA: islem durdu (exit=$code)"; echo "Son adim: $STEP"; echo "Log: $OUT"; exit $code' ERR
step(){ STEP="$1"; echo "-- $1"; }

echo "START $(date -Is)"
echo "EXPECT $EXPECT_HEALTH / $EXPECT_BUILD"
echo "BRANCH $BRANCH"
echo "BASH=${BASH_VERSION:-unknown}"

step "gerekli araclar kontrol ediliyor"
install_pkg(){
  echo "   kuruluyor: $1"
  (apt-get update -y >/dev/null 2>&1 && apt-get install -y "$1" >/dev/null 2>&1) \
    || yum install -y "$1" >/dev/null 2>&1 \
    || dnf install -y "$1" >/dev/null 2>&1 \
    || true
}
for BIN in curl tar python3 rsync; do
  if command -v "$BIN" >/dev/null 2>&1; then
    echo "   ok: $BIN"
  else
    echo "   eksik: $BIN"
    install_pkg "$BIN"
    if command -v "$BIN" >/dev/null 2>&1; then echo "   kuruldu: $BIN"; else echo "   KURULAMADI: $BIN"; fi
  fi
done
for BIN in curl tar; do
  if ! command -v "$BIN" >/dev/null 2>&1; then
    echo "ZORUNLU ARAC YOK: $BIN — once 'apt-get install -y $BIN' calistirin"; exit 1
  fi
done
HAVE_RSYNC=0; command -v rsync >/dev/null 2>&1 && HAVE_RSYNC=1
HAVE_PY=0; command -v python3 >/dev/null 2>&1 && HAVE_PY=1
echo "   rsync=$HAVE_RSYNC python3=$HAVE_PY"

step "kaynak indiriliyor"
mkdir -p "$TMP" && cd "$TMP"
BRANCH_URLENC=${BRANCH//\//%2F}
if ! curl -fsSL "https://codeload.github.com/tahaatk-maker/ATAK-Satis-Pro/tar.gz/refs/heads/$BRANCH" -o src.tgz; then
  echo "   ana adres olmadi, alternatif deneniyor"
  curl -fsSL "https://codeload.github.com/tahaatk-maker/ATAK-Satis-Pro/tar.gz/$BRANCH_URLENC" -o src.tgz
fi
tar -xzf src.tgz
SRC=$(find "$TMP" -type d -name 'atak güncelll' | head -1)
if [ -z "${SRC:-}" ]; then echo "KAYNAK KLASOR BULUNAMADI"; ls -la "$TMP"; exit 1; fi

step "surum dogrulaniyor"
check(){
  local msg="$1"; shift
  if "$@" >/dev/null 2>&1; then echo "   ok: $msg"; else echo "   HATALI: $msg"; return 1; fi
}
check "server.js var" test -f "$SRC/server.js"
check "admin.html var" test -f "$SRC/public/admin.html"
check "health $EXPECT_HEALTH" grep -q "$EXPECT_HEALTH" "$SRC/server.js"
check "admin build $EXPECT_BUILD" grep -q "ATAK_ADMIN_BUILD=$EXPECT_BUILD" "$SRC/public/assets/admin.js"
check "personel build $EXPECT_BUILD" grep -q "ATAK_PERSONEL_BUILD=$EXPECT_BUILD" "$SRC/public/assets/personel.js"
check "admin odeme plani" grep -q 'id="salesPayPlanToggleBtn"' "$SRC/public/admin.html"
check "personel odeme plani" grep -q 'id="salesPayPlanToggleBtn"' "$SRC/public/personel.html"
check "e-fatura kesilmeyen sekmesi" grep -q 'data-inv-module="pending"' "$SRC/public/admin.html"
check "admin cache $EXPECT_BUILD" grep -q "admin.js?v=$EXPECT_BUILD" "$SRC/public/admin.html"
check "personel cache $EXPECT_BUILD" grep -q "personel.js?v=$EXPECT_BUILD" "$SRC/public/personel.html"
check "senet resmi unvan" grep -q "ATAK EV GEREÇLERİ PAZ. TİC. LTD. ŞTİ." "$SRC/public/assets/admin.js"
check "senet Ferahevler adres" grep -q "Ferahevler Mah. Adnan Kahveci Cad. No:109" "$SRC/public/assets/admin.js"
if grep -n "companyLegal=cfg.creditorName\|companyLegal=.*Atak Home\|address='Tarabya" "$SRC/public/assets/admin.js" "$SRC/public/assets/personel.js" "$SRC/server.js" >/dev/null 2>&1; then
  echo "   HATALI: senet sablonunda Atak Home / Tarabya / creditorName kalintisi var"; exit 1
fi
echo "   ok: senet sablonunda Atak Home yok"
if grep -q "companyLegal=cfg.creditorName" "$SRC/public/assets/admin.js"; then
  echo "   HATALI: senet hâlâ creditorName/Atak Home kullanıyor"; exit 1
fi
echo "   ok: senette Atak Home yok (sabit resmi unvan)"
check "yeni personel arayuzu" grep -q 'personel-shell.css' "$SRC/public/personel.html"
check "kokpit css" test -f "$SRC/public/assets/admin-cockpit.css"
check "kokpit api" grep -q 'dashboard-cockpit' "$SRC/server.js"
check "kiosk personel kartlari" grep -q 'modules kiosk' "$SRC/public/personel.html"
if grep -q 'data-finance-jump="uninvoiced"' "$SRC/public/admin.html"; then
  echo "   HATALI: Finans menusunde Kesilmeyen hala var"; exit 1
fi
echo "   ok: Finans menusunde Kesilmeyen yok"
echo "SRC_OK=$SRC"
echo "SRC_ADMIN_MD5=$(md5sum "$SRC/public/assets/admin.js" | awk '{print $1}')"
echo "SRC_HTML_MD5=$(md5sum "$SRC/public/admin.html" | awk '{print $1}')"

step "uygulama klasoru bulunuyor"
APP=""
if [ "$HAVE_PY" = "1" ]; then
  APP=$(pm2 jlist 2>/dev/null | python3 -c 'import sys,json
try:
 d=json.load(sys.stdin)
 p=next((x for x in d if x.get("name")=="atak"),None)
 print((p or {}).get("pm2_env",{}).get("pm_cwd") or "")
except Exception:
 print("")' || true)
fi
[ -n "$APP" ] || APP=/root/atak-v10
echo "APP=$APP"

mapfile -t DIRS < <(
  {
    echo "$APP"
    echo /root/atak-v10
    echo /root/atakhome-platform
    find /root /var/www /home -maxdepth 4 -type f -name server.js 2>/dev/null | while read -r f; do
      d=$(dirname "$f")
      if [ -f "$d/public/admin.html" ] || [ -d "$d/public/assets" ]; then echo "$d"; fi
    done
  } | awk 'NF && !seen[$0]++'
)

step "dosyalar kopyalaniyor"
SYNCED=0
for D in "${DIRS[@]}"; do
  [ -d "$D" ] || continue
  mkdir -p "$D/public/assets" "$D/data"
  if [ -f "$D/data/store.json" ]; then
    cp -a "$D/data/store.json" "$D/data/store.json.bak-$(date +%Y%m%d-%H%M%S)"
  fi
  if [ "$HAVE_RSYNC" = "1" ]; then
    rsync -a --delete --exclude data --exclude node_modules --exclude .env --exclude '*.bak-*' "$SRC"/ "$D"/
  else
    # rsync yoksa: veri ve node_modules haric elle kopyala
    find "$SRC" -mindepth 1 -maxdepth 1 ! -name data ! -name node_modules ! -name .env -print0 \
      | while IFS= read -r -d '' item; do
          rm -rf "$D/$(basename "$item")"
          cp -a "$item" "$D"/
        done
  fi
  echo "   SYNCED $D admin_md5=$(md5sum "$D/public/assets/admin.js" | awk '{print $1}')"
  SYNCED=$((SYNCED+1))
done
[ "$SYNCED" -gt 0 ] || { echo "NO_DIRS"; exit 1; }

step "servis yeniden baslatiliyor"
ENVF="$APP/.env"
[ -f "$ENVF" ] || ENVF=/root/atak-v10/.env
PORT_NOW=$(grep -E '^PORT=' "$ENVF" 2>/dev/null | tail -1 | cut -d= -f2 | tr -d '\r' || true)
[ -n "$PORT_NOW" ] || PORT_NOW=3100
echo "PORT=$PORT_NOW"

pm2 delete atak 2>/dev/null || true
sleep 1
pkill -f 'node .*server\.js' 2>/dev/null || true
sleep 1
for P in 3000 3100 "$PORT_NOW"; do
  PID=$(ss -lntp 2>/dev/null | awk -v p=":$P" '$4 ~ p {print}' | sed -n 's/.*pid=\([0-9]*\).*/\1/p' | head -1 || true)
  if [ -n "${PID:-}" ]; then
    CMD=$(ps -p "$PID" -o args= 2>/dev/null || true)
    echo "   LISTEN $P pid=$PID"
    if echo "$CMD" | grep -qE 'server\.js|node'; then kill -9 "$PID" 2>/dev/null || true; fi
  fi
done
sleep 1

cd "$APP"
if [ ! -d "$APP/node_modules" ] && [ -f "$APP/package.json" ]; then
  npm install --omit=dev || npm install || true
fi
pm2 start "$APP/server.js" --name atak --cwd "$APP" --update-env
pm2 save || true

step "saglik kontrolu"
HEALTH=""
HEALTH_PORT=""
SEARCH_HTTP=""
ok=0
for i in 1 2 3 4 5 6 7 8 9 10; do
  sleep 1
  for P in "$PORT_NOW" 3100 3000; do
    HEALTH=$(curl -sS -m 3 "http://127.0.0.1:$P/health" 2>/dev/null || true)
    if echo "$HEALTH" | grep -q "$EXPECT_HEALTH"; then
      HEALTH_PORT=$P
      SEARCH_HTTP=$(curl -sS -m 3 -o /dev/null -w "%{http_code}" "http://127.0.0.1:$P/web-api/admin/customers/search?q=atak" || echo err)
      ok=1
      break 2
    fi
  done
  echo "   WAIT_$i health=$HEALTH"
done

if [ "$ok" != "1" ]; then
  echo "FAIL_HEALTH_NOT_$EXPECT_HEALTH"
  pm2 describe atak || true
  pm2 logs atak --lines 40 --nostream || true
  FAIL_MSG="health_mismatch want=$EXPECT_HEALTH got=$HEALTH"
else
  FAIL_MSG=""
fi

PROOF="$APP/public/assets/_deploy-check.txt"
{
  echo "stamp=$(date -Is)"
  echo "build=$EXPECT_BUILD"
  echo "app=$APP"
  echo "synced=$SYNCED"
  echo "health_port=$HEALTH_PORT"
  echo "health=$HEALTH"
  echo "search_http=$SEARCH_HTTP"
  echo "admin_js_has_build=$(grep -c "ATAK_ADMIN_BUILD=$EXPECT_BUILD" "$APP/public/assets/admin.js" || true)"
  echo "admin_html_cache=$(grep -o "admin.js?v=[^\"]*" "$APP/public/admin.html" | head -1)"
  echo "finance_has_kesilmeyen=$(grep -c 'data-finance-jump=\"uninvoiced\"' "$APP/public/admin.html" || true)"
  echo "invoice_has_pending=$(grep -c 'data-inv-module=\"pending\"' "$APP/public/admin.html" || true)"
  echo "personel_shell=$(grep -c 'personel-shell.css' "$APP/public/personel.html" || true)"
  echo "admin_md5=$(md5sum "$APP/public/assets/admin.js" | awk '{print $1}')"
  echo "html_md5=$(md5sum "$APP/public/admin.html" | awk '{print $1}')"
  echo "server_md5=$(md5sum "$APP/server.js" | awk '{print $1}')"
  if [ -n "$FAIL_MSG" ]; then echo "status=FAIL $FAIL_MSG"; else echo "status=OK"; fi
  echo "DONE"
} | tee "$PROOF" "$OUT"

for D in /root/atak-v10 /root/atakhome-platform "$APP"; do
  [ -d "$D/public/assets" ] || continue
  cp -f "$PROOF" "$D/public/assets/_deploy-check.txt" 2>/dev/null || true
  cp -f "$OUT" "$D/public/assets/_deploy-log.txt" 2>/dev/null || true
done

echo "PUBLIC https://panel.atakhome.com.tr/web-admin-assets/_deploy-check.txt"
echo "CHECK_HEALTH https://panel.atakhome.com.tr/health  (icinde $EXPECT_HEALTH olmali)"
echo "CHECK_HTML https://panel.atakhome.com.tr/web-admin  (icinde $EXPECT_BUILD olmali)"

if [ -n "$FAIL_MSG" ]; then
  echo "DEPLOY_FAILED"
  exit 2
fi
echo "DEPLOY_OK — tarayicida Ctrl+Shift+R yapin"
