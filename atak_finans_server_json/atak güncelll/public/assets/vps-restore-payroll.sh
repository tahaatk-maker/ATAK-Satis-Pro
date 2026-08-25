#!/bin/bash
# ACİL: Maaş / avans / işe başlama yedekten geri gelsin.
# Ürünler yine BOŞ kalır (sadece ürün silinmiş olsun istiyorsanız).
#   curl -fsSL "https://raw.githubusercontent.com/tahaatk-maker/ATAK-Satis-Pro/cursor/asist-fatura-aktarim-474e/atak_finans_server_json/atak%20g%C3%BCncelll/public/assets/vps-restore-payroll.sh" | bash
set -euo pipefail
log(){ echo "$*"; }
log "=== PAYROLL RESTORE $(date -Is) ==="

python3 - <<'PY'
import json, glob, os, shutil, subprocess, time, uuid
from datetime import datetime, timezone

roots = ["/root/atakhome-platform", "/root/atak-v10"]
patterns = []
for root in roots:
    patterns += [
        root + "/data/backups/store-*.json",
        root + "/data/store.json.bak*",
        root + "/data/store.json",
    ]
# genis tarama
patterns += [
    "/root/*/data/backups/store-*.json",
    "/root/*/data/store.json.bak*",
]

def score(path):
    try:
        sz = os.path.getsize(path)
        with open(path, "r", encoding="utf-8") as f:
            s = json.load(f)
    except Exception as e:
        return None
    if not isinstance(s, dict):
        return None
    users = s.get("users") if isinstance(s.get("users"), list) else []
    staff = s.get("staff") if isinstance(s.get("staff"), list) else []
    txs = s.get("cashTransactions") or s.get("moneyTransactions") or s.get("transactions") or []
    if not isinstance(txs, list):
        txs = []
    people = []
    for row in users + staff:
        if isinstance(row, dict):
            people.append(row)
    sal = 0
    hire = 0
    names = set()
    for p in people:
        if float(p.get("salaryMonthly") or 0) > 0:
            sal += 1
        if str(p.get("hireDate") or "").strip():
            hire += 1
        n = str(p.get("name") or p.get("username") or "").casefold()
        names.add(n)
    # avans islemleri
    adv = 0
    for t in txs:
        if not isinstance(t, dict):
            continue
        blob = " ".join([
            str(t.get("paymentFor") or ""),
            str(t.get("category") or ""),
            str(t.get("note") or ""),
            str(t.get("description") or ""),
        ]).casefold()
        if "advance" in blob or "avans" in blob:
            adv += 1
    has_ramazan = any("ramazan" in n for n in names)
    has_emine = any("emine" in n for n in names)
    prods = len(s.get("products") or [])
    # skor: maaş+hire+avans asıl hedef; eski büyük yedek bonus
    sc = sal * 1000 + hire * 200 + adv * 50 + (300 if has_ramazan else 0) + (200 if has_emine else 0) + min(sz // 100000, 200)
    return {
        "path": path,
        "size": sz,
        "score": sc,
        "salaryPeople": sal,
        "hirePeople": hire,
        "advances": adv,
        "ramazan": has_ramazan,
        "emine": has_emine,
        "products": prods,
        "staff": len(staff),
        "users": len(users),
        "store": s,
    }

seen = set()
cands = []
for pat in patterns:
    for p in glob.glob(pat):
        ap = os.path.realpath(p)
        if ap in seen:
            continue
        seen.add(ap)
        info = score(ap)
        if not info:
            continue
        cands.append(info)
        print(f"  score={info['score']:6d} sal={info['salaryPeople']} hire={info['hirePeople']} avans={info['advances']} ramazan={info['ramazan']} emine={info['emine']} prod={info['products']} size={info['size']} {info['path']}")

if not cands:
    raise SystemExit("FAIL: yedek bulunamadi")

cands.sort(key=lambda x: (x["score"], x["size"]), reverse=True)
best = cands[0]
print("BEST", best["path"], "score", best["score"], "sal", best["salaryPeople"], "hire", best["hirePeople"], "avans", best["advances"])

if best["salaryPeople"] < 1 and best["advances"] < 1 and best["hirePeople"] < 1:
    # yine de en buyuk eski dosyayi dene
    big = sorted(cands, key=lambda x: x["size"], reverse=True)[0]
    print("WARN: maas skoru dusuk, en buyuk dosya deneniyor", big["path"])
    best = big

dst_root = "/root/atakhome-platform" if os.path.isdir("/root/atakhome-platform") else "/root/atak-v10"
dst = os.path.join(dst_root, "data", "store.json")
os.makedirs(os.path.dirname(dst), exist_ok=True)

# canliyi yedekle
if os.path.isfile(dst):
    bak = dst + f".bak-before-payroll-restore-{time.strftime('%Y%m%d-%H%M%S')}"
    shutil.copy2(dst, bak)
    print("LIVE_BAK", bak)

s = best["store"]
# Ürünleri BOŞ bırak (kullanıcı ürün silinsin istemişti) — maaş/avans/personel gelsin
removed = len(s.get("products") or [])
s["products"] = []
s["productStocks"] = []
logs = s.get("auditLogs") if isinstance(s.get("auditLogs"), list) else []
logs.insert(0, {
    "id": str(uuid.uuid4()),
    "date": datetime.now(timezone.utc).isoformat(),
    "actor": "Yonetici",
    "action": "Payroll yedek restore (urunler bos)",
    "entity": best["path"],
    "details": {
        "from": best["path"],
        "salaryPeople": best["salaryPeople"],
        "hirePeople": best["hirePeople"],
        "advances": best["advances"],
        "productsCleared": removed,
    }
})
s["auditLogs"] = logs[:400]

tmp = dst + ".tmp"
with open(tmp, "w", encoding="utf-8") as f:
    json.dump(s, f, ensure_ascii=False, separators=(",", ":"))
os.replace(tmp, dst)
print("RESTORED", best["path"], "->", dst, "products=0 salaryPeople=", best["salaryPeople"])

# pm2 dogru klasorden
subprocess.call(["pm2", "stop", "atak"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
subprocess.call(["pm2", "delete", "atak"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
subprocess.check_call(["pm2", "start", "server.js", "--name", "atak", "--update-env"], cwd=dst_root)
subprocess.call(["pm2", "save"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
print("PM2_CWD", dst_root)
PY

sleep 5
H=$(curl -sS -m 12 http://127.0.0.1:3100/health || true)
log "HEALTH=$H"
log "=== KONTROL: Panel → Para & Maaş → Emine / Ramazan maaş-avans-işe başlama ==="
log "=== Ürünler bilerek BOŞ bırakıldı ==="
