'use strict';

const crypto=require('crypto');

function round2(n){
  return Math.round(Number(n||0)*100)/100;
}

function normalizeInvoiceNo(value){
  return String(value||'').trim().toLocaleUpperCase('tr-TR').replace(/[^0-9A-ZÇĞİÖŞÜ]/g,'');
}

function normalizeProductCode(value){
  return String(value||'').trim().toLocaleUpperCase('tr-TR');
}

function productQtyTotal(store, productCode){
  const code=normalizeProductCode(productCode);
  return (store.productStocks||[]).reduce((sum,row)=>{
    if(normalizeProductCode(row.productCode)!==code)return sum;
    return sum+Math.max(0,Number(row.quantity||0));
  },0);
}

function countImportColumns(header){
  const h=(header||[]).map(x=>String(x??'').trim().toLocaleLowerCase('tr-TR'));
  const codeIndex=h.findIndex(x=>/ürün.?kodu|urun.?kodu|^kod$|product.?code|item.?code|madde.?kodu|malzeme1|^malzeme$/.test(x));
  let qtyIndex=h.findIndex(x=>/^adet$|girilecek.?adet|yeni.?stok|quantity|qty|^miktar$/.test(x));
  if(qtyIndex<0)qtyIndex=h.findIndex(x=>/^(stok|stock)$/.test(x));
  const costIndex=h.findIndex(x=>/birim.?maliyet|alış.?fiyat|alis.?fiyat|unit.?cost|^maliyet$|birim.?fiyat/.test(x));
  return {codeIndex,qtyIndex,costIndex};
}

function weightedAverage(oldQty, oldUnitCost, addQty, addUnitCost){
  const oq=Math.max(0,Number(oldQty)||0);
  const aq=Math.max(0,Number(addQty)||0);
  const oc=Math.max(0,Number(oldUnitCost)||0);
  const ac=Math.max(0,Number(addUnitCost)||0);
  if(aq<=0)return round2(oc);
  if(oq<=0)return round2(ac);
  return round2((oq*oc+aq*ac)/(oq+aq));
}

function receiptKey(invoiceNo, productCode){
  return `${normalizeInvoiceNo(invoiceNo)}::${normalizeProductCode(productCode)}`;
}

function findProductInStore(store, code){
  const norm=normalizeProductCode(code);
  if(!norm)return null;
  return (store.products||[]).find(p=>
    normalizeProductCode(p.code)===norm||
    normalizeProductCode(p.itemCode)===norm||
    normalizeProductCode(p.searchName)===norm||
    normalizeProductCode(p.barcode)===norm
  )||null;
}

function existingReceiptKeys(store){
  const keys=new Set();
  for(const rec of (store.stockReceipts||[])){
    if(rec.reverted)continue;
    const inv=normalizeInvoiceNo(rec.invoiceNo);
    if(!inv)continue;
    for(const line of (rec.items||[])){
      const code=normalizeProductCode(line.productCode);
      if(code)keys.add(`${inv}::${code}`);
    }
  }
  for(const inv of (store.purchaseInvoices||[])){
    if(inv.reverted)continue;
    if(!inv.addStock)continue;
    const no=normalizeInvoiceNo(inv.invoiceNo);
    if(!no)continue;
    for(const line of (inv.items||[])){
      const code=normalizeProductCode(line.productCode);
      if(code)keys.add(`${no}::${code}`);
    }
  }
  return keys;
}

function duplicateProducts(store, invoiceNo, productCodes){
  const keys=existingReceiptKeys(store);
  const inv=normalizeInvoiceNo(invoiceNo);
  const hits=[];
  const seen=new Set();
  for(const code of productCodes||[]){
    const norm=normalizeProductCode(code);
    if(!inv||!norm)continue;
    const key=`${inv}::${norm}`;
    if(seen.has(key)){
      hits.push(norm);
      continue;
    }
    seen.add(key);
    if(keys.has(key))hits.push(norm);
  }
  return [...new Set(hits)];
}

function duplicateError(dups){
  return `Bu fatura numarasıyla bu ürün(ler) daha önce stoğa işlendi: ${dups.join(', ')}. Aynı faturayı tekrar işlemek maliyetleri karıştırır.`;
}

function prepareStockReceipt(store, {invoiceNo, warehouseId, items}={}){
  const displayNo=String(invoiceNo||'').trim();
  const invKey=normalizeInvoiceNo(displayNo);
  if(!invKey)throw new Error('Fatura numarası zorunludur. Aynı ürünü aynı faturayla ikinci kez işlememek için gereklidir.');
  const wh=String(warehouseId||'').trim();
  if(!wh)throw new Error('Depo seçiniz.');
  const raw=(Array.isArray(items)?items:[]).filter(r=>{
    if(!r||typeof r!=='object')return false;
    return String(r.productCode||'').trim()||Number(r.quantity||0)||Number(r.unitCost||0);
  });
  if(!raw.length)throw new Error('En az bir ürün satırı giriniz.');
  const prepared=[];
  const codes=[];
  for(const line of raw){
    const product=findProductInStore(store, line.productCode);
    if(!product)throw new Error(`Ürün bulunamadı: ${String(line.productCode||'').trim()||'?'}`);
    const qty=Math.max(0,Math.round(Number(line.quantity)||0));
    const unitCost=Math.max(0,Number(line.unitCost)||0);
    if(!(qty>0))throw new Error(`${product.code}: gelen adet 0 olamaz.`);
    if(!(unitCost>0))throw new Error(`${product.code}: birim alış maliyeti zorunludur.`);
    const oldQty=productQtyTotal(store, product.code);
    const oldCost=Math.max(0,Number(product.purchasePrice)||0);
    prepared.push({
      productId:product.id||'',
      productCode:product.code,
      productName:product.name||product.code,
      quantity:qty,
      unitCost:round2(unitCost),
      previousQty:oldQty,
      previousPurchasePrice:round2(oldCost),
      newPurchasePrice:weightedAverage(oldQty, oldCost, qty, unitCost)
    });
    codes.push(product.code);
  }
  const dups=duplicateProducts(store, displayNo, codes);
  if(dups.length)throw new Error(duplicateError(dups));
  return {invoiceNo:displayNo, invoiceKey:invKey, warehouseId:wh, items:prepared};
}

function applyPreparedCosts(store, prepared){
  const now=new Date().toISOString();
  for(const line of (prepared.items||[])){
    const product=findProductInStore(store, line.productCode);
    if(!product)continue;
    product.purchasePrice=line.newPurchasePrice;
    product.purchasePriceSource='weighted-average';
    product.purchasePriceUpdatedAt=now;
    product.updatedAt=now;
  }
}

function recordStockReceipt(store, prepared, {id, note='', actor='Personel', date}={}){
  store.stockReceipts=Array.isArray(store.stockReceipts)?store.stockReceipts:[];
  const receipt={
    id:id||crypto.randomUUID(),
    date:String(date||new Date().toISOString().slice(0,10)).slice(0,10),
    invoiceNo:prepared.invoiceNo,
    warehouseId:prepared.warehouseId,
    items:prepared.items||[],
    note:String(note||'').trim(),
    reverted:false,
    createdBy:actor,
    createdAt:new Date().toISOString()
  };
  store.stockReceipts.unshift(receipt);
  if(store.stockReceipts.length>500)store.stockReceipts=store.stockReceipts.slice(0,500);
  return receipt;
}

module.exports={
  round2,
  normalizeInvoiceNo,
  normalizeProductCode,
  productQtyTotal,
  countImportColumns,
  weightedAverage,
  receiptKey,
  findProductInStore,
  existingReceiptKeys,
  duplicateProducts,
  duplicateError,
  prepareStockReceipt,
  applyPreparedCosts,
  recordStockReceipt
};
