'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { plannedDecrease } = require('../lib/stock-decrease');

assert.strictEqual(plannedDecrease(12, 0, 1).after, 11);
assert.strictEqual(plannedDecrease(12, 0, 1).delta, -1);
assert.strictEqual(plannedDecrease(1, 0, 1).after, 0);
assert.strictEqual(plannedDecrease(5, 2, 3).after, 2);
assert.ok(!plannedDecrease(5, 0, 0).ok);
assert.ok(!plannedDecrease(5, 0, 6).ok);
assert.ok(!plannedDecrease(5, 3, 3).ok);
assert.match(plannedDecrease(5, 3, 3).error, /Satılabilir/);

const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const adminJs = fs.readFileSync(path.join(root, 'public', 'assets', 'admin.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public', 'admin.html'), 'utf8');
assert.match(server, /require\('\.\/lib\/stock-decrease'\)/);
assert.match(server, /\/web-api\/admin\/stock-decrease/);
assert.match(adminJs, /data-stock-drop/);
assert.match(adminJs, /purchaseOpenInvoiceLines/);
assert.match(html, /id="purchaseInvoiceDetail"/);
assert.match(html, /Tek ürün için/);
assert.match(adminJs, /purchaseLineSearch/);

console.log('stock-decrease.test.js ok');
