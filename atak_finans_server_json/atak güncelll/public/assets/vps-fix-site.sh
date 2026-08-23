#!/bin/bash
# Bring back https://atakhome.com.tr public shop.
# Do not kill ERP. ASCII only. Do not translate this file.
set -euo pipefail
echo "SITE-FIX START $(date -Is)"

if command -v pm2 >/dev/null 2>&1; then
  echo "PM2_BEFORE"
  pm2 list || true
  pm2 resurrect >/tmp/atak-pm2-resurrect.txt 2>&1 || true
  pm2 start atakhome-web --update-env >/tmp/atak-web-start.txt 2>&1 || pm2 restart atakhome-web --update-env >/tmp/atak-web-start.txt 2>&1 || true
  pm2 start atakhome-ticaret --update-env >/tmp/atak-tic-start.txt 2>&1 || pm2 restart atakhome-ticaret --update-env >/tmp/atak-tic-start.txt 2>&1 || true
  echo "WEB_START"
  tail -8 /tmp/atak-web-start.txt 2>/dev/null || true
  echo "TIC_START"
  tail -8 /tmp/atak-tic-start.txt 2>/dev/null || true
fi

echo "LISTEN"
ss -lntp 2>/dev/null | grep -E ':(3000|3100|3200|4173|5173|8080|80|443)\s' || netstat -lntp 2>/dev/null | grep -E ':(3000|3100|3200|80|443)\s' || true

echo "NGINX_SERVERS"
if [ -d /etc/nginx ]; then
  grep -RIn --include='*.conf' --include='*.inc' 'server_name\|proxy_pass\|atakhome' /etc/nginx 2>/dev/null | head -80 || true
fi

WEB_PORT=""
if command -v pm2 >/dev/null 2>&1; then
  WEB_PORT=$(pm2 jlist 2>/dev/null | python3 -c '
import json,sys,os,re
try:
  data=json.load(sys.stdin)
except Exception:
  raise SystemExit(0)
for p in data:
  name=str(p.get("name") or "")
  env=(p.get("pm2_env") or {})
  if name not in ("atakhome-web","atak-web","web"):
    continue
  port=str(env.get("PORT") or env.get("NEXT_PORT") or "")
  if port.isdigit():
    print(port)
    raise SystemExit(0)
  cwd=env.get("pm_cwd") or ""
  for fname in (".env",".env.production",".env.local"):
    path=os.path.join(cwd,fname)
    if not os.path.isfile(path):
      continue
    try:
      txt=open(path,"r",encoding="utf-8",errors="ignore").read()
    except Exception:
      continue
    m=re.search(r"(?m)^(?:export\s+)?PORT\s*=\s*(\d+)", txt)
    if m:
      print(m.group(1))
      raise SystemExit(0)
print("")
' || true)
fi
echo "WEB_PORT=${WEB_PORT:-unknown}"

# If nginx sends public atakhome.com.tr to ERP :3100, point that block to the shop port.
if [ -n "${WEB_PORT:-}" ] && [ "$WEB_PORT" != "3100" ] && [ -d /etc/nginx ]; then
  python3 - "$WEB_PORT" <<'PY' || true
import os,re,sys
port=sys.argv[1]
root="/etc/nginx"
changed=0
block_re=re.compile(r"server\s*\{", re.I)
for dp, dns, fns in os.walk(root):
  for fn in fns:
    if not fn.endswith((".conf",".inc")): continue
    path=os.path.join(dp,fn)
    try:
      txt=open(path,"r",encoding="utf-8",errors="ignore").read()
    except Exception:
      continue
    if "atakhome.com.tr" not in txt: continue
    parts=re.split(r"(?=\bserver\s*\{)", txt)
    out=[]
    file_changed=False
    for part in parts:
      names=" ".join(re.findall(r"server_name([^;]+);", part))
      public=bool(re.search(r"(^|\s)(www\.)?atakhome\.com\.tr(\s|;)", names)) and not re.search(r"(^|\s)panel\.atakhome\.com\.tr(\s|;)", names)
      if public:
        new=re.sub(r"(proxy_pass\s+http://127\.0\.0\.1:)3100(\s*;)", r"\g<1>"+port+r"\2", part)
        new=re.sub(r"(proxy_pass\s+http://localhost:)3100(\s*;)", r"\g<1>"+port+r"\2", new)
        if new!=part:
          file_changed=True
          part=new
      out.append(part)
    if file_changed:
      open(path,"w",encoding="utf-8").write("".join(out))
      changed+=1
      print("NGINX_UPDATED",path,"->",port)
print("NGINX_CHANGED",changed)
PY
  if command -v nginx >/dev/null 2>&1; then
    if nginx -t >/tmp/atak-nginx-t.txt 2>&1; then
      systemctl reload nginx >/dev/null 2>&1 || service nginx reload >/dev/null 2>&1 || nginx -s reload >/dev/null 2>&1 || true
      echo "NGINX_RELOAD ok"
    else
      echo "NGINX_TEST_FAIL"
      tail -8 /tmp/atak-nginx-t.txt | sed 's/^/  /'
    fi
  fi
fi

sleep 2
echo "CHECK_LOCAL"
for P in ${WEB_PORT:-} 3000 3200 4173 8080; do
  [ -n "$P" ] || continue
  C=$(curl -sS -m 3 -o /tmp/atak-site-local.html -w "%{http_code}" "http://127.0.0.1:$P/" || echo err)
  T=$(tr '\n' ' ' </tmp/atak-site-local.html 2>/dev/null | sed 's/<[^>]*>/ /g' | tr -s ' ' | cut -c1-80)
  echo "LOCAL_$P code=$C title=$T"
done

echo "CHECK_PUBLIC"
PUB=$(curl -sS -m 10 -o /tmp/atak-site-pub.html -w "%{http_code} %{url_effective} %{redirect_url}" -L https://atakhome.com.tr/ || echo fail)
echo "PUBLIC $PUB"
if grep -qi "Personel Girişi\|Atak Pazarlama · Personel" /tmp/atak-site-pub.html 2>/dev/null; then
  echo "SITE_STILL_PERSONEL"
  echo "FAIL: atakhome.com.tr hala personel girisi. nginx atakhome.com.tr ERP 3100 e gidiyor olabilir."
  echo "pm2 list ve /etc/nginx icinde server_name atakhome.com.tr satirini kontrol edin."
  exit 1
fi
if grep -qi "beko\|sepet\|ürün\|urun\|atik\|Atak Home" /tmp/atak-site-pub.html 2>/dev/null; then
  echo "SITE_OK"
else
  echo "SITE_UP_UNKNOWN"
  head -c 200 /tmp/atak-site-pub.html 2>/dev/null; echo
fi

if command -v pm2 >/dev/null 2>&1; then
  echo "PM2_AFTER"
  pm2 list || true
fi
echo "SITE-FIX DONE"
