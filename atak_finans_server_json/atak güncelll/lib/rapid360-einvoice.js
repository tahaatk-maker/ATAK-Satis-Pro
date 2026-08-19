'use strict';

/** Rapid360 / Arçelik Mule geteinvoices — bayi e-fatura listesi (GET, query string). */

const DEFAULTS = {
  url: 'https://arc-p-ms-op.arcelik.com/exp/dms/dms/geteinvoices',
  clientId: '842fb1bc7caf495bb8cdda9e12039adb',
  clientSecret: '3f0774B1c94E4750Bf07a059EEea48d6',
  dealerId: '21134761',
  eInvoiceCode: '2E1N1D3E4',
  systemId: '1',
  addReturns: true
};

/** Başkanın Arçelik bayi hesabı — Atak gelen kutusuna çekilmez. */
const CHAIRMAN_DEALER_ID = '21134761';
const FOREIGN_INVOICE_PREFIX = /^(BEA|GEA|BKO|BEX|ARC)/i;

function emptyConsumeConfig(){
  return {
    url: '',
    clientId: '',
    clientSecret: '',
    dealerId: '',
    eInvoiceCode: '',
    systemId: '1',
    addReturns: true
  };
}

function resolveConsumeConfig(raw = {}, env = process.env){
  const r = raw && typeof raw === 'object' ? raw : {};
  const e = env || {};
  const secret = String(r.clientSecret || e.ARCELIK_MULE_CLIENT_SECRET || '').trim();
  return {
    url: String(r.url || e.ARCELIK_MULE_URL || '').trim().split('?')[0],
    clientId: String(r.clientId || e.ARCELIK_MULE_CLIENT_ID || '').trim(),
    clientSecret: secret,
    dealerId: String(r.dealerId || e.ARCELIK_DEALER_ID || '').trim(),
    eInvoiceCode: String(r.eInvoiceCode || e.ARCELIK_EINVOICE_CODE || '').trim(),
    systemId: String(r.systemId || e.ARCELIK_SYSTEM_ID || '').trim() || '1',
    addReturns: r.addReturns !== false && String(r.addReturns) !== 'false'
  };
}

function isChairmanMuleConsume(cfg, env){
  const r = cfg && typeof cfg === 'object' ? cfg : {};
  if(String(r.dealerId || '').trim() === CHAIRMAN_DEALER_ID) return true;
  if(env && typeof env === 'object' && String(env.ARCELIK_DEALER_ID || '').trim() === CHAIRMAN_DEALER_ID) return true;
  return false;
}

function sanitizeConsumeConfig(raw = {}, env){
  const r = raw && typeof raw === 'object' ? { ...raw } : {};
  if(isChairmanMuleConsume(r, env)){
    return {
      ...emptyConsumeConfig(),
      lastSyncAt: r.lastSyncAt || '',
      lastCount: 0,
      lastError: 'Başkanın Arçelik Rapid360 hesabı (DealerID 21134761) Atak gelen kutusuna çekilmez.'
    };
  }
  return r;
}

function invoiceNumberOf(row){
  if(!row || typeof row !== 'object') return '';
  const raw = row.rapidRaw && typeof row.rapidRaw === 'object' ? row.rapidRaw : {};
  return String(row.invoiceNumber || row.FaturaNo || row.faturaNo || raw.FaturaNo || raw.InvoiceNumber || '').trim();
}

function isForeignInboxRow(row){
  if(!row || typeof row !== 'object') return false;
  const no = invoiceNumberOf(row);
  if(FOREIGN_INVOICE_PREFIX.test(no)) return true;
  const raw = row.rapidRaw && typeof row.rapidRaw === 'object' ? row.rapidRaw : {};
  const dealer = String(
    row.BayiKodu || row.bayiKodu || row.dealerId || row.DealerID
    || raw.BayiKodu || raw.DealerID || raw.DealerId || ''
  ).trim();
  if(dealer === CHAIRMAN_DEALER_ID) return true;
  return false;
}

function purgeForeignInbox(store, { dropAllRapid360 } = {}){
  if(!store || typeof store !== 'object') return { before: 0, after: 0, removed: 0 };
  const list = Array.isArray(store.invoiceInbox) ? store.invoiceInbox : [];
  const before = list.length;
  store.invoiceInbox = list.filter(row => {
    if(dropAllRapid360 && String(row && row.source || '').toLowerCase() === 'rapid360') return false;
    return !isForeignInboxRow(row);
  });
  return { before, after: store.invoiceInbox.length, removed: before - store.invoiceInbox.length };
}

function pad2(n){ return String(n).padStart(2, '0'); }

/** Örnek: 2023-03-27T00:00:00 */
function formatDateTime(v, endOfDay){
  if(v instanceof Date && Number.isFinite(v.getTime())){
    const y = v.getFullYear();
    const m = pad2(v.getMonth() + 1);
    const d = pad2(v.getDate());
    return `${y}-${m}-${d}T${endOfDay ? '23:59:59' : '00:00:00'}`;
  }
  const s = String(v || '').trim();
  if(/^\d{4}-\d{2}-\d{2}T/.test(s)) return s.slice(0, 19);
  if(/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T${endOfDay ? '23:59:59' : '00:00:00'}`;
  const dt = new Date(s);
  if(Number.isFinite(dt.getTime())) return formatDateTime(dt, endOfDay);
  const now = new Date();
  return formatDateTime(now, endOfDay);
}

function pick(obj, names){
  if(!obj || typeof obj !== 'object') return '';
  for(const n of names){
    if(obj[n] != null && obj[n] !== '') return obj[n];
  }
  const lower = new Map(Object.keys(obj).map(k => [k.toLowerCase(), obj[k]]));
  for(const n of names){
    const hit = lower.get(String(n).toLowerCase());
    if(hit != null && hit !== '') return hit;
  }
  return '';
}

function asNumber(v){
  if(typeof v === 'number' && Number.isFinite(v)) return Math.round(v * 100) / 100;
  let s = String(v || '').trim().replace(/\s/g, '');
  if(!s) return 0;
  if(s.includes(',') && s.includes('.')){
    if(s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  }else if(s.includes(',')) s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function resolveConfig(raw = {}, env = process.env){
  const r = raw && typeof raw === 'object' ? raw : {};
  const e = env || {};
  const secret = String(r.clientSecret || e.ARCELIK_MULE_CLIENT_SECRET || DEFAULTS.clientSecret || '').trim();
  return {
    url: String(r.url || e.ARCELIK_MULE_URL || DEFAULTS.url).trim().split('?')[0],
    clientId: String(r.clientId || e.ARCELIK_MULE_CLIENT_ID || DEFAULTS.clientId).trim(),
    clientSecret: secret,
    dealerId: String(r.dealerId || e.ARCELIK_DEALER_ID || DEFAULTS.dealerId).trim(),
    eInvoiceCode: String(r.eInvoiceCode || e.ARCELIK_EINVOICE_CODE || DEFAULTS.eInvoiceCode).trim(),
    systemId: String(r.systemId || e.ARCELIK_SYSTEM_ID || DEFAULTS.systemId).trim() || '1',
    addReturns: r.addReturns !== false && String(r.addReturns) !== 'false'
  };
}

function buildQuery(cfg, { startDate, endDate } = {}){
  const c = resolveConfig(cfg);
  const q = new URLSearchParams();
  q.set('client_id', c.clientId);
  q.set('client_secret', c.clientSecret);
  q.set('StartDate', formatDateTime(startDate, false));
  q.set('EndDate', formatDateTime(endDate, true));
  q.set('DealerID', c.dealerId);
  q.set('EInvoiceCode', c.eInvoiceCode);
  q.set('SystemId', c.systemId);
  q.set('addReturns', c.addReturns ? 'true' : 'false');
  return q.toString();
}

function buildUrl(cfg, range){
  const c = resolveConfig(cfg);
  return `${c.url}?${buildQuery(c, range)}`;
}

function collectArrays(node, out, depth){
  if(depth > 6 || node == null) return;
  if(Array.isArray(node)){
    if(node.length) out.push(node);
    for(const x of node.slice(0, 20)) collectArrays(x, out, depth + 1);
    return;
  }
  if(typeof node !== 'object') return;
  for(const v of Object.values(node)) collectArrays(v, out, depth + 1);
}

function looksLikeInvoice(x){
  if(!x || typeof x !== 'object' || Array.isArray(x)) return false;
  const keys = Object.keys(x).join(' ').toLowerCase();
  return /invoice|fatura|ettn|uuid|document|amount|tutar|supplier|vergi|vkn|faturano|einvoiceslines/.test(keys);
}

function extractList(payload){
  if(payload == null) return [];
  if(Array.isArray(payload)) return payload.filter(looksLikeInvoice);
  if(typeof payload === 'string'){
    const t = payload.trim();
    if(t.startsWith('{') || t.startsWith('[')){
      try{ return extractList(JSON.parse(t)); }catch{ return []; }
    }
    return [];
  }
  if(typeof payload !== 'object') return [];
  const preferred = [
    'EInvoices', 'eInvoices', 'Einvoices', 'invoices', 'Invoices',
    'data', 'Data', 'items', 'Items', 'result', 'Result', 'value', 'Value',
    'GetEInvoicesResult', 'getEInvoicesResult'
  ];
  for(const k of preferred){
    const v = payload[k];
    if(Array.isArray(v) && v.some(looksLikeInvoice)) return v;
    if(v && typeof v === 'object' && Array.isArray(v.invoice || v.Invoice)){
      return v.invoice || v.Invoice;
    }
  }
  const found = [];
  collectArrays(payload, found, 0);
  const best = found.find(a => a.some(looksLikeInvoice));
  return best || [];
}

function toIsoDate(raw){
  const s = String(raw || '').trim();
  const tr = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/);
  if(tr) return `${tr[3]}-${String(tr[2]).padStart(2, '0')}-${String(tr[1]).padStart(2, '0')}`;
  if(/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const dt = new Date(s);
  if(Number.isFinite(dt.getTime())){
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  }
  return '';
}

function normalizeInvoice(raw, i = 0){
  const uuid = String(pick(raw, ['UUID', 'uuid', 'Ettn', 'ETTN', 'ettn', 'DocumentUUID', 'InvoiceUUID', 'FaturaSayac'])).trim();
  const invoiceNumber = String(pick(raw, [
    'InvoiceNumber', 'invoiceNumber', 'InvoiceNo', 'invoiceNo', 'DocumentId', 'DocumentID',
    'FaturaNo', 'faturaNo', 'ResmiBelgeNo', 'ID', 'Id'
  ])).trim();
  const invoiceDate = toIsoDate(pick(raw, ['InvoiceDate', 'invoiceDate', 'IssueDate', 'issueDate', 'Date', 'FaturaTarihi']));
  const total = asNumber(pick(raw, [
    'TutarToplami', 'PayableAmount', 'payableAmount', 'GrandTotal', 'TotalAmount', 'Amount', 'amount',
    'Tutar', 'ToplamTutar', 'DocumentAmount', 'SatirTutari'
  ]));
  const customerName = String(pick(raw, [
    'FaturalanacakMusteriAdi', 'CustomerName', 'customerName', 'MusteriAdi'
  ])).trim();
  const supplierName = String(pick(raw, [
    'SupplierName', 'supplierName', 'VendorName', 'SenderName', 'PartyName',
    'SenderTitle', 'AccountingSupplierName', 'Unvan'
  ])).trim() || customerName || 'Arçelik A.Ş.';
  const supplierVkn = String(pick(raw, [
    'VergiNo', 'SupplierTaxNumber', 'supplierVkn', 'VKN', 'Vkn', 'TaxNumber', 'SenderVkn'
  ])).replace(/\D/g, '');
  const profile = String(pick(raw, ['Profile', 'ProfileID', 'InvoiceType', 'DocumentType', 'DocType', 'FaturaTipi']) || 'efatura');
  const isReturn = /true|1|iade|return/i.test(String(pick(raw, ['IsReturn', 'isReturn', 'Return', 'addReturn', 'IsCreditNote'])));
  const id = uuid || invoiceNumber || `rapid360-${i}`;
  return {
    id: `rapid360:${id}`,
    source: 'rapid360',
    uuid,
    invoiceNumber,
    invoiceDate,
    total,
    supplierName,
    supplierVkn,
    customerName,
    profile,
    docType: /arsiv|earsiv/i.test(profile) ? 'earsiv' : 'efatura',
    isReturn,
    status: 'ready',
    read: false,
    erpImported: false,
    rapidRaw: raw,
    rawKeys: Object.keys(raw || {}).slice(0, 40)
  };
}

function parseInvoices(payload){
  return extractList(payload).map((row, i) => normalizeInvoice(row, i)).filter(x => x.invoiceNumber || x.uuid);
}

function publicConfig(cfg, env){
  const c = resolveConsumeConfig(cfg, env);
  const blocked = isChairmanMuleConsume(cfg, env) || c.dealerId === CHAIRMAN_DEALER_ID;
  const shown = blocked ? resolveConsumeConfig(emptyConsumeConfig(), {}) : c;
  const r = cfg && typeof cfg === 'object' ? cfg : {};
  return {
    url: shown.url,
    dealerId: shown.dealerId,
    eInvoiceCode: shown.eInvoiceCode,
    systemId: shown.systemId || '1',
    addReturns: shown.addReturns,
    clientId: shown.clientId,
    clientSecret: shown.clientSecret ? '********' : '',
    blocked,
    ready: !blocked && Boolean(shown.url && shown.clientId && shown.clientSecret && shown.dealerId && shown.eInvoiceCode),
    lastSyncAt: r.lastSyncAt || '',
    lastCount: Number(r.lastCount || 0) || 0,
    lastError: blocked
      ? 'Başkanın Arçelik Rapid360 hesabı Atak gelen kutusuna çekilmez.'
      : String(r.lastError || '')
  };
}

async function fetchGetEInvoices(cfg, range = {}, { fetchImpl, timeoutMs = 45000 } = {}){
  const consume = resolveConsumeConfig(cfg);
  if(isChairmanMuleConsume(cfg, process.env) || consume.dealerId === CHAIRMAN_DEALER_ID){
    throw new Error('Başkanın Arçelik Rapid360 hesabı (DealerID 21134761) Atak gelen kutusuna çekilmez.');
  }
  if(!consume.url || !consume.clientId || !consume.clientSecret || !consume.dealerId || !consume.eInvoiceCode){
    throw new Error('Atak’ın kendi Rapid360 hesabı tanımlı değil. Firmaya verilen örnek link gelen kutuya çekilmez.');
  }
  const url = buildUrl(consume, range);
  const fetchFn = fetchImpl || fetch;
  const ac = typeof AbortController === 'function' ? new AbortController() : null;
  const t = ac ? setTimeout(() => ac.abort(), timeoutMs) : null;
  let res;
  try{
    res = await fetchFn(url, {
      method: 'GET',
      headers: { Accept: 'application/json, application/xml, text/plain;q=0.8' },
      signal: ac ? ac.signal : undefined
    });
  }catch(e){
    const msg = /abort/i.test(String(e && e.name)) ? 'Rapid360 zaman aşımı' : (e.message || 'Rapid360 bağlantı hatası');
    throw new Error(msg);
  }finally{
    if(t) clearTimeout(t);
  }
  const text = await res.text();
  let json = null;
  try{ json = JSON.parse(text); }catch{ json = null; }
  if(!res.ok){
    const snippet = String(text || '').replace(/\s+/g, ' ').slice(0, 240);
    throw new Error(`Rapid360 HTTP ${res.status}${snippet ? ': ' + snippet : ''}`);
  }
  const invoices = parseInvoices(json != null ? json : text);
  return {
    ok: true,
    status: res.status,
    count: invoices.length,
    invoices,
    parsed: json != null,
    empty: invoices.length === 0,
    sampleKeys: invoices[0]?.rawKeys || (json && typeof json === 'object' ? Object.keys(json).slice(0, 20) : [])
  };
}

function mergeInbox(store, invoices){
  if(!store || typeof store !== 'object') return { added: 0, updated: 0 };
  if(!Array.isArray(store.invoiceInbox)) store.invoiceInbox = [];
  const byKey = new Map();
  for(const row of store.invoiceInbox){
    const k = String(row.uuid || row.invoiceNumber || row.id || '').toLowerCase();
    if(k) byKey.set(k, row);
  }
  let added = 0;
  let updated = 0;
  const now = new Date().toISOString();
  for(const inv of invoices || []){
    if(isForeignInboxRow(inv)) continue;
    const k = String(inv.uuid || inv.invoiceNumber || inv.id || '').toLowerCase();
    if(!k) continue;
    const prev = byKey.get(k);
    if(prev){
      Object.assign(prev, {
        invoiceNumber: inv.invoiceNumber || prev.invoiceNumber,
        invoiceDate: inv.invoiceDate || prev.invoiceDate,
        total: inv.total || prev.total,
        supplierName: inv.supplierName || prev.supplierName,
        supplierVkn: inv.supplierVkn || prev.supplierVkn,
        profile: inv.profile || prev.profile,
        docType: inv.docType || prev.docType,
        isReturn: inv.isReturn,
        source: 'rapid360',
        customerName: inv.customerName || prev.customerName,
        rapidRaw: inv.rapidRaw || prev.rapidRaw,
        updatedAt: now
      });
      updated++;
    }else{
      const row = { ...inv, createdAt: now, updatedAt: now };
      store.invoiceInbox.unshift(row);
      byKey.set(k, row);
      added++;
    }
  }
  store.invoiceInbox = store.invoiceInbox.slice(0, 4000);
  return { added, updated, total: store.invoiceInbox.length };
}

module.exports = {
  DEFAULTS,
  CHAIRMAN_DEALER_ID,
  FOREIGN_INVOICE_PREFIX,
  emptyConsumeConfig,
  resolveConsumeConfig,
  isChairmanMuleConsume,
  sanitizeConsumeConfig,
  isForeignInboxRow,
  purgeForeignInbox,
  formatDateTime,
  toIsoDate,
  asNumber,
  resolveConfig,
  buildQuery,
  buildUrl,
  extractList,
  parseInvoices,
  normalizeInvoice,
  publicConfig,
  fetchGetEInvoices,
  mergeInbox
};
