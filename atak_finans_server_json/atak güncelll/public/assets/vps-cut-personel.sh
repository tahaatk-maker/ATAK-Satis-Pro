#!/bin/bash
# ONE job: atakhome.com.tr must not open /personel.
# Do not copy ERP. Do not touch commerce files. Restart only "atak".
# ASCII only. Chrome translate OFF.
set +e
echo "CUT-PERSONEL START $(date -Is)"

mkdir -p /var/www/atakhome-hold
cat > /var/www/atakhome-hold/index.html <<'HTML'
<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Atak Home</title></head>
<body style="font-family:sans-serif;max-width:640px;margin:12vh auto;padding:24px">
<h1>Atak Home</h1>
<p>Personel ekranı bu adreste açılmaz.</p>
<p>Personel: <a href="https://panel.atakhome.com.tr/personel">panel.atakhome.com.tr/personel</a><br>
Yönetim: <a href="https://panel.atakhome.com.tr/web-admin">panel.atakhome.com.tr/web-admin</a></p>
</body></html>
HTML

python3 - <<'PY'
import glob, os, re
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
%s    root /var/www/atakhome-hold;
    index index.html;
    location / { try_files $uri /index.html; }
}
'''%ssl
os.makedirs("/etc/nginx/conf.d", exist_ok=True)
os.makedirs("/etc/nginx/sites-available", exist_ok=True)
os.makedirs("/etc/nginx/sites-enabled", exist_ok=True)
open("/etc/nginx/conf.d/00-atak-public-hold.conf","w").write(conf)
open("/etc/nginx/sites-available/atakhome-public.conf","w").write(conf)
link="/etc/nginx/sites-enabled/atakhome-public.conf"
if os.path.lexists(link):
    os.remove(link)
os.symlink("/etc/nginx/sites-available/atakhome-public.conf", link)
print("WROTE nginx public hold, ssl=", ssl_cert or "none")

# Remove public names from every other vhost so this block wins.
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
                bak=path+".bak-cut-personel"
                if not os.path.isfile(bak):
                    open(bak,"w").write(txt)
                open(path,"w").write(new)
                print("STRIP", path)
PY

# Patch LIVE ERP so even a wrong proxy cannot open personel on the public host.
python3 - <<'PY'
import os
needle="app.get('/',(req,res)=>res.redirect('/personel'));"
insert='''function requestHost(req){return String(req.headers['x-forwarded-host']||req.headers.host||'').split(',')[0].trim().toLowerCase().replace(/:\\d+$/,'');}
function isPublicShopHost(req){const h=requestHost(req);return h==='atakhome.com.tr'||h==='www.atakhome.com.tr';}
function sendPublicShopHold(res){res.status(200).type('html').set('Cache-Control','no-store').send('<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>Atak Home</title></head><body style="font-family:sans-serif;max-width:640px;margin:12vh auto;padding:24px"><h1>Atak Home</h1><p>Personel girisi bu adreste acilmaz.</p><p><a href="https://panel.atakhome.com.tr/personel">Personel</a> · <a href="https://panel.atakhome.com.tr/web-admin">Yonetim</a></p></body></html>');}
'''
for path in ("/root/atak-v10/server.js","/root/atakhome-platform/server.js"):
    if not os.path.isfile(path):
        print("SKIP", path)
        continue
    txt=open(path,encoding="utf-8",errors="ignore").read()
    if "isPublicShopHost" in txt:
        print("ALREADY_PATCHED", path)
        continue
    if needle not in txt:
        print("NO_NEEDLE", path)
        continue
    bak=path+".bak-cut-personel"
    if not os.path.isfile(bak):
        open(bak,"w").write(txt)
    txt=txt.replace(needle, insert+"app.get('/',(req,res)=>{if(isPublicShopHost(req))return sendPublicShopHold(res);res.redirect('/personel');});")
    txt=txt.replace("app.get('*',(req,res)=>res.redirect('/personel'));",
                    "app.get('*',(req,res)=>{if(isPublicShopHost(req))return sendPublicShopHold(res);res.redirect('/personel');});")
    txt=txt.replace("app.get('/personel',(req,res)=>{",
                    "app.get('/personel',(req,res)=>{if(isPublicShopHost(req))return sendPublicShopHold(res);")
    open(path,"w").write(txt)
    print("PATCHED", path)
PY

nginx -t >/tmp/cut-ngx.txt 2>&1
if [ $? -eq 0 ]; then
  systemctl reload nginx 2>/dev/null || nginx -s reload
  echo "NGINX_RELOAD ok"
else
  echo "NGINX_FAIL"
  cat /tmp/cut-ngx.txt
fi

pm2 restart atak --update-env
sleep 2

echo "PUBLIC"
curl -sSI -m 8 https://atakhome.com.tr/ | head -16
echo "BODY"
curl -sS -m 8 https://atakhome.com.tr/ | head -c 220; echo
echo "PANEL"; curl -sS -m 6 https://panel.atakhome.com.tr/health; echo
echo "PERSONEL $(curl -sS -m 6 -o /dev/null -w '%{http_code}' https://panel.atakhome.com.tr/personel)"

if curl -sSI -m 8 https://atakhome.com.tr/ | grep -qi "location: /personel"; then
  echo "FAIL_STILL_PERSONEL"
  echo "NGINX_DUMP"
  grep -RIn --include='*.conf' 'server_name\|proxy_pass\|root ' /etc/nginx | head -80
  exit 1
fi
echo "CUT_OK"
echo "CUT-PERSONEL DONE"
