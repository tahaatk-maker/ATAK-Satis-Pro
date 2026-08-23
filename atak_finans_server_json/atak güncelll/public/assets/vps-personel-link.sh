#!/bin/bash
# Only fix /personel on the public site. Do not copy ERP. Do not touch customers.
# ASCII only. Chrome translate OFF.
set +e
echo "PERSONEL-LINK START $(date -Is)"

python3 - <<'PY'
import os
paths=[
  "/etc/nginx/conf.d/00-atak-public-hold.conf",
  "/etc/nginx/sites-available/atakhome-public.conf",
]
block='''    location ^~ /personel {
        return 302 https://panel.atakhome.com.tr/personel;
    }
    location ^~ /web-admin {
        return 302 https://panel.atakhome.com.tr/web-admin;
    }
'''
needle="    location / { try_files $uri /index.html; }"
for path in paths:
    if not os.path.isfile(path):
        print("SKIP", path)
        continue
    txt=open(path,encoding="utf-8",errors="ignore").read()
    if "location ^~ /personel" in txt:
        print("ALREADY", path)
        continue
    if needle not in txt:
        print("NO_NEEDLE", path)
        continue
    open(path,"w").write(txt.replace(needle, block+needle, 1))
    print("PATCHED", path)
PY

nginx -t >/tmp/personel-link-ngx.txt 2>&1
if [ $? -eq 0 ]; then
  systemctl reload nginx 2>/dev/null || nginx -s reload
  echo "NGINX_RELOAD ok"
else
  echo "NGINX_FAIL"
  cat /tmp/personel-link-ngx.txt
  exit 1
fi

echo "PUBLIC_PERSONEL"
curl -sSI -m 8 https://atakhome.com.tr/personel | head -12
echo "PANEL_PERSONEL"
curl -sSI -m 8 https://panel.atakhome.com.tr/personel | head -8
echo "PERSONEL-LINK DONE"
