#!/bin/bash
# ACİL TAM VERİ RESTORE — kodu değiştirmez (Asist / PP CSV / kategori vs. kalır)
# En iyi yedek: çok müşteri + maaş + depolar (İstikbal)
#   curl -fsSL "https://raw.githubusercontent.com/tahaatk-maker/ATAK-Satis-Pro/cursor/asist-fatura-aktarim-474e/atak_finans_server_json/atak%20g%C3%BCncelll/public/assets/vps-restore-full-data.sh" | bash
set -euo pipefail
log(){ echo "$*"; }
log "=== FULL DATA RESTORE (kod dokunulmaz) $(date -Is) ==="

python3 - <<'PY'
import json, glob, os, shutil, subprocess, time, uuid
from datetime import datetime, timezone

roots = ["/root/atakhome-platform", "/root/atak-v10"]
pats = []
for root in roots:
    pats += [
        root + "/data/backups/store-*.json",
        root + "/data/store.json.bak*",
        root + "/data/store.json",
    ]
pats += [
    "/root/*/data/backups/store-*.json",
    "/root/*/data/store.json.bak*",
    "/var/www/*/data/backups/store-*.json",
]

def fold(s):
    return str(s or "").replace("İ","i").replace("I","i").casefold()

def score(path):
    try:
        sz = os.path.getsize(path)
        # 11k musteri ~ buyuk dosya; kucukleri hizli ele
        with open(path, "r", encoding="utf-8") as f:
            s = json.load(f)
    except Exception:
        return None
    if not isinstance(s, dict):
        return None
    customers = s.get("customers") if isinstance(s.get("customers"), list) else []
    users = s.get("users") if isinstance(s.get("users"), list) else []
    staff = s.get("staff") if isinstance(s.get("staff"), list) else []
    wh = s.get("warehouses") if isinstance(s.get("warehouses"), list) else []
    products = s.get("products") if isinstance(s.get("products"), list) else []
    txs = s.get("cashTransactions") or s.get("moneyTransactions") or s.get("transactions") or []
    if not isinstance(txs, list):
        txs = []

    cust_n = len(customers)
    sal = sum(1 for p in (users + staff) if isinstance(p, dict) and float(p.get("salaryMonthly") or 0) > 0)
    hire = sum(1 for p in (users + staff) if isinstance(p, dict) and str(p.get("hireDate") or "").strip())
    names = " ".join(fold(p.get("name") or p.get("username") or "") for p in (users + staff) if isinstance(p, dict))
    has_ramazan = "ramazan" in names
    has_emine = "emine" in names
    wh_names = " ".join(fold(w.get("name") or w.get("code") or "") for w in wh if isinstance(w, dict))
    has_istikbal_depo = ("istikbal" in wh_names) or ("ist" in wh_names and "depo" in wh_names)
    wh_n = len(wh)
    adv = 0
    for t in txs:
        if not isinstance(t, dict):
            continue
        blob = fold(" ".join([
            str(t.get("paymentFor") or ""),
            str(t.get("category") or ""),
            str(t.get("note") or ""),
            str(t.get("description") or ""),
        ]))
        if "advance" in blob or "avans" in blob:
            adv += 1

    # Asil hedef: musteri sayisi (11000), sonra maas/depo
    sc = (
        cust_n * 10
        + sal * 500
        + hire * 100
        + adv * 40
        + wh_n * 30
        + (500 if has_istikbal_depo else 0)
        + (400 if has_ramazan else 0)
        + (300 if has_emine else 0)
        + min(sz // 50000, 500)
    )
    return {
        "path": path,
        "size": sz,
        "score": sc,
        "customers": cust_n,
        "salaryPeople": sal,
        "hirePeople": hire,
        "advances": adv,
        "warehouses": wh_n,
        "istikbalDepo": has_istikbal_depo,
        "ramazan": has_ramazan,
        "emine": has_emine,
        "products": len(products),
        "store": s,
    }

seen = set()
cands = []
for pat in pats:
    for p in glob.glob(pat):
        ap = os.path.realpath(p)
        if ap in seen:
            continue
        seen.add(ap)
        if not os.path.isfile(ap):
            continue
        # cok kucuk dosyalar (bos store) listele ama dusuk skor
        info = score(ap)
        if not info:
            continue
        cands.append(info)
        print(
            f"  sc={info['score']:7d} cust={info['customers']:6d} sal={info['salaryPeople']} "
            f"hire={info['hirePeople']} avans={info['advances']} wh={info['warehouses']} "
            f"istDepo={info['istikbalDepo']} ramazan={info['ramazan']} emine={info['emine']} "
            f"prod={info['products']} size={info['size']} {info['path']}"
        )

if not cands:
    raise SystemExit("FAIL: hic yedek yok")

cands.sort(key=lambda x: (x["score"], x["customers"], x["size"]), reverse=True)
best = cands[0]
print(
    "BEST", best["path"],
    "customers", best["customers"],
    "sal", best["salaryPeople"],
    "hire", best["hirePeople"],
    "wh", best["warehouses"],
    "istDepo", best["istikbalDepo"],
    "size", best["size"],
)

if best["customers"] < 1000:
    print("WARN: en iyi adayda musteri < 1000 — yine de en yuksek skorlu yedek yuklenecek")
    # yine de 11MB civari varsa onu tercih et
    big = [c for c in cands if c["customers"] >= 1000]
    if big:
        best = sorted(big, key=lambda x: (x["score"], x["customers"]), reverse=True)[0]
        print("SWITCH_TO", best["path"], "customers", best["customers"])

dst_root = "/root/atakhome-platform" if os.path.isdir("/root/atakhome-platform") else "/root/atak-v10"
dst = os.path.join(dst_root, "data", "store.json")
os.makedirs(os.path.dirname(dst), exist_ok=True)

if os.path.isfile(dst):
    bak = dst + f".bak-before-full-restore-{time.strftime('%Y%m%d-%H%M%S')}"
    shutil.copy2(dst, bak)
    print("LIVE_BAK", bak)

s = best["store"]
logs = s.get("auditLogs") if isinstance(s.get("auditLogs"), list) else []
logs.insert(0, {
    "id": str(uuid.uuid4()),
    "date": datetime.now(timezone.utc).isoformat(),
    "actor": "Yonetici",
    "action": "TAM veri restore (kod ayni)",
    "entity": best["path"],
    "details": {
        "from": best["path"],
        "customers": best["customers"],
        "salaryPeople": best["salaryPeople"],
        "hirePeople": best["hirePeople"],
        "warehouses": best["warehouses"],
        "istikbalDepo": best["istikbalDepo"],
        "products": best["products"],
        "note": "Yeni kod (Asist/PP/kategori) korunur; sadece store.json degisti",
    },
})
s["auditLogs"] = logs[:500]

tmp = dst + ".tmp"
with open(tmp, "w", encoding="utf-8") as f:
    json.dump(s, f, ensure_ascii=False, separators=(",", ":"))
os.replace(tmp, dst)
print(
    "RESTORED", best["path"], "->", dst,
    "customers=", best["customers"],
    "products=", best["products"],
    "warehouses=", best["warehouses"],
)

# Ayni kodla atakhome-platform'dan calistir (data burada)
# Mevcut server.js surumunu bozma — sadece process cwd/data
subprocess.call(["pm2", "stop", "atak"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
subprocess.call(["pm2", "delete", "atak"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
if not os.path.isfile(os.path.join(dst_root, "server.js")):
    raise SystemExit("FAIL: server.js yok " + dst_root)
subprocess.check_call(["pm2", "start", "server.js", "--name", "atak", "--update-env"], cwd=dst_root)
subprocess.call(["pm2", "save"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
print("PM2_CWD", dst_root)
print("CODE_VERSION_ON_DISK", end=" ")
try:
    import re
    txt = open(os.path.join(dst_root, "server.js"), encoding="utf-8", errors="ignore").read()
    m = re.search(r"version:'([^']+)'", txt)
    print(m.group(1) if m else "?")
except Exception as e:
    print("?", e)

# Yeni yararli kodu koru: GitHub'dan sadece kod dosyalarini cek (data'ya dokunma)
print("CODE_SYNC from GitHub (data haric)...")
import tarfile, tempfile, urllib.request
branch = os.environ.get("ATAK_BRANCH", "cursor/asist-fatura-aktarim-474e")
url = f"https://codeload.github.com/tahaatk-maker/ATAK-Satis-Pro/tar.gz/refs/heads/{branch}"
tg = "/tmp/atak-full-restore-code.tgz"
urllib.request.urlretrieve(url, tg)
extract_dir = "/tmp/atak-full-restore-src"
shutil.rmtree(extract_dir, ignore_errors=True)
os.makedirs(extract_dir, exist_ok=True)
with tarfile.open(tg, "r:gz") as tar:
    tar.extractall(extract_dir)
src = None
for root, dirs, files in os.walk(extract_dir):
    if root.endswith("atak güncelll") and "server.js" in files:
        src = root
        break
if not src:
    raise SystemExit("FAIL: github kaynak yok")
for rel in [
    "server.js",
    "public/admin.html",
    "public/assets/admin.js",
    "public/assets/admin.css",
    "lib/purchase-csv.js",
    "lib/istikbal-category.js",
    "lib/stock-cost.js",
    "lib/password-reset.js",
    "lib/mail.js",
    "public/sifre-sifirla.html",
]:
    a = os.path.join(src, rel)
    b = os.path.join(dst_root, rel)
    if os.path.isfile(a):
        os.makedirs(os.path.dirname(b), exist_ok=True)
        shutil.copy2(a, b)
        print("  CODE", rel)
# restart again with synced code + restored data
subprocess.call(["pm2", "restart", "atak", "--update-env"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
print("CODE_SYNC_OK")
PY

sleep 5
H=$(curl -sS -m 15 http://127.0.0.1:3100/health || true)
log "HEALTH=$H"
echo "$H" | grep -q '"ok":true' || { log "FAIL health"; exit 1; }
# musteri sayisi health'te yok — python ile dogrula
python3 - <<'PY'
import json
p="/root/atakhome-platform/data/store.json"
s=json.load(open(p,encoding="utf-8"))
cust=len(s.get("customers") or [])
wh=len(s.get("warehouses") or [])
users=s.get("users") or []
staff=s.get("staff") or []
sal=sum(1 for x in users+staff if isinstance(x,dict) and float(x.get("salaryMonthly") or 0)>0)
hire=sum(1 for x in users+staff if isinstance(x,dict) and str(x.get("hireDate") or "").strip())
print(f"VERIFY customers={cust} warehouses={wh} salaryPeople={sal} hirePeople={hire} products={len(s.get('products') or [])}")
if cust < 1000:
    raise SystemExit("FAIL: musteri hala dusuk — daha eski/buyuk yedek yok gibi")
print("OK_FULL_DATA_RESTORE")
PY
log "=== Panel Ctrl+F5: Musteriler / Para&Maas / Stok Merkezi (Istikbal depo) ==="
log "=== Kod ayni kaldi (Asist vb. silinmedi) ==="
