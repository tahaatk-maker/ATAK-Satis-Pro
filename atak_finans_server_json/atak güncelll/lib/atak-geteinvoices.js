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
const ARCELIK_DEALER_ID = '21134761';
const SAMPLE_START = '2023-03-27T00:00:00';
const SAMPLE_END = '2023-03-31T00:00:00';

const DEFAULTS = {
  clientId: rapid360.DEFAULTS.clientId,
  clientSecret: rapid360.DEFAULTS.clientSecret,
  dealerId: '340344',
  eInvoiceCode: rapid360.DEFAULTS.eInvoiceCode,
  systemId: rapid360.DEFAULTS.systemId,
  bayi: 'ATAKHOME',
  subeKodu: '340344',
  enabled: true,
  includeInbox: false
};

function generateClientId(){
  return crypto.randomBytes(16).toString('hex');
}

function generateClientSecret(){
  const hex = crypto.randomBytes(16).toString('hex');
  return hex.slice(0, 8) + hex.slice(8, 16).toUpperCase() + hex.slice(16);
}

function muleFallback(fallback){
  const f = fallback && typeof fallback === 'object' ? fallback : {};
  return {
    clientId: String(f.clientId || DEFAULTS.clientId).trim(),
    clientSecret: String(f.clientSecret || DEFAULTS.clientSecret).trim(),
    dealerId: DEFAULTS.dealerId,
    eInvoiceCode: String(f.eInvoiceCode || DEFAULTS.eInvoiceCode).trim() || DEFAULTS.eInvoiceCode,
    systemId: String(f.systemId || DEFAULTS.systemId).trim() || '1'
  };
}

function normalizeAtakDealerId(v){
  const s = String(v || '').trim();
  if(!s || s === ARCELIK_DEALER_ID) return DEFAULTS.dealerId;
  return s;
}

function normalizeAtakBayi(v){
  const s = String(v || '').trim();
  if(!s || s === '1292') return DEFAULTS.bayi;
  return s;
}

function normalizeAtakSube(v){
  const s = String(v || '').trim();
  if(!s || s === '21134762') return DEFAULTS.subeKodu;
  return s;
}

function isForeignInvoice(row){
  if(!row || typeof row !== 'object') return true;
  const src = String(row.source || row.Source || '').toUpperCase();
  if(src.includes('RAPID') || src.includes('INBOX')) return true;
  if(row.rapidRaw) return true;
  const no = String(row.invoiceNumber || row.FaturaNo || (row.rapidRaw && row.rapidRaw.FaturaNo) || '').toUpperCase();
  if(/^(BEA|GEA|BKO|BEX|ARC)/.test(no)) return true;
  return false;
}

function isAtakOwnInvoice(row){
  return !isForeignInvoice(row);
}

function ensureConfig(raw = {}, fallback = {}){
  const r = raw && typeof raw === 'object' ? raw : {};
  const mule = muleFallback(fallback);
  const missing = !String(r.clientId || '').trim() || !String(r.clientSecret || '').trim();
  return {
    generated: missing,
    cfg: {
      enabled: r.enabled !== false && String(r.enabled) !== 'false',
      includeInbox: false,
      dealerId: normalizeAtakDealerId(r.dealerId),
      eInvoiceCode: String(r.eInvoiceCode || mule.eInvoiceCode).trim() || mule.eInvoiceCode,
      systemId: String(r.systemId || mule.systemId).trim() || '1',
      bayi: normalizeAtakBayi(r.bayi),
      subeKodu: normalizeAtakSube(r.subeKodu),
      allowedIps: parseIpList(r.allowedIps),
      clientId: String(r.clientId || mule.clientId).trim(),
      clientSecret: String(r.clientSecret || mule.clientSecret).trim(),
      rotatedAt: r.rotatedAt || (missing ? new Date().toISOString() : '')
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

function parseIpList(raw){
  if(Array.isArray(raw)) return raw.map(x => String(x || '').trim()).filter(Boolean);
  return String(raw || '').split(/[,;\n\r]+/).map(x => x.trim()).filter(Boolean);
}

function ipv4ToInt(ip){
  const p = String(ip || '').split('.').map(n => Number(n));
  if(p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
}

function ipMatchesEntry(needle, allowed){
  const a = String(allowed || '').trim();
  const n = String(needle || '').trim();
  if(!a || !n) return false;
  if(a === '*') return true;
  if(a === n) return true;
  const cidr = a.match(/^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/);
  if(!cidr) return false;
  const bits = Number(cidr[2]);
  if(!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const base = ipv4ToInt(cidr[1]);
  const ip = ipv4ToInt(n);
  if(base == null || ip == null) return false;
  const mask = bits === 0 ? 0 : ((0xFFFFFFFF << (32 - bits)) >>> 0);
  return (base & mask) === (ip & mask);
}

function dmsAllowlist(cfg, env = process.env){
  const c = ensureConfig(cfg).cfg;
  return [...parseIpList(c.allowedIps), ...parseIpList(env && env.ATAK_DMS_ALLOWED_IPS)];
}

function ipAllowedForDms(cfg, ip, env = process.env){
  const list = dmsAllowlist(cfg, env);
  if(!list.length) return { ok: true, locked: false };
  const needle = String(ip || '').replace(/^::ffff:/, '').trim();
  if(!needle) return { ok: false, locked: true, reason: 'no-ip' };
  return { ok: list.some(a => ipMatchesEntry(needle, a)), locked: true };
}

function authenticate(cfg, query){
  const c = ensureConfig(cfg).cfg;
  const clientId = qpick(query, ['client_id', 'clientId', 'ClientId']);
  const clientSecret = qpick(query, ['client_secret', 'clientSecret', 'ClientSecret']);
  const dealerId = qpick(query, ['DealerID', 'dealerId', 'DealerId']);
  const eInvoiceCode = qpick(query, ['EInvoiceCode', 'eInvoiceCode']);
  const systemId = qpick(query, ['SystemId', 'systemId']);
  if(!clientId || !clientSecret || !eInvoiceCode || !dealerId){
    return { ok: false, status: 401, message: 'Unauthorized' };
  }
  if(!safeEq(clientId, c.clientId) || !safeEq(clientSecret, c.clientSecret)){
    return { ok: false, status: 401, message: 'Unauthorized' };
  }
  if(!safeEq(eInvoiceCode, c.eInvoiceCode) || !safeEq(dealerId, c.dealerId)){
    return { ok: false, status: 401, message: 'Unauthorized' };
  }
  if(systemId && !safeEq(systemId, c.systemId)){
    return { ok: false, status: 401, message: 'Unauthorized' };
  }
  if(!c.enabled){
    return { ok: false, status: 403, message: 'Unauthorized' };
  }
  return { ok: true, cfg: c };
}

function parseAddReturns(query, fallback = true){
  const v = qpick(query, ['addReturns', 'AddReturns']);
  if(v === '') return fallback !== false;
  return v === 'true' || v === '1' || v.toLowerCase() === 'true';
}

function ymd(v){
  const s = String(v || '').trim();
  const tr = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/);
  if(tr) return `${tr[3]}-${String(tr[2]).padStart(2, '0')}-${String(tr[1]).padStart(2, '0')}`;
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if(m) return m[1];
  const dt = v instanceof Date ? v : new Date(s);
  if(!Number.isFinite(dt.getTime())) return '';
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function formatTrDate(v){
  const d = ymd(v);
  if(!d) return '';
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
}

function dealerNumber(cfg){
  const n = Number(String(cfg.dealerId || DEFAULTS.dealerId).replace(/\D/g, ''));
  return Number.isFinite(n) && n > 0 ? n : Number(DEFAULTS.dealerId);
}

function numericSayac(seed, fallback){
  const n = Number(seed);
  if(Number.isFinite(n) && n > 0) return Math.round(n);
  const hex = String(seed || '').replace(/[^0-9a-f]/gi, '');
  if(hex.length >= 6){
    const v = parseInt(hex.slice(-10), 16);
    if(Number.isFinite(v) && v > 0) return v % 10000000000;
  }
  return fallback || 1;
}

function vatSplit(gross, rate){
  const g = rapid360.asNumber(gross);
  const r = Number(rate) || 0;
  if(!r) return { net: g, vat: 0, gross: g };
  const net = Math.round((g * 100) / (100 + r) * 100) / 100;
  const vat = Math.round((g - net) * 100) / 100;
  return { net, vat, gross: g };
}

function findSale(store, saleId){
  if(!store || !saleId) return null;
  return (store.financeTransactions || []).find(t => String(t.id) === String(saleId)) || null;
}

function findCustomer(store, customerId){
  if(!store || !customerId) return null;
  return (store.customers || []).find(c => String(c.id) === String(customerId)) || null;
}

function emptyRapidEnvelope(range, cfg, addReturns){
  const c = ensureConfig(cfg).cfg;
  return {
    $id: '1',
    DealerId: dealerNumber(c),
    startDate: range && range.startDate || '',
    endDate: range && range.endDate || '',
    RecordCount: 0,
    EInvoiceCode: c.eInvoiceCode,
    addReturns: !!addReturns,
    EInvoices: [],
    _reference: '',
    _schema: 0
  };
}

function mapLine(item, invoice, sayac, detaySayac, siparisSayac, i){
  const qty = rapid360.asNumber(item.quantity != null ? item.quantity : 1) || 1;
  const unit = rapid360.asNumber(item.unitPrice != null ? item.unitPrice : (item.price != null ? item.price : 0));
  const discount = rapid360.asNumber(item.discountAmount || item.discount || 0);
  const rate = Number(item.vatRate != null ? item.vatRate : 20) || 0;
  const gross = Math.max(0, Math.round((qty * unit - discount) * 100) / 100);
  const split = vatSplit(gross, rate);
  const dateTr = invoice.FaturaTarihi;
  return {
    FaturaTarihi: dateTr,
    FaturaSayac: sayac,
    FaturaDetaySayac: detaySayac,
    SiparisSayac: siparisSayac,
    Sirket: invoice.SubeKodu,
    MalzemeKodu: String(item.productCode || item.code || item.sku || '').trim(),
    UrunAdi: String(item.name || item.productName || item.title || '').trim(),
    TransferTarihi: dateTr,
    Depo: String(item.warehouse || item.depo || 'MRKZ'),
    Birim: String(item.unit || 'Adet'),
    Miktar: qty,
    BirimFiyat: unit,
    Tutar: split.net,
    IndirimTutari: discount,
    KDVTutari: split.vat,
    SatirTutari: split.gross,
    KDVOrani: rate,
    SiparisSatirSayac: numericSayac(item.id || `${siparisSayac}${i + 1}`, siparisSayac + i + 1)
  };
}

function toRapidInvoice(row, store, cfg){
  const c = ensureConfig(cfg).cfg;
  if(row && row.rapidRaw && (row.rapidRaw.FaturaNo || row.rapidRaw.EInvoicesLines)){
    return JSON.parse(JSON.stringify(row.rapidRaw));
  }
  if(row && row.FaturaNo && Array.isArray(row.EInvoicesLines)){
    return JSON.parse(JSON.stringify(row));
  }
  const sale = findSale(store, row.saleId) || {};
  const customer = Object.assign({}, findCustomer(store, row.customerId) || {}, row.customer || {});
  const dateSrc = row.invoiceDate || sale.invoiceDate || sale.date || row.createdAt;
  const dateTr = formatTrDate(dateSrc);
  const sayac = numericSayac(row.faturaSayac || row.uuid || row.id, 1);
  const siparis = numericSayac(row.saleId || row.reference || row.id, sayac);
  const items = Array.isArray(row.items) && row.items.length
    ? row.items
    : (Array.isArray(sale.items) ? sale.items : []);
  const lines = items.map((item, i) => mapLine(item, { FaturaTarihi: dateTr, SubeKodu: String(sale.storeId || c.subeKodu) }, sayac, sayac + i + 1, siparis, i));
  const qtySum = lines.reduce((a, l) => a + Number(l.Miktar || 0), 0);
  const discountSum = lines.reduce((a, l) => a + Number(l.IndirimTutari || 0), 0) || rapid360.asNumber(sale.discountAmount || 0);
  const gross = rapid360.asNumber(row.total != null ? row.total : sale.total);
  const vatRate = lines[0] ? Number(lines[0].KDVOrani) : 20;
  const split = vatSplit(gross, vatRate);
  const vatSum = lines.length ? Math.round(lines.reduce((a, l) => a + Number(l.KDVTutari || 0), 0) * 100) / 100 : split.vat;
  const netSum = lines.length ? Math.round(lines.reduce((a, l) => a + Number(l.Tutar || 0), 0) * 100) / 100 : split.net;
  const isEa = /earsiv|arsiv/i.test(String(row.docType || row.invoiceType || ''));
  const valor = formatTrDate(sale.valorDate || sale.firstDueDate || row.valorDate);
  return {
    FaturaTarihi: dateTr,
    FaturaSayac: sayac,
    FaturaNo: String(row.invoiceNumber || row.reference || '').trim(),
    EmanetMi: sale.reserveStock ? 'Evet' : 'Hayır',
    EFaturaMi: isEa ? 'No' : 'Yes',
    ResmiBelgeNo: String(row.invoiceNumber || row.reference || '').trim(),
    FaturaSinifi: '',
    FaturaTipi: 'Mal Faturası',
    FaturaAsama: isReturnRow(row) ? 'IADE' : 'NORMAL',
    FaturaAciklama: String(row.description || sale.description || '').trim(),
    MusteriKodu: String(customer.code || customer.customerCode || row.customerId || customer.id || '').trim(),
    MusteriEmail: String(customer.email || '').trim(),
    SubeKodu: String(sale.storeId || c.subeKodu),
    Bayi: String(c.bayi || DEFAULTS.bayi),
    BayiKodu: String(c.dealerId || DEFAULTS.dealerId),
    MusteriSayac: numericSayac(customer.id || row.customerId, sayac),
    VergiNo: partyTax(customer),
    VergiDairesi: String(customer.taxOffice || '').trim(),
    Adres: String(customer.address || '').trim(),
    Sehir: String(customer.city || '').trim(),
    Ilce: String(customer.district || '').trim(),
    Semt: String(customer.neighborhood || customer.semt || '').trim(),
    IrtibatTelefonu: String(customer.workPhone || '').trim(),
    EvTelefonu: String(customer.homePhone || '').trim(),
    CepTelefonu: String(customer.phone || customer.mobile || '').replace(/\D/g, ''),
    MuhasebeBaglantiKodu: '',
    FaturalanacakMusteriAdi: String(customer.name || customer.companyName || '').trim(),
    ValorTarihi: valor,
    TutarToplami: gross,
    KDVTutarToplami: vatSum,
    AktarimToplami: netSum,
    IndirimToplami: discountSum,
    FaturaMiktari: qtySum || lines.length,
    EInvoicesLines: lines
  };
}

function inDateRange(row, range){
  const d = ymd(row && (row.invoiceDate || row.FaturaTarihi || row.createdAt || (row.rapidRaw && row.rapidRaw.FaturaTarihi)));
  if(!d) return true;
  return d >= range.startYmd && d <= range.endYmd;
}

function parseRange(query){
  const startRaw = qpick(query, ['StartDate', 'startDate', 'start']);
  const endRaw = qpick(query, ['EndDate', 'endDate', 'end']);
  const endYmd = ymd(endRaw) || ymd(new Date());
  let startYmd = ymd(startRaw);
  if(!startYmd){
    const end = new Date(`${endYmd}T00:00:00`);
    startYmd = ymd(new Date(end.getTime() - 29 * 86400000));
  }
  return {
    startYmd,
    endYmd,
    startDate: `${startYmd}T00:00:00`,
    endDate: `${endYmd}T00:00:00`,
    startMs: Date.parse(`${startYmd}T00:00:00`),
    endMs: Date.parse(`${endYmd}T23:59:59`)
  };
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
    if(!row || (!row.invoiceNumber && !row.uuid && !row.FaturaNo)) continue;
    if(!isAtakOwnInvoice(row)) continue;
    if(!inDateRange(row, range)) continue;
    if(!addReturns && isReturnRow(row)) continue;
    out.push(toRapidInvoice(row, store, c));
  }
  out.sort((a, b) => ymd(b.FaturaTarihi).localeCompare(ymd(a.FaturaTarihi)) || String(b.FaturaNo || '').localeCompare(String(a.FaturaNo || '')));
  return { rows: out.slice(0, 5000), range, addReturns };
}

function stampIds(invoices){
  let n = 2;
  for(const inv of invoices){
    inv.$id = String(n++);
    for(const line of inv.EInvoicesLines || []){
      line.$id = String(n++);
    }
  }
}

function buildResponse(store, cfg, query){
  const { rows, range, addReturns } = collectRows(store, cfg, query);
  stampIds(rows);
  const env = emptyRapidEnvelope(range, cfg, addReturns);
  env.RecordCount = rows.length;
  env.EInvoices = rows;
  env.addReturns = addReturns;
  return env;
}

function failBody(message, status){
  return {
    status: status || 401,
    body: {
      $id: '1',
      DealerId: 0,
      startDate: '',
      endDate: '',
      RecordCount: 0,
      EInvoiceCode: '',
      addReturns: false,
      EInvoices: [],
      _reference: '',
      _schema: 0,
      Message: String(message || 'Unauthorized')
    }
  };
}

function muleQueryString(cfg, { startDate, endDate, mask } = {}){
  const c = ensureConfig(cfg).cfg;
  const start = rapid360.formatDateTime(startDate || SAMPLE_START, false);
  const end = rapid360.formatDateTime(endDate || SAMPLE_END, false);
  const secret = mask ? '********' : String(c.clientSecret || '');
  return [
    'client_id=' + String(c.clientId || ''),
    'client_secret=' + secret,
    'StartDate=' + start,
    'EndDate=' + end,
    'DealerID=' + String(c.dealerId || ''),
    'EInvoiceCode=' + String(c.eInvoiceCode || ''),
    'SystemId=' + String(c.systemId || '1'),
    'addReturns=true'
  ].join('&');
}

function buildCopyUrl(cfg, { baseUrl, startDate, endDate, mask } = {}){
  const c = ensureConfig(cfg).cfg;
  const origin = String(baseUrl || 'https://panel.atakhome.com.tr').replace(/\/$/, '');
  return `${origin}${PATH}?${muleQueryString(c, { startDate, endDate, mask })}`;
}

function publicConfig(cfg, { reveal, baseUrl, env } = {}){
  const c = ensureConfig(cfg).cfg;
  const r = cfg && typeof cfg === 'object' ? cfg : {};
  const list = dmsAllowlist(c, env || process.env);
  const ipLocked = list.length > 0 && !list.includes('*');
  return {
    enabled: c.enabled,
    includeInbox: c.includeInbox,
    dealerId: c.dealerId,
    eInvoiceCode: c.eInvoiceCode,
    bayi: c.bayi,
    subeKodu: c.subeKodu,
    allowedIps: Array.isArray(c.allowedIps) ? c.allowedIps.join(', ') : '',
    ipLocked,
    systemId: c.systemId,
    clientId: c.clientId,
    clientSecret: reveal ? c.clientSecret : (c.clientSecret ? '********' : ''),
    path: PATH,
    aliasPath: PATH_ALIAS,
    copyUrlMasked: buildCopyUrl(c, { baseUrl, mask: true }),
    copyUrl: buildCopyUrl(c, { baseUrl, mask: false }),
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
    includeInbox: false,
    dealerId: normalizeAtakDealerId(x.dealerId != null ? x.dealerId : base.dealerId),
    eInvoiceCode: String(x.eInvoiceCode != null ? x.eInvoiceCode : base.eInvoiceCode).trim() || DEFAULTS.eInvoiceCode,
    systemId: String(x.systemId != null ? x.systemId : base.systemId).trim() || '1',
    bayi: normalizeAtakBayi(x.bayi != null ? x.bayi : base.bayi),
    subeKodu: normalizeAtakSube(x.subeKodu != null ? x.subeKodu : base.subeKodu),
    allowedIps: x.allowedIps != null ? parseIpList(x.allowedIps) : (base.allowedIps || []),
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
  SAMPLE_START,
  SAMPLE_END,
  generateClientId,
  generateClientSecret,
  ensureConfig,
  authenticate,
  parseIpList,
  ipMatchesEntry,
  dmsAllowlist,
  ipAllowedForDms,
  parseRange,
  ymd,
  inDateRange,
  parseAddReturns,
  isReturnRow,
  profileOf,
  toDmsRow,
  mapQueueRow,
  mapInboxRow,
  isAtakOwnInvoice,
  isForeignInvoice,
  collectRows,
  buildResponse,
  failBody,
  muleQueryString,
  buildCopyUrl,
  publicConfig,
  mergeIncoming
};
