#!/bin/bash
# Put the DESIGNED shop back on atakhome.com.tr.
# Do not touch atak / atakhome-web (panel + personel).
# ASCII only. Chrome translate OFF.
set +e
echo "SHOP-RESTORE START $(date -Is)"

is_erp_dir(){
  local d="$1"
  [ -d "$d" ] || return 1
  [ -f "$d/public/personel.html" ] && return 0
  [ -f "$d/public/admin.html" ] && grep -q "atakhome-erp\|redirect('/personel')" "$d/server.js" 2>/dev/null && return 0
  return 1
}

score_shop(){
  local d="$1" n=0
  [ -d "$d" ] || { echo 0; return; }
  is_erp_dir "$d" && { echo 0; return; }
  n=10
  [ -f "$d/package.json" ] && n=$((n+20))
  grep -qiE 'next|vite|nuxt|checkout|commerce' "$d/package.json" 2>/dev/null && n=$((n+40))
  [ -d "$d/app" ] || [ -d "$d/src" ] || [ -d "$d/pages" ] && n=$((n+20))
  echo "$d" | grep -qi 'backup\|live-support\|v4-4' && n=$((n+15))
  echo "$n"
}

SHOP_DIR=""
if command -v pm2 >/dev/null 2>&1; then
  SHOP_DIR=$(pm2 jlist 2>/dev/null | python3 -c '
import json,sys
try: d=json.load(sys.stdin)
except Exception: raise SystemExit(0)
for p in d:
  if "commerce" in str(p.get("name") or ""):
    print((p.get("pm2_env") or {}).get("pm_cwd") or "")
    break
')
fi
[ -n "$SHOP_DIR" ] || SHOP_DIR=/root/atakhome-commerce-v4-5-checkout
echo "SHOP_DIR=$SHOP_DIR"
echo "PM2"; pm2 list

echo "SCAN_BACKUPS"
BEST=""
BESTN=0
while IFS= read -r d; do
  [ -d "$d" ] || continue
  n=$(score_shop "$d")
  erp=no
  is_erp_dir "$d" && erp=yes
  echo "CAND $d score=$n erp=$erp"
  if [ "$n" -gt "$BESTN" ]; then BEST="$d"; BESTN="$n"; fi
done < <(ls -1d /root/atakhome-commerce* /root/*checkout* /root/*vitrin* /root/*live-support* 2>/dev/null)

echo "BEST_SRC=${BEST:-none} score=$BESTN"

if [ -z "$BEST" ] || [ "$BESTN" -lt 10 ]; then
  echo "FAIL_NO_SHOP_BACKUP"
  echo "Panel ve personel duruyor. Vitrin yedegi ERP olmayan klasorde degil."
  exit 1
fi

if [ ! -d "$SHOP_DIR" ]; then
  echo "FAIL_NO_SHOP_DIR $SHOP_DIR"
  exit 1
fi

if [ "$BEST" = "$SHOP_DIR" ] && ! is_erp_dir "$SHOP_DIR"; then
  echo "SHOP_ALREADY_GOOD $SHOP_DIR"
else
  echo "COPY $BEST -> $SHOP_DIR (keep .env node_modules data)"
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete \
      --exclude node_modules --exclude .env --exclude data --exclude '.git' \
      --exclude '*.bak-*' \
      "$BEST"/ "$SHOP_DIR"/
  else
    # keep env
    [ -f "$SHOP_DIR/.env" ] && cp -a "$SHOP_DIR/.env" /tmp/atak-shop.env.bak
    find "$SHOP_DIR" -mindepth 1 -maxdepth 1 ! -name node_modules ! -name .env ! -name data ! -name .git -exec rm -rf {} +
    find "$BEST" -mindepth 1 -maxdepth 1 ! -name node_modules ! -name .env ! -name data ! -name .git -exec cp -a {} "$SHOP_DIR"/ \;
    [ -f /tmp/atak-shop.env.bak ] && cp -a /tmp/atak-shop.env.bak "$SHOP_DIR/.env"
  fi
fi

# Force PORT=3200 in shop .env without touching ERP .env
if [ -f "$SHOP_DIR/.env" ]; then
  sed -i -E '/^[[:space:]]*(export[[:space:]]+)?PORT[[:space:]]*=/d' "$SHOP_DIR/.env"
  echo "PORT=3200" >> "$SHOP_DIR/.env"
else
  echo "PORT=3200" > "$SHOP_DIR/.env"
fi
echo "SHOP_ENV_PORT=3200"

if is_erp_dir "$SHOP_DIR"; then
  echo "FAIL_STILL_ERP_AFTER_COPY src=$BEST"
  exit 1
fi
echo "SHOP_FILES_OK"

# Restart ONLY commerce
pm2 restart atakhome-commerce --update-env --cwd "$SHOP_DIR" >/tmp/shop-pm2.txt 2>&1
tail -15 /tmp/shop-pm2.txt
sleep 3

# nginx public -> 3200 (already written before; write again)
python3 - <<'PY'
import os,re,glob
shop="3200"
ssl_cert=ssl_key=""
for path in glob.glob("/etc/letsencrypt/live/atakhome.com.tr/fullchain.pem"):
    ssl_cert=path; ssl_key=path.replace("fullchain.pem","privkey.pem")
ssl=""
if ssl_cert and os.path.isfile(ssl_cert):
    ssl="    ssl_certificate %s;\n    ssl_certificate_key %s;\n"%(ssl_cert,ssl_key)
conf='''server {
    listen 80;
    listen [::]:80;
    server_name atakhome.com.tr www.atakhome.com.tr;
    return 301 https://$host$request_uri;
}
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name atakhome.com.tr www.atakhome.com.tr;
%s    location / {
        proxy_pass http://127.0.0.1:%s;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
'''%(ssl, shop)
os.makedirs("/etc/nginx/sites-available",exist_ok=True)
os.makedirs("/etc/nginx/sites-enabled",exist_ok=True)
open("/etc/nginx/sites-available/atakhome-public.conf","w").write(conf)
link="/etc/nginx/sites-enabled/atakhome-public.conf"
try:
    if os.path.lexists(link): os.remove(link)
except Exception:
    pass
os.symlink("/etc/nginx/sites-available/atakhome-public.conf", link)
print("NGINX_SHOP 3200")
# strip public names from other vhosts
for dp,dns,fns in os.walk("/etc/nginx"):
    for fn in fns:
        if not fn.endswith((".conf",".inc")): continue
        path=os.path.join(dp,fn)
        if path.endswith("atakhome-public.conf"): continue
        try: txt=open(path,encoding="utf-8",errors="ignore").read()
        except Exception: continue
        if "atakhome.com.tr" not in txt: continue
        def drop(m):
            names=m.group(1)
            names=re.sub(r"(^|\s)www\.atakhome\.com\.tr(\s|$)"," ",names)
            names=re.sub(r"(^|\s)atakhome\.com\.tr(\s|$)"," ",names)
            names=re.sub(r"\s+"," ",names).strip()
            return "server_name %s;"%names if names else "server_name _;"
        new=re.sub(r"server_name([^;]+);", drop, txt)
        if new!=txt:
            bak=path+".bak-shop-restore"
            if not os.path.isfile(bak): open(bak,"w").write(txt)
            open(path,"w").write(new)
            print("STRIP", path)
PY

nginx -t >/tmp/atak-nginx-t.txt 2>&1 && { systemctl reload nginx 2>/dev/null || nginx -s reload; echo NGINX_RELOAD; } || { echo NGINX_FAIL; cat /tmp/atak-nginx-t.txt; }

sleep 2
echo "CHECK_3200"
curl -sS -m 4 -D - -o /tmp/c3200.html http://127.0.0.1:3200/ | head -15
echo "BODY3200"; head -c 160 /tmp/c3200.html; echo
echo "CHECK_PUBLIC"
curl -sSI -m 8 https://atakhome.com.tr/ | head -15
echo "CHECK_PANEL"
curl -sS -m 6 https://panel.atakhome.com.tr/health; echo
curl -sS -m 6 -o /dev/null -w "PERSONEL_HTTP=%{http_code}\n" https://panel.atakhome.com.tr/personel

if grep -qi "redirecting to /personel\|Personel Girişi" /tmp/c3200.html; then
  echo "FAIL_3200_STILL_ERP"
  exit 1
fi
if curl -sSI -m 8 https://atakhome.com.tr/ | grep -qi "location: /personel"; then
  echo "FAIL_PUBLIC_STILL_PERSONEL"
  exit 1
fi
echo "SHOP_RESTORE_OK"
echo "SHOP-RESTORE DONE"
