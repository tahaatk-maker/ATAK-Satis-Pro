# ATAK-Satis-Pro

Atak Pazarlama satış / finans platformu + **atakhome.com.tr** vitrin.

## Klasörler

- `atak_finans_server_json/atak güncelll/` — Ana ERP (Satış Merkezi, ürünler, cari, stok, web vitrin)
- `atak_finans_server_json/atak güncelll/public/vitrin/` — Genel vitrin (atakhome.com.tr)

## Web kataloğu (Beko + İstikbal)

Vitrin ürünleri **resmi bayi listelerinden** gelir:

1. **Beko** → Dynamics Excel aktarımı (admin → Dynamics Excel)
2. **İstikbal** → alış/stok CSV veya bayi fiyat CSV (Web Sitesi → Bayi fiyat listesi)
3. Showroom örnekleri boş katalogda geçici demo olarak eklenebilir

**Yapılmaz:** `beko.com` / `istikbal.com` tüketici sitelerinden otomatik ürün/fiyat/kategori kopyalama (telif ve site kullanım şartları).

CSV sütun örnekleri: `code`, `name`, `brand`, `category`, `salePrice` / `Birim Fiyat` / `Satış Fiyatı`.

## Test

```bash
node "atak_finans_server_json/atak güncelll/tests/dealer-catalog.test.js"
node "atak_finans_server_json/atak güncelll/tests/vitrin-public.test.js"
node "atak_finans_server_json/atak güncelll/tests/sales-calc.test.js"
```

## Not

Ürün verisi `data/store.json` içinde tutulur. Güncellemede bu dosyayı silmeyin.
