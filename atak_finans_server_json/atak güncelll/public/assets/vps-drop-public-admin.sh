#!/bin/bash
# Remove atakhome.com.tr/web-admin. Public site stays https://atakhome.com.tr/
# Do not copy ERP. Do not touch panel or customers.
# ASCII only. Chrome translate OFF.
set +e
echo "DROP-PUBLIC-ADMIN START $(date -Is)"

python3 - <<'PY'
import os, re
paths=[
  "/etc/nginx/conf.d/00-atak-public-hold.conf",
  "/etc/nginx/sites-available/atakhome-public.conf",
]
block='''    location ^~ /web-admin {
        return 302 https://atakhome.com.tr/;
    }
'''
needle="    location / { try_files $uri /index.html; }"
for path in paths:
    if not os.path.isfile(path):
        print("SKIP", path)
        continue
    txt=open(path,encoding="utf-8",errors="ignore").read()
    txt2=re.sub(
        r"    location \^~ /web-admin \{[^}]*\}\n",
        block,
        txt,
        count=1,
    )
    if txt2==txt:
        if "location ^~ /web-admin" in txt:
            print("ALREADY", path)
            continue
        if needle not in txt:
            print("NO_NEEDLE", path)
            continue
        txt2=txt.replace(needle, block+needle, 1)
    open(path,"w").write(txt2)
    print("PATCHED", path)
PY

nginx -t >/tmp/drop-admin-ngx.txt 2>&1
if [ $? -eq 0 ]; then
  systemctl reload nginx 2>/dev/null || nginx -s reload
  echo "NGINX_RELOAD ok"
else
  echo "NGINX_FAIL"
  cat /tmp/drop-admin-ngx.txt
  exit 1
fi

echo "PUBLIC_ADMIN"
curl -sSI -m 8 https://atakhome.com.tr/web-admin | head -12
echo "PUBLIC_HOME"
curl -sSI -m 8 https://atakhome.com.tr/ | head -8
echo "PANEL_ADMIN"
curl -sSI -m 8 https://panel.atakhome.com.tr/web-admin | head -8
echo "DROP-PUBLIC-ADMIN DONE"
