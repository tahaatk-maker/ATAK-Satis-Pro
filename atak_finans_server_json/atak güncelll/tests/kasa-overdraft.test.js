'use strict';
const fs = require('fs');
const path = require('path');

function assert(cond, msg){
  if(!cond) throw new Error(msg);
}

const src = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');

function routeBody(prefix){
  const i = src.indexOf(prefix);
  assert(i >= 0, 'route missing: ' + prefix);
  const next = src.indexOf('\napp.post(', i + prefix.length);
  const end = next >= 0 ? next : src.length;
  return src.slice(i, end);
}

const salary = routeBody("app.post('/web-api/admin/salary-pay'");
assert(!salary.includes('Hesap bakiyesi yetersiz'), 'avans/maaş kasası 0 olsa da eksi yazılmalı');
assert(salary.includes("kind:'payment'"), 'salary-pay payment yazar');

const expense = routeBody("app.post('/web-api/admin/money-expense'");
assert(!expense.includes('Hesap bakiyesi yetersiz'), 'masraf kasası 0 olsa da eksi yazılmalı');

console.log('kasa-overdraft.test.js ok');
