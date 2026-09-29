#!/bin/bash
# Point https://atakhome.com.tr at the public shop, not /personel.
# Leave https://panel.atakhome.com.tr on ERP.
# ASCII only. Do not translate this file.
set +e
echo "SITE-FIX START $(date -Is)"

if command -v pm2 >/dev/null 2>&1; then
  echo "PM2"
  pm2 list
  pm2 resurrect >/tmp/atak-pm2-resurrect.txt 2>&1
  pm2 restart atakhome-web --update-env >/tmp/atak-web-start.txt 2>&1 || pm2 start atakhome-web --update-env >/tmp/atak-web-start.txt 2>&1
  pm2 restart atakhome-ticaret --update-env >/tmp/atak-tic-start.txt 2>&1 || pm2 start atakhome-ticaret --update-env >/tmp/atak-tic-start.txt 2>&1
  echo "WEB_SHOW"
  pm2 show atakhome-web 2>/dev/null | head -40
fi

echo "LISTEN"
ss -lntp 2>/dev/null || netstat -lntp 2>/dev/null

python3 - <<'PY'
import glob, json, os, re, socket, subprocess, time

def sh(cmd):
    p = subprocess.run(cmd, shell=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    return p.returncode, p.stdout

def curl(url):
    code, out = sh('curl -sS -m 3 -D - -o /tmp/atak-curl-body.txt "%s" 2>/dev/null' % url)
    body = ""
    try:
        body = open("/tmp/atak-curl-body.txt", "r", encoding="utf-8", errors="ignore").read()
    except Exception:
        body = ""
    return out or "", body

def classify(port):
    hdr, body = curl("http://127.0.0.1:%s/" % port)
    h2, health = curl("http://127.0.0.1:%s/health" % port)
    blob = (hdr + "\n" + body + "\n" + health).lower()
    if "atakhome-erp-v2" in blob or "personel gir" in blob or "atak pazarlama · personel" in blob:
        return "erp", body[:80].replace("\n", " ")
    if "next" in blob or "sepet" in blob or "beko" in blob or "__next" in blob or "atak home" in blob:
        return "shop", body[:80].replace("\n", " ")
    if body.strip():
        return "other", body[:80].replace("\n", " ")
    return "down", ""

ports = set()
# pm2 env ports
code, jtxt = sh("pm2 jlist 2>/dev/null")
pm2_web = ""
pm2_erp = ""
try:
    apps = json.loads(jtxt or "[]")
except Exception:
    apps = []
for p in apps:
    env = p.get("pm2_env") or {}
    name = str(p.get("name") or "")
    port = str(env.get("PORT") or "")
    cwd = env.get("pm_cwd") or ""
    print("PM2_APP name=%s status=%s port=%s cwd=%s" % (name, env.get("status"), port, cwd))
    if port.isdigit():
        ports.add(int(port))
    if name in ("atakhome-web", "atak-web", "web") and port.isdigit():
        pm2_web = port
    if name == "atak" and port.isdigit():
        pm2_erp = port
    for fname in (".env", ".env.production", ".env.local"):
        path = os.path.join(cwd, fname)
        if not os.path.isfile(path):
            continue
        try:
            txt = open(path, "r", encoding="utf-8", errors="ignore").read()
        except Exception:
            continue
        m = re.search(r"(?m)^(?:export\s+)?PORT\s*=\s*(\d+)", txt)
        if m:
            ports.add(int(m.group(1)))
            if name in ("atakhome-web", "atak-web", "web"):
                pm2_web = pm2_web or m.group(1)
            print("ENV_PORT %s %s -> %s" % (name, path, m.group(1)))

for p in (3000, 3100, 3200, 3001, 4173, 5173, 8080):
    ports.add(p)

kinds = {}
for p in sorted(ports):
    kind, hint = classify(p)
    kinds[p] = kind
    print("PORT %s kind=%s hint=%s" % (p, kind, hint[:70]))

erp = None
shop = None
if pm2_erp and kinds.get(int(pm2_erp)) == "erp":
    erp = int(pm2_erp)
if pm2_web and kinds.get(int(pm2_web)) in ("shop", "other"):
    shop = int(pm2_web)
for p, kind in kinds.items():
    if kind == "erp" and erp is None:
        erp = p
    if kind == "shop" and shop is None:
        shop = p
if shop is None and pm2_web and pm2_web.isdigit() and int(pm2_web) != erp:
    shop = int(pm2_web)
if shop is None:
    for p, kind in kinds.items():
        if kind == "other" and p != erp:
            shop = p
            break

print("ERP_PORT=%s" % (erp if erp else "none"))
print("SHOP_PORT=%s" % (shop if shop else "none"))
open("/tmp/atak-site-ports.env", "w").write("ERP_PORT=%s\nSHOP_PORT=%s\n" % (erp or "", shop or ""))

if not shop:
    print("FAIL_NO_SHOP_PORT")
    raise SystemExit(1)

def rewrite_proxy(part, port):
    part = re.sub(r"proxy_pass\s+http://127\.0\.0\.1:\d+\s*;", "proxy_pass http://127.0.0.1:%s;" % port, part)
    part = re.sub(r"proxy_pass\s+http://localhost:\d+\s*;", "proxy_pass http://127.0.0.1:%s;" % port, part)
    return part

def names_of(part):
    return " ".join(re.findall(r"server_name([^;]+);", part))

changed = 0
root = "/etc/nginx"
if os.path.isdir(root):
    for dp, dns, fns in os.walk(root):
        for fn in fns:
            if not fn.endswith((".conf", ".inc")):
                continue
            path = os.path.join(dp, fn)
            try:
                txt = open(path, "r", encoding="utf-8", errors="ignore").read()
            except Exception:
                continue
            if "atakhome.com.tr" not in txt:
                continue
            parts = re.split(r"(?=\bserver\s*\{)", txt)
            out = []
            file_changed = False
            for part in parts:
                names = names_of(part)
                has_public = bool(re.search(r"(^|\s)(www\.)?atakhome\.com\.tr(\s|;|$)", names))
                has_panel = bool(re.search(r"(^|\s)panel\.atakhome\.com\.tr(\s|;|$)", names))
                if has_public and has_panel:
                    pub = rewrite_proxy(part, shop)
                    pub = re.sub(r"server_name[^;]+;", "server_name atakhome.com.tr www.atakhome.com.tr;", pub, count=1)
                    pan = rewrite_proxy(part, erp or 3000)
                    pan = re.sub(r"server_name[^;]+;", "server_name panel.atakhome.com.tr;", pan, count=1)
                    out.append(pub)
                    if not pub.endswith("\n"):
                        out.append("\n")
                    out.append(pan)
                    file_changed = True
                    print("NGINX_SPLIT %s shop=%s erp=%s" % (path, shop, erp))
                elif has_public and not has_panel:
                    new = rewrite_proxy(part, shop)
                    if new != part:
                        file_changed = True
                        print("NGINX_PUBLIC %s -> %s" % (path, shop))
                    out.append(new)
                elif has_panel and erp:
                    new = rewrite_proxy(part, erp)
                    if new != part:
                        file_changed = True
                        print("NGINX_PANEL %s -> %s" % (path, erp))
                    out.append(new)
                else:
                    out.append(part)
            if file_changed:
                bak = path + ".bak-sitefix"
                if not os.path.isfile(bak):
                    open(bak, "w", encoding="utf-8").write(txt)
                open(path, "w", encoding="utf-8").write("".join(out))
                changed += 1
print("NGINX_CHANGED", changed)
PY

if [ -f /tmp/atak-site-ports.env ]; then
  . /tmp/atak-site-ports.env
fi
echo "ERP_PORT=${ERP_PORT:-none} SHOP_PORT=${SHOP_PORT:-none}"

if command -v nginx >/dev/null 2>&1; then
  if nginx -t >/tmp/atak-nginx-t.txt 2>&1; then
    systemctl reload nginx >/dev/null 2>&1 || service nginx reload >/dev/null 2>&1 || nginx -s reload >/dev/null 2>&1
    echo "NGINX_RELOAD ok"
  else
    echo "NGINX_TEST_FAIL"
    tail -12 /tmp/atak-nginx-t.txt
  fi
fi

sleep 2
echo "CHECK_PUBLIC"
: > /tmp/atak-site-pub.html
curl -sS -m 12 -o /tmp/atak-site-pub.html -w "PUBLIC code=%{http_code} url=%{url_effective}\n" -L https://atakhome.com.tr/
if grep -qi "Personel Girişi\|Atak Pazarlama · Personel\|location: /personel" /tmp/atak-site-pub.html /dev/null 2>/dev/null; then
  echo "SITE_STILL_PERSONEL"
  echo "NGINX_SNIPPET ----"
  grep -RIn --include='*.conf' 'server_name\|proxy_pass' /etc/nginx 2>/dev/null | head -60
  echo "----"
else
  echo "SITE_OK_OR_CHANGED"
  head -c 180 /tmp/atak-site-pub.html; echo
fi

# final header check
curl -sSI -m 8 https://atakhome.com.tr/ | head -15
echo "SITE-FIX DONE"
