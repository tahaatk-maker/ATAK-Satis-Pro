#!/bin/bash
# Sadece kullanıcı e-postalarını yedekten geri yazar. Musteri/maas/urun/depo DOKUNULMAZ.
#   curl -fsSL "https://raw.githubusercontent.com/tahaatk-maker/ATAK-Satis-Pro/cursor/asist-fatura-aktarim-474e/atak_finans_server_json/atak%20g%C3%BCncelll/public/assets/vps-restore-staff-emails.sh" | bash
set -euo pipefail
echo "=== STAFF EMAIL RESTORE $(date -Is) ==="

python3 - <<'PY'
import json, os, glob, shutil, time

def fold(s):
    return str(s or "").replace("İ","i").replace("I","i").strip().casefold()

cands=[]
for pat in (
    "/root/*/data/backups/store-*.json",
    "/root/*/data/store.json.bak*",
    "/root/*/data/store.json",
):
    cands += glob.glob(pat)

# boyut + dolu email sayisi
ranked=[]
for p in sorted(set(os.path.realpath(x) for x in cands if os.path.isfile(x)), key=lambda x: -os.path.getsize(x))[:15]:
    try:
        s=json.load(open(p, encoding="utf-8"))
    except Exception:
        continue
    users=s.get("users") if isinstance(s.get("users"), list) else []
    n=sum(1 for u in users if isinstance(u, dict) and str(u.get("email") or "").strip())
    ranked.append((n, os.path.getsize(p), p, s))
    print(f"  emails={n:3d} size={os.path.getsize(p):10d} {p}")

if not ranked:
    raise SystemExit("FAIL: yedek yok")
ranked.sort(reverse=True)
best_n, best_sz, src, bak = ranked[0]
print("BEST", src, "emails", best_n)

bak_by_user={}
for u in (bak.get("users") or []):
    if not isinstance(u, dict):
        continue
    e=str(u.get("email") or "").strip()
    if not e:
        continue
    for k in (fold(u.get("username")), fold(u.get("id")), fold(u.get("name"))):
        if k:
            bak_by_user[k]=e
for st in (bak.get("staff") or []):
    if not isinstance(st, dict):
        continue
    e=str(st.get("email") or "").strip()
    if not e:
        continue
    for k in (fold(st.get("username")), fold(st.get("id")), fold(st.get("name"))):
        if k and k not in bak_by_user:
            bak_by_user[k]=e

stamp=time.strftime("%Y%m%d-%H%M%S")
changed_total=0
for live in ("/root/atakhome-platform/data/store.json", "/root/atak-v10/data/store.json"):
    if not os.path.isfile(live):
        continue
    shutil.copy2(live, live + f".bak-before-email-restore-{stamp}")
    s=json.load(open(live, encoding="utf-8"))
    n=0
    for u in (s.get("users") or []):
        if not isinstance(u, dict):
            continue
        hit=bak_by_user.get(fold(u.get("username"))) or bak_by_user.get(fold(u.get("id"))) or bak_by_user.get(fold(u.get("name")))
        if not hit:
            continue
        cur=str(u.get("email") or "").strip()
        if cur.lower()==hit.lower():
            continue
        u["email"]=hit
        n+=1
        print(f"  SET {u.get('username') or u.get('name')} -> {hit}  (was {cur or 'yok'})  [{live}]")
    for st in (s.get("staff") or []):
        if not isinstance(st, dict):
            continue
        hit=bak_by_user.get(fold(st.get("username"))) or bak_by_user.get(fold(st.get("name")))
        if hit:
            st["email"]=hit
    tmp=live+".tmp"
    json.dump(s, open(tmp,"w",encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, live)
    print(f"UPDATED {live} changed={n}")
    changed_total += n

print("CHANGED", changed_total)
if changed_total==0:
    print("WARN: yedekte eslesen email yok veya zaten ayni")
PY

pm2 restart atak --update-env >/dev/null 2>&1 || true
sleep 3
echo "=== Ctrl+F5 Kullanıcılar: kayıtlı e-postalar ==="
