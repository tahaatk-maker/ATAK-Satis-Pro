'use strict';

/**
 * Dijital Planet (NetInvoice) SOAP — fatura GÖNDERİMİ.
 * geteinvoices (Rapid360 çekme linki) Dijital Planet değildir.
 * Akış: GetFormsAuthenticationTicket → SendInvoiceData (UBL).
 */

const DEFAULTS = {
  liveUrl: 'https://integration.digitalplanet.com.tr/IntegrationService.asmx',
  testUrl: 'https://n11integrationtest.digitalplanet.com.tr/IntegrationService.asmx',
  fileType: 'UBL'
};

function escXml(v){
  return String(v ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
  }[c]));
}

function decodeXml(v){
  return String(v || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function xmlTag(xml, names){
  const src = String(xml || '');
  const list = Array.isArray(names) ? names : [names];
  for(const n of list){
    const re = new RegExp(`<(?:[\\w.-]+:)?${n}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.-]+:)?${n}>`, 'i');
    const m = src.match(re);
    if(m && String(m[1] || '').trim()) return decodeXml(String(m[1]).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
  }
  return '';
}

function soapEnvelope(action, inner){
  return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <${action} xmlns="http://tempuri.org/">
${inner}
    </${action}>
  </soap:Body>
</soap:Envelope>`;
}

function serviceUrl(cfg){
  const custom = String(cfg && cfg.serviceUrl || '').trim();
  if(custom) return custom.replace(/\?wsdl$/i, '');
  return String(cfg && cfg.environment || 'live') === 'test' ? DEFAULTS.testUrl : DEFAULTS.liveUrl;
}

function fromEnv(env = process.env){
  const e = env && typeof env === 'object' ? env : {};
  return {
    corporateCode: String(e.DIGITALPLANET_CORPORATE_CODE || '').trim(),
    loginName: String(e.DIGITALPLANET_LOGIN || '').trim(),
    password: String(e.DIGITALPLANET_PASSWORD || '').trim(),
    serviceUrl: String(e.DIGITALPLANET_URL || '').trim(),
    templateCode: String(e.DIGITALPLANET_TEMPLATE || '').trim(),
    mapCode: String(e.DIGITALPLANET_MAP || '').trim(),
    receiverPostboxName: String(e.DIGITALPLANET_POSTBOX || '').trim()
  };
}

function ensureConfig(raw = {}, env = process.env){
  const r = raw && typeof raw === 'object' ? raw : {};
  const e = fromEnv(env);
  const cfg = {
    enabled: r.enabled !== false && String(r.enabled) !== 'false',
    environment: String(r.environment || 'live') === 'test' ? 'test' : 'live',
    serviceUrl: String(r.serviceUrl || e.serviceUrl || '').trim(),
    corporateCode: String(r.corporateCode || e.corporateCode || '').trim(),
    loginName: String(r.loginName || e.loginName || '').trim(),
    password: String(r.password || e.password || '').trim(),
    templateCode: String(r.templateCode || e.templateCode || '').trim(),
    mapCode: String(r.mapCode || e.mapCode || '').trim(),
    receiverPostboxName: String(r.receiverPostboxName || e.receiverPostboxName || '').trim(),
    fileType: String(r.fileType || DEFAULTS.fileType).trim() || DEFAULTS.fileType
  };
  return { cfg, ready: isReady(cfg) };
}

function isReady(cfg){
  const c = cfg && typeof cfg === 'object' ? cfg : {};
  return Boolean(c.enabled !== false && c.corporateCode && c.loginName && c.password);
}

function publicConfig(raw, { reveal, env } = {}){
  const { cfg, ready } = ensureConfig(raw, env);
  return {
    enabled: cfg.enabled,
    environment: cfg.environment,
    serviceUrl: serviceUrl(cfg),
    corporateCode: cfg.corporateCode,
    loginName: cfg.loginName,
    password: reveal ? cfg.password : (cfg.password ? '********' : ''),
    templateCode: cfg.templateCode,
    mapCode: cfg.mapCode,
    receiverPostboxName: cfg.receiverPostboxName,
    fileType: cfg.fileType,
    ready
  };
}

function mergeIncoming(prev, incoming){
  const base = ensureConfig(prev).cfg;
  const x = incoming && typeof incoming === 'object' ? incoming : {};
  const secretRaw = x.password != null ? x.password : '';
  return {
    enabled: x.enabled != null ? (x.enabled === true || x.enabled === 'true' || x.enabled === 'on') : base.enabled,
    environment: String(x.environment != null ? x.environment : base.environment) === 'test' ? 'test' : 'live',
    serviceUrl: String(x.serviceUrl != null ? x.serviceUrl : base.serviceUrl || '').trim(),
    corporateCode: String(x.corporateCode != null ? x.corporateCode : base.corporateCode || '').trim(),
    loginName: String(x.loginName != null ? x.loginName : base.loginName || '').trim(),
    password: String(secretRaw || '') === '********' || secretRaw === ''
      ? base.password
      : String(secretRaw),
    templateCode: String(x.templateCode != null ? x.templateCode : base.templateCode || '').trim(),
    mapCode: String(x.mapCode != null ? x.mapCode : base.mapCode || '').trim(),
    receiverPostboxName: String(x.receiverPostboxName != null ? x.receiverPostboxName : base.receiverPostboxName || '').trim(),
    fileType: String(x.fileType != null ? x.fileType : base.fileType || DEFAULTS.fileType).trim() || DEFAULTS.fileType
  };
}

function readinessChecks(raw, env){
  const { cfg, ready } = ensureConfig(raw, env);
  return [
    { name: 'Dijital Planet', ok: cfg.enabled !== false, detail: cfg.enabled === false ? 'Kapalı' : 'Açık' },
    { name: 'Firma kodu', ok: !!cfg.corporateCode, detail: cfg.corporateCode || 'CorporateCode yazın' },
    { name: 'Kullanıcı', ok: !!cfg.loginName, detail: cfg.loginName || 'NetInvoice kullanıcı adı' },
    { name: 'Şifre', ok: !!cfg.password, detail: cfg.password ? 'Tanımlı' : 'NetInvoice şifre' },
    { name: 'Servis', ok: true, detail: serviceUrl(cfg) },
    { name: 'Hazır', ok: ready, detail: ready ? 'Gönderime hazır' : 'Eksik bilgi' }
  ];
}

async function soapPost(url, action, inner, { fetchImpl, timeoutMs } = {}){
  const fetchFn = fetchImpl || fetch;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs || 20000);
  try{
    const r = await fetchFn(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        SOAPAction: `"http://tempuri.org/${action}"`,
        Accept: 'text/xml, application/xml, */*'
      },
      body: soapEnvelope(action, inner),
      signal: ac.signal
    });
    const text = await r.text();
    return { ok: r.ok, status: r.status, text: String(text || '') };
  } finally {
    clearTimeout(t);
  }
}

function parseTicket(xml){
  const ticket = xmlTag(xml, ['GetFormsAuthenticationTicketResult']);
  if(!ticket || /^(null|undefined|false)$/i.test(ticket)) return '';
  return ticket;
}

function parseSendResult(xml){
  const fault = xmlTag(xml, ['faultstring', 'FaultString']);
  const serviceResult = xmlTag(xml, ['ServiceResult']);
  const desc = xmlTag(xml, ['ServiceResultDescription', 'StatusDescription']);
  const invoiceId = xmlTag(xml, ['InvoiceId']);
  const uuid = xmlTag(xml, ['UUID']);
  const errorCode = xmlTag(xml, ['ErrorCode']);
  const errNum = Number(errorCode);
  let ok = false;
  if(fault) ok = false;
  else if(/^error$/i.test(serviceResult)) ok = false;
  else if(/^successful$/i.test(serviceResult)) ok = true;
  else if(Number.isFinite(errNum) && errNum === 0) ok = true;
  return {
    ok,
    serviceResult,
    message: fault || desc || (ok ? 'Dijital Planet kabul etti' : 'Dijital Planet reddetti'),
    invoiceId,
    uuid,
    errorCode
  };
}

function ticketBody(cfg){
  return `      <CorporateCode>${escXml(cfg.corporateCode)}</CorporateCode>
      <LoginName>${escXml(cfg.loginName)}</LoginName>
      <Password>${escXml(cfg.password)}</Password>`;
}

function sendBody(cfg, ticket, ublXml){
  const b64 = Buffer.from(String(ublXml || ''), 'utf8').toString('base64');
  const tpl = cfg.templateCode
    ? `\n      <TemplateCode>${escXml(cfg.templateCode)}</TemplateCode>`
    : '';
  return `      <Ticket>${escXml(ticket)}</Ticket>
      <FileType>${escXml(cfg.fileType || 'UBL')}</FileType>
      <InvoiceRawData>${b64}</InvoiceRawData>
      <CorporateCode>${escXml(cfg.corporateCode)}</CorporateCode>
      <MapCode>${escXml(cfg.mapCode || '')}</MapCode>
      <ReceiverPostboxName>${escXml(cfg.receiverPostboxName || '')}</ReceiverPostboxName>${tpl}`;
}

async function getTicket(raw, opts = {}){
  const { cfg } = ensureConfig(raw, opts.env);
  if(!isReady(cfg)) return { ok: false, error: 'Dijital Planet firma kodu, kullanıcı ve şifre gerekli' };
  let res;
  try{
    res = await soapPost(serviceUrl(cfg), 'GetFormsAuthenticationTicket', ticketBody(cfg), opts);
  }catch(e){
    return { ok: false, error: e.name === 'AbortError' ? 'Dijital Planet zaman aşımı' : (e.message || 'Bağlantı hatası') };
  }
  if(/faultstring|soap:Fault/i.test(res.text)){
    return { ok: false, error: xmlTag(res.text, ['faultstring', 'FaultString']) || 'Dijital Planet SOAP hata', status: res.status };
  }
  const ticket = parseTicket(res.text);
  if(!ticket) return { ok: false, error: 'Giriş reddedildi — firma kodu / kullanıcı / şifre kontrol edin', status: res.status };
  return { ok: true, ticket, status: res.status };
}

async function sendUbl(raw, ublXml, opts = {}){
  const { cfg } = ensureConfig(raw, opts.env);
  if(!isReady(cfg)) return { ok: false, error: 'Dijital Planet bilgileri eksik' };
  const auth = await getTicket(cfg, opts);
  if(!auth.ok) return auth;
  const action = cfg.templateCode ? 'SendInvoiceDataWithTemplateCode' : 'SendInvoiceData';
  let res;
  try{
    res = await soapPost(serviceUrl(cfg), action, sendBody(cfg, auth.ticket, ublXml), opts);
  }catch(e){
    return { ok: false, error: e.name === 'AbortError' ? 'Dijital Planet zaman aşımı' : (e.message || 'Gönderim hatası') };
  }
  const parsed = parseSendResult(res.text);
  if(!parsed.ok){
    return { ok: false, error: parsed.message, status: res.status, ticket: true, rawOk: res.ok };
  }
  return {
    ok: true,
    status: res.status,
    invoiceId: parsed.invoiceId,
    uuid: parsed.uuid,
    message: parsed.message,
    serviceResult: parsed.serviceResult
  };
}

module.exports = {
  DEFAULTS,
  ensureConfig,
  isReady,
  publicConfig,
  mergeIncoming,
  readinessChecks,
  serviceUrl,
  soapEnvelope,
  parseTicket,
  parseSendResult,
  ticketBody,
  sendBody,
  getTicket,
  sendUbl,
  xmlTag
};
