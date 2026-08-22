#!/bin/bash
# Clear ALL products, keep categories / customers / sales.
# ASCII only. Do not translate this file.
set -euo pipefail
echo "CLEAR-PRODUCTS START $(date -Is)"

clear_one(){
  local STORE="$1"
  [ -f "$STORE" ] || return 0
  local BAK="$STORE.bak-clear-products-$(date +%Y%m%d-%H%M%S)"
  cp -a "$STORE" "$BAK"
  echo "BACKUP=$BAK"
  python3 - "$STORE" <<'PY'
import json, sys, uuid, os
from datetime import datetime, timezone
path=sys.argv[1]
with open(path, "r", encoding="utf-8") as f:
    s=json.load(f)
if not isinstance(s, dict):
    print("SKIP_NOT_OBJECT", path)
    raise SystemExit(0)
cats=s.get("categories") if isinstance(s.get("categories"), list) else []
prods=s.get("products") if isinstance(s.get("products"), list) else []
stocks=s.get("productStocks") if isinstance(s.get("productStocks"), list) else []
removed=len(prods)
stocks_n=len(stocks)
s["products"]=[]
s["productStocks"]=[]
s["categories"]=cats
logs=s.get("auditLogs") if isinstance(s.get("auditLogs"), list) else []
logs.insert(0,{
    "id": str(uuid.uuid4()),
    "date": datetime.now(timezone.utc).isoformat(),
    "actor": "Yonetici",
    "action": "Tum urunler silindi",
    "entity": str(removed)+" urun",
    "details": {"removed": removed, "stocksCleared": stocks_n, "categoriesKept": len(cats)}
})
s["auditLogs"]=logs[:300]
tmp=path+".tmp"
with open(tmp, "w", encoding="utf-8") as f:
    json.dump(s, f, ensure_ascii=False, separators=(",", ":"))
os.replace(tmp, path)
print("SILINEN_URUN="+str(removed)+" SILINEN_STOK="+str(stocks_n)+" KALAN_KATEGORI="+str(len(cats))+" DOSYA="+path)
PY
}

FOUND=0
while IFS= read -r f; do
  [ -f "$f" ] || continue
  echo "STORE=$f"
  clear_one "$f"
  FOUND=$((FOUND+1))
done < <(
  {
    echo /root/atak-v10/data/store.json
    echo /root/atakhome-platform/data/store.json
    find /root /var/www /home -maxdepth 5 -type f -name store.json 2>/dev/null
  } | awk 'NF && !seen[$0]++'
)

echo "STORE_COUNT=$FOUND"
[ "$FOUND" -gt 0 ] || { echo "FAIL_NO_STORE"; exit 1; }

if command -v pm2 >/dev/null 2>&1; then
  pm2 restart atak --update-env || true
  pm2 restart atakhome-ticaret --update-env || true
  pm2 restart atakhome-web --update-env || true
fi

echo "CLEAR-PRODUCTS_OK"
echo "PANEL: Ctrl+Shift+R  ->  Tum Urunler = 0   Kategoriler durur"
