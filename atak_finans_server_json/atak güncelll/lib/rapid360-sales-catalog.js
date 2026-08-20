'use strict';

function fold(s){
  return String(s || '').trim().toLocaleLowerCase('tr-TR');
}

function lineKey(line){
  return String((line && (line.itemCode || line.name || line.searchName)) || '').trim();
}

function findCatalogProduct(products, line){
  const item = fold(line && line.itemCode);
  const search = fold(line && (line.name || line.searchName));
  const pid = fold(line && (line.dynamicsProductId || line.itemCode));
  return (products || []).find((p) =>
    (item && (fold(p.itemCode) === item || fold(p.code) === item)) ||
    (search && (fold(p.searchName) === search || fold(p.code) === search || fold(p.name) === search)) ||
    (pid && fold(p.dynamicsProductId) === pid)
  ) || null;
}

function parseCategoryMap(raw){
  let map = raw;
  if(typeof map === 'string'){
    try{ map = JSON.parse(map || '{}'); }catch{ return {}; }
  }
  if(!map || typeof map !== 'object' || Array.isArray(map)) return {};
  const out = {};
  for(const [k, v] of Object.entries(map)){
    const key = String(k || '').trim();
    const cat = String(v || '').trim();
    if(key && cat) out[key] = cat;
  }
  return out;
}

function lookupCategory(map, item, fallback){
  const keys = [item && item.itemCode, item && item.name, item && item.key, item && item.searchName]
    .map((x) => String(x || '').trim())
    .filter(Boolean);
  for(const k of keys){
    if(map && map[k]) return String(map[k]).trim();
    const hit = Object.keys(map || {}).find((x) => fold(x) === fold(k));
    if(hit) return String(map[hit]).trim();
  }
  return String(fallback || '').trim();
}

function parseSalesIds(raw){
  if(raw == null || raw === '') return [];
  if(Array.isArray(raw)) return [...new Set(raw.map((s) => String(s || '').trim()).filter(Boolean))];
  if(typeof raw === 'string'){
    const t = raw.trim();
    if(!t) return [];
    if(t.startsWith('[')){
      try{ return parseSalesIds(JSON.parse(t)); }catch{ /* fall through */ }
    }
    return [...new Set(t.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean))];
  }
  return [];
}

function filterSalesByIds(parsed, salesIds){
  const ids = new Set(parseSalesIds(salesIds));
  if(!ids.size) return parsed;
  const sales = ((parsed && parsed.sales) || []).filter((s) => ids.has(String(s.salesId || '').trim()));
  return Object.assign({}, parsed || {}, { sales });
}

function collectMissingProducts(parsed, products, opts = {}){
  const skip = opts.skipSalesIds instanceof Set ? opts.skipSalesIds : new Set(opts.skipSalesIds || []);
  const suggest = typeof opts.suggestCategoryId === 'function' ? opts.suggestCategoryId : () => '';
  const furniture = opts.furniture === true;
  const seen = new Map();
  for(const sale of (parsed && parsed.sales) || []){
    const salesId = String(sale && sale.salesId || '').trim();
    if(salesId && skip.has(salesId)) continue;
    for(const line of (sale && sale.lines) || []){
      const key = lineKey(line);
      if(!key) continue;
      if(findCatalogProduct(products, line)) continue;
      const k = fold(key);
      if(seen.has(k)){
        const row = seen.get(k);
        row.salesCount += 1;
        if(salesId && !row.salesIds.includes(salesId)) row.salesIds.push(salesId);
        continue;
      }
      const name = String(line.name || line.searchName || key).trim();
      const hint = furniture ? `mobilya ${name} ${key}` : `${name} ${key}`;
      const suggested = String(suggest(hint) || '').trim();
      seen.set(k, {
        key,
        itemCode: String(line.itemCode || '').trim(),
        name,
        suggestedCategoryId: suggested,
        categoryId: suggested,
        salesCount: 1,
        salesIds: salesId ? [salesId] : []
      });
    }
  }
  return [...seen.values()];
}

function paymentSplitKey(method){
  const s = String(method || '').toLocaleLowerCase('tr-TR');
  if(/senet|promiss|cek|çek/.test(s)) return 'note';
  if(/kredi\s*kart|kk\b|card|pos/.test(s)) return 'card';
  if(/havale|eft|transfer|banka/.test(s)) return 'transfer';
  if(/vadeli|credit|acik\s*hesap|açık/.test(s)) return 'credit';
  if(/nakit|cash|nak\b/.test(s)) return 'cash';
  return 'credit';
}

function paymentsToSplits(payments){
  const out = { cash: 0, card: 0, transfer: 0, credit: 0, note: 0 };
  for(const p of payments || []){
    const amt = Number(p && p.amount);
    if(!(amt > 0)) continue;
    const key = paymentSplitKey(p.method || p.rawMethod);
    out[key] = Math.round((out[key] + amt) * 100) / 100;
  }
  return out;
}

function isOpenRapidSale(tx){
  if(!tx || String(tx.kind || '') !== 'sale' || tx.cancelled) return false;
  if(tx.needsCompletion === true || tx.rapidDraft === true) return true;
  const src = String(tx.source || '');
  const rapidId = String(tx.rapidSalesId || '').trim();
  if(!/^rapid360/i.test(src) && !rapidId) return false;
  if(tx.cashPosted === true) return false;
  if(Array.isArray(tx.collectionIds) && tx.collectionIds.length) return false;
  if(Number(tx.customerDelta || 0) !== 0) return false;
  return true;
}

function markImportedSaleDraft(row, src){
  const sale = src || {};
  row.needsCompletion = true;
  row.rapidDraft = true;
  row.cashPosted = false;
  row.deliveryStatus = 'order_received';
  row.invoiceStatus = 'not_required';
  row.rapidInvoiceNumber = String(sale.invoiceNumber || row.rapidInvoiceNumber || row.invoiceNumber || '').trim();
  row.rapidInvoiceDate = sale.invoiceDate || row.rapidInvoiceDate || row.invoiceDate || '';
  row.invoiceNumber = '';
  row.invoiceDate = '';
  row.invoiceIssuedAt = '';
  row.invoiceQueueId = '';
  row.customerDelta = 0;
  row.amount = 0;
  return row;
}

module.exports = {
  fold,
  lineKey,
  findCatalogProduct,
  parseCategoryMap,
  lookupCategory,
  collectMissingProducts,
  parseSalesIds,
  filterSalesByIds,
  paymentSplitKey,
  paymentsToSplits,
  isOpenRapidSale,
  markImportedSaleDraft
};
