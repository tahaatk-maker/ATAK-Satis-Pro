'use strict';

/**
 * Beko katalog senkronu — resmi bayi Dynamics Excel / fiyat CSV üzerinden.
 * beko.com tüketici sitesinden otomatik tarama yapılmaz.
 */
const dealerCatalog = require('./dealer-catalog');

async function runBekoSync(store, opts = {}){
  if(!store || typeof store !== 'object'){
    return { ok: false, added: 0, updated: 0, error: 'store-required' };
  }
  const cats = dealerCatalog.ensureRetailCategories(store);
  const brands = dealerCatalog.ensureRetailBrands(store);
  let priceResult = { added: 0, updated: 0, skipped: 0 };
  if(Array.isArray(opts.rows) && opts.rows.length){
    priceResult = dealerCatalog.upsertDealerPriceRows(store, opts.rows, {
      publish: opts.publish !== false
    });
  }
  return {
    ok: true,
    source: 'dealer-feed',
    note: 'Beko ürünleri Dynamics Excel veya bayi fiyat CSV ile yüklenir; beko.com taranmaz.',
    categoriesAdded: cats.added,
    brandsAdded: brands.added,
    added: priceResult.added || 0,
    updated: priceResult.updated || 0,
    skipped: priceResult.skipped || 0
  };
}

module.exports = { runBekoSync };
