'use strict';

const assert = require('assert');
const dealerCatalog = require('../lib/dealer-catalog');
const { runBekoSync } = require('../lib/beko-sync');

async function main(){
  const store = { categories: [], brands: [], products: [] };
  const cats = dealerCatalog.ensureRetailCategories(store);
  assert.ok(cats.total >= 20);
  assert.ok(store.categories.some((c) => c.id === 'buzdolabi'));
  assert.ok(store.categories.some((c) => c.id === 'oturma-grubu' && c.parent === 'mobilya'));

  dealerCatalog.ensureRetailBrands(store);
  assert.ok(store.brands.some((b) => /beko/i.test(b.name)));
  assert.ok(store.brands.some((b) => dealerCatalog.fold(b.name) === 'istikbal'));

  assert.equal(dealerCatalog.suggestCategoryId('BEKO BM 3145'), 'bulasik-makinesi');
  assert.equal(dealerCatalog.suggestCategoryId('L köşe koltuk İstikbal'), 'oturma-grubu');
  assert.equal(dealerCatalog.suggestCategoryId('Yatak odası takımı'), 'yatak-odasi');
  assert.equal(dealerCatalog.suggestCategoryId('12000 BTU klima'), 'klima');

  const price = dealerCatalog.upsertDealerPriceRows(store, [
    { code: 'BM 3145', name: 'BM 3145 BEKO', brand: 'Beko', 'Satış Fiyatı': '18.500,00', category: 'Bulaşık Makinesi' },
    { 'Madde kodu': 'IST-KOL-01', 'Malzeme Uzun Metni E': 'Köşe Koltuk', Marka: 'İstikbal', 'Birim Fiyat': '45000' }
  ]);
  assert.equal(price.added, 2);
  assert.ok(store.products.some((p) => p.code === 'BM 3145' && p.salePrice === 18500));
  assert.ok(store.products.some((p) => dealerCatalog.fold(p.brand) === 'istikbal' && p.vatRate === 10));

  const seedEmpty = { categories: [], brands: [], products: [] };
  const seeded = dealerCatalog.seedShowcaseIfEmpty(seedEmpty);
  assert.equal(seeded.seeded, dealerCatalog.SHOWCASE_PRODUCTS.length);
  const seededAgain = dealerCatalog.seedShowcaseIfEmpty(seedEmpty);
  assert.equal(seededAgain.seeded, 0);

  const sync = await runBekoSync(store, {});
  assert.equal(sync.ok, true);
  assert.equal(sync.source, 'dealer-feed');
  assert.match(sync.note, /taranmaz|Dynamics/i);

  console.log('dealer-catalog.test.js ok');
}

main().catch((e)=>{ console.error(e); process.exit(1); });
