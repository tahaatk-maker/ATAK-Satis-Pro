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
const COPY_WINDOW_DAYS = 59;

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

const RAPID360_MULE_DEALER = ARCELIK_DEALER_ID;

function requestedDealerId(query){
  return qpick(query, ['DealerID', 'dealerId', 'DealerId']);
}

function dealerIdMatchesAtak(requested, cfgDealer){
  const req = String(requested || '').trim();
  const ours = String(cfgDealer || DEFAULTS.dealerId).trim();
  if(!req) return false;
  if(safeEq(req, ours)) return true;
  // EVA Rapid Aktar Rapid360 DealerID gönderir; tarayıcıdaki Atak URL’si 340344 kullanır.
  return req === RAPID360_MULE_DEALER && (ours === DEFAULTS.dealerId || ours === '340344');
}

function envelopeDealerId(cfg, query){
  const req = requestedDealerId(query);
  if(req === RAPID360_MULE_DEALER) return RAPID360_MULE_DEALER;
  return String((cfg && cfg.dealerId) || DEFAULTS.dealerId);
}

function cleanText(v){
  const s = String(v == null ? '' : v).trim();
  if(!s || /^(null|undefined|-)$/i.test(s)) return '';
  return s;
}

function authenticate(cfg, query){
  const c = ensureConfig(cfg).cfg;
  const clientId = qpick(query, ['client_id', 'clientId', 'ClientId']);
  const clientSecret = qpick(query, ['client_secret', 'clientSecret', 'ClientSecret']);
  const dealerId = requestedDealerId(query);
  const eInvoiceCode = qpick(query, ['EInvoiceCode', 'eInvoiceCode']);
  const systemId = qpick(query, ['SystemId', 'systemId']);
  if(!clientId || !clientSecret || !eInvoiceCode || !dealerId){
    return { ok: false, status: 401, message: 'Unauthorized' };
  }
  if(!safeEq(clientId, c.clientId) || !safeEq(clientSecret, c.clientSecret)){
    return { ok: false, status: 401, message: 'Unauthorized' };
  }
  if(!safeEq(eInvoiceCode, c.eInvoiceCode) || !dealerIdMatchesAtak(dealerId, c.dealerId)){
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

function dealerNumber(cfg, query){
  const id = envelopeDealerId(cfg, query);
  const n = Number(String(id).replace(/\D/g, ''));
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

function emptyRapidEnvelope(range, cfg, addReturns, query){
  const c = ensureConfig(cfg).cfg;
  return {
    $id: '1',
    DealerId: dealerNumber(c, query),
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

function toRapidInvoice(row, store, cfg, query){
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
  const siparis = numericSayac(row.saleId || row.reference || sale.reference || row.id, sayac);
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
  const isReturn = isReturnRow(row, sale);
  const valor = formatTrDate(sale.valorDate || sale.firstDueDate || row.valorDate);
  const aciklama = [sale.reference || row.reference, row.description || sale.description].map(cleanText).filter(Boolean).join(' · ');
  return {
    FaturaTarihi: dateTr,
    FaturaSayac: sayac,
    FaturaNo: String(row.invoiceNumber || row.reference || sale.reference || '').trim(),
    Rapid360No: String(row.invoiceNumber || row.reference || sale.reference || '').trim(),
    SiparisNo: cleanText(sale.reference || row.reference),
    EmanetMi: (sale.consignment || sale.emanet) ? 'Evet' : 'Hayır',
    EFaturaMi: isReturn ? 'No' : 'Yes',
    ResmiBelgeNo: String(row.invoiceNumber || row.reference || sale.reference || '').trim(),
    FaturaSinifi: isReturn ? 'IADE' : 'BEKLEYEN',
    FaturaTipi: 'Mal Faturası',
    FaturaAsama: isReturn ? 'IADE' : 'NORMAL',
    FaturaAciklama: aciklama || 'Mağaza satışı',
    MusteriKodu: String(customer.code || customer.customerCode || row.customerId || customer.id || '').trim(),
    MusteriEmail: cleanText(customer.email),
    SubeKodu: String(sale.storeId || c.subeKodu),
    Bayi: String(c.bayi || DEFAULTS.bayi),
    BayiKodu: envelopeDealerId(c, query),
    MusteriSayac: numericSayac(customer.id || row.customerId, sayac),
    VergiNo: partyTax(customer),
    VergiDairesi: cleanText(customer.taxOffice),
    Adres: cleanText(customer.address),
    Sehir: cleanText(customer.city),
    Ilce: cleanText(customer.district),
    Semt: cleanText(customer.neighborhood || customer.semt),
    IrtibatTelefonu: cleanText(customer.workPhone),
    EvTelefonu: cleanText(customer.homePhone),
    CepTelefonu: String(customer.phone || customer.mobile || '').replace(/\D/g, ''),
    MuhasebeBaglantiKodu: '',
    FaturalanacakMusteriAdi: displayCustomerName(customer),
    ValorTarihi: valor,
    TutarToplami: gross,
    KDVTutarToplami: vatSum,
    AktarimToplami: netSum,
    IndirimToplami: discountSum,
    FaturaMiktari: qtySum || lines.length,
    EInvoicesLines: lines
  };
}

function rowInvoiceYmd(row, store){
  const sale = findSale(store, row && row.saleId) || {};
  return ymd(row && (
    row.invoiceDate ||
    row.FaturaTarihi ||
    sale.invoiceDate ||
    sale.date ||
    row.createdAt ||
    sale.createdAt ||
    (row.rapidRaw && row.rapidRaw.FaturaTarihi)
  ));
}

function inDateRange(row, range, store){
  const d = rowInvoiceYmd(row, store);
  if(!d) return true;
  return d >= range.startYmd && d <= range.endYmd;
}

function parseRange(query, now){
  const startRaw = qpick(query, ['StartDate', 'startDate', 'start']);
  const endRaw = qpick(query, ['EndDate', 'endDate', 'end']);
  const todayYmd = ymd(now || new Date());
  let endYmd = ymd(endRaw) || todayYmd;
  // Firma linkinde eski EndDate kalınca yeni faturalar düşmesin: bugüne kadar uzat.
  if(endYmd < todayYmd) endYmd = todayYmd;
  let startYmd = ymd(startRaw);
  if(!startYmd){
    const end = new Date(`${endYmd}T12:00:00`);
    startYmd = ymd(new Date(end.getTime() - COPY_WINDOW_DAYS * 86400000));
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

function saleNeedsInvoiceStatus(status){
  const st = String(status || 'pending').toLowerCase();
  return st === 'pending' || st === 'queued' || st === 'queue_qnb' || st === 'ready';
}

function isSkippedPendingSale(sale){
  if(!sale || typeof sale !== 'object') return true;
  if(String(sale.kind || 'sale') !== 'sale') return true;
  if(sale.cancelled) return true;
  if(sale.rapidDraft || sale.needsCompletion) return true;
  return false;
}

function pendingSalesAsQueueRows(store){
  const queued = new Set(((store && store.invoiceQueue) || [])
    .filter(q=>{
      const st=String(q && q.status || '').toLowerCase();
      return st && !['error','cancelled','canceled','void','not_required','pending'].includes(st);
    })
    .map(q => String(q.saleId || ''))
    .filter(Boolean));
  const extra = [];
  for(const s of (store && store.financeTransactions) || []){
    if(isSkippedPendingSale(s)) continue;
    if(!saleNeedsInvoiceStatus(s.invoiceStatus)) continue;
    if(queued.has(String(s.id))) continue;
    extra.push({
      id: 'sale-inv-' + s.id,
      saleId: s.id,
      reference: s.reference || '',
      customerId: s.customerId,
      customer: s.customer || {},
      items: Array.isArray(s.items) ? s.items : [],
      total: s.total,
      status: 'pending',
      invoiceType: s.invoiceType || 'auto',
      docType: s.invoiceType || 'auto',
      uuid: s.invoiceUuid || s.uuid || '',
      invoiceNumber: String(s.invoiceNumber || s.reference || '').trim(),
      invoiceDate: s.invoiceDate || s.date || s.createdAt,
      createdAt: s.createdAt || s.date
    });
  }
  return extra;
}

function displayCustomerName(customer){
  const c = customer && typeof customer === 'object' ? customer : {};
  const names = [c.name, c.companyName, c.title]
    .map(v => String(v == null ? '' : v).trim())
    .filter(v => v && !/^null$/i.test(v) && v !== '-' && !/^undefined$/i.test(v));
  return names[0] || '';
}

function isReturnToken(v){
  const t = String(v || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  return t === 'iade' || t === 'return' || t === 'creditnote' || t === 'credit' || t === 'iadefatura';
}

function isReturnRow(row, sale){
  if(!row) return false;
  const s = sale && typeof sale === 'object' ? sale : {};
  if(row.isReturn === true || row.isReturn === 'true' || row.isReturn === 1 || row.isReturn === '1') return true;
  if(s.isReturn === true || s.isReturn === 'true') return true;
  if(String(row.kind || s.kind || '').toLowerCase() === 'return') return true;
  const asama = String(row.FaturaAsama || s.FaturaAsama || '').toUpperCase().replace(/İ/g, 'I');
  if(asama === 'IADE') return true;
  return [row.docType, row.invoiceType, row.profile, row.invoiceTypeCode, s.docType, s.invoiceTypeCode].some(isReturnToken);
}

function isDroppedInvoiceStatus(status){
  const st = String(status || '').toLowerCase();
  return st === 'cancelled' || st === 'canceled' || st === 'void' || st === 'error';
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

function collectRows(store, cfg, query, now){
  const c = ensureConfig(cfg).cfg;
  const range = parseRange(query, now);
  const addReturns = parseAddReturns(query, true);
  const out = [];
  const seen = new Set();
  const queue = [...((store && store.invoiceQueue) || []), ...pendingSalesAsQueueRows(store)];
  for(const row of queue){
    if(!row) continue;
    const st = String(row.status || '').toLowerCase();
    if(st === 'not_required' || isDroppedInvoiceStatus(st)) continue;
    const sale = findSale(store, row.saleId) || {};
    const no = String(row.invoiceNumber || row.FaturaNo || row.reference || sale.invoiceNumber || sale.reference || '').trim();
    const uuid = String(row.uuid || row.ettn || sale.invoiceUuid || '').trim();
    if(!no && !uuid) continue;
    const dated = Object.assign({}, row, {
      invoiceNumber: no || row.invoiceNumber,
      invoiceDate: row.invoiceDate || sale.invoiceDate || sale.date || row.createdAt
    });
    if(!isAtakOwnInvoice(dated)) continue;
    if(!inDateRange(dated, range, store)) continue;
    if(!addReturns && isReturnRow(dated, sale)) continue;
    const key = String(no || uuid || row.saleId || row.id);
    if(seen.has(key)) continue;
    seen.add(key);
    out.push(toRapidInvoice(dated, store, c, query));
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

function buildResponse(store, cfg, query, now){
  const { rows, range, addReturns } = collectRows(store, cfg, query, now);
  stampIds(rows);
  const env = emptyRapidEnvelope(range, cfg, addReturns, query);
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

function rollingCopyRange(now){
  const endYmd = ymd(now || new Date());
  const end = new Date(`${endYmd}T12:00:00`);
  const start = new Date(end.getTime() - COPY_WINDOW_DAYS * 86400000);
  return {
    startDate: `${ymd(start)}T00:00:00`,
    endDate: `${endYmd}T00:00:00`
  };
}

function muleQueryString(cfg, { startDate, endDate, mask, now } = {}){
  const c = ensureConfig(cfg).cfg;
  const roll = rollingCopyRange(now);
  const start = rapid360.formatDateTime(startDate || roll.startDate, false);
  const end = rapid360.formatDateTime(endDate || roll.endDate, false);
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

function buildCopyUrl(cfg, { baseUrl, startDate, endDate, mask, now } = {}){
  const c = ensureConfig(cfg).cfg;
  const origin = String(baseUrl || 'https://panel.atakhome.com.tr').replace(/\/$/, '');
  return `${origin}${PATH}?${muleQueryString(c, { startDate, endDate, mask, now })}`;
}

function publicConfig(cfg, { reveal, baseUrl, env, now } = {}){
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
    copyUrlMasked: buildCopyUrl(c, { baseUrl, mask: true, now }),
    copyUrl: buildCopyUrl(c, { baseUrl, mask: false, now }),
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
  COPY_WINDOW_DAYS,
  rollingCopyRange,
  pendingSalesAsQueueRows,
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
