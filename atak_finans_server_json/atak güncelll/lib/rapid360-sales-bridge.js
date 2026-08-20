'use strict';

const crypto = require('crypto');
const salesXml = require('./rapid360-sales-xml');

const TTL_MS = 10 * 60 * 1000;
const bridges = new Map();

const ODATA_ENTITIES = [
  'DmrDetailedSalesReports',
  'DmrDetailedSalesReportLines',
  'DmrDetailedSales',
  'RetailTransactionSalesTrans',
  'SalesOrderLinesV3'
];

function sweep(){
  const now = Date.now();
  for(const [id, row] of bridges){
    if(now - row.at > TTL_MS) bridges.delete(id);
  }
}

function createBridge(meta = {}){
  sweep();
  const id = crypto.randomBytes(18).toString('hex');
  const row = {
    id,
    at: Date.now(),
    meta: {
      startDate: String(meta.startDate || '').slice(0, 10),
      endDate: String(meta.endDate || '').slice(0, 10),
      store: String(meta.store || '340334'),
      company: String(meta.company || '2521'),
      dealerId: String(meta.dealerId || '')
    },
    parsed: null,
    error: ''
  };
  bridges.set(id, row);
  return row;
}

function getBridge(id){
  sweep();
  return bridges.get(String(id || '')) || null;
}

function parseIncoming(body){
  if(body == null) return { sales: [], cancelledCount: 0, recordCount: 0, format: 'empty' };
  if(typeof body === 'string') return salesXml.extractSales(body);
  if(Buffer.isBuffer(body)) return salesXml.extractSales(salesXml.decodeBuffer(body));
  const xml = String(body.xml || body.html || '').trim();
  if(xml && /<Satislar/i.test(xml)) return salesXml.extractSales(xml);
  if(body.json != null) return salesXml.extractSalesFromJson(body.json);
  if(body.value || body.Satislar || body.sales) return salesXml.extractSalesFromJson(body);
  if(xml) return salesXml.extractSales(xml);
  return salesXml.extractSalesFromJson(body);
}

function acceptPush(id, body){
  const row = getBridge(id);
  if(!row) return { ok: false, error: 'Oturum yok. Rapid Aktar’da Satışları oku’ya tekrar basın.' };
  const parsed = parseIncoming(body);
  if(!(parsed.sales && parsed.sales.length)){
    row.error = 'Rapid360 veri gönderdi ama satış yok. XML yedeğini kullanın.';
    return { ok: false, error: row.error, parsed };
  }
  row.parsed = parsed;
  row.error = '';
  row.at = Date.now();
  return { ok: true, count: parsed.sales.length };
}

function bookmarklet({ bridgeId, baseUrl, startDate, endDate }){
  const cfg = {
    id: String(bridgeId || ''),
    a: String(baseUrl || '').replace(/\/+$/, ''),
    s: String(startDate || '').slice(0, 10),
    e: String(endDate || '').slice(0, 10)
  };
  const src = `(async()=>{const C=${JSON.stringify(cfg)};const es=${JSON.stringify(ODATA_ENTITIES)};let data=null,xml='';try{const h=document.documentElement.innerHTML||'';if(/<Satislar/i.test(h))xml=h}catch(e){}for(const n of es){try{const r=await fetch('/data/'+n+'?cross-company=true&$top=200',{credentials:'include'});if(!r.ok)continue;const j=await r.json();if(j&&((j.value&&j.value.length)||j.Satislar)){data=j;break}}catch(e){}}if(!data&&!xml){alert('Rapid360 veri vermedi. XML indirip Atak’a yükleyin.');return}const r=await fetch(C.a+'/web-api/rapid360-bridge/'+C.id,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({json:data,xml:xml,startDate:C.s,endDate:C.e})});alert(r.ok?'Satışlar Atak’a gitti. Atak sekmesine dönün.':'Atak’a gönderilemedi');})();`;
  return `javascript:${encodeURIComponent(src)}`;
}

function corsOrigin(origin){
  const o = String(origin || '');
  if(/https:\/\/liverapid360\.operations\.dynamics\.com$/i.test(o)) return o;
  if(/https:\/\/([a-z0-9-]+\.)?atakhome\.com\.tr$/i.test(o)) return o;
  return '';
}

function resetForTests(){
  bridges.clear();
}

module.exports = {
  TTL_MS,
  ODATA_ENTITIES,
  createBridge,
  getBridge,
  parseIncoming,
  acceptPush,
  bookmarklet,
  corsOrigin,
  resetForTests
};
