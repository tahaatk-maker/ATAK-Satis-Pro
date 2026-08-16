# ATAK-Satis-Pro

Atak Pazarlama satış / finans platformu.

## Klasörler

- `atak_finans_server_json/atak güncelll/` — Ana ERP (Satış Merkezi, ürünler, cari, stok)
- `atak_finans_server_json/` — Ayrı Atak Finans (JSON) uygulaması

## Satış Merkezi (iskonto / prim)

Örnek: brüt 10.000 ₺ + %7 iskonto + %0,5 prim

- İskonto: 700 ₺
- Net: 9.300 ₺
- Prim: 46,50 ₺

Test:

```bash
node "atak_finans_server_json/atak güncelll/tests/sales-calc.test.js"
```

## Not

Ürün verisi `data/store.json` içinde tutulur. Güncellemede bu dosyayı silmeyin.
