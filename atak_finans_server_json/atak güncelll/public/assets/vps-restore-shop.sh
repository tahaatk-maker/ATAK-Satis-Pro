#!/bin/bash
# Restore designed public shop on atakhome.com.tr
# Do NOT touch web-admin or /personel (ERP on atak / atakhome-platform).
# ASCII only. Turn Chrome translate OFF.
set +e
echo "SHOP-RESTORE START $(date -Is)"

SHOP_DIR=""
for d in \
  /root/atakhome-commerce-v4-5-checkout \
  /root/atakhome-commerce \
  /root/atakhome-commerce-v4 \
  /var/www/atakhome
 do
  [ -d "$d" ] && SHOP_DIR="$d" && break
done
if [ -z "$SHOP_DIR" ] && command -v pm2 >/dev/null 2>&1; then
  SHOP_DIR=$(pm2 jlist 2>/dev/null | python3 -c '
import json,sys
try:
  d=json.load(sys.stdin)
except Exception:
  raise SystemExit(0)
for p in d:
  n=str(p.get("name") or "")
  if "commerce" in n or n in ("atakhome-shop","shop"):
    print((p.get("pm2_env") or {}).get("pm_cwd") or "")
    break
')
fi
echo "SHOP_DIR=${SHOP_DIR:-none}"
echo "PM2"
pm2 list 2>/dev/null

if [ -n "$SHOP_DIR" ] && [ -d "$SHOP_DIR" ]; then
  echo "SHOP_LS"
  ls -la "$SHOP_DIR" | head -25
  if [ -f "$SHOP_DIR/public/personel.html" ] || grep -q "res.redirect('/personel')" "$SHOP_DIR/server.js" 2>/dev/null; then
    echo "SHOP_OVERWRITTEN_BY_ERP"
    if [ -d "$SHOP_DIR/.git" ]; then
      echo "GIT_REMOTE"
      git -C "$SHOP_DIR" remote -v
      git -C "$SHOP_DIR" log --oneline -8
      git -C "$SHOP_DIR" fetch --all --prune 2>/tmp/shop-git-fetch.txt
      cat /tmp/shop-git-fetch.txt | tail -6
      BR=$(git -C "$SHOP_DIR" rev-parse --abbrev-ref origin/HEAD 2>/dev/null | sed 's#origin/##')
      [ -n "$BR" ] || BR=main
      echo "GIT_RESET origin/$BR"
      git -C "$SHOP_DIR" reset --hard "origin/$BR"
      echo "GIT_HEAD $(git -C "$SHOP_DIR" log -1 --oneline)"
    else
      echo "NO_GIT_IN_SHOP"
      echo "LOOKING_BACKUPS"
      ls -d /root/atakhome-commerce* /root/*checkout* /root/*vitrin* 2>/dev/null
      ls -d "$SHOP_DIR".bak* "$SHOP_DIR"-bak* 2>/dev/null
    fi
  else
    echo "SHOP_SOURCE_LOOKS_OK"
  fi
  if [ -f "$SHOP_DIR/public/personel.html" ] && [ -f "$SHOP_DIR/public/admin.html" ]; then
    echo "STILL_ERP_FILES_IN_SHOP"
  fi
  pm2 restart atakhome-commerce --update-env >/tmp/shop-pm2.txt 2>&1
  tail -8 /tmp/shop-pm2.txt
else
  echo "FAIL_NO_SHOP_DIR"
fi

# Classify local ports after restore
python3 - <<'PY'
import os,re,subprocess

def curl(url):
    p=subprocess.run(["curl","-sS","-m","3","-D","-","-o","/tmp/atak-b.txt",url],stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
    body=""
    try: body=open("/tmp/atak-b.txt","r",encoding="utf-8",errors="ignore").read()
    except Exception: body=""
    return (p.stdout or "")+"\n"+body

erp=shop=None
for port in (3000,3100,3200,3001):
    blob=curl("http://127.0.0.1:%s/"%port).lower()
    health=curl("http://127.0.0.1:%s/health"%port).lower()
    print("PORT",port,"personel",("/personel" in blob),"erp_health",("atakhome-erp-v2" in health),"len",len(blob))
    if "atakhome-erp-v2" in health or "redirecting to /personel" in blob:
        if erp is None: erp=port
    elif blob.strip() and "redirecting to /personel" not in blob and "personel gir" not in blob:
        if shop is None: shop=port

# prefer 3200 for shop if it is not erp
blob3200=curl("http://127.0.0.1:3200/")
if "redirecting to /personel" not in blob3200.lower() and "personel gir" not in blob3200.lower() and blob3200.strip():
    shop=3200
if shop is None:
    shop=3200
if erp is None:
    erp=3000
open("/tmp/atak-shop-ports.env","w").write("ERP_PORT=%s\nSHOP_PORT=%s\n"%(erp,shop))
print("ERP_PORT",erp,"SHOP_PORT",shop)
PY
. /tmp/atak-shop-ports.env 2>/dev/null
echo "ERP_PORT=${ERP_PORT:-3000} SHOP_PORT=${SHOP_PORT:-3200}"

# Write dedicated public vhost. Do not edit panel block except remove public names from ERP default.
python3 - <<'PY'
import os,re,glob
erp=os.environ.get("ERP_PORT") or "3000"
shop=os.environ.get("SHOP_PORT") or "3200"
try:
    env=open("/tmp/atak-shop-ports.env").read()
    for line in env.splitlines():
        if "=" in line:
            k,v=line.split("=",1)
            if k=="ERP_PORT" and v: erp=v
            if k=="SHOP_PORT" and v: shop=v
except Exception:
    pass

ssl_cert=""
ssl_key=""
for path in glob.glob("/etc/letsencrypt/live/atakhome.com.tr/fullchain.pem") + glob.glob("/etc/letsencrypt/live/*/fullchain.pem"):
    if "atakhome" in path or not ssl_cert:
        ssl_cert=path
        ssl_key=path.replace("fullchain.pem","privkey.pem")
        if "atakhome.com.tr" in path:
            break
if not ssl_cert:
    for dp,dns,fns in os.walk("/etc/nginx"):
        for fn in fns:
            if not fn.endswith((".conf",".inc")): continue
            p=os.path.join(dp,fn)
            try: t=open(p,encoding="utf-8",errors="ignore").read()
            except Exception: continue
            m=re.search(r"ssl_certificate\s+(\S+);",t)
            k=re.search(r"ssl_certificate_key\s+(\S+);",t)
            if m and k:
                ssl_cert=m.group(1); ssl_key=k.group(1)
                break

ssl_lines=""
if ssl_cert and os.path.isfile(ssl_cert):
    ssl_lines="    ssl_certificate %s;\n    ssl_certificate_key %s;\n"%(ssl_cert,ssl_key)

conf='''# Public shop only. panel.atakhome.com.tr stays on ERP.
server {
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
'''%(ssl_lines, shop)

os.makedirs("/etc/nginx/sites-available", exist_ok=True)
os.makedirs("/etc/nginx/sites-enabled", exist_ok=True)
open("/etc/nginx/sites-available/atakhome-public.conf","w").write(conf)
link="/etc/nginx/sites-enabled/atakhome-public.conf"
if os.path.islink(link) or os.path.isfile(link):
    try: os.remove(link)
    except Exception: pass
os.symlink("/etc/nginx/sites-available/atakhome-public.conf", link)
print("WROTE", link, "shop", shop, "ssl", ssl_cert or "none")

# Remove public names from other server_name lines so this vhost wins
changed=0
for dp,dns,fns in os.walk("/etc/nginx"):
    for fn in fns:
        if not fn.endswith((".conf",".inc")): continue
        path=os.path.join(dp,fn)
        if path.endswith("atakhome-public.conf"): continue
        try: txt=open(path,encoding="utf-8",errors="ignore").read()
        except Exception: continue
        if "atakhome.com.tr" not in txt: continue
        def drop_public(m):
            names=m.group(1)
            names=re.sub(r"(^|\s)www\.atakhome\.com\.tr(\s|$)"," ",names)
            names=re.sub(r"(^|\s)atakhome\.com\.tr(\s|$)"," ",names)
            names=re.sub(r"\s+"," ",names).strip()
            return "server_name %s;"%names if names else "server_name _;"
        new=re.sub(r"server_name([^;]+);", drop_public, txt)
        if new!=txt:
            bak=path+".bak-shop-restore"
            if not os.path.isfile(bak):
                open(bak,"w").write(txt)
            open(path,"w").write(new)
            changed+=1
            print("STRIP_PUBLIC_NAME", path)
print("STRIPPED", changed)
PY

if command -v nginx >/dev/null 2>&1; then
  if nginx -t >/tmp/atak-nginx-t.txt 2>&1; then
    systemctl reload nginx >/dev/null 2>&1 || nginx -s reload
    echo "NGINX_RELOAD ok"
  else
    echo "NGINX_TEST_FAIL"
    cat /tmp/atak-nginx-t.txt
  fi
fi

sleep 2
echo "CHECK"
echo -n "HOST_3200 "; curl -sS -m 4 -o /tmp/h3200.html -w "%{http_code}" -H "Host: atakhome.com.tr" http://127.0.0.1:${SHOP_PORT:-3200}/; echo
head -c 120 /tmp/h3200.html 2>/dev/null; echo
echo -n "PUBLIC "; curl -sSI -m 8 https://atakhome.com.tr/ | head -12
echo -n "PANEL "; curl -sS -m 6 https://panel.atakhome.com.tr/health; echo
echo -n "PERSONEL "; curl -sS -m 6 -o /tmp/per.html -w "%{http_code}" https://panel.atakhome.com.tr/personel; echo

if curl -sSI -m 8 https://atakhome.com.tr/ | grep -qi "location: /personel"; then
  echo "STILL_PERSONEL — shop files may still be ERP. Need original commerce git/backup."
else
  echo "SHOP_RESTORE_OK"
fi
echo "SHOP-RESTORE DONE"
