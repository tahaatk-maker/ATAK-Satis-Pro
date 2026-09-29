#!/bin/bash
# ATAK — TAM YEDEK (once bunu calistir, sonra deploy)
# Veri, ayar dosyalari ve yuklenen dosyalar tek arsivde toplanir.
set -uo pipefail
STAMP=$(date +%Y%m%d-%H%M%S)
DEST="/root/atak-yedek"
OUT="$DEST/atak-yedek-$STAMP"
LOG="/tmp/atak-yedek.txt"
: > "$LOG"
log(){ echo "$*" | tee -a "$LOG"; }

log "=== ATAK YEDEK $STAMP ==="
mkdir -p "$OUT"

APPS=""
for D in /root/atak-v10 /root/atakhome-platform; do
  [ -f "$D/server.js" ] && APPS="$APPS $D"
done
[ -n "$APPS" ] || { log "FAIL: uygulama klasoru bulunamadi"; exit 1; }
log "uygulamalar:$APPS"

COPIED=0
for D in $APPS; do
  NAME=$(basename "$D")
  mkdir -p "$OUT/$NAME"
  if [ -f "$D/data/store.json" ]; then
    cp -a "$D/data/store.json" "$OUT/$NAME/store.json"
    SIZE=$(stat -c%s "$OUT/$NAME/store.json")
    log "  $NAME/store.json  $SIZE bayt"
    if command -v node >/dev/null 2>&1; then
      node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$OUT/$NAME/store.json" \
        && log "    JSON gecerli" || log "    UYARI: JSON okunamadi"
      node -e '
const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
const n=k=>Array.isArray(s[k])?s[k].length:0;
console.log("    kayit: musteri="+n("customers")+" urun="+n("products")+" satis="+n("sales")+
  " hareket="+n("financeTransactions")+" senet="+n("promissoryNotes")+" kullanici="+n("users"));
' "$OUT/$NAME/store.json" | tee -a "$LOG"
    fi
    COPIED=$((COPIED+1))
  fi
  # eski otomatik yedekler de gelsin
  find "$D/data" -maxdepth 1 -name 'store.json.bak-*' -printf '%f\n' 2>/dev/null | tail -5 | while read -r F; do
    cp -a "$D/data/$F" "$OUT/$NAME/$F" 2>/dev/null && log "  $NAME/$F"
  done
  [ -f "$D/.env" ] && cp -a "$D/.env" "$OUT/$NAME/env.txt" && log "  $NAME/.env"
  if [ -d "$D/public/uploads" ]; then
    mkdir -p "$OUT/$NAME/uploads"
    cp -a "$D/public/uploads/." "$OUT/$NAME/uploads/" 2>/dev/null || true
    UP=$(du -sh "$OUT/$NAME/uploads" 2>/dev/null | cut -f1)
    log "  $NAME/uploads  $UP"
  fi
done
[ "$COPIED" -gt 0 ] || { log "FAIL: store.json bulunamadi, yedek alinamadi"; exit 1; }

command -v pm2 >/dev/null 2>&1 && pm2 list > "$OUT/pm2-list.txt" 2>/dev/null
{ echo "tarih: $(date -Is)"; echo "host: $(hostname)"; curl -fsS http://127.0.0.1:3100/health 2>/dev/null; } > "$OUT/bilgi.txt"

TAR="$DEST/atak-yedek-$STAMP.tar.gz"
tar -czf "$TAR" -C "$DEST" "atak-yedek-$STAMP" && log "arsiv: $TAR ($(du -h "$TAR" | cut -f1))"

# 10 gunden eski arsivleri temizle (yer dolmasin)
find "$DEST" -maxdepth 1 -name 'atak-yedek-*.tar.gz' -mtime +10 -delete 2>/dev/null

log ""
log "=== YEDEK TAMAM ==="
log "Klasor : $OUT"
log "Arsiv  : $TAR"
log "Geri yukleme (gerekirse):"
log "  pm2 stop all"
log "  cp -a $OUT/atak-v10/store.json /root/atak-v10/data/store.json"
log "  pm2 restart all"
log "Bilgisayara indirmek icin (kendi bilgisayarinizda):"
log "  scp root@SUNUCU_IP:$TAR ."
