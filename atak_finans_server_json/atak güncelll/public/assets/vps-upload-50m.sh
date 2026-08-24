#!/bin/bash
# Raise panel upload limit to 50 MB. ASCII only. Chrome translate OFF.
# Does not copy ERP. Does not restart pm2.
set +e
echo "UPLOAD-50M START $(date -Is)"

if [ -d /etc/nginx/conf.d ] && [ -w /etc/nginx/conf.d ]; then
  printf 'client_max_body_size 50m;\nproxy_read_timeout 300s;\nproxy_send_timeout 300s;\nsend_timeout 300s;\n' > /etc/nginx/conf.d/99-atak-upload.conf
  echo "WROTE /etc/nginx/conf.d/99-atak-upload.conf"
fi

if [ -d /etc/nginx ]; then
  find /etc/nginx -type f \( -name '*.conf' -o -name '*.inc' \) 2>/dev/null | while read -r f; do
    [ -f "$f" ] && [ -w "$f" ] || continue
    grep -q 'client_max_body_size' "$f" || continue
    sed -i -E 's/client_max_body_size[[:space:]]+[0-9]+[kKmM]/client_max_body_size 50m/g' "$f"
    echo "PATCHED $f"
  done
fi

if command -v nginx >/dev/null 2>&1; then
  if nginx -t >/tmp/atak-upload-50m-ngx.txt 2>&1; then
    systemctl reload nginx >/dev/null 2>&1 || nginx -s reload >/dev/null 2>&1 || true
    echo "NGINX_RELOAD ok"
  else
    echo "NGINX_FAIL"
    cat /tmp/atak-upload-50m-ngx.txt
  fi
else
  echo "nginx yok"
fi

if [ -d /etc/apache2/conf-available ] && [ -w /etc/apache2/conf-available ]; then
  printf 'LimitRequestBody 52428800\n' > /etc/apache2/conf-available/atak-upload.conf
  a2enconf atak-upload >/dev/null 2>&1 || true
  systemctl reload apache2 >/dev/null 2>&1 || true
  echo "APACHE 50m"
fi

echo "LIMITS"
grep -h client_max_body_size /etc/nginx/conf.d/99-atak-upload.conf /etc/nginx/nginx.conf 2>/dev/null | head -5
echo "UPLOAD-50M DONE"
