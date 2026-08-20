'use strict';

const rapid360 = require('./rapid360-einvoice');
const salesXml = require('./rapid360-sales-xml');
const d365Auth = require('./rapid360-d365-auth');
const d365Sales = require('./rapid360-d365-sales');

const DEFAULT_STORE = '340334';
const DEFAULT_DEALER = '340344';
const DEFAULT_COMPANY = '2521';
const ATAK_STORES = new Set(['340334', '340344']);

const SALES_PATHS = [
  'getdetailedsales',
  'getsales',
  'getdetailedsalesreport',
  'getdmrdetailedsalesreport',
  'getsaledetails',
  'getsalesinfo',
  'dmrdetailedsales',
  'getdmrsales',
  'getsatissorgula'
];

function stripQuery(url){
  return String(url || '').trim().split('?')[0].replace(/\/+$/, '');
}

function dmsBase(invoiceUrl){
  const u = stripQuery(invoiceUrl);
  return u.replace(/\/geteinvoices$/i, '');
}

function candidateUrls(consume = {}, overrideUrl){
  const out = [];
  const custom = stripQuery(overrideUrl || consume.salesUrl);
  if(custom) out.push(custom);
  const base = dmsBase(consume.url);
  if(base && !/\/geteinvoices$/i.test(custom)){
    for(const path of SALES_PATHS){
      const url = `${base}/${path}`;
      if(!out.includes(url)) out.push(url);
    }
  }
  return out;
}

function publicUrl(url){
  try{
    const u = new URL(url);
    u.searchParams.delete('client_secret');
    u.searchParams.delete('clientSecret');
    return u.toString();
  }catch{
    return String(url || '').replace(/client_secret=[^&]*/ig, 'client_secret=');
  }
}

function atakDealerId(raw){
  const d = String(raw || '').trim();
  if(!d || d === rapid360.CHAIRMAN_DEALER_ID) return DEFAULT_DEALER;
  return d;
}

function sameAtakStore(a, b){
  const A = String(a || '').trim();
  const B = String(b || '').trim();
  if(!A || !B || A === B) return true;
  return ATAK_STORES.has(A) && ATAK_STORES.has(B);
}

function keepSaleStore(sale, magaza){
  const st = String(sale && sale.store || '').trim();
  if(!st || !magaza) return true;
  if(st === String(magaza).trim()) return true;
  return sameAtakStore(st, magaza);
}

function filterParsedByStore(parsed, magaza){
  const sales = ((parsed && parsed.sales) || []).filter((s) => keepSaleStore(s, magaza));
  return Object.assign({}, parsed || {}, { sales });
}

function resolveSalesConsume(rawCfg, env = process.env){
  const raw = rawCfg && typeof rawCfg === 'object' ? rawCfg : {};
  const consume = rapid360.resolveConsumeConfig(raw, env);
  const dealerId = atakDealerId(consume.dealerId || raw.dealerId);
  return {
    url: String(consume.url || env.ARCELIK_MULE_URL || '').trim().split('?')[0],
    clientId: String(consume.clientId || env.ARCELIK_MULE_CLIENT_ID || '').trim(),
    clientSecret: String(consume.clientSecret || env.ARCELIK_MULE_CLIENT_SECRET || '').trim(),
    dealerId,
    eInvoiceCode: String(consume.eInvoiceCode || env.ARCELIK_EINVOICE_CODE || '').trim(),
    systemId: String(consume.systemId || env.ARCELIK_SYSTEM_ID || '1').trim() || '1',
    salesUrl: String(raw.salesUrl || env.ARCELIK_SALES_URL || '').trim(),
    salesStore: String(raw.salesStore || env.ARCELIK_STORE_ID || DEFAULT_STORE).trim() || DEFAULT_STORE,
    salesCompany: String(raw.salesCompany || env.ARCELIK_COMPANY || DEFAULT_COMPANY).trim() || DEFAULT_COMPANY
  };
}

function consumeReady(consume){
  return Boolean(consume && consume.url && consume.clientId && consume.clientSecret);
}

function baseSalesQuery(consume, { startDate, endDate, dealerId } = {}){
  const q = new URLSearchParams();
  if(consume.clientId) q.set('client_id', consume.clientId);
  if(consume.clientSecret) q.set('client_secret', consume.clientSecret);
  q.set('StartDate', rapid360.formatDateTime(startDate, false));
  q.set('EndDate', rapid360.formatDateTime(endDate, true));
  const dealer = atakDealerId(dealerId || consume.dealerId);
  if(dealer) q.set('DealerID', dealer);
  if(consume.eInvoiceCode) q.set('EInvoiceCode', consume.eInvoiceCode);
  q.set('SystemId', consume.systemId || '1');
  return q;
}

function cloneQuery(q){
  return new URLSearchParams(String(q));
}

function salesQueryVariants(consume, { startDate, endDate, store, company } = {}){
  const magaza = String(store || consume.salesStore || DEFAULT_STORE).trim() || DEFAULT_STORE;
  const cmp = String(company || consume.salesCompany || DEFAULT_COMPANY).trim() || DEFAULT_COMPANY;
  const dealers = [];
  const primary = atakDealerId(consume.dealerId);
  for(const id of [primary, DEFAULT_DEALER, magaza]){
    if(id && !dealers.includes(id)) dealers.push(id);
  }
  const out = [];
  const seen = new Set();
  const push = (q) => {
    const s = q.toString();
    if(seen.has(s)) return;
    seen.add(s);
    out.push(s);
  };
  for(const dealerId of dealers){
    const base = baseSalesQuery(consume, { startDate, endDate, dealerId });
    push(base);
    const withStore = cloneQuery(base);
    withStore.set('Magaza', magaza);
    withStore.set('InventLocationId', magaza);
    withStore.set('Store', magaza);
    withStore.set('Company', cmp);
    withStore.set('dataAreaId', cmp);
    withStore.set('cmp', cmp);
    withStore.set('ReportName', 'DmrDetailedSalesReport');
    push(withStore);
    const withSube = cloneQuery(base);
    withSube.set('Magaza', magaza);
    withSube.set('SubeKodu', DEFAULT_DEALER);
    withSube.set('BayiKodu', 'ATAKHOME');
    push(withSube);
  }
  return out;
}

function buildSalesQuery(consume, range = {}){
  return salesQueryVariants(consume, range)[0] || '';
}

function parseSalesPayload(body, contentType){
  const type = String(contentType || '').toLowerCase();
  const text = Buffer.isBuffer(body) ? salesXml.decodeBuffer(body) : String(body || '');
  if(!text.trim()) return { sales: [], cancelledCount: 0, recordCount: 0, format: 'empty' };
  if(/json/.test(type) || /^\s*[\{\[]/.test(text)){
    try{
      return salesXml.extractSalesFromJson(JSON.parse(text));
    }catch{
      return salesXml.extractSales(text);
    }
  }
  return salesXml.extractSales(text);
}

function headerGet(headers, name){
  if(!headers) return '';
  if(typeof headers.get === 'function') return headers.get(name) || '';
  const key = String(name || '').toLowerCase();
  for(const [k, v] of Object.entries(headers)){
    if(String(k).toLowerCase() === key) return v || '';
  }
  return '';
}

async function readResBody(res){
  if(res && typeof res.arrayBuffer === 'function'){
    try{
      return Buffer.from(await res.arrayBuffer());
    }catch(_){}
  }
  if(res && typeof res.buffer === 'function'){
    try{
      return Buffer.from(await res.buffer());
    }catch(_){}
  }
  if(res && typeof res.text === 'function'){
    return Buffer.from(await res.text());
  }
  if(res && res.body != null) return Buffer.from(String(res.body));
  return Buffer.alloc(0);
}

async function fetchOne(url, { fetchImpl, timeoutMs }){
  const fetchFn = fetchImpl || fetch;
  const ac = typeof AbortController === 'function' ? new AbortController() : null;
  const t = ac ? setTimeout(() => ac.abort(), timeoutMs) : null;
  try{
    const res = await fetchFn(url, {
      method: 'GET',
      headers: { Accept: 'application/xml, application/json, text/xml, text/plain;q=0.8' },
      signal: ac ? ac.signal : undefined
    });
    const buf = await readResBody(res);
    const contentType = headerGet(res.headers, 'content-type') || res.contentType || '';
    return { status: res.status, ok: res.ok, buf, contentType };
  }finally{
    if(t) clearTimeout(t);
  }
}

function consumeFromStore(store){
  if(store && store.invoiceIntegration && store.invoiceIntegration.rapid360){
    return store.invoiceIntegration.rapid360;
  }
  return store && store.rapid360 ? store.rapid360 : store;
}

async function fetchDetailedSales(rawCfg, range = {}, { fetchImpl, timeoutMs = 45000, env } = {}){
  const consume = resolveSalesConsume(rawCfg, env || process.env);
  if(!consumeReady(consume) && !consume.salesUrl){
    throw new Error('Rapid360 satış XML’i çekilemedi. Faturalar → Kurulum’da Atak Rapid360 Servis URL, Client ID ve Client secret kaydedin. Dosya yüklemeniz gerekmez.');
  }
  const store = String(range.store != null && String(range.store).trim() ? range.store : consume.salesStore || DEFAULT_STORE).trim() || DEFAULT_STORE;
  const company = String(range.company || consume.salesCompany || DEFAULT_COMPANY).trim() || DEFAULT_COMPANY;
  const queries = salesQueryVariants(consume, {
    startDate: range.startDate,
    endDate: range.endDate,
    store,
    company
  });
  const urls = candidateUrls(consume, consume.salesUrl);
  if(!urls.length){
    throw new Error('Rapid360 satış adresi yok. Servis URL veya satış çekme URL yazın.');
  }
  const tried = [];
  let lastErr = '';
  let lastParsed = null;
  for(const base of urls){
    let pathMissing = false;
    for(const query of queries){
      const url = `${base}?${query}`;
      const shown = publicUrl(url);
      try{
        const res = await fetchOne(url, { fetchImpl, timeoutMs });
        tried.push({ url: shown, status: res.status });
        if(res.status === 404 || res.status === 405){
          lastErr = `HTTP ${res.status}`;
          pathMissing = true;
          break;
        }
        if(!res.ok){
          lastErr = `HTTP ${res.status}`;
          continue;
        }
        const parsed = filterParsedByStore(parseSalesPayload(res.buf, res.contentType), store);
        lastParsed = parsed;
        if(parsed.sales && parsed.sales.length){
          return {
            ok: true,
            parsed: Object.assign(parsed, { fetched: true, source: shown }),
            sourceUrl: shown,
            store,
            company,
            tried
          };
        }
        lastErr = parsed.cancelledCount
          ? `${parsed.cancelledCount} satış İPTAL, aktarılacak yok`
          : 'yanıtta satış yok';
      }catch(e){
        lastErr = /abort/i.test(String(e && e.name)) ? 'zaman aşımı' : (e.message || 'bağlantı hatası');
        tried.push({ url: shown, status: 0, error: lastErr });
      }
    }
    if(pathMissing) continue;
  }
  const err = new Error(`Rapid360 satış XML’i alınamadı (${lastErr}). Mağaza ${store} ATAK / bayi ${consume.dealerId} / şirket ${company}.`);
  err.tried = tried;
  err.parsed = lastParsed;
  throw err;
}

async function fetchViaOkta(raw, range, opts = {}){
  const ensured = await d365Auth.ensureAccessToken(raw, { fetchImpl: opts.fetchImpl, env: opts.env });
  if(!ensured.ok){
    return { ok: false, needsOkta: true, error: 'Rapid360 için Okta Verify gerekli.', tokens: null, cfg: ensured.cfg };
  }
  const cfg = ensured.cfg;
  const dynamicsUrl = d365Auth.isMuleUrl(cfg.dynamicsUrl) ? d365Auth.DEFAULT_DYNAMICS_URL : cfg.dynamicsUrl;
  const out = await d365Sales.fetchWithToken({
    token: ensured.token,
    dynamicsUrl,
    odataEntity: cfg.odataEntity,
    company: range.company,
    store: range.store,
    startDate: range.startDate,
    endDate: range.endDate,
    fetchImpl: opts.fetchImpl
  });
  if(out.needsOkta){
    return { ok: false, needsOkta: true, error: out.error || 'Okta Verify gerekli.', tried: out.tried || [], tokens: ensured.refreshed ? ensured.tokens : null };
  }
  if(out.ok && out.parsed){
    out.parsed = filterParsedByStore(out.parsed, range.store);
    if(!(out.parsed.sales && out.parsed.sales.length)){
      return { ok: false, error: out.error || 'Okta bağlandı ama bu mağaza/tarihte satış yok.', tried: out.tried || [], tokens: ensured.refreshed ? ensured.tokens : null };
    }
  }
  return Object.assign({ tokens: ensured.refreshed ? ensured.tokens : null }, out);
}

async function fetchRapid360Sales(opts = {}){
  const raw = consumeFromStore(opts.store) || opts.consume || opts.cfg || {};
  const consume = resolveSalesConsume(raw, opts.env || process.env);
  const range = {
    startDate: opts.startDate,
    endDate: opts.endDate,
    store: String(opts.salesStore != null ? opts.salesStore : (opts.magaza != null ? opts.magaza : opts.storeId) || DEFAULT_STORE).trim() || DEFAULT_STORE,
    company: opts.company || consume.salesCompany || DEFAULT_COMPANY
  };
  try{
    const cfg = d365Auth.configFromRapid(raw, opts.env || process.env);
    const oktaReady = d365Auth.tokenFresh(cfg) || Boolean(cfg.accessToken && cfg.refreshToken);
    let muleErr = '';
    let muleTried = [];
    let muleParsed = null;
    const muleReady = Boolean(consume.salesUrl) || (consumeReady(consume) && !oktaReady);

    async function tryMule(){
      if(!(consumeReady(consume) || Boolean(consume.salesUrl))) return null;
      try{
        const out = await fetchDetailedSales(raw, range, { fetchImpl: opts.fetchImpl, timeoutMs: opts.timeoutMs, env: opts.env || process.env });
        if(out && out.parsed && out.parsed.sales && out.parsed.sales.length){
          return {
            ok: true,
            parsed: out.parsed,
            sourceUrl: out.sourceUrl || '',
            store: out.store || range.store,
            company: out.company || range.company,
            tried: out.tried || [],
            via: 'mule',
            tokens: null
          };
        }
      }catch(e){
        muleErr = e.message || 'çekilemedi';
        muleTried = e.tried || [];
        muleParsed = e.parsed || null;
      }
      return null;
    }

    if(oktaReady){
      const okta = await fetchViaOkta(raw, range, opts);
      if(okta.ok){
        return {
          ok: true,
          parsed: okta.parsed,
          sourceUrl: okta.sourceUrl || '',
          store: okta.store || range.store,
          company: okta.company || range.company,
          tried: okta.tried || [],
          via: 'okta',
          tokens: okta.tokens || null
        };
      }
      const mule = await tryMule();
      if(mule) return mule;
      if(okta.needsOkta && !muleErr){
        return { ok: false, needsOkta: true, error: 'Önce Rapid360’ı açın (Okta). Satış için Rapid’te XML indirip Atak’a seçin. Mağaza 340334 ATAK.', tried: okta.tried || [], tokens: okta.tokens || null };
      }
      return {
        ok: false,
        error: okta.error || muleErr || 'Satışlar okunamadı',
        tried: (okta.tried || []).concat(muleTried),
        parsed: muleParsed,
        store: range.store,
        company: range.company,
        tokens: okta.tokens || null
      };
    }

    if(muleReady){
      const mule = await tryMule();
      if(mule) return mule;
    }
    const okta = await fetchViaOkta(raw, range, opts);
    if(okta.ok){
      return {
        ok: true,
        parsed: okta.parsed,
        sourceUrl: okta.sourceUrl || '',
        store: okta.store || range.store,
        company: okta.company || range.company,
        tried: (muleTried || []).concat(okta.tried || []),
        via: 'okta',
        tokens: okta.tokens || null
      };
    }
    if(okta.needsOkta){
      return { ok: false, needsOkta: true, error: 'Önce Rapid360’ı açın (Okta). Satış için Rapid’te XML indirip Atak’a seçin. Mağaza 340334 ATAK.', tried: (muleTried || []).concat(okta.tried || []), tokens: okta.tokens || null };
    }
    return { ok: false, error: okta.error || muleErr || 'çekilemedi', tried: (muleTried || []).concat(okta.tried || []), parsed: muleParsed, tokens: okta.tokens || null };
  }catch(e){
    return { ok: false, error: e.message || 'çekilemedi', tried: e.tried || [] };
  }
}

module.exports = {
  DEFAULT_STORE,
  DEFAULT_DEALER,
  DEFAULT_COMPANY,
  ATAK_STORES,
  SALES_PATHS,
  candidateUrls,
  publicUrl,
  buildSalesQuery,
  salesQueryVariants,
  resolveSalesConsume,
  parseSalesPayload,
  keepSaleStore,
  fetchDetailedSales,
  fetchViaOkta,
  fetchRapid360Sales
};
