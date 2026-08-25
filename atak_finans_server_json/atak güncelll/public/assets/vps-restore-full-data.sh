#!/bin/bash
# ACİL: en büyük dolu store yedeğini geri yükle (müşteri/maaş/depo).
# Kod silinmez. Bellekte tüm yedekleri tutmaz (önceki script OOM olabilirdi).
#   curl -fsSL "https://raw.githubusercontent.com/tahaatk-maker/ATAK-Satis-Pro/cursor/asist-fatura-aktarim-474e/atak_finans_server_json/atak%20g%C3%BCncelll/public/assets/vps-restore-full-data.sh" | bash
set -eu
log(){ echo "$*"; }
log "=== FULL DATA RESTORE v2 $(date -Is) ==="

python3 - <<'PY'
import json, os, glob, shutil, subprocess, time, uuid
from datetime import datetime, timezone

SEARCH_ROOTS = ["/root", "/var/www", "/home"]
NAME_HINTS = ("store.json", "store-")

def fold(s):
    return str(s or "").replace("İ","i").replace("I","i").casefold()

def iter_candidates():
    seen=set()
    extra = [
        "/root/atakhome-platform/data/store.json",
        "/root/atak-v10/data/store.json",
    ]
    extra += glob.glob("/root/*/data/store.json")
    extra += glob.glob("/root/*/data/store.json.bak*")
    extra += glob.glob("/root/*/data/backups/store-*.json")
    extra += glob.glob("/root/*/data/backups/store-*.json.bak*")
    for p in extra:
        ap=os.path.realpath(p)
        if ap not in seen and os.path.isfile(ap):
            seen.add(ap)
            yield ap
    for root in SEARCH_ROOTS:
        if not os.path.isdir(root):
            continue
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d not in (".git","node_modules","lost+found")]
            for name in filenames:
                if not (name == "store.json" or name.startswith("store.json.bak") or name.startswith("store-")):
                    continue
                if not name.endswith(".json") and ".bak" not in name:
                    continue
                ap=os.path.realpath(os.path.join(dirpath, name))
                if ap in seen:
                    continue
                seen.add(ap)
                yield ap

rows=[]
print("--- DOSYALAR (boyut) ---")
for path in iter_candidates():
    try:
        sz=os.path.getsize(path)
    except OSError:
        continue
    print(f"  {sz:12d}  {path}")
    rows.append((sz, path))

if not rows:
    raise SystemExit("FAIL: store dosyasi yok")

# Once en buyukleri incele (11MB asil hedef)
rows.sort(reverse=True)
inspect = rows[:12]
print("--- INCELEME (en buyuk 12) ---")

def inspect_file(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            s=json.load(f)
    except Exception as e:
        print("  SKIP", path, e)
        return None
    if not isinstance(s, dict):
        return None
    customers = s.get("customers") if isinstance(s.get("customers"), list) else []
    # bazi eski dump'larda farkli anahtar
    if not customers:
        for k in ("cariler","musteriler","customerList","CariKartlar"):
            if isinstance(s.get(k), list) and len(s.get(k))>len(customers):
                customers=s.get(k)
                s["customers"]=customers
    users = s.get("users") if isinstance(s.get("users"), list) else []
    staff = s.get("staff") if isinstance(s.get("staff"), list) else []
    people = [p for p in users+staff if isinstance(p, dict)]
    sal = sum(1 for p in people if float(p.get("salaryMonthly") or 0) > 0)
    hire = sum(1 for p in people if str(p.get("hireDate") or "").strip())
    names = " ".join(fold(p.get("name") or p.get("username") or "") for p in people)
    wh = s.get("warehouses") if isinstance(s.get("warehouses"), list) else []
    whn = " ".join(fold(w.get("name") or w.get("code") or "") for w in wh if isinstance(w, dict))
    info = {
        "path": path,
        "size": os.path.getsize(path),
        "customers": len(customers),
        "salaryPeople": sal,
        "hirePeople": hire,
        "warehouses": len(wh),
        "istikbalDepo": ("istikbal" in whn),
        "ramazan": "ramazan" in names,
        "emine": "emine" in names,
        "products": len(s.get("products") or []) if isinstance(s.get("products"), list) else 0,
        "keys": sorted(list(s.keys()))[:40],
    }
    # skoru hesapla; nesneyi RAM'de tutma
    info["score"] = (
        info["customers"] * 10
        + info["salaryPeople"] * 400
        + info["hirePeople"] * 80
        + info["warehouses"] * 20
        + (800 if info["istikbalDepo"] else 0)
        + (400 if info["ramazan"] else 0)
        + (300 if info["emine"] else 0)
        + min(info["size"] // 20000, 800)
    )
    print(
        f"  sc={info['score']:7d} cust={info['customers']:6d} sal={info['salaryPeople']} "
        f"hire={info['hirePeople']} wh={info['warehouses']} istDepo={info['istikbalDepo']} "
        f"ramazan={info['ramazan']} emine={info['emine']} prod={info['products']} "
        f"size={info['size']} {path}"
    )
    del s
    return info

metas=[]
for sz, path in inspect:
    m=inspect_file(path)
    if m:
        metas.append(m)

if not metas:
    raise SystemExit("FAIL: hicbir yedek okunamadi")

# 1000+ musteri varsa onu tercih et; yoksa en buyuk skor (boyut agir)
rich=[m for m in metas if m["customers"] >= 1000]
if rich:
    best=sorted(rich, key=lambda x: (x["score"], x["customers"], x["size"]), reverse=True)[0]
else:
    print("WARN: 1000+ musteri iceren dosya yok — en buyuk/skorlu dosya denenecek")
    best=sorted(metas, key=lambda x: (x["score"], x["size"]), reverse=True)[0]

print("BEST", best["path"], "cust", best["customers"], "size", best["size"], "sal", best["salaryPeople"])

if best["customers"] < 100 and best["size"] < 3_000_000:
    raise SystemExit("FAIL: dolu yedek yok (musteri<%d size=%d). Hostinger yedek/snapshot gerekir." % (best["customers"], best["size"]))

# Hedef kokler: HER IKISINE de yaz (pm2 hangisini kullanirsa kullanir)
targets=[]
for d in ("/root/atakhome-platform", "/root/atak-v10"):
    if os.path.isdir(d):
        targets.append(os.path.join(d, "data", "store.json"))
if not targets:
    raise SystemExit("FAIL: ERP klasoru yok")

stamp=time.strftime("%Y%m%d-%H%M%S")
src=best["path"]
for dst in targets:
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    if os.path.isfile(dst) and os.path.realpath(dst) != os.path.realpath(src):
        bak=dst + f".bak-before-full-restore-{stamp}"
        shutil.copy2(dst, bak)
        print("LIVE_BAK", bak)
    if os.path.realpath(dst) == os.path.realpath(src):
        print("SKIP_SAME", dst)
        continue
    shutil.copy2(src, dst)
    print("COPIED", src, "->", dst, "bytes", os.path.getsize(dst))

# audit notu (platform)
try:
    live=targets[0]
    with open(live, "r", encoding="utf-8") as f:
        s=json.load(f)
    logs=s.get("auditLogs") if isinstance(s.get("auditLogs"), list) else []
    logs.insert(0, {
        "id": str(uuid.uuid4()),
        "date": datetime.now(timezone.utc).isoformat(),
        "actor": "Yonetici",
        "action": "TAM veri restore v2",
        "entity": src,
        "details": {k: best[k] for k in best if k != "keys"},
    })
    s["auditLogs"]=logs[:500]
    tmp=live+".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(s, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, live)
    # ikinci koke de ayni icerik
    if len(targets)>1 and os.path.realpath(targets[1]) != os.path.realpath(live):
        shutil.copy2(live, targets[1])
    del s
except Exception as e:
    print("AUDIT_WARN", e)

# pm2 cwd
cwd="/root/atakhome-platform" if os.path.isdir("/root/atakhome-platform") else "/root/atak-v10"
try:
    import json as _j
    j=subprocess.check_output(["pm2","jlist"], text=True, stderr=subprocess.DEVNULL)
    arr=_j.loads(j)
    p=next((x for x in arr if x.get("name")=="atak"), None)
    if p:
        cwd=(p.get("pm2_env") or {}).get("pm_cwd") or cwd
except Exception:
    pass
if not os.path.isfile(os.path.join(cwd, "server.js")):
    cwd="/root/atakhome-platform" if os.path.isfile("/root/atakhome-platform/server.js") else "/root/atak-v10"

print("PM2_START_CWD", cwd)
subprocess.call(["pm2","stop","atak"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
subprocess.call(["pm2","delete","atak"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
subprocess.check_call(["pm2","start","server.js","--name","atak","--update-env"], cwd=cwd)
subprocess.call(["pm2","save"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
print("PM2_OK")
print("BEST_JSON", json.dumps({k:best[k] for k in best if k!="keys"}))
PY

log "kodu koru (data haric)..."
set +e
BRANCH="${ATAK_BRANCH:-cursor/asist-fatura-aktarim-474e}"
rm -rf /tmp/atak-full-restore-src /tmp/atak-full-restore-code.tgz
mkdir -p /tmp/atak-full-restore-src
if curl -4 -fL --connect-timeout 20 --max-time 120 \
  "https://codeload.github.com/tahaatk-maker/ATAK-Satis-Pro/tar.gz/refs/heads/${BRANCH}" \
  -o /tmp/atak-full-restore-code.tgz; then
  tar -xzf /tmp/atak-full-restore-code.tgz -C /tmp/atak-full-restore-src
  SRC=$(find /tmp/atak-full-restore-src -type d -name 'atak güncelll' | head -1)
  for D in /root/atakhome-platform /root/atak-v10; do
    [ -d "$D" ] || continue
    [ -n "$SRC" ] && [ -f "$SRC/server.js" ] || continue
    mkdir -p "$D/public/assets" "$D/lib"
    cp -f "$SRC/server.js" "$D/server.js"
    cp -f "$SRC/public/admin.html" "$D/public/admin.html" 2>/dev/null || true
    cp -f "$SRC/public/assets/admin.js" "$D/public/assets/admin.js" 2>/dev/null || true
    cp -f "$SRC/lib/purchase-csv.js" "$D/lib/purchase-csv.js" 2>/dev/null || true
    cp -f "$SRC/lib/istikbal-category.js" "$D/lib/istikbal-category.js" 2>/dev/null || true
    log "CODE_SYNC $D"
  done
  pm2 restart atak --update-env >/dev/null 2>&1
  log "CODE_SYNC_OK"
else
  log "CODE_SYNC_SKIP (github indirilemedi — veri yine yuklendi)"
fi
set -e

sleep 5
H=$(curl -sS -m 12 http://127.0.0.1:3100/health || true)
log "HEALTH=$H"

python3 - <<'PY'
import json, os
paths=["/root/atakhome-platform/data/store.json","/root/atak-v10/data/store.json"]
ok=False
for p in paths:
    if not os.path.isfile(p):
        continue
    s=json.load(open(p, encoding="utf-8"))
    cust=len(s.get("customers") or [])
    wh=len(s.get("warehouses") or [])
    people=[x for x in (s.get("users") or [])+(s.get("staff") or []) if isinstance(x, dict)]
    sal=sum(1 for x in people if float(x.get("salaryMonthly") or 0)>0)
    hire=sum(1 for x in people if str(x.get("hireDate") or "").strip())
    print(f"VERIFY {p} customers={cust} warehouses={wh} salaryPeople={sal} hirePeople={hire} products={len(s.get('products') or [])} size={os.path.getsize(p)}")
    if cust >= 1000:
        ok=True
if not ok:
    raise SystemExit("FAIL: musteri hala <1000 — VPS'te 11MB yedek kalmamis olabilir, Hostinger snapshot acin")
print("OK_FULL_DATA_RESTORE")
PY

log "=== Ctrl+F5: Musteriler ~11000 / Para&Maas / Istikbal depo ==="
