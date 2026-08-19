'use strict';

const crypto = require('crypto');

const CALL_RESULTS = ['started', 'no_answer', 'reached', 'busy', 'voicemail'];

function ensure(store){
  if(!store || typeof store !== 'object') return [];
  if(!Array.isArray(store.customerComms)) store.customerComms = [];
  return store.customerComms;
}

function actorLabel(actor){
  return String(actor?.name || actor?.username || 'Kullanıcı').slice(0, 80);
}

function push(s, row){
  const rec = {
    id: row.id || crypto.randomUUID(),
    at: row.at || new Date().toISOString(),
    updatedAt: row.updatedAt || '',
    customerId: String(row.customerId || ''),
    customerName: String(row.customerName || '').slice(0, 120),
    kind: row.kind === 'sms' ? 'sms' : 'call',
    result: String(row.result || '').slice(0, 40),
    phone: String(row.phone || '').slice(0, 32),
    message: String(row.message || '').slice(0, 1000),
    note: String(row.note || '').slice(0, 500),
    actor: String(row.actor || '').slice(0, 80),
    actorId: String(row.actorId || ''),
    smsLogId: String(row.smsLogId || ''),
    provider: String(row.provider || '').slice(0, 40),
    ok: row.ok !== false,
    manual: Boolean(row.manual)
  };
  ensure(s);
  s.customerComms.unshift(rec);
  s.customerComms = s.customerComms.slice(0, 8000);
  return rec;
}

function lastOpenCall(s, customerId, nowMs){
  const id = String(customerId);
  const rec = (s.customerComms || []).find(x => String(x.customerId) === id && x.kind === 'call');
  if(!rec || rec.result !== 'started') return null;
  const t = Date.parse(rec.at);
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  if(!Number.isFinite(t) || now - t > 30 * 60 * 1000) return null;
  return rec;
}

function recordCall(s, customer, {result = 'started', phone = '', note = '', actor, nowMs} = {}){
  const res = CALL_RESULTS.includes(result) ? result : 'started';
  const open = lastOpenCall(s, customer.id, nowMs);
  if(open && res !== 'started'){
    open.result = res;
    if(note) open.note = String(note).slice(0, 500);
    if(phone) open.phone = String(phone).slice(0, 32);
    open.updatedAt = new Date().toISOString();
    if(actor) open.actor = actorLabel(actor);
    return open;
  }
  return push(s, {
    kind: 'call',
    result: res,
    phone: phone || customer.phone || '',
    note,
    customerId: customer.id,
    customerName: customer.name || '',
    actor: actorLabel(actor),
    actorId: actor?.id || ''
  });
}

function recordSms(s, customer, {result = 'sent', phone = '', message = '', note = '', actor, smsLogId = '', provider = '', ok = true, manual = false} = {}){
  return push(s, {
    kind: 'sms',
    result: ok === false ? 'failed' : (result || 'sent'),
    phone: phone || customer.phone || '',
    message,
    note,
    customerId: customer.id,
    customerName: customer.name || '',
    actor: actorLabel(actor),
    actorId: actor?.id || '',
    smsLogId,
    provider,
    ok: ok !== false,
    manual
  });
}

function fromSmsLog(x){
  return {
    id: 'smslog-' + x.id,
    at: x.at,
    customerId: x.customerId,
    customerName: x.customerName || '',
    kind: 'sms',
    result: x.ok === false ? 'failed' : 'sent',
    phone: x.phone || '',
    message: x.message || '',
    note: x.error || '',
    actor: x.actor || '',
    provider: x.provider || '',
    ok: x.ok !== false,
    imported: true
  };
}

function listForCustomer(s, customerId, limit = 250){
  const id = String(customerId);
  const comms = (s.customerComms || []).filter(x => String(x.customerId) === id);
  const linked = new Set(comms.map(x => String(x.smsLogId || '')).filter(Boolean));
  const extra = (s.smsLogs || [])
    .filter(x => String(x.customerId) === id && x.id && !linked.has(String(x.id)))
    .map(fromSmsLog);
  return [...comms, ...extra]
    .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
    .slice(0, limit);
}

function resultLabel(kind, result){
  if(kind === 'sms'){
    if(result === 'failed') return 'SMS gönderilemedi';
    return 'SMS gönderildi';
  }
  return ({
    started: 'Arama başlatıldı',
    no_answer: 'Ulaşılamadı',
    reached: 'Görüşüldü',
    busy: 'Meşgul',
    voicemail: 'Sesli mesaj'
  })[result] || result || 'Arama';
}

module.exports = {
  ensure,
  push,
  recordCall,
  recordSms,
  listForCustomer,
  resultLabel,
  lastOpenCall,
  CALL_RESULTS
};
