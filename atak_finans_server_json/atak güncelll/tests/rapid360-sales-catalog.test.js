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

console.log('rapid360-sales-catalog tests OK');
