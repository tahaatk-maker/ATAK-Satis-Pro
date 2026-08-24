#!/bin/bash
# Acil: bos store'u atakhome-platform yedeginden geri yukle + dogru klasorden atak baslat
#   curl -fsSL "https://raw.githubusercontent.com/tahaatk-maker/ATAK-Satis-Pro/cursor/asist-fatura-aktarim-474e/atak_finans_server_json/atak%20g%C3%BCncelll/public/assets/vps-restore-store.sh" | bash
set -euo pipefail
log(){ echo "$*"; }

ROOT_P=/root/atakhome-platform
ROOT_V=/root/atak-v10

log "=== STORE RESTORE ==="
python3 - <<'PY'
import json, glob, os, shutil, subprocess, time

roots=["/root/atakhome-platform","/root/atak-v10"]
cands=[]
for root in roots:
  paths=[]
  paths += glob.glob(root+"/data/backups/store-*.json")
  paths += glob.glob(root+"/data/store.json.bak*")
  paths += glob.glob(root+"/data/store.json")
  for p in paths:
    try:
      sz=os.path.getsize(p)
      with open(p,"r",encoding="utf-8") as f:
        s=json.load(f)
      n=len(s.get("products") or [])
      cands.append((n, sz, p, root))
      print(f"  {n:6d} products | {sz:10d} B | {p}")
    except Exception as e:
      print(f"  SKIP {p}: {e}")

cands.sort(key=lambda x:(x[0], x[1]), reverse=True)
if not cands or cands[0][0] < 50:
  # size fallback
  big=[c for c in cands if c[1] >= 1_000_000]
  if not big:
    raise SystemExit("FAIL: dolu yedek yok")
  best=max(big, key=lambda x:x[1])
  print(f"WARN: products sayisi dusuk; en buyuk dosya kullanilacak: {best}")
else:
  best=cands[0]

n, sz, src, src_root = best
# Hedef: platform (asıl ERP)
dst_root="/root/atakhome-platform" if os.path.isdir("/root/atakhome-platform") else src_root
dst=os.path.join(dst_root,"data","store.json")
os.makedirs(os.path.dirname(dst), exist_ok=True)
if os.path.isfile(dst):
  bak=dst+f".bak-before-restore-{time.strftime('%Y%m%d-%H%M%S')}"
  shutil.copy2(dst, bak)
  print(f"yedeklendi: {bak}")
shutil.copy2(src, dst)
print(f"RESTORE {src} ({n} urun, {sz} B) -> {dst}")

# server.js var mi
srv=os.path.join(dst_root,"server.js")
if not os.path.isfile(srv):
  raise SystemExit(f"FAIL: {srv} yok")

# pm2 recreate from dst_root
subprocess.call(["pm2","stop","atak"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
subprocess.call(["pm2","delete","atak"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
subprocess.check_call(["pm2","start","server.js","--name","atak","--update-env"], cwd=dst_root)
subprocess.call(["pm2","save"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
print(f"pm2 start cwd={dst_root}")
print("START_DIR="+dst_root)
PY

sleep 5
H=$(curl -sS -m 10 http://127.0.0.1:3100/health || true)
log "HEALTH=$H"
echo "$H" | grep -q '"productCount":0' && { log "FAIL: productCount hala 0"; exit 1; }
echo "$H" | grep -q '"ok":true' || { log "FAIL: health ok degil"; exit 1; }
log "=== BASARILI: urunler geri yuklendi ==="
