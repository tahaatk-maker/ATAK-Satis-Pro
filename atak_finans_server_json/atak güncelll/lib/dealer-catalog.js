'use strict';

/**
 * Atak Home bayi katalog yardımcıları.
 * Kaynak: resmi bayi Dynamics Excel (Beko) ve İstikbal stok/fiyat CSV.
 * beko.com / istikbal.com tüketici sitelerinden otomatik tarama YOKTUR.
 */

function fold(s){
  return String(s || '')
    .trim()
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .replace(/ş/g, 's')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/\s+/g, ' ');
}

function slugify(name){
  return fold(name)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'kategori';
}

/** Beyaz eşya (Beko) + mobilya (İstikbal) perakende kategori ağacı */
const RETAIL_CATEGORIES = [
  { id: 'beyaz-esya', name: 'Beyaz Eşya', sort: 10, brandHint: 'beko' },
  { id: 'buzdolabi', name: 'Buzdolabı', sort: 11, brandHint: 'beko', parent: 'beyaz-esya' },
  { id: 'dondurucu', name: 'Dondurucu', sort: 12, brandHint: 'beko', parent: 'beyaz-esya' },
  { id: 'camasir-makinesi', name: 'Çamaşır Makinesi', sort: 13, brandHint: 'beko', parent: 'beyaz-esya' },
  { id: 'kurutma-makinesi', name: 'Kurutma Makinesi', sort: 14, brandHint: 'beko', parent: 'beyaz-esya' },
  { id: 'bulasik-makinesi', name: 'Bulaşık Makinesi', sort: 15, brandHint: 'beko', parent: 'beyaz-esya' },
  { id: 'pisiriciler', name: 'Pişiriciler', sort: 16, brandHint: 'beko', parent: 'beyaz-esya' },
  { id: 'firin-solo-ank', name: 'Fırın (Solo+Ank.)', sort: 17, brandHint: 'beko', parent: 'beyaz-esya' },
  { id: 'ankastre-buzdolabi', name: 'Ankastre Buzdolabı', sort: 18, brandHint: 'beko', parent: 'beyaz-esya' },
  { id: 'ankastre-bulasik', name: 'Ankastre Bulaşık', sort: 19, brandHint: 'beko', parent: 'beyaz-esya' },
  { id: 'havalandirma', name: 'Havalandırma', sort: 20, brandHint: 'beko', parent: 'beyaz-esya' },
  { id: 'klima', name: 'Klima', sort: 30, brandHint: 'beko' },
  { id: 'tv-elektronik', name: 'TV & Elektronik', sort: 40, brandHint: 'beko' },
  { id: 'kucuk-ev-aletleri', name: 'Küçük Ev Aletleri', sort: 45, brandHint: 'beko' },
  { id: 'isiticilar', name: 'Isıtıcılar', sort: 46, brandHint: 'beko' },
  { id: 'mobilya', name: 'Mobilya', sort: 50, brandHint: 'istikbal' },
  { id: 'oturma-grubu', name: 'Oturma Grubu', sort: 51, brandHint: 'istikbal', parent: 'mobilya' },
  { id: 'yatak-odasi', name: 'Yatak Odası', sort: 52, brandHint: 'istikbal', parent: 'mobilya' },
  { id: 'yemek-odasi', name: 'Yemek Odası', sort: 53, brandHint: 'istikbal', parent: 'mobilya' },
  { id: 'genc-odasi', name: 'Genç Odası', sort: 54, brandHint: 'istikbal', parent: 'mobilya' },
  { id: 'yatak-baza', name: 'Yatak & Baza', sort: 55, brandHint: 'istikbal', parent: 'mobilya' },
  { id: 'tv-unitesi', name: 'TV Ünitesi', sort: 56, brandHint: 'istikbal', parent: 'mobilya' },
  { id: 'ceyiz', name: 'Çeyiz', sort: 60, brandHint: 'istikbal' },
  { id: 'yazar-kasa', name: 'Yazar Kasa', sort: 90, brandHint: 'beko' },
  { id: 'diger', name: 'Diğer', sort: 99, brandHint: '' }
];

const SHOWCASE_PRODUCTS = [
  {
    code: 'AH-SHOW-BUZ-01',
    name: 'No-frost buzdolabı — showroom modeli',
    brand: 'Beko',
    category: 'buzdolabi',
    listPrice: 42999,
    cashPrice: 39999,
    salePrice: 39999,
    vatRate: 20,
    featured: true,
    tags: ['showroom', 'beko', 'vitrin'],
    description: 'Atak Home Sarıyer showroom’da inceleyebilirsiniz. Güncel fiyat ve stok için arayın.'
  },
  {
    code: 'AH-SHOW-CAM-01',
    name: 'Çamaşır makinesi — showroom modeli',
    brand: 'Beko',
    category: 'camasir-makinesi',
    listPrice: 24999,
    cashPrice: 22999,
    salePrice: 22999,
    vatRate: 20,
    featured: true,
    tags: ['showroom', 'beko', 'vitrin'],
    description: 'Atak Home showroom stok örneği. Bayi listesinden güncellenir.'
  },
  {
    code: 'AH-SHOW-KLIMA-01',
    name: 'Duvar tipi klima — showroom modeli',
    brand: 'Beko',
    category: 'klima',
    listPrice: 28999,
    cashPrice: 26999,
    salePrice: 26999,
    vatRate: 20,
    featured: true,
    tags: ['showroom', 'beko', 'vitrin'],
    description: 'Montaj ve keşif için Atak Home ile iletişime geçin.'
  },
  {
    code: 'AH-SHOW-KOLTUK-01',
    name: 'L köşe koltuk — showroom modeli',
    brand: 'İstikbal',
    category: 'oturma-grubu',
    listPrice: 54999,
    cashPrice: 49999,
    salePrice: 49999,
    vatRate: 10,
    featured: true,
    tags: ['showroom', 'istikbal', 'mobilya', 'vitrin'],
    description: 'İstikbal oturma grubu showroom örneği. Kumaş ve ölçü seçenekleri mağazada.'
  },
  {
    code: 'AH-SHOW-YATAK-01',
    name: 'Yatak odası takımı — showroom modeli',
    brand: 'İstikbal',
    category: 'yatak-odasi',
    listPrice: 79999,
    cashPrice: 74999,
    salePrice: 74999,
    vatRate: 10,
    featured: true,
    tags: ['showroom', 'istikbal', 'mobilya', 'vitrin'],
    description: 'İstikbal yatak odası showroom örneği. Resmi bayi fiyat listesinden güncellenir.'
  },
  {
    code: 'AH-SHOW-YEMEK-01',
    name: 'Yemek odası takımı — showroom modeli',
    brand: 'İstikbal',
    category: 'yemek-odasi',
    listPrice: 45999,
    cashPrice: 42999,
    salePrice: 42999,
    vatRate: 10,
    featured: false,
    tags: ['showroom', 'istikbal', 'mobilya', 'vitrin'],
    description: 'İstikbal yemek odası showroom örneği.'
  }
];

function ensureRetailCategories(store){
  if(!store.categories) store.categories = [];
  let added = 0;
  for(const cat of RETAIL_CATEGORIES){
    const hit = store.categories.find(
      (c) => c.id === cat.id || fold(c.name) === fold(cat.name)
    );
    if(hit){
      if(hit.active === false) hit.active = true;
      if(cat.parent && !hit.parent) hit.parent = cat.parent;
      continue;
    }
    store.categories.push({
      id: cat.id,
      name: cat.name,
      active: true,
      sort: cat.sort,
      parent: cat.parent || '',
      description: cat.brandHint
        ? `Atak Home ${cat.brandHint === 'beko' ? 'Beko' : 'İstikbal'} kategorisi`
        : ''
    });
    added += 1;
  }
  store.categories.sort((a, b) => Number(a.sort || 0) - Number(b.sort || 0));
  return { added, total: store.categories.length };
}

function ensureRetailBrands(store){
  if(!store.brands) store.brands = [];
  const wanted = [
    { id: 'beko', name: 'Beko', sort: 0 },
    { id: 'istikbal', name: 'İstikbal', sort: 1 },
    { id: 'grundig', name: 'Grundig', sort: 2 }
  ];
  let added = 0;
  for(const b of wanted){
    if(store.brands.some((x) => fold(x.name) === fold(b.name) || x.id === b.id)) continue;
    store.brands.push({ id: b.id, name: b.name, active: true, sort: b.sort, logo: '' });
    added += 1;
  }
  return { added };
}

function suggestCategoryId(text){
  const raw = fold(text);
  const t = raw.replace(/^beko[\s\-_]*/, '');
  if(/\bx30\s*tr\b|yazar\s*kasa/.test(raw)) return 'yazar-kasa';
  if(/oturma|koltuk|kanepe|kose|köşe|chester/.test(raw)) return 'oturma-grubu';
  if(/yatak\s*oda|dolap\s*takim|komodin|sifonyer/.test(raw)) return 'yatak-odasi';
  if(/yemek\s*oda|masa\s*takim|sandalye/.test(raw) && !/camasir|bulasik/.test(raw)) return 'yemek-odasi';
  if(/genc\s*oda|genç\s*oda|calisma\s*masa/.test(raw)) return 'genc-odasi';
  if(/baza|yatak(?!\s*oda)|mattress|somye/.test(raw)) return 'yatak-baza';
  if(/tv\s*unite|tv\s*ünite|konsol/.test(raw)) return 'tv-unitesi';
  if(/ceyiz|çeyiz/.test(raw)) return 'ceyiz';
  if(/istikbal|mobilya/.test(raw)) return 'mobilya';
  if(/klima|btu|inverter\s*klima/.test(raw)) return 'klima';
  if(/\btv\b|televizyon|google\s*tv|smart\s*tv|oled|qled/.test(raw)) return 'tv-elektronik';
  if(/kurutma|\bkmx\b|\bkm\s*\d|^km(?:[\s\-_]|\d)/.test(t)) return 'kurutma-makinesi';
  if(/camasir|çamaşır|\bcmx\b|\bcm\s*\d|^c(?:[\s\-_]|\d)/.test(t)) return 'camasir-makinesi';
  if(/bulasik|bulaşık|\bbm\s*\d|^bm(?:[\s\-_]|\d)/.test(t)) return 'bulasik-makinesi';
  if(/dondurucu|derin\s*dond/.test(t)) return 'dondurucu';
  if(/ankastre.*buz|gömme\s*buz/.test(t)) return 'ankastre-buzdolabi';
  if(/ankastre.*bulasik|ankastre.*bulaşık/.test(t)) return 'ankastre-bulasik';
  if(/firin|fırın|ankastre\s*ocak|bfc|bfm/.test(t)) return 'pisiriciler';
  if(/davlumba|havalandir|aspiratör|aspirator/.test(t)) return 'havalandirma';
  if(/isitici|ısıtıcı|radiator|kalorifer/.test(t)) return 'isiticilar';
  if(/buzdolabi|buzdolabı|no[\s-]*frost|\bnfb\b|^[968]\d/.test(t)) return 'buzdolabi';
  if(/supurge|süpürge|blender|tost|kettle|üreteç|kea/.test(t)) return 'kucuk-ev-aletleri';
  if(/beyaz\s*esya|beyaz\s*eşya/.test(raw)) return 'beyaz-esya';
  return 'diger';
}

function parseMoney(v){
  if(v == null || v === '') return 0;
  if(typeof v === 'number') return Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0;
  let s = String(v).trim().replace(/[₺TL\s]/gi, '');
  if(!s) return 0;
  if(/\d,\d{2}$/.test(s) && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.');
  else if(/\d,\d{2}$/.test(s)) s = s.replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

function rowPick(row, keys){
  const map = {};
  for(const [k, v] of Object.entries(row || {})) map[fold(k)] = v;
  for(const key of keys){
    const hit = map[fold(key)];
    if(hit != null && String(hit).trim() !== '') return hit;
  }
  return '';
}

function normalizeDealerPriceRow(row){
  const code = String(rowPick(row, [
    'code', 'urun kodu', 'ürün kodu', 'stok kodu', 'madde kodu', 'malzeme1',
    'search name', 'arama adi', 'arama adı', 'sku'
  ]) || '').trim();
  const name = String(rowPick(row, [
    'name', 'urun adi', 'ürün adı', 'urun ad', 'malzeme uzun metni e',
    'arama adi', 'arama adı', 'aciklama', 'açıklama'
  ]) || code).trim();
  const brandRaw = String(rowPick(row, ['brand', 'marka']) || '').trim();
  const brand = brandRaw || (/istikbal|koltuk|yatak|kanepe|mobilya/i.test(`${code} ${name}`) ? 'İstikbal' : 'Beko');
  const categoryHint = String(rowPick(row, ['category', 'kategori']) || '').trim();
  const category = categoryHint
    ? (slugify(categoryHint) || suggestCategoryId(`${code} ${name} ${brand}`))
    : suggestCategoryId(`${code} ${name} ${brand}`);
  const salePrice = parseMoney(rowPick(row, [
    'salePrice', 'satis fiyati', 'satış fiyatı', 'fiyat', 'birim fiyat',
    'cashPrice', 'nakit fiyat', 'liste fiyati', 'liste fiyatı'
  ]));
  const listPrice = parseMoney(rowPick(row, [
    'listPrice', 'liste fiyati', 'liste fiyatı', 'eski fiyat', 'oldPrice', 'tavsiye fiyati'
  ])) || salePrice;
  return {
    code: code || name,
    name: name || code,
    brand,
    category,
    salePrice,
    listPrice,
    cashPrice: salePrice,
    cardPrice: salePrice,
    vatRate: /istikbal|mobilya|oturma|yatak|yemek|genc|ceyiz/i.test(`${brand} ${category} ${name}`) ? 10 : 20
  };
}

function upsertDealerPriceRows(store, rows, opts = {}){
  ensureRetailCategories(store);
  ensureRetailBrands(store);
  if(!store.products) store.products = [];
  const publish = opts.publish !== false;
  let added = 0;
  let updated = 0;
  let skipped = 0;
  for(const raw of rows || []){
    const row = normalizeDealerPriceRow(raw);
    if(!row.code || !row.name){ skipped += 1; continue; }
    const key = fold(row.code);
    let product = store.products.find(
      (p) => fold(p.code) === key || fold(p.searchName) === key || fold(p.itemCode) === key
    );
    const tags = new Set([...(product?.tags || []).map(String), 'dealer-price-csv', fold(row.brand)]);
    if(/istikbal/i.test(row.brand)) tags.add('mobilya');
    if(/beko|grundig/i.test(row.brand)) tags.add('beyaz-esya');
    if(!product){
      product = {
        id: require('crypto').randomUUID(),
        code: row.code,
        name: row.name,
        searchName: row.code,
        brand: row.brand,
        category: row.category,
        purchasePrice: 0,
        listPrice: row.listPrice,
        oldPrice: row.listPrice,
        bekoPrice: /beko/i.test(row.brand) ? row.listPrice : 0,
        cashPrice: row.cashPrice,
        cardPrice: row.cardPrice,
        salePrice: row.salePrice,
        minimumSalePrice: 0,
        vatRate: row.vatRate,
        priceMode: 'manual',
        priceValue: row.salePrice,
        stock: 0,
        active: publish,
        featured: false,
        tags: [...tags],
        image: '',
        images: [],
        description: '',
        sourceUrl: '',
        updatedAt: new Date().toISOString()
      };
      store.products.unshift(product);
      added += 1;
    } else {
      product.name = row.name || product.name;
      product.brand = row.brand || product.brand;
      product.category = row.category || product.category;
      if(row.salePrice > 0){
        product.salePrice = row.salePrice;
        product.cashPrice = row.cashPrice;
        product.cardPrice = row.cardPrice;
        product.priceMode = 'manual';
        product.priceValue = row.salePrice;
      }
      if(row.listPrice > 0){
        product.listPrice = row.listPrice;
        product.oldPrice = row.listPrice;
        if(/beko/i.test(row.brand)) product.bekoPrice = row.listPrice;
      }
      product.vatRate = row.vatRate;
      product.tags = [...tags];
      if(publish) product.active = true;
      product.updatedAt = new Date().toISOString();
      updated += 1;
    }
  }
  return { ok: true, added, updated, skipped, total: store.products.length };
}

function seedShowcaseIfEmpty(store){
  ensureRetailCategories(store);
  ensureRetailBrands(store);
  if(!store.products) store.products = [];
  const real = store.products.filter((p) => !(p.tags || []).includes('showroom'));
  if(real.length > 0) return { seeded: 0, reason: 'catalog-not-empty' };
  if(store.products.some((p) => (p.tags || []).includes('showroom'))) {
    return { seeded: 0, reason: 'showcase-exists' };
  }
  const crypto = require('crypto');
  for(const sample of SHOWCASE_PRODUCTS){
    store.products.push({
      id: crypto.randomUUID(),
      ...sample,
      searchName: sample.code,
      oldPrice: sample.listPrice,
      bekoPrice: /beko/i.test(sample.brand) ? sample.listPrice : 0,
      cardPrice: sample.cashPrice,
      minimumSalePrice: 0,
      priceMode: 'manual',
      priceValue: sample.salePrice,
      stock: 1,
      active: true,
      image: '',
      images: [],
      sourceUrl: '',
      updatedAt: new Date().toISOString()
    });
  }
  return { seeded: SHOWCASE_PRODUCTS.length, reason: 'ok' };
}

module.exports = {
  RETAIL_CATEGORIES,
  SHOWCASE_PRODUCTS,
  fold,
  slugify,
  ensureRetailCategories,
  ensureRetailBrands,
  suggestCategoryId,
  parseMoney,
  normalizeDealerPriceRow,
  upsertDealerPriceRows,
  seedShowcaseIfEmpty
};
