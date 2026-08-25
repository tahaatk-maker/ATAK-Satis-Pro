'use strict';
const assert=require('assert');
const stock=require('../lib/stock-cost');

/** Fatura+ürün birleşim anahtarı — farklı faturalar ayrı kalmalı */
function mergeKey(invoiceNo, itemCode){
  const prod=String(itemCode||'').trim().toLocaleUpperCase('tr-TR');
  const inv=stock.normalizeInvoiceNo(invoiceNo)||'_';
  return `${inv}::${prod}`;
}

assert.notEqual(
  mergeKey('ARC1','9237611600'),
  mergeKey('ARC2','9237611600'),
  'aynı madde farklı faturalarda ayrı kalır'
);
assert.equal(mergeKey('arc-1','9237611600'),mergeKey('ARC1','9237611600'));

const keys=stock.existingReceiptKeys({
  stockReceipts:[{invoiceNo:'ARC1',items:[{productCode:'9237611600'}]}],
  purchaseInvoices:[]
});
assert.ok(keys.has(stock.receiptKey('ARC1','9237611600')));
assert.equal(stock.duplicateProducts({
  stockReceipts:[{invoiceNo:'ARC1',items:[{productCode:'9237611600'}]}],
  purchaseInvoices:[]
},'ARC1',['9237611600']).length,1);
assert.equal(stock.duplicateProducts({
  stockReceipts:[{invoiceNo:'ARC1',items:[{productCode:'9237611600'}]}],
  purchaseInvoices:[]
},'ARC2',['9237611600']).length,0);

console.log('OK asist-invoice-group tests passed');
