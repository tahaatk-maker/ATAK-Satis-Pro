#!/bin/bash
# Clear ALL products, keep categories / customers / sales.
# ASCII only. Chrome translate must not rewrite this file.
set -euo pipefail
echo "CLEAR-PRODUCTS START $(date -Is)"

APP=""
if command -v pm2 >/dev/null 2>&1; then
  APP=$(pm2 jlist 2>/dev/null | python3 -c 'import json,sys
try:
 d=json.load(sys.stdin)
 p=next((x for x in d if x.get("name")=="atak"),None)
 print((p or {}).get("pm2_env",{}).get("pm_cwd") or "")
except Exception:
 print("")' || true)
fi
[ -n "$APP" ] || APP=/root/atak-v10
if [ ! -f "$APP/data/store.json" ] && [ -f /root/atakhome-platform/data/store.json ]; then
  APP=/root/atakhome-platform
fi
STORE="$APP/data/store.json"
echo "APP=$APP"
echo "STORE=$STORE"
[ -f "$STORE" ] || { echo "FAIL_NO_STORE"; exit 1; }

BAK="$STORE.bak-clear-products-$(date +%Y%m%d-%H%M%S)"
cp -a "$STORE" "$BAK"
echo "BACKUP=$BAK"

python3 - "$STORE" <<'PY'
import json, sys, uuid
from datetime import datetime, timezone
path=sys.argv[1]
with open(path, "r", encoding="utf-8") as f:
    s=json.load(f)
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
    "entity": f"{removed} urun",
    "details": {"removed": removed, "stocksCleared": stocks_n, "categoriesKept": len(cats)}
})
s["auditLogs"]=logs[:300]
tmp=path+".tmp"
with open(tmp, "w", encoding="utf-8") as f:
    json.dump(s, f, ensure_ascii=False, separators=(",", ":"))
import os
os.replace(tmp, path)
print(f"CLEARED products={removed} stocks={stocks_n} categories_kept={len(cats)}")
PY

if command -v pm2 >/dev/null 2>&1; then
  pm2 restart atak --update-env || true
fi
echo "CLEAR-PRODUCTS_OK"
echo "CHECK panel: Tüm Ürünler boş olmalı, Kategoriler durmalı."
