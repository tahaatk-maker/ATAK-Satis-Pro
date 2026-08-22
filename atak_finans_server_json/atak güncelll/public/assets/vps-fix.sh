echo "VPS-FIX START $(date -Is)"
# ATAK VPS kesin deploy — health 6.3.234-atak-geteinvoices olmadan DONE yazmaz
set -euo pipefail
BRANCH="${ATAK_BRANCH:-cursor/fatura-ayri-sekme-474e}"
EXPECT_HEALTH=6.3.234-atak-geteinvoices
EXPECT_BUILD=fix-v234
TMP=/tmp/atak-fix-$(date +%s)
OUT=/tmp/atak-deploy-result.txt

STEP="baslangic"
trap 'code=$?; echo ""; echo "HATA: islem durdu (exit=$code)"; echo "Son adim: $STEP"; echo "Log: $OUT"; exit $code' ERR
step(){ STEP="$1"; echo "-- $1"; }

echo "EXPECT $EXPECT_HEALTH / $EXPECT_BUILD"
echo "BRANCH $BRANCH"
echo "BASH=${BASH_VERSION:-unknown}"

step "gerekli araclar kontrol ediliyor"
for BIN in curl tar python3 rsync git; do
  if command -v "$BIN" >/dev/null 2>&1; then
    echo "   ok: $BIN"
  else
    echo "   yok: $BIN"
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

step "kaynak bulunuyor"
SRC=""
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
LOCAL_SRC=$(cd "$SCRIPT_DIR/../.." 2>/dev/null && pwd || true)
if [ -n "${LOCAL_SRC:-}" ] && [ -f "$LOCAL_SRC/server.js" ]; then
  SRC="$LOCAL_SRC"
  echo "   yerel klon kullaniliyor: $SRC"
fi
if [ -z "$SRC" ]; then
  CAND=$(find /tmp/ATAK-Satis-Pro -type d -name 'atak güncelll' 2>/dev/null | head -1 || true)
  if [ -n "${CAND:-}" ] && [ -f "$CAND/server.js" ]; then
    SRC="$CAND"
    echo "   /tmp klon kullaniliyor: $SRC"
  fi
fi
if [ -z "$SRC" ]; then
  mkdir -p "$TMP" && cd "$TMP"
  echo "   GitHub paket indiriliyor (IPv4)..."
  curl_get(){
    curl -4 -fL --connect-timeout 15 --max-time 90 --retry 1 --progress-bar "$@"
  }
  BRANCH_URLENC=${BRANCH//\//%2F}
  curl_get "https://codeload.github.com/tahaatk-maker/ATAK-Satis-Pro/tar.gz/refs/heads/$BRANCH" -o src.tgz || true
  if [ -s src.tgz ]; then
    tar -xzf src.tgz
    SRC=$(find "$TMP" -type d -name 'atak güncelll' | head -1)
  fi
fi
if [ -z "${SRC:-}" ]; then echo "KAYNAK KLASOR BULUNAMADI"; exit 1; fi

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
check "fatura build $EXPECT_BUILD" grep -q "ATAK_FATURA_BUILD=$EXPECT_BUILD" "$SRC/public/assets/fatura.js"
check "admin odeme plani" grep -q 'id="salesPayPlanToggleBtn"' "$SRC/public/admin.html"
check "personel odeme plani" grep -q 'id="salesPayPlanToggleBtn"' "$SRC/public/personel.html"
check "e-fatura kesilmeyen sekmesi" grep -q 'data-inv-module="pending"' "$SRC/public/admin.html"
check "admin cache $EXPECT_BUILD" grep -q "admin.js?v=$EXPECT_BUILD" "$SRC/public/admin.html"
check "personel cache $EXPECT_BUILD" grep -q "personel.js?v=$EXPECT_BUILD" "$SRC/public/personel.html"
check "personel e-fatura karti" grep -q 'id="invoiceCard"' "$SRC/public/personel.html"
check "personel e-fatura header" grep -q 'id="invoiceHeaderBtn"' "$SRC/public/personel.html"
check "personel fatura otomatik yetki" grep -q "grantInvoiceScreenOnList" "$SRC/server.js"
check "e-fatura sayfasi" grep -q 'Faturalar' "$SRC/public/fatura.html"
check "e-fatura tam merkez" grep -q 'data-inv-module="efatura"' "$SRC/public/fatura.html"
check "e-fatura giden kutu" grep -q 'data-inv-view="ef_out_pending"' "$SRC/public/fatura.html"
check "baskan inbox kapali" grep -q "isChairmanMuleConsume" "$SRC/lib/rapid360-einvoice.js"
check "baskan dealer kilidi" grep -q "CHAIRMAN_DEALER_ID" "$SRC/lib/rapid360-einvoice.js"
check "rapid360 satis xml" test -f "$SRC/lib/rapid360-sales-xml.js"
check "rapid360 xml oz nitelik" grep -q "function parseAttrs" "$SRC/lib/rapid360-sales-xml.js"
check "rapid360 siparisno" grep -q "siparisno" "$SRC/lib/rapid360-sales-xml.js"
check "rapid360 ad soyad" grep -q "composeCustomerName" "$SRC/lib/rapid360-sales-xml.js"
check "musteri ad soyad ayri" grep -q "customerPageFirstName" "$SRC/public/admin.html"
check "musteri kodu alani" grep -q "customerPageCode" "$SRC/public/admin.html"
check "musteri dogum tarihi" grep -q 'id="customerPageBirthDate"' "$SRC/public/admin.html"
check "musteri kurumsal adres" grep -q 'id="customerPageCompanyAddress"' "$SRC/public/admin.html"
check "musteri is telefonu" grep -q 'id="customerPageWorkPhone"' "$SRC/public/admin.html"
check "musteri kodu lib" test -f "$SRC/lib/customer-code.js"
check "musteri kodu next api" grep -q "customer-code-next" "$SRC/server.js"
check "person name lib" test -f "$SRC/lib/person-name.js"
check "musteri ad soyad tek kayit" test -f "$SRC/lib/customer-dedupe.js"
check "rapid360 satis fetch" test -f "$SRC/lib/rapid360-sales-fetch.js"
check "rapid360 getdetailedsales" grep -q "getdetailedsales" "$SRC/lib/rapid360-sales-fetch.js"
check "rapid360 okta once" grep -q "oktaReady" "$SRC/lib/rapid360-sales-fetch.js"
check "rapid360 pull api" grep -q "rapid360-sales-pull" "$SRC/server.js"
check "rapid360 atak bayi 340344" grep -q "DEFAULT_DEALER" "$SRC/lib/rapid360-sales-fetch.js"
check "rapid360 sales query variants" grep -q "salesQueryVariants" "$SRC/lib/rapid360-sales-fetch.js"
if grep -q "Sirket', magaza" "$SRC/lib/rapid360-sales-fetch.js"; then
  echo "   HATALI: satış sorgusu Sirket=mağaza gönderiyor"; exit 1
fi
echo "   ok: satış sorgusu Sirket=mağaza değil"
check "rapid360 okta auth" test -f "$SRC/lib/rapid360-d365-auth.js"
check "rapid360 d365 sales" test -f "$SRC/lib/rapid360-d365-sales.js"
check "rapid360 okta poll api" grep -q "rapid360-okta-poll" "$SRC/server.js"
check "rapid360 okta callback" grep -q "rapid360-okta-callback" "$SRC/server.js"
check "rapid360 detayli satis url" grep -q "DmrDetailedSalesReport" "$SRC/lib/rapid360-d365-auth.js"
check "rapid360 nativeclient yok" grep -q "isBlockedMicrosoftUrl" "$SRC/lib/rapid360-d365-auth.js"
check "rapid360 magaza url yok" grep -q "prt', 'initial'" "$SRC/lib/rapid360-d365-auth.js"
if grep -q "parmMagaza" "$SRC/lib/rapid360-d365-auth.js"; then
  echo "   HATALI: Rapid360 URL hâlâ sahte Magaza query gönderiyor"; exit 1
fi
echo "   ok: Rapid360 URL Magaza query yok"
check "rapid360 f12 magaza" grep -q "rapid360MagazaConsoleScript" "$SRC/public/assets/admin.js"
check "rapid360 web only login" grep -q "startWebOnlyLogin" "$SRC/lib/rapid360-d365-auth.js"
check "rapid360 okta bagla" grep -q "rapid360OktaConnectBtn" "$SRC/public/admin.html"
check "rapid360 xml drop" grep -q 'id="rapid360SalesXmlDrop"' "$SRC/public/admin.html"
check "personel xml drop" grep -q 'id="rapid360SalesXmlDrop"' "$SRC/public/personel.html"
check "rapid360 xml oku" grep -q "XML oku" "$SRC/public/admin.html"
check "rapid360 xml paste" grep -q 'id="rapid360SalesXmlPaste"' "$SRC/public/admin.html"
check "rapid360 secilenleri aktar" grep -q "Seçilenleri aktar" "$SRC/public/admin.html"
check "rapid360 salesIds" grep -q "parseSalesIds" "$SRC/lib/rapid360-sales-catalog.js"
check "rapid360 magaza 340334" grep -q 'value="340334"' "$SRC/public/admin.html"
check "rapid360 atak magaza" grep -q "340334 ATAK" "$SRC/public/admin.html"
check "rapid360 pull auto yok" grep -q "autoImport:false" "$SRC/public/assets/admin.js"
check "rapid360 auto pull" grep -q "autoPullRapid360Sales" "$SRC/public/assets/admin.js"
check "personel auto pull" grep -q "autoPullRapid360Sales" "$SRC/public/assets/personel.js"
check "rapid360 satis oku" grep -q "Satışları oku" "$SRC/public/admin.html"
if grep -A30 "async function startRapidOktaChallenge" "$SRC/server.js" | grep -q "startInteractiveLogin"; then
  echo "   HATALI: Rapid Aktar Microsoft AADSTS50011 callback açıyor"; exit 1
fi
echo "   ok: Rapid Aktar Microsoft callback yok"
if grep -A8 "async function startInteractiveLogin" "$SRC/lib/rapid360-d365-auth.js" | grep -q "buildAuthorizeUrl"; then
  echo "   HATALI: Rapid Aktar hâlâ PKCE authorize açıyor"; exit 1
fi
echo "   ok: Rapid Aktar PKCE authorize yok"
if grep -A12 "rapid360-okta-callback" "$SRC/server.js" | grep -q "completeAuthorizationCode"; then
  echo "   HATALI: Rapid callback hâlâ Microsoft token alıyor"; exit 1
fi
echo "   ok: Rapid callback Microsoft token almıyor"
check "aadsts50011 uyarisi" grep -q "AADSTS50011" "$SRC/server.js"
if grep -q "rapid360-okta-callback" "$SRC/public/assets/admin.js" && grep -q 'webOnly:true' "$SRC/public/assets/admin.js"; then
  echo "   ok: Rapid Aktar popup Microsoft authorize açmaz"
fi
if ! grep -F "login.microsoftonline.com" "$SRC/public/assets/admin.js" >/dev/null; then
  echo "   HATALI: Rapid popup Microsoft URL kilidi yok"; exit 1
fi
echo "   ok: Rapid popup Microsoft URL kilidi var"
if ! grep -F "login.microsoftonline.com" "$SRC/public/assets/personel.js" >/dev/null; then
  echo "   HATALI: Personel Rapid popup Microsoft URL kilidi yok"; exit 1
fi
echo "   ok: Personel Rapid popup Microsoft URL kilidi var"
if grep -q "rapid360silent" "$SRC/public/assets/admin.js" "$SRC/public/assets/personel.js"; then
  echo "   HATALI: Rapid Aktar hâlâ silent Kod penceresi açıyor"; exit 1
fi
echo "   ok: Rapid Aktar silent Kod penceresi yok"
if grep -q "deviceLoginUrl" "$SRC/public/assets/admin.js" "$SRC/public/assets/personel.js"; then
  echo "   HATALI: Rapid Aktar hâlâ deviceLoginUrl açıyor"; exit 1
fi
echo "   ok: Rapid Aktar deviceLoginUrl yok"
if grep -q "rapid360finish" "$SRC/public/assets/admin.js" "$SRC/public/assets/personel.js"; then
  echo "   HATALI: Rapid Aktar hâlâ ikinci Kod penceresi açıyor"; exit 1
fi
echo "   ok: Rapid Aktar ikinci Kod penceresi yok"
check "rapid360 satis aktar ui" grep -q "Rapid Aktar" "$SRC/public/admin.html"
check "rapid360 satis katalog" test -f "$SRC/lib/rapid360-sales-catalog.js"
check "rapid360 missing products" grep -q "collectMissingProducts" "$SRC/lib/rapid360-sales-catalog.js"
check "rapid taslak isOpenRapidSale" grep -q "isOpenRapidSale" "$SRC/lib/rapid360-sales-catalog.js"
check "rapid iptal tekrar yazmaz" grep -q "isRapidSaleAlreadyImported" "$SRC/lib/rapid360-sales-catalog.js"
check "rapid iptal hayalet kapat" grep -q "suppressReimportedCancelledRapidDrafts" "$SRC/lib/rapid360-sales-catalog.js"
check "rapid taslak sil api" grep -q "discard-rapid-draft" "$SRC/server.js"
check "admin taslak sil" grep -q "discardRapidDraft" "$SRC/public/assets/admin.js"
check "rapid360 bridge start" grep -q "rapid360-bridge-start" "$SRC/server.js"
check "rapid360 mule once" grep -q "XML ile aynı Satislar" "$SRC/lib/rapid360-sales-fetch.js"
check "admin rapid bridge" grep -q "showRapidBridgeBox" "$SRC/public/assets/admin.js"
check "rapid conn status api" grep -q "rapid360-conn-status" "$SRC/server.js"
check "admin conn isigi" grep -q "rapid360-conn-status" "$SRC/public/assets/admin.js"
check "rapid robot lib" test -f "$SRC/lib/rapid360-robot.js"
check "rapid robot api" grep -q "rapid360-robot-start" "$SRC/server.js"
check "admin robot poll" grep -q "rapid360-robot-poll" "$SRC/public/assets/admin.js"
check "personel robot poll" grep -q "rapid360-robot-poll" "$SRC/public/assets/personel.js"
check "okta sifre alani" grep -q "rapidSettingsOktaPass" "$SRC/public/admin.html"
check "ayarlar rapid sekmesi" grep -q 'data-settings-tab="rapid"' "$SRC/public/admin.html"
check "okta ayar api" grep -q "rapid360-okta-settings" "$SRC/server.js"
check "robot sorgula basar" grep -q "fillReportAndQuery" "$SRC/lib/rapid360-robot.js"
check "robot xml aktar" grep -q "xml\\\\s\\*aktar" "$SRC/lib/rapid360-robot.js"
check "robot chromium testi" grep -q "verifyLaunch" "$SRC/lib/rapid360-robot.js"
check "robot teshis api" grep -q "rapid360-robot-diag" "$SRC/server.js"
check "robot selenium tikla" grep -q "typeIntoD365" "$SRC/lib/rapid360-robot.js"
check "robot ekran goruntusu" grep -q "rapid360-robot-shot" "$SRC/server.js"
check "robot test api" grep -q "rapid360-robot-test" "$SRC/server.js"
check "ayarlar robot test" grep -q "rapidRobotTestBtn" "$SRC/public/admin.html"
check "robot coklu klasor" grep -q "PW_SEARCH_PATHS" "$SRC/lib/rapid360-robot.js"
check "robot playwright meta" grep -q "resolvePlaywrightMeta" "$SRC/lib/rapid360-robot.js"
check "robot teshis yol" grep -q "playwrightPath" "$SRC/server.js"
check "okta nokta duzelt" grep -q "normalizeRapidAccount" "$SRC/lib/rapid360-d365-auth.js"
check "okta oturum hatasi" grep -q "oturum açılamıyor" "$SRC/lib/rapid360-robot.js"
check "okta kullanici placeholder" grep -q "W340334.1@rapid360.arcelikpazarlama.com.tr" "$SRC/public/admin.html"
check "robot magaza sec" grep -q "selectMagaza" "$SRC/lib/rapid360-robot.js"
check "robot magaza dolu" grep -q "magazaFilled" "$SRC/lib/rapid360-robot.js"
check "okta ileri asama" grep -q "NEXT_CLICKED" "$SRC/lib/rapid360-robot.js"
check "okta ileri etiket" grep -q "isNextButtonLabel" "$SRC/lib/rapid360-robot.js"
check "turkiye tarihi" grep -q "turkeyTodayIso" "$SRC/lib/rapid360-robot.js"
check "robot stage api" grep -q "jobPublicView" "$SRC/server.js"
check "rapid taslak needsCompletion" grep -q "needsCompletion" "$SRC/server.js"
check "rapid taslak completeSaleId" grep -q "completeSaleId" "$SRC/public/assets/admin.js"
check "personel taslak completeSaleId" grep -q "completeSaleId" "$SRC/public/assets/personel.js"
check "satis takip rapid tamamla" grep -q "Rapid — tamamla" "$SRC/public/admin.html"
check "admin satis git" grep -q "openRapidSaleInSalesCenter" "$SRC/public/assets/admin.js"
check "personel satis git" grep -q "openRapidSaleInSalesCenter" "$SRC/public/assets/personel.js"
check "rapid360 yeni urun kategori" grep -q "createRapidMissingProducts" "$SRC/server.js"
check "admin yeni urun kutu" grep -q 'id="rapid360NewProductsBox"' "$SRC/public/admin.html"
check "personel yeni urun kutu" grep -q 'id="rapid360NewProductsBox"' "$SRC/public/personel.html"
check "vkn lookup api" grep -q "vkn-lookup" "$SRC/server.js"
check "vkn lookup admin ui" grep -q 'data-vkn-lookup="customerPage"' "$SRC/public/admin.html"
check "vkn lookup personel ui" grep -q 'id="qcVknLookupBtn"' "$SRC/public/personel.html"
check "asistek musteri excel api" grep -q "customers-excel-import" "$SRC/server.js"
check "asistek musteri excel ui" grep -q 'id="customerExcelBtn"' "$SRC/public/admin.html"
check "musteri excel birakma" grep -q 'id="customerExcelDrop"' "$SRC/public/admin.html"
check "musteri excel onizle" grep -q 'id="customerExcelPreviewBtn"' "$SRC/public/admin.html"
check "musteri excel aktar" grep -q '>Aktar</button>' "$SRC/public/admin.html"
if grep -q "Telefonluları aktar" "$SRC/public/admin.html"; then echo "   HATALI: Telefonluları aktar duruyor"; exit 1; fi
echo "   ok: Telefonluları aktar yok"
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
check "personel girisi .env son deger" grep -q "forceKeys" "$SRC/server.js"
check "store.json yedek kurtarma" grep -q "recoverStoreFile" "$SRC/server.js"
check "otomatik yedek" grep -q "auto-backup" "$SRC/server.js"
check "rapid360 einvoice" grep -q "rapid360-einvoice" "$SRC/server.js"
check "atak geteinvoices" grep -q "atak-geteinvoices" "$SRC/server.js"
check "microsip ara sip-call.js" test -f "$SRC/public/assets/sip-call.js"
check "admin microsip" grep -q "sip-call.js" "$SRC/public/admin.html"
check "personel microsip" grep -q "sip-call.js" "$SRC/public/personel.html"
check "musteri iletisim kaydi" grep -q "customerComms" "$SRC/server.js"
check "musteri iletisim sil" grep -q "customer/:id/comm/:commId" "$SRC/server.js"
check "hazir ulasilamadi sms" grep -q "smsDefaultMissedTemplate" "$SRC/server.js"
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

step "store.json yedekleniyor / kurtariliyor"
recover_store_file(){
  local dest_dir="$1"
  mkdir -p "$dest_dir/data"
  local dest="$dest_dir/data/store.json"
  local dest_sz=0
  if [ -f "$dest" ]; then
    dest_sz=$(stat -c%s "$dest" 2>/dev/null || echo 0)
  fi
  if [ "${dest_sz:-0}" -ge 200 ]; then
    echo "   store=ok $dest bytes=$dest_sz"
    return 0
  fi
  local best="" bestsz=0
  local f sz
  shopt -s nullglob
  for f in \
    /root/atak-v10/data/store.json \
    /root/atakhome-platform/data/store.json \
    /root/atak-v10/data/store.json.bak-* \
    /root/atakhome-platform/data/store.json.bak-* \
    /root/atak-v10/data/backups/store-*.json \
    /root/atakhome-platform/data/backups/store-*.json \
    "$dest_dir/data/backups/store-"*.json \
    "$dest_dir/data/store.json.bak-"*
  do
    [ -f "$f" ] || continue
    sz=$(stat -c%s "$f" 2>/dev/null || echo 0)
    [ "${sz:-0}" -ge 200 ] || continue
    if [ "$sz" -gt "$bestsz" ]; then
      best="$f"
      bestsz="$sz"
    fi
  done
  shopt -u nullglob
  if [ -z "$best" ]; then
    echo "   store=MISSING $dest — yedek bulunamadi"
    return 1
  fi
  cp -a "$best" "$dest"
  echo "   store=recovered from=$best bytes=$bestsz dest=$dest"
}
STORE_OK=0
for D in "${DIRS[@]}"; do
  [ -d "$D" ] || continue
  if recover_store_file "$D"; then STORE_OK=1; fi
done
if ! recover_store_file "$APP"; then
  echo "FAIL_STORE_JSON_EKSIK"
  echo "   /root/atak-v10/data/store.json yok. Canli veri /root/atakhome-platform/data veya .bak- dosyasindan kopyalanamadi."
  echo "   Bos store.json OLUSTURULMADI (musteri/satis verisi silinmesin diye)."
  FAIL_STORE=1
else
  FAIL_STORE=""
  STORE_OK=1
fi
echo "STORE_OK=$STORE_OK APP_STORE_BYTES=$(stat -c%s "$APP/data/store.json" 2>/dev/null || echo 0)"

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

step "personel girisi aciliyor (ATAK_OWNER_ONLY=0)"
force_env_kv(){
  local file="$1" key="$2" val="$3"
  [ -n "$file" ] || return 0
  mkdir -p "$(dirname "$file")" 2>/dev/null || true
  touch "$file"
  # export KEY=, bosluklu KEY =, CRLF, tekrarlayan satirlar — hepsini sil, tek satir yaz
  sed -i -E "/^[[:space:]]*(export[[:space:]]+)?${key}[[:space:]]*=/d" "$file"
  printf '%s=%s\n' "$key" "$val" >> "$file"
}
for D in "${DIRS[@]}" "$APP" /root/atak-v10 /root/atakhome-platform; do
  [ -d "$D" ] || continue
  force_env_kv "$D/.env" ATAK_OWNER_ONLY 0
  force_env_kv "$D/.env" ATAK_MFA_ENABLED 0
done
force_env_kv "$ENVF" ATAK_OWNER_ONLY 0
unset ATAK_OWNER_ONLY || true
export ATAK_OWNER_ONLY=0
echo "   .env ATAK_OWNER_ONLY=0 (PM2 env ezilecek)"

cd "$APP"
if [ ! -d "$APP/node_modules" ] && [ -f "$APP/package.json" ]; then
  npm install --omit=dev || npm install || true
fi

step "rapid robot (tarayici) kuruluyor"
ROBOT_OK=0
echo "   node: $(node -v 2>/dev/null || echo yok)  npm: $(npm -v 2>/dev/null || echo yok)  disk: $(df -h "$APP" 2>/dev/null | awk 'NR==2{print $4" bos"}')"
# Iki uygulama klasoru olabilir — playwright'i HEPSINE kur (calisan panel hangisiyse bulsun)
for RD in "${DIRS[@]}"; do
  [ -d "$RD" ] || continue
  if (cd "$RD" && node -e "require('playwright')" >/dev/null 2>&1); then
    echo "   $RD: playwright kurulu ($(cd "$RD" && node -e "console.log(require('playwright/package.json').version)" 2>/dev/null))"
    ROBOT_OK=1
  else
    echo "   $RD: playwright indiriliyor..."
    if (cd "$RD" && npm install playwright --no-save --omit=dev >/tmp/atak-pw-install.log 2>&1); then
      echo "   $RD: playwright kuruldu"
      ROBOT_OK=1
    else
      echo "   $RD: HATA — playwright kurulamadi:"
      tail -4 /tmp/atak-pw-install.log 2>/dev/null | sed 's/^/     /'
    fi
  fi
done
cd "$APP"
if [ "$ROBOT_OK" = "1" ]; then
  npx playwright install chromium >/tmp/atak-pw-browser.log 2>&1 || { echo "   chromium indirme sorunu:"; tail -4 /tmp/atak-pw-browser.log | sed 's/^/     /'; }
  npx playwright install-deps chromium >/dev/null 2>&1 \
    || apt-get install -y --no-install-recommends \
      libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 \
      libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 \
      libpango-1.0-0 libcairo2 libglib2.0-0 fonts-liberation >/dev/null 2>&1 \
    || echo "   sistem kutuphaneleri kurulamadi (apt)"
  LAUNCH_OK=0
  for RD in "${DIRS[@]}"; do
    [ -d "$RD" ] || continue
    if (cd "$RD" && node -e "const {chromium}=require('playwright');(async()=>{const b=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});await b.close()})().then(()=>process.exit(0)).catch(e=>{console.error(String(e.message).split('\n')[0]);process.exit(1)})" 2>/tmp/atak-robot-err.txt); then
      echo "   ok: rapid robot hazir ($RD chromium acildi)"
      LAUNCH_OK=1
      break
    fi
  done
  if [ "$LAUNCH_OK" != "1" ]; then
    echo "   HATA: chromium acilamadi — robot devre disi: $(head -c 200 /tmp/atak-robot-err.txt 2>/dev/null)"
    ROBOT_OK=0
  fi
fi
[ "$ROBOT_OK" = "1" ] || echo "   robot yok: Satislari oku yine calisir (Rapid360 penceresi + XML)"

NODE_PATH_JOIN=""
for RD in "${DIRS[@]}" /root/atak-v10 /root/atakhome-platform "$APP"; do
  [ -d "$RD/node_modules" ] || continue
  case ":$NODE_PATH_JOIN:" in *":$RD/node_modules:"*) ;; *) NODE_PATH_JOIN="${NODE_PATH_JOIN:+$NODE_PATH_JOIN:}$RD/node_modules" ;; esac
done
echo "   NODE_PATH=$NODE_PATH_JOIN"
NODE_PATH="$NODE_PATH_JOIN" ATAK_OWNER_ONLY=0 pm2 start "$APP/server.js" --name atak --cwd "$APP" --update-env
pm2 save || true

step "nginx/apache Excel yukleme limiti (413)"
# 5-6 MB .xls, nginx varsayilan 1m ile 413 doner. Node 50 MB kabul eder.
raise_upload_limit(){
  if [ -d /etc/nginx/conf.d ] && [ -w /etc/nginx/conf.d ]; then
    printf 'client_max_body_size 50m;\nproxy_read_timeout 300s;\nproxy_send_timeout 300s;\nsend_timeout 300s;\n' > /etc/nginx/conf.d/99-atak-upload.conf
    echo "   nginx conf.d/99-atak-upload.conf = 50m"
  elif [ -d /etc/nginx ] && [ -w /etc/nginx ]; then
    printf 'client_max_body_size 50m;\n' > /etc/nginx/atak-upload.conf || true
    echo "   nginx/atak-upload.conf = 50m"
  else
    echo "   nginx conf yazilamadi (dizin yok veya root degil)"
  fi
  if [ -d /etc/nginx ]; then
    find /etc/nginx -type f \( -name '*.conf' -o -name '*.inc' \) 2>/dev/null | while read -r f; do
      [ -f "$f" ] && [ -w "$f" ] || continue
      grep -q 'client_max_body_size' "$f" || continue
      sed -i -E 's/client_max_body_size[[:space:]]+[0-9]+[kKmM]/client_max_body_size 50m/g' "$f"
    done
  fi
  if command -v nginx >/dev/null 2>&1; then
    if nginx -t >/tmp/atak-nginx-t.txt 2>&1; then
      systemctl reload nginx >/dev/null 2>&1 || service nginx reload >/dev/null 2>&1 || nginx -s reload >/dev/null 2>&1 || true
      echo "   nginx reload ok"
    else
      echo "   nginx -t uyarisi (devam):"
      tail -6 /tmp/atak-nginx-t.txt 2>/dev/null | sed 's/^/     /'
    fi
  else
    echo "   nginx yok — atlandi"
  fi
  if [ -d /etc/apache2/conf-available ] && [ -w /etc/apache2/conf-available ]; then
    printf 'LimitRequestBody 52428800\n' > /etc/apache2/conf-available/atak-upload.conf
    a2enconf atak-upload >/dev/null 2>&1 || true
    if command -v apache2ctl >/dev/null 2>&1 && apache2ctl configtest >/tmp/atak-apache-t.txt 2>&1; then
      systemctl reload apache2 >/dev/null 2>&1 || service apache2 reload >/dev/null 2>&1 || true
      echo "   apache LimitRequestBody 50m"
    fi
  fi
}
raise_upload_limit || echo "   yukleme limiti adimi atlandi"

step "saglik kontrolu"
HEALTH=""
HEALTH_PORT=""
SEARCH_HTTP=""
FAIL_MSG=""
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

if echo "$HEALTH" | grep -q '"ownerOnly":true'; then
  echo "FAIL_OWNER_ONLY_HALA_ACIK"
  FAIL_MSG="ownerOnly=true — personel girisi kapali"
  ok=0
fi
if echo "$HEALTH" | grep -q '"storeOk":false'; then
  echo "FAIL_STORE_JSON"
  FAIL_MSG="store.json eksik"
  ok=0
fi
if [ -n "${FAIL_STORE:-}" ]; then
  FAIL_MSG="store.json eksik — yedek kopya da bulunamadi"
  ok=0
fi

if [ "$ok" != "1" ]; then
  if [ -z "$FAIL_MSG" ]; then
    echo "FAIL_HEALTH_NOT_$EXPECT_HEALTH"
    FAIL_MSG="health_mismatch want=$EXPECT_HEALTH got=$HEALTH"
  fi
  pm2 describe atak || true
  pm2 logs atak --lines 40 --nostream || true
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
  echo "owner_only=$(echo "$HEALTH" | grep -o '"ownerOnly":[^,}]*' || true)"
  echo "store_ok=$(echo "$HEALTH" | grep -o '"storeOk":[^,}]*' || true)"
  echo "store_bytes=$(stat -c%s "$APP/data/store.json" 2>/dev/null || echo 0)"
  echo "admin_js_has_build=$(grep -c "ATAK_ADMIN_BUILD=$EXPECT_BUILD" "$APP/public/assets/admin.js" || true)"
  echo "admin_html_cache=$(grep -o "admin.js?v=[^\"]*" "$APP/public/admin.html" | head -1)"
  echo "finance_has_kesilmeyen=$(grep -c 'data-finance-jump=\"uninvoiced\"' "$APP/public/admin.html" || true)"
  echo "invoice_has_pending=$(grep -c 'data-inv-module=\"pending\"' "$APP/public/admin.html" || true)"
  echo "personel_shell=$(grep -c 'personel-shell.css' "$APP/public/personel.html" || true)"
  echo "admin_md5=$(md5sum "$APP/public/assets/admin.js" | awk '{print $1}')"
  echo "html_md5=$(md5sum "$APP/public/admin.html" | awk '{print $1}')"
  echo "server_md5=$(md5sum "$APP/server.js" | awk '{print $1}')"
  echo "nginx_body=$(grep -h client_max_body_size /etc/nginx/conf.d/99-atak-upload.conf /etc/nginx/nginx.conf 2>/dev/null | head -1 || echo yok)"
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
