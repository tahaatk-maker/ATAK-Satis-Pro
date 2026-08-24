'use strict';
const assert=require('assert');
const stock=require('../lib/stock-cost');

assert.equal(stock.normalizeInvoiceNo(' ata-123 / a '), 'ATA123A');
assert.equal(stock.weightedAverage(10,10000,0,12000), 10000);
assert.equal(stock.weightedAverage(0,10000,10,12000), 12000);
assert.equal(stock.weightedAverage(5,10000,10,12000), 11333.33);

const store={
  products:[{id:'p1',code:'COMFORT',name:'Comfort Yatak',purchasePrice:10000,itemCode:'comfort'}],
  productStocks:[{productCode:'comfort',quantity:5}],
  stockReceipts:[{invoiceNo:'F-1',reverted:false,items:[{productCode:'COMFORT'}]}],
  purchaseInvoices:[{invoiceNo:'C-9',addStock:false,items:[{productCode:'COMFORT'}]}]
};
assert.equal(stock.productQtyTotal(store,'Comfort'),5);
assert.deepEqual(stock.duplicateProducts(store,'f1',['comfort']),['COMFORT']);
assert.deepEqual(stock.duplicateProducts(store,'f2',['comfort']),[]);
assert.deepEqual(stock.duplicateProducts(store,'F-1',['comfort','comfort']),['COMFORT']);
assert.deepEqual(stock.duplicateProducts(store,'c-9',['comfort']),[], 'sadece maliyet aktarımı stoğu kilitlemez');

assert.throws(()=>stock.prepareStockReceipt(store,{invoiceNo:'',warehouseId:'ana',items:[{productCode:'COMFORT',quantity:1,unitCost:1}]}),/Fatura numarası/);
assert.throws(()=>stock.prepareStockReceipt(store,{invoiceNo:'F-1',warehouseId:'ana',items:[{productCode:'COMFORT',quantity:2,unitCost:12000}]}),/daha önce stoğa işlendi/);

const prepared=stock.prepareStockReceipt(store,{
  invoiceNo:'F-2 / a',
  warehouseId:'ana-depo',
  items:[{productCode:'comfort',quantity:10,unitCost:12000}]
});
assert.equal(prepared.invoiceKey,'F2A');
assert.equal(prepared.items[0].previousQty,5);
assert.equal(prepared.items[0].previousPurchasePrice,10000);
assert.equal(prepared.items[0].newPurchasePrice,11333.33);

stock.applyPreparedCosts(store,prepared);
assert.equal(store.products[0].purchasePrice,11333.33);
assert.equal(store.products[0].purchasePriceSource,'weighted-average');

const receipt=stock.recordStockReceipt(store,prepared,{actor:'Depo'});
assert.equal(receipt.invoiceNo,'F-2 / a');
assert.equal(store.stockReceipts[0].id,receipt.id);
assert.throws(()=>stock.prepareStockReceipt(store,{invoiceNo:'F2A',warehouseId:'ana-depo',items:[{productCode:'COMFORT',quantity:1,unitCost:1}]}),/daha önce stoğa işlendi/);

console.log('stock-cost.test.js ok');
