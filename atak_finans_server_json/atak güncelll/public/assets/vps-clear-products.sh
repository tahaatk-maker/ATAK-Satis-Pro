#!/bin/bash
# Empty Tüm Ürünler only. Keep categories. Collapse duplicate brands.
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
brands=s.get("brands") if isinstance(s.get("brands"), list) else []
removed=len(prods)
stocks_n=len(stocks)
keep=[]
seen={}
for i,b in enumerate(brands):
    if not isinstance(b, dict):
        continue
    name=str(b.get("name") or "").strip() or "Marka"
    key=name.replace("İ","i").replace("I","i").casefold()
    if key in seen:
        prev=seen[key]
        if not prev.get("logo") and b.get("logo"):
            prev["logo"]=b.get("logo")
        continue
    row={
        "id": "istikbal" if key=="istikbal" else str(b.get("id") or ("b"+str(i))),
        "name": name,
        "active": b.get("active", True) is not False,
        "sort": int(b.get("sort") or i or 0),
        "logo": str(b.get("logo") or "")
    }
    seen[key]=row
    keep.append(row)
s["products"]=[]
s["productStocks"]=[]
s["categories"]=cats
s["brands"]=keep
logs=s.get("auditLogs") if isinstance(s.get("auditLogs"), list) else []
logs.insert(0,{
    "id": str(uuid.uuid4()),
    "date": datetime.now(timezone.utc).isoformat(),
    "actor": "Yonetici",
    "action": "Tum urunler silindi",
    "entity": str(removed)+" urun",
    "details": {"removed": removed, "stocksCleared": stocks_n, "categoriesKept": len(cats), "brandsAfter": len(keep)}
})
s["auditLogs"]=logs[:300]
tmp=path+".tmp"
with open(tmp, "w", encoding="utf-8") as f:
    json.dump(s, f, ensure_ascii=False, separators=(",", ":"))
os.replace(tmp, path)
print("SILINEN_URUN="+str(removed)+" SILINEN_STOK="+str(stocks_n)+" KALAN_KATEGORI="+str(len(cats))+" KALAN_MARKA="+str(len(keep))+" DOSYA="+path)
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
    if command -v pm2 >/dev/null 2>&1; then
      pm2 jlist 2>/dev/null | python3 -c 'import json,sys,os
try:
  d=json.load(sys.stdin)
except Exception:
  raise SystemExit(0)
for p in d:
  cwd=((p.get("pm2_env") or {}).get("pm_cwd") or "")
  if cwd:
    print(os.path.join(cwd, "data", "store.json"))
' || true
    fi
    find /root /var/www /home -maxdepth 6 -type f -name store.json 2>/dev/null
  } | awk 'NF && !seen[$0]++'
)

echo "STORE_COUNT=$FOUND"
[ "$FOUND" -gt 0 ] || { echo "FAIL_NO_STORE"; exit 1; }

if command -v pm2 >/dev/null 2>&1; then
  pm2 restart atak --update-env || true
fi

sleep 2
echo "VERIFY"
python3 - <<'PY'
import json,glob
paths=sorted(set(glob.glob("/root/*/data/store.json")+glob.glob("/root/*/*/data/store.json")+["/root/atak-v10/data/store.json","/root/atakhome-platform/data/store.json"]))
for path in paths:
    try:
        with open(path,"r",encoding="utf-8") as f:
            s=json.load(f)
    except Exception:
        continue
    if not isinstance(s,dict):
        continue
    print("FILE",path,"urun",len(s.get("products") or []),"kategori",len(s.get("categories") or []),"marka",len(s.get("brands") or []))
PY
for P in 3100 3000 3200; do
  H=$(curl -sS -m 3 "http://127.0.0.1:$P/health" 2>/dev/null || true)
  [ -n "$H" ] && echo "HEALTH_$P=$H"
done

echo "CLEAR-PRODUCTS_OK"
echo "PANEL Ctrl+Shift+R : Tum Urunler = 0 , Markalar tek Istikbal , Kategoriler durur"
