#!/bin/bash
# Tüm fiziksel stokları 0 yapar (yedek alır). data dışında hiçbir şeye dokunmaz.
set -euo pipefail
OUT=/tmp/atak-stock-zero.txt
: > "$OUT"
log(){ echo "$*" | tee -a "$OUT"; }
die(){ log "FAIL: $*"; exit 1; }

log "=== ATAK STOK SIFIRLA ==="
APP="${APP_DIR:-/root/atak-v10}"
[ -d /root/atakhome-platform ] && [ ! -f "$APP/server.js" ] && APP=/root/atakhome-platform
STORE="$APP/data/store.json"
[ -f "$STORE" ] || STORE=/root/atak-v10/data/store.json
[ -f "$STORE" ] || STORE=/root/atakhome-platform/data/store.json
[ -f "$STORE" ] || die "store.json bulunamadi"

log "STORE=$STORE"
BAK="$STORE.bak-stock-zero-$(date +%Y%m%d-%H%M%S)"
cp -a "$STORE" "$BAK"
log "YEDEK=$BAK"

RESULT=$(node -e '
const fs=require("fs");
const p=process.argv[1];
const s=JSON.parse(fs.readFileSync(p,"utf8"));
s.productStocks=Array.isArray(s.productStocks)?s.productStocks:[];
s.stockMovements=Array.isArray(s.stockMovements)?s.stockMovements:[];
s.products=Array.isArray(s.products)?s.products:[];
s.auditLog=Array.isArray(s.auditLog)?s.auditLog:[];
let cleared=0,units=0,reservedCleared=0;
const now=new Date().toISOString();
for(const row of s.productStocks){
  const qty=Math.max(0,Math.round(Number(row.quantity||0)));
  const reserved=Math.max(0,Math.round(Number(row.reserved||0)));
  if(qty>0){
    s.stockMovements.unshift({
      id:require("crypto").randomUUID(),
      productCode:row.productCode,
      warehouseId:row.warehouseId,
      type:"inventory_zero",
      quantity:-qty,
      before:qty,
      after:0,
      reference:"STOK-SIFIR",
      note:"VPS toplu stok sifirlama",
      user:"VPS",
      createdAt:now
    });
    row.quantity=0;
    row.updatedAt=now;
    cleared++;
    units+=qty;
  }
  if(reserved>0){
    row.reserved=0;
    row.updatedAt=now;
    reservedCleared+=reserved;
  }
}
let productStockCleared=0;
for(const prod of s.products){
  if(Number(prod.stock||0)!==0){
    prod.stock=0;
    prod.updatedAt=now;
    productStockCleared++;
  }
}
s.auditLog.unshift({
  id:require("crypto").randomUUID(),
  action:"Stoklar sifirlandi",
  target:"Tumu",
  detail:{cleared,units,reservedCleared,productStockCleared,via:"vps-stock-zero.sh"},
  at:now,
  user:"VPS"
});
fs.writeFileSync(p,JSON.stringify(s));
process.stdout.write(JSON.stringify({ok:true,cleared,units,reservedCleared,productStockCleared}));
' "$STORE") || die "node sifirlama hatasi"

log "SONUC=$RESULT"
log "=== BASARILI — panelde Ctrl+Shift+R / Stok Merkezi Yenile ==="
echo "$RESULT"
)