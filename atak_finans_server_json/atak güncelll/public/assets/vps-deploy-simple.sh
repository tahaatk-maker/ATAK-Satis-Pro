#!/bin/bash
set -euo pipefail
OUT=/tmp/atak-ok.txt
: > "$OUT"
log(){ echo "$*" | tee -a "$OUT"; }
die(){ log "FAIL: $*"; exit 1; }

log "=== ATAK DEPLOY ==="
BRANCH="cursor/fatura-ayri-sekme-474e"
EXPECT_V="6.3.166-yedek"
EXPECT_B="fix-v166"
APP="${APP_DIR:-/root/atak-v10}"
[ -d /root/atakhome-platform ] && [ ! -f "$APP/server.js" ] && APP=/root/atakhome-platform

log "APP=$APP"
log "EXPECT $EXPECT_V / $EXPECT_B"

log "1) temizle"
rm -rf /tmp/atak-deploy-src /tmp/atak-src.tgz
mkdir -p /tmp/atak-deploy-src

log "2) indir"
curl -fL "https://codeload.github.com/tahaatk-maker/ATAK-Satis-Pro/tar.gz/refs/heads/${BRANCH}" -o /tmp/atak-src.tgz || die "github indirilemedi"
tar -xzf /tmp/atak-src.tgz -C /tmp/atak-deploy-src || die "tar acilamadi"
SRC=$(find /tmp/atak-deploy-src -type d -name 'atak güncelll' | head -1)
log "SRC=$SRC"
[ -n "$SRC" ] || die "kaynak klasor yok"
[ -f "$SRC/server.js" ] || die "server.js yok"
[ -f "$SRC/public/assets/admin.js" ] || die "admin.js yok"

log "3) kaynak kontrol"
head -1 "$SRC/public/assets/admin.js" | tee -a "$OUT"
grep -E "version:|build:" "$SRC/server.js" | head -2 | tee -a "$OUT"
grep -q "$EXPECT_B" "$SRC/public/assets/admin.js" || die "kaynak admin build yanlis"
grep -q "$EXPECT_V" "$SRC/server.js" || die "kaynak version yanlis"
grep -q "build:'$EXPECT_B'" "$SRC/server.js" || die "kaynak build yanlis"
log "   kaynak OK"

log "4) kopyala (data dokunulmaz)"
mkdir -p "$APP/data" "$APP/public/assets"
if [ -f "$APP/data/store.json" ]; then
  cp -a "$APP/data/store.json" "$APP/data/store.json.bak-$(date +%Y%m%d-%H%M%S)"
  log "   store.json yedek"
fi
for D in "$APP" /root/atak-v10 /root/atakhome-platform; do
  [ -d "$D" ] || continue
  log "   SYNC -> $D"
  rsync -a --delete --exclude data --exclude node_modules --exclude .env --exclude '*.bak-*' "$SRC"/ "$D"/
  cp -f "$SRC/server.js" "$D/server.js"
  cp -f "$SRC/public/admin.html" "$D/public/admin.html"
  cp -f "$SRC/public/assets/admin.js" "$D/public/assets/admin.js"
  cp -f "$SRC/public/assets/admin.css" "$D/public/assets/admin.css"
  cp -f "$SRC/public/assets/personel.js" "$D/public/assets/personel.js" 2>/dev/null || true
  cp -f "$SRC/public/personel.html" "$D/public/personel.html" 2>/dev/null || true
  cp -f "$SRC/public/assets/personel.css" "$D/public/assets/personel.css" 2>/dev/null || true
  cp -f "$SRC/package.json" "$D/package.json" 2>/dev/null || true
done

log "4b) npm bagimlilik (nodemailer)"
for D in "$APP" /root/atak-v10 /root/atakhome-platform; do
  [ -f "$D/package.json" ] || continue
  (cd "$D" && npm install --omit=dev --no-audit --no-fund) >>"$OUT" 2>&1 || log "   npm uyarisi: $D"
done

log "5) disk kontrol"
head -1 "$APP/public/assets/admin.js" | tee -a "$OUT"
grep -E "version:|build:" "$APP/server.js" | head -2 | tee -a "$OUT"
grep -q "$EXPECT_V" "$APP/server.js" || die "disk version yanlis"
grep -q "build:'$EXPECT_B'" "$APP/server.js" || die "disk build yanlis"
grep -q "ATAK_ADMIN_BUILD=$EXPECT_B" "$APP/public/assets/admin.js" || die "disk admin build yanlis"
log "   disk OK"

log "5b) Mobilya / İstikbal alış maliyetlerini sıfırla (store.json)"
for STORE in "$APP/data/store.json" /root/atak-v10/data/store.json /root/atakhome-platform/data/store.json; do
  [ -f "$STORE" ] || continue
  CLEAR_N=$(node -e '
const fs=require("fs");
const p=process.argv[1];
const s=JSON.parse(fs.readFileSync(p,"utf8"));
s.products=Array.isArray(s.products)?s.products:[];
s.categories=Array.isArray(s.categories)?s.categories:[];
s.metaFlags=(s.metaFlags&&typeof s.metaFlags==="object")?s.metaFlags:{};
const ids=new Set(s.categories.filter(c=>String(c.id||"").toLowerCase()==="mobilya"||/mobilya/i.test(String(c.name||""))).map(c=>String(c.id).toLowerCase()));
ids.add("mobilya");
let cleared=0;
for(const prod of s.products){
  const cat=String(prod.category||"").toLowerCase();
  const brand=String(prod.brand||"").toLocaleLowerCase("tr-TR");
  const isMobilya=ids.has(cat)||cat==="mobilya"||/mobilya/.test(cat);
  if(!isMobilya&&!/istikbal/.test(brand))continue;
  const price=Number(prod.purchasePrice||0);
  if(!(price>0)&&!prod.purchasePriceSource)continue;
  prod.purchasePrice=0;
  prod.purchasePriceSource="manual-zero";
  prod.purchasePriceUpdatedAt=new Date().toISOString();
  prod.updatedAt=new Date().toISOString();
  cleared++;
}
s.metaFlags.clearMobilyaPurchase_v1=true;
s.metaFlags.clearMobilyaPurchase_v2=true;
s.metaFlags.clearMobilyaPurchase_v2_at=new Date().toISOString();
s.metaFlags.clearMobilyaPurchase_v2_count=cleared;
const tmp=p+".tmp";
fs.writeFileSync(tmp,JSON.stringify(s,null,2),"utf8");
fs.renameSync(tmp,p);
process.stdout.write(String(cleared));
' "$STORE" 2>/tmp/atak-clear-err.txt) || die "alis sifirlama fail: $(cat /tmp/atak-clear-err.txt 2>/dev/null)"
  log "   $STORE -> $CLEAR_N alis sifirlandi"
done

log "5c) store.json yedek / kurtarma"
recover_store(){
  local dest="$1/data/store.json"
  mkdir -p "$1/data"
  local dest_sz=0
  [ -f "$dest" ] && dest_sz=$(stat -c%s "$dest" 2>/dev/null || echo 0)
  if [ "${dest_sz:-0}" -ge 200 ]; then
    log "   store=ok $dest bytes=$dest_sz"
    return 0
  fi
  local best="" bestsz=0 f sz
  shopt -s nullglob
  for f in /root/atak-v10/data/store.json /root/atakhome-platform/data/store.json /root/atak-v10/data/store.json.bak-* /root/atakhome-platform/data/store.json.bak-* /root/atak-v10/data/backups/store-*.json /root/atakhome-platform/data/backups/store-*.json "$1/data/backups/store-"*.json "$1/data/store.json.bak-"*; do
    [ -f "$f" ] || continue
    sz=$(stat -c%s "$f" 2>/dev/null || echo 0)
    [ "${sz:-0}" -ge 200 ] || continue
    if [ "$sz" -gt "$bestsz" ]; then best="$f"; bestsz="$sz"; fi
  done
  shopt -u nullglob
  [ -n "$best" ] || return 1
  cp -a "$best" "$dest"
  log "   store=recovered from=$best bytes=$bestsz"
}
recover_store "$APP" || die "store.json eksik: $APP/data/store.json ve yedek yok"

log "6) npm + pm2 + MFA kapali + personel acik"
cd "$APP"
touch .env
sed -i -E '/^[[:space:]]*(export[[:space:]]+)?ATAK_MFA_ENABLED[[:space:]]*=/d' .env
sed -i -E '/^[[:space:]]*(export[[:space:]]+)?ATAK_OWNER_ONLY[[:space:]]*=/d' .env
printf 'ATAK_MFA_ENABLED=0\nATAK_OWNER_ONLY=0\n' >> .env
log "   ATAK_MFA_ENABLED=0 ATAK_OWNER_ONLY=0 (.env)"
if [ ! -d node_modules ]; then
  log "   npm install"
  npm install --omit=dev --no-audit --no-fund || die "npm install fail"
fi
# nodemailer yoksa ekle (mail ayari icin)
node -e "require('nodemailer')" 2>/dev/null || npm install nodemailer --omit=dev --no-audit --no-fund || true
pm2 delete atak 2>/dev/null || true
sleep 1
for P in 3100 3000; do
  PID=$(ss -lntp 2>/dev/null | awk -v p=":$P" '$4 ~ p{print}' | sed -n 's/.*pid=\([0-9]*\).*/\1/p' | head -1 || true)
  if [ -n "${PID:-}" ]; then
    log "   kill $PID :$P"
    kill -9 "$PID" 2>/dev/null || true
  fi
done
sleep 1
ATAK_OWNER_ONLY=0 pm2 start "$APP/server.js" --name atak --cwd "$APP" --update-env || die "pm2 start fail"
pm2 save || true
sleep 5

log "7) health (/health — /web-api/health DEGIL)"
H1=$(curl -sS -m 8 http://127.0.0.1:3100/health || true)
log "LOCAL=$H1"
echo "$H1" | grep -q "$EXPECT_V" || die "health version yok: $H1"
echo "$H1" | grep -q "$EXPECT_B" || die "health build yok: $H1"
echo "$H1" | grep -q '"mfa":false' || log "UYARI: mfa true — .env kontrol"
echo "$H1" | grep -q '"ownerOnly":true' && die "personel kilidi hala acik (ownerOnly=true)"
echo "$H1" | grep -q '"storeOk":false' && die "store.json eksik (storeOk=false)"
log "=== BASARILI $EXPECT_V / $EXPECT_B (MFA kapali) ==="
echo OK > /tmp/atak-deploy-OK
log "Log dosyasi: $OUT"
