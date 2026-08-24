#!/bin/bash
# Recover designed shop. Never send atakhome.com.tr to ERP /personel.
# Do not change atak / atakhome-web (panel + personel).
# ASCII only. Chrome translate OFF.
set +e
echo "SHOP-RESTORE START $(date -Is)"

erpish(){
  local d="$1"
  [ -f "$d/public/personel.html" ] && return 0
  grep -q "redirect('/personel')" "$d/server.js" 2>/dev/null && return 0
  return 1
}

echo "PM2"; pm2 list

SHOP_DIR=$(pm2 jlist 2>/dev/null | python3 -c '
import json,sys
try: d=json.load(sys.stdin)
except Exception: raise SystemExit(0)
for p in d:
  if "commerce" in str(p.get("name") or ""):
    print((p.get("pm2_env") or {}).get("pm_cwd") or ""); break
')
[ -n "$SHOP_DIR" ] || SHOP_DIR=/root/atakhome-commerce-v4-5-checkout
echo "SHOP_DIR=$SHOP_DIR"

echo "FIND_NEXT"
find /root /var/www /home -maxdepth 5 \( -name 'next.config.js' -o -name 'next.config.mjs' -o -name 'vite.config.js' -o -name 'vite.config.ts' \) 2>/dev/null

echo "SCAN_DIRS"
GOOD=""
while IFS= read -r d; do
  [ -d "$d" ] || continue
  echo -n "DIR $d"
  erpish "$d" && echo -n " erp=yes" || echo -n " erp=no"
  [ -d "$d/.git" ] && echo -n " git=yes" || echo -n " git=no"
  [ -f "$d/next.config.js" ] || [ -f "$d/next.config.mjs" ] && echo -n " next=yes"
  echo
  if [ -d "$d/.git" ]; then
    echo "  REMOTE $(git -C "$d" remote -v 2>/dev/null | head -2)"
    git -C "$d" log --oneline -6 2>/dev/null | sed 's/^/  /'
    # first commit whose server.js does not redirect to personel
    HIT=$(git -C "$d" rev-list --max-count=80 HEAD 2>/dev/null | while read -r c; do
      if git -C "$d" show "$c:server.js" 2>/dev/null | grep -q "redirect('/personel')"; then
        continue
      fi
      if git -C "$d" cat-file -e "$c:public/personel.html" 2>/dev/null; then
        continue
      fi
      echo "$c"
      break
    done)
    if [ -n "$HIT" ]; then
      echo "  GOOD_COMMIT $HIT in $d"
      GOOD="$d:$HIT"
    fi
  fi
  if [ -z "$GOOD" ] && ! erpish "$d"; then
    if [ -f "$d/next.config.js" ] || [ -f "$d/next.config.mjs" ] || [ -f "$d/package.json" ]; then
      echo "  GOOD_TREE $d"
      GOOD="$d:TREE"
    fi
  fi
done < <(ls -1d /root/atakhome-commerce* /root/*checkout* /root/*vitrin* /root/*live-support* /var/www/* 2>/dev/null)

echo "GOOD=$GOOD"

if [ -n "$GOOD" ]; then
  SRC=${GOOD%%:*}
  REF=${GOOD##*:}
  echo "RESTORE from $SRC ref=$REF -> $SHOP_DIR"
  mkdir -p "$SHOP_DIR"
  [ -f "$SHOP_DIR/.env" ] && cp -a "$SHOP_DIR/.env" /tmp/atak-shop.env.bak
  if [ "$REF" != "TREE" ] && [ -d "$SRC/.git" ]; then
    git -C "$SRC" checkout -f "$REF"
  fi
  if command -v rsync >/dev/null; then
    rsync -a --delete --exclude node_modules --exclude .env --exclude data --exclude '.git' "$SRC"/ "$SHOP_DIR"/
  else
    find "$SHOP_DIR" -mindepth 1 -maxdepth 1 ! -name node_modules ! -name .env ! -name data ! -name .git -exec rm -rf {} +
    find "$SRC" -mindepth 1 -maxdepth 1 ! -name node_modules ! -name .env ! -name data ! -name .git -exec cp -a {} "$SHOP_DIR"/ \;
  fi
  [ -f /tmp/atak-shop.env.bak ] && cp -a /tmp/atak-shop.env.bak "$SHOP_DIR/.env"
  if [ -f "$SHOP_DIR/.env" ]; then
    sed -i -E '/^[[:space:]]*(export[[:space:]]+)?PORT[[:space:]]*=/d' "$SHOP_DIR/.env"
  fi
  echo "PORT=3200" >> "$SHOP_DIR/.env"
  if erpish "$SHOP_DIR"; then
    echo "COPY_STILL_ERP"
    GOOD=""
  else
    echo "SHOP_FILES_RESTORED"
    pm2 restart atakhome-commerce --update-env --cwd "$SHOP_DIR"
    sleep 4
  fi
fi

# Nginx: public domain must NEVER hit ERP.
# If shop on 3200 is still ERP, serve a local hold page instead of /personel.
USE_HOLD=0
curl -sS -m 3 http://127.0.0.1:3200/ -D /tmp/h3200.hdr -o /tmp/h3200.html
if grep -qi "redirecting to /personel\|location: /personel\|Personel Girişi" /tmp/h3200.hdr /tmp/h3200.html; then
  USE_HOLD=1
  echo "3200_IS_ERP hold=1"
else
  echo "3200_LOOKS_OK"
fi

mkdir -p /var/www/atakhome-hold
cat > /var/www/atakhome-hold/index.html <<'HTML'
<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Atak Home</title>
<style>body{font-family:sans-serif;max-width:640px;margin:12vh auto;padding:24px;color:#1a1a1a}h1{font-size:28px}p{line-height:1.5}a{color:#0a7}</style></head>
<body>
<h1>Atak Home vitrin sitesi geri yükleniyor</h1>
<p>Personel ve yönetim paneli çalışıyor. Mağaza vitrini ayrı bir uygulamadır; kısa süre içinde buraya dönecek.</p>
<p>Personel: <a href="https://panel.atakhome.com.tr/personel">panel.atakhome.com.tr/personel</a><br>
Yönetim: <a href="https://panel.atakhome.com.tr/web-admin">panel.atakhome.com.tr/web-admin</a></p>
</body></html>
HTML

python3 - "$USE_HOLD" <<'PY'
import os,re,glob,sys
hold=sys.argv[1]=="1"
ssl_cert=ssl_key=""
for path in glob.glob("/etc/letsencrypt/live/atakhome.com.tr/fullchain.pem"):
    ssl_cert=path; ssl_key=path.replace("fullchain.pem","privkey.pem")
ssl=""
if ssl_cert and os.path.isfile(ssl_cert):
    ssl="    ssl_certificate %s;\n    ssl_certificate_key %s;\n"%(ssl_cert,ssl_key)
if hold:
    loc='''    root /var/www/atakhome-hold;
    index index.html;
    location / { try_files $uri /index.html; }
'''
else:
    loc='''    location / {
        proxy_pass http://127.0.0.1:3200;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
'''
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
%s%s}
'''%(ssl, loc)
os.makedirs("/etc/nginx/sites-available",exist_ok=True)
os.makedirs("/etc/nginx/sites-enabled",exist_ok=True)
open("/etc/nginx/sites-available/atakhome-public.conf","w").write(conf)
link="/etc/nginx/sites-enabled/atakhome-public.conf"
if os.path.lexists(link):
    os.remove(link)
os.symlink("/etc/nginx/sites-available/atakhome-public.conf", link)
print("NGINX_PUBLIC hold=%s"%hold)
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
            print("STRIP",path)
PY

nginx -t >/tmp/ngx.txt 2>&1 && { nginx -s reload 2>/dev/null || systemctl reload nginx; echo NGINX_RELOAD; } || { echo NGINX_FAIL; cat /tmp/ngx.txt; }

sleep 2
echo "PUBLIC_HEAD"
curl -sSI -m 8 https://atakhome.com.tr/ | head -16
echo "PANEL_HEALTH"
curl -sS -m 6 https://panel.atakhome.com.tr/health; echo
echo "PERSONEL_CODE $(curl -sS -m 6 -o /dev/null -w '%{http_code}' https://panel.atakhome.com.tr/personel)"

if curl -sSI -m 8 https://atakhome.com.tr/ | grep -qi "location: /personel"; then
  echo "FAIL_STILL_PERSONEL"
  exit 1
fi
if [ "$USE_HOLD" = "1" ] || [ -z "$GOOD" ]; then
  echo "CLASH_STOPPED"
  echo "Vitrin dosyasi bulunamadiysa Hostinger snapshot / 4 Agustos yedegini buradan geri yukleyin."
  echo "Panel ve personel ayakta: https://panel.atakhome.com.tr/web-admin  /personel"
else
  echo "SHOP_RESTORE_OK"
fi
echo "SHOP-RESTORE DONE"
