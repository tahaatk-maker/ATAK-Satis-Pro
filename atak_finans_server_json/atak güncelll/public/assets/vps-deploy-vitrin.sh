#!/bin/bash
# Public shop + panel web tab. Do not copy into commerce. Do not restart commerce.
# Do not restore Hostinger backups. Do not touch panel data.
# ASCII only. Chrome translate OFF.
set +e
echo "VITRIN-DEPLOY START $(date -Is)"

HERE=$(cd "$(dirname "$0")" && pwd)
VITRIN=$(cd "$HERE/../vitrin" && pwd)
DEST=/var/www/atakhome-vitrin
echo "VITRIN=$VITRIN"
echo "DEST=$DEST"

if [ ! -f "$VITRIN/index.html" ]; then
  echo "FAIL_NO_VITRIN"
  exit 1
fi

mkdir -p "$DEST/img"
cp -f "$VITRIN/index.html" "$DEST/index.html"
cp -f "$VITRIN/styles.css" "$DEST/styles.css"
cp -f "$VITRIN/app.js" "$DEST/app.js"
cp -f "$VITRIN"/img/* "$DEST/img/" 2>/dev/null
cp -f "$HERE/atak-header-logo.svg" "$DEST/atak-header-logo.svg" 2>/dev/null
cp -f "$HERE/beko-logo.svg" "$DEST/beko-logo.svg" 2>/dev/null
cp -f "$HERE/istikbal-logo.svg" "$DEST/istikbal-logo.svg" 2>/dev/null
echo "COPIED $(ls -1 "$DEST" "$DEST/img" 2>/dev/null | wc -l) files"

ERP_PORT=$(pm2 jlist 2>/dev/null | python3 -c '
import json,sys
try: d=json.load(sys.stdin)
except Exception: raise SystemExit(0)
for p in d:
  if str(p.get("name") or "")=="atak":
    env=p.get("pm2_env") or {}
    print(env.get("PORT") or env.get("port") or "")
    break
' 2>/dev/null)
[ -n "$ERP_PORT" ] || ERP_PORT=3000
echo "ERP_PORT=$ERP_PORT"

python3 - "$DEST" "$ERP_PORT" <<'PY'
import glob, os, re, sys
dest, port = sys.argv[1], sys.argv[2]
ssl_cert=ssl_key=""
for path in glob.glob("/etc/letsencrypt/live/atakhome.com.tr/fullchain.pem"):
    ssl_cert=path
    ssl_key=path.replace("fullchain.pem","privkey.pem")
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
%s    root %s;
    index index.html;
    location ^~ /personel {
        return 302 https://panel.atakhome.com.tr/personel;
    }
    location ^~ /web-admin {
        return 302 https://atakhome.com.tr/;
    }
    location = /web-api/public {
        proxy_pass http://127.0.0.1:%s/web-api/public;
        proxy_set_header Host panel.atakhome.com.tr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    location /uploads/ {
        proxy_pass http://127.0.0.1:%s/uploads/;
        proxy_set_header Host panel.atakhome.com.tr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    location / { try_files $uri /index.html; }
}
'''%(ssl, dest, port, port)
os.makedirs("/etc/nginx/conf.d", exist_ok=True)
os.makedirs("/etc/nginx/sites-available", exist_ok=True)
os.makedirs("/etc/nginx/sites-enabled", exist_ok=True)
open("/etc/nginx/conf.d/00-atak-public-hold.conf","w").write(conf)
open("/etc/nginx/sites-available/atakhome-public.conf","w").write(conf)
link="/etc/nginx/sites-enabled/atakhome-public.conf"
if os.path.lexists(link):
    os.remove(link)
os.symlink("/etc/nginx/sites-available/atakhome-public.conf", link)
print("WROTE nginx public vitrin, ssl=", ssl_cert or "none")

for root in ("/etc/nginx",):
    for dp, dns, fns in os.walk(root):
        for fn in fns:
            if not fn.endswith((".conf",".inc")):
                continue
            path=os.path.join(dp,fn)
            if path.endswith("00-atak-public-hold.conf") or path.endswith("atakhome-public.conf"):
                continue
            try:
                txt=open(path,encoding="utf-8",errors="ignore").read()
            except Exception:
                continue
            if "atakhome.com.tr" not in txt:
                continue
            def drop(m):
                names=m.group(1)
                names=re.sub(r"(^|\s)www\.atakhome\.com\.tr(\s|$)"," ",names)
                names=re.sub(r"(^|\s)atakhome\.com\.tr(\s|$)"," ",names)
                names=re.sub(r"\s+"," ",names).strip()
                return "server_name %s;"% (names or "_")
            new=re.sub(r"server_name([^;]+);", drop, txt)
            if new!=txt:
                bak=path+".bak-vitrin"
                if not os.path.isfile(bak):
                    open(bak,"w").write(txt)
                open(path,"w").write(new)
                print("STRIP", path)
PY

nginx -t >/tmp/vitrin-ngx.txt 2>&1
if [ $? -eq 0 ]; then
  systemctl reload nginx 2>/dev/null || nginx -s reload
  echo "NGINX_RELOAD ok"
else
  echo "NGINX_FAIL"
  cat /tmp/vitrin-ngx.txt
  exit 1
fi

echo "PUBLIC"
curl -sSI -m 8 https://atakhome.com.tr/ | head -16
echo "TITLE"
curl -sL -m 8 https://atakhome.com.tr/ | head -c 400
echo
echo "PANEL still"
curl -sSI -m 8 https://panel.atakhome.com.tr/personel | head -8

APP=$(cd "$HERE/../.." && pwd)
echo "PANEL_FILES $APP"
for D in /root/atak-v10 /root/atakhome-platform; do
  case "$D" in *commerce*|*checkout*|*vitrin*) echo "SKIP_SHOP $D"; continue ;; esac
  [ -d "$D" ] || { echo "SKIP_MISSING $D"; continue; }
  if [ ! -f "$D/public/admin.html" ]; then echo "SKIP_NOT_ERP $D"; continue; fi
  cp -f "$APP/public/admin.html" "$D/public/admin.html"
  cp -f "$APP/public/assets/admin.js" "$D/public/assets/admin.js"
  cp -f "$APP/server.js" "$D/server.js"
  echo "PANEL_PATCH $D"
done
pm2 restart atak --update-env
sleep 2
echo "VITRIN-DEPLOY DONE"
