'use strict';
const { splitPersonName, joinPersonName, normalizePersonName } = require('../lib/person-name');

function assert(cond, msg){
  if(!cond) throw new Error(msg);
}

assert(joinPersonName('ALİ', 'SEZER') === 'ALİ SEZER', 'join');
assert(joinPersonName('MUHAMMED EMİR', 'ATAK') === 'MUHAMMED EMİR ATAK', 'çoklu ad');
const a = splitPersonName('AHMET YILMAZ');
assert(a.firstName === 'AHMET' && a.lastName === 'YILMAZ', 'split iki kelime');
const b = splitPersonName('MUHAMMED EMİR ATAK');
assert(b.firstName === 'MUHAMMED EMİR' && b.lastName === 'ATAK', 'split son kelime soyad');
const c = splitPersonName('SEZER');
assert(c.firstName === 'SEZER' && c.lastName === '', 'tek kelime ada gider');

const n = normalizePersonName({ firstName: 'ALİ', lastName: 'SEZER' });
assert(n.name === 'ALİ SEZER' && n.firstName === 'ALİ' && n.lastName === 'SEZER', 'normalize ayrı alan');
const m = normalizePersonName({ name: 'HANİFE DEMİR' });
assert(m.firstName === 'HANİFE' && m.lastName === 'DEMİR' && m.name === 'HANİFE DEMİR', 'normalize tek name');

console.log('person-name.test.js ok');
