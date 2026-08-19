'use strict';

/**
 * Atak geteinvoices — Rapid360 / Arçelik DMS ile aynı GET sözleşmesi.
 * E-fatura firması bu uç noktayı çağırır; veri Atak kuyruk + gelen kutusundan gelir.
 */

const crypto = require('crypto');
const rapid360 = require('./rapid360-einvoice');

const PATH = '/exp/dms/dms/geteinvoices';
const PATH_ALIAS = '/api/dms/geteinvoices';
const PUBLIC_PATHS = [PATH, PATH_ALIAS];

const DEFAULTS = {
  dealerId: '21134761',
  eInvoiceCode: '2E1N1D3E4',
  systemId: '1',
  enabled: true,
  includeInbox: true
};

function generateClientId(){
  return crypto.randomBytes(16).toString('hex');
}

function generateClientSecret(){
  const hex = crypto.randomBytes(16).toString('hex');
  return hex.slice(0, 8) + hex.slice(8, 16).toUpperCase() + hex.slice(16);
}

function ensureConfig(raw = {}){
  const r = raw && typeof raw === 'object' ? raw : {};
  const clientId = String(r.clientId || '').trim();
  const clientSecret = String(r.clientSecret || '').trim();
  const generated = !clientId || !clientSecret;
  return {
    generated,
    cfg: {
      enabled: r.enabled !== false && String(r.enabled) !== 'false',
      includeInbox: r.includeInbox !== false && String(r.includeInbox) !== 'false',
      dealerId: String(r.dealerId || DEFAULTS.dealerId).trim() || DEFAULTS.dealerId,
      eInvoiceCode: String(r.eInvoiceCode || DEFAULTS.eInvoiceCode).trim() || DEFAULTS.eInvoiceCode,
      systemId: String(r.systemId || DEFAULTS.systemId).trim() || '1',
      clientId: clientId || generateClientId(),
      clientSecret: clientSecret || generateClientSecret(),
      rotatedAt: r.rotatedAt || (generated ? new Date().toISOString() : '')
    }
  };
}

function qpick(query, names){
  const q = query && typeof query === 'object' ? query : {};
  for(const n of names){
    if(q[n] != null && String(q[n]) !== '') return String(q[n]);
  }
  const lower = new Map(Object.keys(q).map(k => [k.toLowerCase(), q[k]]));
  for(const n of names){
    const hit = lower.get(String(n).toLowerCase());
    if(hit != null && String(hit) !== '') return String(hit);
  }
  return '';
}

function safeEq(a, b){
  const x = Buffer.from(String(a || ''), 'utf8');
  const y = Buffer.from(String(b || ''), 'utf8');
  if(x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

function authenticate(cfg, query){
  const c = ensureConfig(cfg).cfg;
  const clientId = qpick(query, ['client_id', 'clientId', 'ClientId']);
  const clientSecret = qpick(query, ['client_secret', 'clientSecret', 'ClientSecret']);
  const dealerId = qpick(query, ['DealerID', 'dealerId', 'DealerId']);
  const eInvoiceCode = qpick(query, ['EInvoiceCode', 'eInvoiceCode']);
  const systemId = qpick(query, ['SystemId', 'systemId']);
  if(!safeEq(clientId, c.clientId) || !safeEq(clientSecret, c.clientSecret)){
    return { ok: false, status: 401, message: 'Unauthorized' };
  }
  if(dealerId && !safeEq(dealerId, c.dealerId)){
    return { ok: false, status: 401, message: 'Invalid DealerID' };
  }
  if(eInvoiceCode && !safeEq(eInvoiceCode, c.eInvoiceCode)){
    return { ok: false, status: 401, message: 'Invalid EInvoiceCode' };
  }
  if(systemId && !safeEq(systemId, c.systemId)){
    return { ok: false, status: 401, message: 'Invalid SystemId' };
  }
  if(!c.enabled){
    return { ok: false, status: 403, message: 'Service disabled' };
  }
  return { ok: true, cfg: c };
}

function parseAddReturns(query, fallback = true){
  const v = qpick(query, ['addReturns', 'AddReturns']);
  if(v === '') return fallback !== false;
  return v === 'true' || v === '1' || v.toLowerCase() === 'true';
}

function parseRange(query){
  const startRaw = qpick(query, ['StartDate', 'startDate', 'start']);
  const endRaw = qpick(query, ['EndDate', 'endDate', 'end']);
  const end = endRaw ? new Date(rapid360.formatDateTime(endRaw, true)) : new Date();
  const start = startRaw
    ? new Date(rapid360.formatDateTime(startRaw, false))
    : new Date(end.getTime() - 29 * 86400000);
  const startMs = Number.isFinite(start.getTime()) ? start.getTime() : 0;
  const endMs = Number.isFinite(end.getTime()) ? end.getTime() : Date.now();
  return { startMs, endMs, startDate: rapid360.formatDateTime(start, false), endDate: rapid360.formatDateTime(end, true) };
}

function rowTime(row){
  const raw = row && (row.invoiceDate || row.createdAt || row.updatedAt || '');
  const t = Date.parse(String(raw));
  return Number.isFinite(t) ? t : 0;
}

function isReturnRow(row){
  if(!row) return false;
  if(row.isReturn === true || row.isReturn === 'true') return true;
  const st = String(row.status || '').toLowerCase();
  if(st === 'cancelled' || st === 'return' || st === 'iade') return true;
  const blob = `${row.docType || ''} ${row.invoiceType || ''} ${row.profile || ''}`.toLowerCase();
  return /iade|return|credit/.test(blob);
}

function profileOf(row){
  const t = String(row.docType || row.invoiceType || row.profile || '').toLowerCase();
  if(/arsiv|earsiv/.test(t)) return 'EARSIVFATURA';
  if(/ticari/.test(t)) return 'TICARIFATURA';
  if(/iade|return/.test(t)) return 'IADEFATURA';
  return 'TEMELFATURA';
}

function partyTax(party){
  if(!party || typeof party !== 'object') return '';
  return String(party.taxNumber || party.taxNo || party.vkn || party.tckn || '').replace(/\D/g, '');
}

function toDmsRow(row, cfg, meta){
  const c = ensureConfig(cfg).cfg;
  const invoiceDate = rapid360.formatDateTime(row.invoiceDate || row.createdAt, false);
  return {
    InvoiceNumber: String(row.invoiceNumber || row.reference || '').trim(),
    InvoiceDate: invoiceDate,
    UUID: String(row.uuid || '').trim(),
    SupplierName: String(meta.supplierName || '').trim(),
    SupplierTaxNumber: String(meta.supplierVkn || '').replace(/\D/g, ''),
    CustomerName: String(meta.customerName || '').trim(),
    CustomerTaxNumber: String(meta.customerVkn || '').replace(/\D/g, ''),
    Amount: rapid360.asNumber(row.total),
    Profile: profileOf(row),
    IsReturn: isReturnRow(row),
    Status: String(row.status || ''),
    SaleId: String(row.saleId || ''),
    Reference: String(row.reference || ''),
    DealerID: c.dealerId,
    EInvoiceCode: c.eInvoiceCode,
    SystemId: c.systemId,
    Source: meta.source,
    Direction: meta.direction
  };
}

function mapQueueRow(row, store, cfg){
  const inv = store && store.invoiceIntegration || {};
  const customer = row.customer && typeof row.customer === 'object' ? row.customer : {};
  return toDmsRow(row, cfg, {
    source: 'ATAK',
    direction: 'Outgoing',
    supplierName: inv.companyTitle || 'ATAK PAZARLAMA',
    supplierVkn: inv.companyVkn || '',
    customerName: customer.name || customer.companyName || '',
    customerVkn: partyTax(customer)
  });
}

function mapInboxRow(row, cfg){
  return toDmsRow(row, cfg, {
    source: String(row.source || 'RAPID360').toUpperCase().startsWith('RAPID') ? 'RAPID360' : String(row.source || 'INBOX').toUpperCase(),
    direction: 'Incoming',
    supplierName: row.supplierName || '',
    supplierVkn: row.supplierVkn || '',
    customerName: '',
    customerVkn: ''
  });
}

function collectRows(store, cfg, query){
  const c = ensureConfig(cfg).cfg;
  const range = parseRange(query);
  const addReturns = parseAddReturns(query, true);
  const out = [];
  for(const row of (store && store.invoiceQueue) || []){
    if(!row || (!row.invoiceNumber && !row.uuid)) continue;
    const t = rowTime(row);
    if(t && (t < range.startMs || t > range.endMs + 999)) continue;
    if(!addReturns && isReturnRow(row)) continue;
    out.push(mapQueueRow(row, store, c));
  }
  if(c.includeInbox){
    for(const row of (store && store.invoiceInbox) || []){
      if(!row || (!row.invoiceNumber && !row.uuid)) continue;
      const t = rowTime(row);
      if(t && (t < range.startMs || t > range.endMs + 999)) continue;
      if(!addReturns && isReturnRow(row)) continue;
      out.push(mapInboxRow(row, c));
    }
  }
  out.sort((a, b) => String(b.InvoiceDate || '').localeCompare(String(a.InvoiceDate || '')));
  return { rows: out.slice(0, 5000), range, addReturns };
}

function buildResponse(store, cfg, query){
  const { rows, range } = collectRows(store, cfg, query);
  return {
    IsSuccess: true,
    Message: 'OK',
    Count: rows.length,
    StartDate: range.startDate,
    EndDate: range.endDate,
    Data: rows
  };
}

function failBody(message, status){
  return {
    status: status || 401,
    body: { IsSuccess: false, Message: String(message || 'Unauthorized'), Count: 0, Data: [] }
  };
}

function buildCopyUrl(cfg, { baseUrl, startDate, endDate, mask } = {}){
  const c = ensureConfig(cfg).cfg;
  const origin = String(baseUrl || 'https://panel.atakhome.com.tr').replace(/\/$/, '');
  const q = new URLSearchParams();
  q.set('client_id', c.clientId);
  q.set('client_secret', mask ? '********' : c.clientSecret);
  q.set('StartDate', rapid360.formatDateTime(startDate || new Date(Date.now() - 13 * 86400000), false));
  q.set('EndDate', rapid360.formatDateTime(endDate || new Date(), true));
  q.set('DealerID', c.dealerId);
  q.set('EInvoiceCode', c.eInvoiceCode);
  q.set('SystemId', c.systemId);
  q.set('addReturns', 'true');
  return `${origin}${PATH}?${q.toString()}`;
}

function publicConfig(cfg, { reveal, baseUrl } = {}){
  const c = ensureConfig(cfg).cfg;
  const r = cfg && typeof cfg === 'object' ? cfg : {};
  return {
    enabled: c.enabled,
    includeInbox: c.includeInbox,
    dealerId: c.dealerId,
    eInvoiceCode: c.eInvoiceCode,
    systemId: c.systemId,
    clientId: c.clientId,
    clientSecret: c.clientSecret ? '********' : '',
    path: PATH,
    aliasPath: PATH_ALIAS,
    copyUrlMasked: buildCopyUrl(c, { baseUrl, mask: true }),
    copyUrl: reveal ? buildCopyUrl(c, { baseUrl, mask: false }) : '',
    rotatedAt: r.rotatedAt || c.rotatedAt || '',
    ready: Boolean(c.clientId && c.clientSecret && c.dealerId && c.eInvoiceCode)
  };
}

function mergeIncoming(prev, incoming, { rotate } = {}){
  const base = ensureConfig(prev).cfg;
  const x = incoming && typeof incoming === 'object' ? incoming : {};
  const secretRaw = x.clientSecret != null ? x.clientSecret : '';
  let clientId = String(x.clientId != null ? x.clientId : base.clientId).trim();
  let clientSecret = String(secretRaw || '') === '********' || secretRaw === ''
    ? base.clientSecret
    : String(secretRaw);
  let rotatedAt = base.rotatedAt || '';
  if(rotate){
    clientId = generateClientId();
    clientSecret = generateClientSecret();
    rotatedAt = new Date().toISOString();
  }
  return {
    enabled: x.enabled != null ? (x.enabled === true || x.enabled === 'true' || x.enabled === 'on') : base.enabled,
    includeInbox: x.includeInbox != null ? (x.includeInbox === true || x.includeInbox === 'true' || x.includeInbox === 'on') : base.includeInbox,
    dealerId: String(x.dealerId != null ? x.dealerId : base.dealerId).trim() || DEFAULTS.dealerId,
    eInvoiceCode: String(x.eInvoiceCode != null ? x.eInvoiceCode : base.eInvoiceCode).trim() || DEFAULTS.eInvoiceCode,
    systemId: String(x.systemId != null ? x.systemId : base.systemId).trim() || '1',
    clientId,
    clientSecret,
    rotatedAt
  };
}

module.exports = {
  PATH,
  PATH_ALIAS,
  PUBLIC_PATHS,
  DEFAULTS,
  generateClientId,
  generateClientSecret,
  ensureConfig,
  authenticate,
  parseRange,
  parseAddReturns,
  isReturnRow,
  profileOf,
  toDmsRow,
  mapQueueRow,
  mapInboxRow,
  collectRows,
  buildResponse,
  failBody,
  buildCopyUrl,
  publicConfig,
  mergeIncoming
};
