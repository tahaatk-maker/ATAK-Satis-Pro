'use strict';

/**
 * Rapid360 D365 F&O OData — Okta token ile yalnız satış kalemlerini oku.
 * geteinvoices / başkan mule hesabı kullanılmaz.
 */

const salesXml = require('./rapid360-sales-xml');
const d365Auth = require('./rapid360-d365-auth');

const DEFAULT_STORE = '340334';
const DEFAULT_COMPANY = '2521';
const PAGE_SIZE = 200;
const MAX_PAGES = 15;

const PREFERRED_ENTITIES = [
  'DmrDetailedSalesReports',
  'DmrDetailedSalesReportLines',
  'DmrDetailedSales',
  'DmrSalesLines',
  'DmrSatisBilgileri',
  'RetailTransactionSalesTrans',
  'RetailTransactionSalesLines',
  'RetailTransactions',
  'SalesOrderLinesV3',
  'SalesOrderLinesV2',
  'SalesInvoiceLinesV3',
  'SalesInvoiceLinesV2',
  'CustInvoiceTrans',
  'SalesOrderHeadersV3',
  'SalesOrderHeadersV2'
];

function odataHeaders(token){
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    'OData-MaxVersion': '4.0',
    'OData-Version': '4.0'
  };
}

function fold(s){
  return salesXml.foldKey(s);
}

function findKey(obj, names){
  const map = {};
  for(const k of Object.keys(obj || {})){
    const f = fold(k);
    if(f && map[f] == null) map[f] = k;
  }
  for(const n of names){
    const f = fold(n);
    if(map[f]) return map[f];
  }
  return '';
}

function scoreEntityName(name){
  const s = String(name || '').toLowerCase();
  if(!s || /metadata|entitystore|datamanagement/.test(s)) return 0;
  let n = 0;
  if(/dmr/.test(s) && /(sales|satis|detail|detay)/.test(s)) n += 120;
  if(/detaile.*sales|sales.*detail|detayli.*satis|satis.*detay/.test(s)) n += 90;
  if(/retailtransaction/.test(s) && /(sales|line|trans)/.test(s)) n += 70;
  if(/salesorderline/.test(s)) n += 50;
  if(/salesinvoice.*line|custinvoicetran/.test(s)) n += 42;
  if(/salesorderheader/.test(s)) n += 28;
  if(/retailtransaction/.test(s)) n += 22;
  return n;
}

function odataQuote(v){
  return `'${String(v || '').replace(/'/g, "''")}'`;
}

function isoBound(d, end){
  const s = String(d || '').slice(0, 10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  return end ? `${s}T23:59:59Z` : `${s}T00:00:00Z`;
}

function buildFilters(sample, { company, store, startDate, endDate }){
  const dateKey = findKey(sample, [
    'OrderDate', 'TransDate', 'InvoiceDate', 'ReceiptDate', 'CreatedDateTime',
    'TransactionDate', 'SalesDate', 'SiparisTarihi', 'OrderingDate'
  ]);
  const storeKey = findKey(sample, [
    'InventLocationId', 'WarehouseId', 'StoreNumber', 'RetailStoreId', 'Store',
    'Magaza', 'InventSiteId', 'Warehouse'
  ]);
  const companyKey = findKey(sample, ['dataAreaId', 'DataAreaId', 'Company']);
  const variants = [];
  const parts = [];
  if(companyKey && company) parts.push(`${companyKey} eq ${odataQuote(company)}`);
  if(storeKey && store) parts.push(`${storeKey} eq ${odataQuote(store)}`);
  if(dateKey && startDate){
    parts.push(`${dateKey} ge ${isoBound(startDate, false)}`);
    if(endDate) parts.push(`${dateKey} le ${isoBound(endDate, true)}`);
  }
  if(parts.length) variants.push(parts.join(' and '));
  if(storeKey && store && dateKey && startDate){
    variants.push(`${storeKey} eq ${odataQuote(store)} and ${dateKey} ge ${isoBound(startDate, false)}${endDate ? ` and ${dateKey} le ${isoBound(endDate, true)}` : ''}`);
  }
  if(dateKey && startDate){
    variants.push(`${dateKey} ge ${isoBound(startDate, false)}${endDate ? ` and ${dateKey} le ${isoBound(endDate, true)}` : ''}`);
  }
  if(storeKey && store) variants.push(`${storeKey} eq ${odataQuote(store)}`);
  if(companyKey && company) variants.push(`${companyKey} eq ${odataQuote(company)}`);
  variants.push('');
  return [...new Set(variants)];
}

async function readJson(res){
  const text = typeof res.text === 'function' ? await res.text() : String(res.body || '');
  let json = null;
  try{ json = text ? JSON.parse(text) : null; }catch{ json = null; }
  return { status: res.status, ok: res.ok, json, text };
}

async function odataGet(url, token, fetchImpl, timeoutMs){
  const fetchFn = fetchImpl || fetch;
  const ac = typeof AbortController === 'function' ? new AbortController() : null;
  const t = ac ? setTimeout(() => ac.abort(), timeoutMs || 45000) : null;
  try{
    const res = await fetchFn(url, { method: 'GET', headers: odataHeaders(token), signal: ac ? ac.signal : undefined });
    return await readJson(res);
  }finally{
    if(t) clearTimeout(t);
  }
}

async function listEntitySets(base, token, fetchImpl){
  const res = await odataGet(`${base}/data/`, token, fetchImpl, 20000);
  const rows = res.json && Array.isArray(res.json.value) ? res.json.value : [];
  return rows.map(r => String(r.name || r.url || '')).filter(Boolean);
}

async function collectPages(firstUrl, token, fetchImpl){
  const records = [];
  let url = firstUrl;
  for(let i = 0; i < MAX_PAGES && url; i += 1){
    const res = await odataGet(url, token, fetchImpl, 60000);
    if(!res.ok || !res.json){
      return { ok: false, status: res.status, records, error: (res.json && (res.json.error && res.json.error.message)) || `HTTP ${res.status}` };
    }
    const chunk = Array.isArray(res.json.value) ? res.json.value : (res.json.value ? [res.json.value] : []);
    for(const row of chunk){
      if(row && typeof row === 'object') records.push(row);
    }
    url = res.json['@odata.nextLink'] || '';
    if(chunk.length < PAGE_SIZE) break;
  }
  return { ok: true, records };
}

function entityUrl(base, entity, filter){
  const q = new URLSearchParams();
  q.set('cross-company', 'true');
  q.set('$top', String(PAGE_SIZE));
  if(filter) q.set('$filter', filter);
  return `${base}/data/${entity}?${q.toString()}`;
}

function looksLikeLine(rec){
  if(!rec || typeof rec !== 'object') return false;
  return Boolean(
    findKey(rec, ['ItemId', 'ItemNumber', 'ItemCode', 'MalzemeKodu', 'ProductNumber', 'ItemName', 'MalzemeAdi'])
  );
}

function sameAtakStore(a, b){
  const A = String(a || '').trim();
  const B = String(b || '').trim();
  if(!A || !B || A === B) return true;
  return (A === '340334' || A === '340344') && (B === '340334' || B === '340344');
}

function filterSales(sales, { store, startDate, endDate }){
  const magaza = String(store || '').trim();
  const from = String(startDate || '').slice(0, 10);
  const to = String(endDate || '').slice(0, 10);
  return (sales || []).filter(s => {
    const st = String(s.store || '').trim();
    if(magaza && st && st !== magaza && !sameAtakStore(st, magaza)) return false;
    const d = String(s.orderDate || s.invoiceDate || '').slice(0, 10);
    if(from && d && d < from) return false;
    if(to && d && d > to) return false;
    return true;
  });
}

async function queryEntity(base, token, entity, range, fetchImpl){
  const probe = await odataGet(entityUrl(base, entity, '').replace(`$top=${PAGE_SIZE}`, '$top=1'), token, fetchImpl, 20000);
  if(!probe.ok){
    return {
      ok: false,
      status: probe.status,
      entity,
      records: [],
      error: (probe.json && probe.json.error && probe.json.error.message) || `HTTP ${probe.status}`,
      auth: probe.status === 401 || probe.status === 403
    };
  }
  const sample = probe.json && Array.isArray(probe.json.value) && probe.json.value[0]
    ? probe.json.value[0]
    : (probe.json && probe.json.value) || {};
  const filters = buildFilters(sample && typeof sample === 'object' ? sample : {}, range);
  let lastErr = '';
  for(const filter of filters){
    const got = await collectPages(entityUrl(base, entity, filter), token, fetchImpl);
    if(got.ok && got.records.length){
      return { ok: true, entity, records: got.records, filter };
    }
    lastErr = got.error || lastErr;
    if(got.status === 401 || got.status === 403){
      return { ok: false, status: got.status, entity, records: [], error: got.error, auth: true };
    }
  }
  return { ok: false, status: 200, entity, records: [], error: lastErr || 'kayıt yok' };
}

async function fetchWithToken(opts = {}){
  const token = String(opts.token || '').trim();
  if(!token) return { ok: false, needsOkta: true, error: 'Okta Verify gerekli.' };
  const base = d365Auth.normalizeDynamicsUrl(opts.dynamicsUrl);
  if(d365Auth.isMuleUrl(base)){
    return { ok: false, error: 'Rapid360 Dynamics adresi mule geteinvoices olamaz.' };
  }
  const range = {
    company: String(opts.company || DEFAULT_COMPANY).trim() || DEFAULT_COMPANY,
    store: String(opts.store || DEFAULT_STORE).trim() || DEFAULT_STORE,
    startDate: opts.startDate,
    endDate: opts.endDate
  };
  const tried = [];
  const names = [];
  const preferred = String(opts.odataEntity || '').trim();
  if(preferred) names.push(preferred);
  for(const n of PREFERRED_ENTITIES){
    if(!names.includes(n)) names.push(n);
  }
  try{
    const listed = await listEntitySets(base, token, opts.fetchImpl);
    const ranked = listed
      .map(n => ({ n, s: scoreEntityName(n) }))
      .filter(x => x.s > 0)
      .sort((a, b) => b.s - a.s);
    for(const x of ranked){
      if(!names.includes(x.n)) names.push(x.n);
    }
  }catch(_){
    tried.push({ url: `${base}/data/`, error: 'entity listesi yok' });
  }

  let authFail = false;
  for(const entity of names.slice(0, 24)){
    try{
      const got = await queryEntity(base, token, entity, range, opts.fetchImpl);
      tried.push({ entity, status: got.status || (got.ok ? 200 : 0), count: (got.records || []).length });
      if(got.auth){
        authFail = true;
        break;
      }
      if(!got.ok || !got.records || !got.records.length) continue;
      const parsed = salesXml.extractSalesFromJson({ value: got.records });
      let sales = parsed.sales || [];
      if(!sales.length && looksLikeLine(got.records[0])){
        // OData alan adları KEY listesinde yoksa yine de kalemleri bas
        const patched = got.records.map(r => {
          const rec = { ...r };
          if(!rec.SalesId && rec.SalesOrderNumber) rec.SalesId = rec.SalesOrderNumber;
          if(!rec.ItemId && rec.ItemNumber) rec.ItemId = rec.ItemNumber;
          return rec;
        });
        const again = salesXml.extractSalesFromJson({ value: patched });
        sales = again.sales || [];
        Object.assign(parsed, again);
      }
      sales = filterSales(sales, range);
      if(sales.length){
        return {
          ok: true,
          parsed: {
            sales,
            cancelledCount: parsed.cancelledCount || 0,
            recordCount: got.records.length,
            format: 'd365-odata',
            fetched: true,
            source: `${base}/data/${entity}`
          },
          sourceUrl: `${base}/data/${entity}`,
          store: range.store,
          company: range.company,
          tried,
          entity
        };
      }
    }catch(e){
      const msg = /abort/i.test(String(e && e.name)) ? 'zaman aşımı' : (e.message || 'hata');
      tried.push({ entity, error: msg });
    }
  }

  if(authFail){
    return { ok: false, needsOkta: true, error: 'Rapid360 oturumu düştü. Okta Verify’ı tekrar onaylayın.', tried };
  }
  return {
    ok: false,
    error: `Okta bağlandı ama Rapid360 satış kalemleri okunamadı (mağaza ${range.store} / ${range.company}). Detaylı satış ekranında yetkiniz olsun; Client secret gerekmez.`,
    tried
  };
}

module.exports = {
  DEFAULT_STORE,
  DEFAULT_COMPANY,
  PREFERRED_ENTITIES,
  scoreEntityName,
  buildFilters,
  filterSales,
  fetchWithToken
};
