const comms = require('../lib/customer-comms');

function assert(cond, msg){ if(!cond) throw new Error(msg); }

const s = { customerComms: [], smsLogs: [], customers: [{id:'c1', name:'Ayşe', phone:'05321112233'}] };
const c = s.customers[0];
const actor = {id:'u1', name:'Emine'};

const started = comms.recordCall(s, c, {result:'started', actor, nowMs: 1_000_000});
assert(started.result === 'started', 'arama basladi');
const missed = comms.recordCall(s, c, {result:'no_answer', note:'2 kez caldi', actor, nowMs: 1_000_000 + 60_000});
assert(missed.id === started.id, 'ayni kayit guncellenir');
assert(missed.result === 'no_answer', 'ulasilamadi');
assert(missed.note.includes('caldi'), 'not yazilir');

const sms = comms.recordSms(s, c, {message:'Sizi aradik ulasamadik', actor, smsLogId:'log1', provider:'corvass'});
assert(sms.kind === 'sms' && sms.result === 'sent', 'sms kayit');

s.smsLogs.push({id:'old1', customerId:'c1', at:'2026-01-01T10:00:00.000Z', message:'eski', ok:true, actor:'Taha'});
const list = comms.listForCustomer(s, 'c1');
assert(list.some(x => x.smsLogId === 'log1'), 'yeni sms');
assert(list.some(x => x.id === 'smslog-old1'), 'eski smsLogs birlesir');
assert(comms.resultLabel('call','no_answer') === 'Ulaşılamadı', 'etiket');
assert(comms.resultLabel('sms','sent') === 'SMS gönderildi', 'sms etiket');

console.log('customer-comms.test.js ok');
