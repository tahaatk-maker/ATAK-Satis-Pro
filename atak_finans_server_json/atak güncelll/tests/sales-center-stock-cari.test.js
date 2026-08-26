'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const adminHtml = fs.readFileSync(path.join(root, 'public', 'admin.html'), 'utf8');
const personelHtml = fs.readFileSync(path.join(root, 'public', 'personel.html'), 'utf8');
const adminJs = fs.readFileSync(path.join(root, 'public', 'assets', 'admin.js'), 'utf8');
const personelJs = fs.readFileSync(path.join(root, 'public', 'assets', 'personel.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

assert.match(adminHtml, /id="salesCustomerSelect"/);
assert.match(adminHtml, /<label>Sonuçlar<select id="salesCustomerSelect"/);
assert.doesNotMatch(adminHtml, /id="salesCustomerRail"/);
assert.doesNotMatch(adminHtml, /sales-hub-select-fallback">Sonuçlar/);
assert.doesNotMatch(personelHtml, /sales-hub-select-fallback">Sonuçlar/);
assert.doesNotMatch(adminHtml, /<option value="no">Değişmesin<\/option>/);
assert.doesNotMatch(personelHtml, /<option value="no" selected>Değişmesin<\/option>/);
assert.match(adminHtml, /<option value="" selected>Stok durumu seçin<\/option>/);
assert.match(personelHtml, /<option value="" selected>Stok durumu seçin<\/option>/);
assert.match(adminHtml, /<option value="reserve">Rezerve et<\/option>/);
assert.match(adminHtml, /<option value="yes">Stoktan düş<\/option>/);
assert.match(personelHtml, /data-need-perm="sale_deduct_stock">Stoktan düş/);
assert.doesNotMatch(personelHtml, /staff-perm-stock"[^>]*data-need-perm="sale_deduct_stock"/);

assert.match(adminJs, /function salesSelectCustomerRecord/);
assert.match(adminJs, /function salesCustomerName/);
assert.match(adminJs, /salesCustomerShort\(c\)/);
assert.match(adminJs, /Stok durumu zorunludur/);
assert.match(personelJs, /function salesPickCustomerRecord/);
assert.match(personelJs, /Stok durumu zorunludur/);
assert.match(personelJs, /el\.classList\.toggle\('perm-locked',!ok\);/);
assert.doesNotMatch(personelJs, /need==='sale_deduct_stock'\?!ok:false/);
assert.doesNotMatch(personelJs, /stockSel==='yes'&&canStock\?'deduct':\(stockSel==='reserve'\?'reserve':'none'\)/);
assert.doesNotMatch(adminJs, /function fillSalesCustomerRail/);
assert.doesNotMatch(personelJs, /function fillSalesCustomerRail/);

assert.match(server, /Stok durumu zorunludur: Rezerve et veya Stoktan düş seçin/);
assert.match(server, /reserveStock:Boolean\(t\.reserveStock\)/);
assert.match(server, /available:Math\.max\(0,Number\(x\.quantity\|\|0\)-Number\(x\.reserved\|\|0\)\)/);
assert.match(server, /6\.3\.270-satis-eski/);
assert.match(adminJs, /ATAK_ADMIN_BUILD=fix-v273/);
assert.match(personelJs, /ATAK_PERSONEL_BUILD=fix-v273/);

console.log('sales-center-stock-cari.test.js ok');
