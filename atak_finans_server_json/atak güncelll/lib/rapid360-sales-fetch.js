'use strict';

const rapid360 = require('./rapid360-einvoice');
const salesXml = require('./rapid360-sales-xml');
const d365Auth = require('./rapid360-d365-auth');
const d365Sales = require('./rapid360-d365-sales');

const DEFAULT_STORE = '340334';
const DEFAULT_COMPANY = '2521';

const SALES_PATHS = [
  'getdetailedsales',
  'getdetailedsalesreport',
  'getdmrdetailedsalesreport',
  'getsales',
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

function buildSalesQuery(consume, { startDate, endDate, store, company } = {}){
  const q = new URLSearchParams();
  if(consume.clientId) q.set('client_id', consume.clientId);
  if(consume.clientSecret) q.set('client_secret', consume.clientSecret);
  q.set('StartDate', rapid360.formatDateTime(startDate, false));
  q.set('EndDate', rapid360.formatDateTime(endDate, true));
  if(consume.dealerId) q.set('DealerID', consume.dealerId);
  if(consume.eInvoiceCode) q.set('EInvoiceCode', consume.eInvoiceCode);
  q.set('SystemId', consume.systemId || '1');
  const magaza = String(store == null ? (consume.salesStore || DEFAULT_STORE) : store).trim() || DEFAULT_STORE;
  if(magaza){
    q.set('Magaza', magaza);
    q.set('InventLocationId', magaza);
    q.set('Store', magaza);
    q.set('Sirket', magaza);
  }
  const cmp = String(company || consume.salesCompany || DEFAULT_COMPANY).trim() || DEFAULT_COMPANY;
  if(cmp){
    q.set('Company', cmp);
    q.set('dataAreaId', cmp);
    q.set('cmp', cmp);
  }
  q.set('ReportName', 'DmrDetailedSalesReport');
  return q.toString();
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

function consumeReady(consume){
  return Boolean(consume && consume.url && consume.clientId && consume.clientSecret);
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

async function fetchDetailedSales(rawCfg, range = {}, { fetchImpl, timeoutMs = 90000 } = {}){
  if(rapid360.isChairmanMuleConsume(rawCfg, process.env) || String(rawCfg && rawCfg.dealerId || '') === rapid360.CHAIRMAN_DEALER_ID){
    throw new Error('Başkanın Arçelik Rapid360 hesabı ile satış çekilmez. Atak bayi hesabını yazın (DealerID 21134761 kabul edilmez).');
  }
  const consume = Object.assign({}, rapid360.resolveConsumeConfig(rawCfg), {
    salesUrl: String(rawCfg && rawCfg.salesUrl || process.env.ARCELIK_SALES_URL || '').trim(),
    salesStore: String(rawCfg && rawCfg.salesStore || process.env.ARCELIK_STORE_ID || DEFAULT_STORE).trim() || DEFAULT_STORE,
    salesCompany: String(rawCfg && rawCfg.salesCompany || process.env.ARCELIK_COMPANY || DEFAULT_COMPANY).trim() || DEFAULT_COMPANY
  });
  if(!consumeReady(consume) && !consume.salesUrl){
    throw new Error('Rapid360 satış XML’i çekilemedi. Faturalar → Kurulum’da Atak Rapid360 Servis URL, Client ID ve Client secret kaydedin. Dosya yüklemeniz gerekmez.');
  }
  const store = String(range.store != null && String(range.store).trim() ? range.store : consume.salesStore || DEFAULT_STORE).trim() || DEFAULT_STORE;
  const company = String(range.company || consume.salesCompany || DEFAULT_COMPANY).trim() || DEFAULT_COMPANY;
  const query = buildSalesQuery(consume, {
    startDate: range.startDate,
    endDate: range.endDate,
    store,
    company
  });
  const urls = candidateUrls(consume, consume.salesUrl).map(u => `${u}?${query}`);
  if(!urls.length){
    throw new Error('Rapid360 satış adresi yok. Servis URL veya satış çekme URL yazın.');
  }
  const tried = [];
  let lastErr = '';
  for(const url of urls){
    const shown = publicUrl(url);
    try{
      const res = await fetchOne(url, { fetchImpl, timeoutMs });
      tried.push({ url: shown, status: res.status });
      if(!res.ok){
        lastErr = `HTTP ${res.status}`;
        continue;
      }
      const parsed = parseSalesPayload(res.buf, res.contentType);
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
  const err = new Error(`Rapid360 satış XML’i alınamadı (${lastErr}). Mağaza ${store || DEFAULT_STORE} / ${company}.`);
  err.tried = tried;
  throw err;
}

async function fetchViaOkta(raw, range, opts = {}){
  const ensured = await d365Auth.ensureAccessToken(raw, { fetchImpl: opts.fetchImpl, env: opts.env });
  if(!ensured.ok){
    return { ok: false, needsOkta: true, error: 'Rapid360 için Okta Verify gerekli.', tokens: null, cfg: ensured.cfg };
  }
  const cfg = ensured.cfg;
  const out = await d365Sales.fetchWithToken({
    token: ensured.token,
    dynamicsUrl: cfg.dynamicsUrl,
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
  return Object.assign({ tokens: ensured.refreshed ? ensured.tokens : null }, out);
}

async function fetchRapid360Sales(opts = {}){
  const raw = consumeFromStore(opts.store) || opts.consume || opts.cfg || {};
  const range = {
    startDate: opts.startDate,
    endDate: opts.endDate,
    store: String(opts.salesStore != null ? opts.salesStore : (opts.magaza != null ? opts.magaza : opts.storeId) || DEFAULT_STORE).trim() || DEFAULT_STORE,
    company: opts.company
  };
  try{
    if(rapid360.isChairmanMuleConsume(raw, opts.env || process.env) || String(raw && raw.dealerId || '') === rapid360.CHAIRMAN_DEALER_ID){
      throw new Error('Başkanın Arçelik Rapid360 hesabı ile satış çekilmez. Atak bayi hesabını yazın (DealerID 21134761 kabul edilmez).');
    }
    const consume = Object.assign({}, rapid360.resolveConsumeConfig(raw), {
      salesUrl: String(raw && raw.salesUrl || '').trim()
    });
    const muleReady = consumeReady(consume) || Boolean(consume.salesUrl);
    if(muleReady){
      try{
        const out = await fetchDetailedSales(raw, range, { fetchImpl: opts.fetchImpl, timeoutMs: opts.timeoutMs });
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
        if(/21134761/.test(String(e && e.message))) throw e;
      }
    }
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
    if(okta.needsOkta){
      return { ok: false, needsOkta: true, error: 'Önce Okta bağla, sonra Satışları oku. Mağaza 340334 ATAK Atak’ta uygulanır.', tried: okta.tried || [], tokens: okta.tokens || null };
    }
    return { ok: false, error: okta.error || 'çekilemedi', tried: okta.tried || [], tokens: okta.tokens || null };
  }catch(e){
    if(/21134761/.test(String(e && e.message))) throw e;
    return { ok: false, error: e.message || 'çekilemedi', tried: e.tried || [] };
  }
}

module.exports = {
  DEFAULT_STORE,
  DEFAULT_COMPANY,
  SALES_PATHS,
  candidateUrls,
  publicUrl,
  buildSalesQuery,
  parseSalesPayload,
  fetchDetailedSales,
  fetchViaOkta,
  fetchRapid360Sales
};
