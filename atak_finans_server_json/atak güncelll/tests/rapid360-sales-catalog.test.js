'use strict';
const assert = require('assert');
const catalog = require('../lib/rapid360-sales-catalog');

const parsed = {
  sales: [
    {
      salesId: 'S1',
      lines: [
        { itemCode: 'C9120', name: 'BEKO C9120 Çamaşır' },
        { itemCode: 'EXIST', name: 'Var olan' }
      ]
    },
    {
      salesId: 'S2',
      lines: [
        { itemCode: 'C9120', name: 'BEKO C9120 Çamaşır' },
        { itemCode: 'NEW2', name: 'Yeni televizyon' }
      ]
    },
    {
      salesId: 'DUP',
      lines: [{ itemCode: 'ONLYDUP', name: 'Sadece kayıtlı siparişte' }]
    }
  ]
};

const products = [
  { code: 'EXIST', itemCode: 'EXIST', searchName: 'Var olan', name: 'Var olan' }
];

const missing = catalog.collectMissingProducts(parsed, products, {
  skipSalesIds: new Set(['DUP']),
  suggestCategoryId: (hint) => /C9120|çamaşır/i.test(hint) ? 'camasir-makinesi' : 'diger'
});
assert.equal(missing.length, 2);
assert.equal(missing.find((x) => x.itemCode === 'C9120').salesCount, 2);
assert.equal(missing.find((x) => x.itemCode === 'C9120').suggestedCategoryId, 'camasir-makinesi');
assert.ok(!missing.some((x) => x.itemCode === 'EXIST'));
assert.ok(!missing.some((x) => x.itemCode === 'ONLYDUP'));

const map = catalog.parseCategoryMap(JSON.stringify({ C9120: 'camasir-makinesi', NEW2: 'televizyon' }));
assert.equal(catalog.lookupCategory(map, { itemCode: 'C9120', name: 'BEKO C9120' }), 'camasir-makinesi');
assert.equal(catalog.lookupCategory(map, { itemCode: 'NEW2' }, 'diger'), 'televizyon');
assert.equal(catalog.lookupCategory({}, { itemCode: 'X' }, 'diger'), 'diger');
assert.equal(catalog.lookupCategory({ C9120: 'camasir-makinesi' }, { key: 'C9120', name: 'BEKO C9120' }), 'camasir-makinesi');

const furniture = catalog.collectMissingProducts({
  sales: [{ salesId: 'F1', lines: [{ itemCode: 'K1', name: 'Yatak başı' }] }]
}, [], {
  furniture: true,
  suggestCategoryId: (hint) => {
    assert.ok(/mobilya/i.test(hint));
    return 'mobilya';
  }
});
assert.equal(furniture.length, 1);
assert.equal(furniture[0].suggestedCategoryId, 'mobilya');

const found = catalog.findCatalogProduct(
  [{ code: 'C9120', itemCode: 'C9120', searchName: 'BEKO C9120 Çamaşır', name: 'BEKO C9120 Çamaşır' }],
  { itemCode: 'C9120', name: 'BEKO C9120 Çamaşır' }
);
assert.ok(found);

assert.deepEqual(catalog.parseSalesIds('S1,S2 S3'), ['S1', 'S2', 'S3']);
assert.deepEqual(catalog.parseSalesIds('[]'), []);
assert.deepEqual(catalog.parseSalesIds(['S1', 'S1', ' S2 ']), ['S1', 'S2']);
const picked = catalog.filterSalesByIds(parsed, ['S1']);
assert.equal(picked.sales.length, 1);
assert.equal(picked.sales[0].salesId, 'S1');
assert.deepEqual(missing.find((x) => x.itemCode === 'C9120').salesIds, ['S1', 'S2']);
assert.deepEqual(missing.find((x) => x.itemCode === 'NEW2').salesIds, ['S2']);

assert.deepEqual(catalog.paymentsToSplits([
  { method: 'Nakit', amount: 1000 },
  { method: 'Kredi Kartı', amount: 500.5 },
  { method: 'Senet', amount: 200 }
]), { cash: 1000, card: 500.5, transfer: 0, credit: 0, note: 200 });
assert.equal(catalog.paymentSplitKey('Havale / EFT'), 'transfer');
assert.equal(catalog.paymentSplitKey('Açık hesap'), 'credit');

const draft = catalog.markImportedSaleDraft({
  kind: 'sale', invoiceNumber: 'FTR-1', invoiceDate: '2026-08-01', invoiceStatus: 'issued', deliveryStatus: 'delivered'
}, { invoiceNumber: 'FTR-1', invoiceDate: '2026-08-01' });
assert.equal(draft.needsCompletion, true);
assert.equal(draft.rapidDraft, true);
assert.equal(draft.cashPosted, false);
assert.equal(draft.deliveryStatus, 'order_received');
assert.equal(draft.invoiceStatus, 'not_required');
assert.equal(draft.invoiceNumber, '');
assert.equal(draft.rapidInvoiceNumber, 'FTR-1');
assert.equal(catalog.isOpenRapidSale(draft), true);
assert.equal(catalog.isOpenRapidSale({ kind: 'sale', source: 'rapid360-xml', cashPosted: false, customerDelta: 0 }), true);
assert.equal(catalog.isOpenRapidSale({ kind: 'sale', source: 'rapid360-xml', cashPosted: true, customerDelta: 1200 }), false);
assert.equal(catalog.isOpenRapidSale({ kind: 'sale', cancelled: true, needsCompletion: true }), false);

console.log('rapid360-sales-catalog tests OK');
