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
        seen.get(k).salesCount += 1;
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
        salesCount: 1
      });
    }
  }
  return [...seen.values()];
}

module.exports = {
  fold,
  lineKey,
  findCatalogProduct,
  parseCategoryMap,
  lookupCategory,
  collectMissingProducts
};
