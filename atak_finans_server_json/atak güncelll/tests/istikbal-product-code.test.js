'use strict';
const assert=require('assert');

/** server.js purchaseProductLookup ile aynı sözleşme: kod kaydı → ikinci kez kart açılmaz */
function purchaseProductLookup(products){
  const map=new Map();
  const norm=v=>String(v||'').trim().toLocaleUpperCase('tr-TR').replace(/\s+/g,' ');
  const add=(k,p)=>{const n=norm(k);if(n&&!map.has(n))map.set(n,p)};
  const register=p=>{
    if(!p)return;
    add(p.code,p);add(p.itemCode,p);add(p.name,p);add(p.searchName,p);
  };
  for(const p of products||[])register(p);
  return{
    find(code,name='',itemCode=''){
      for(const k of [code,itemCode,name]){
        const hit=map.get(norm(k));
        if(hit)return hit;
      }
      return null;
    },
    register
  };
}

const store={products:[]};
const lookup=purchaseProductLookup(store.products);

function createFromMalzeme1(code,name){
  const existing=lookup.find(code,name,code);
  if(existing)return {created:false,product:existing};
  const product={
    id:`p_${code}`,
    code,
    itemCode:code,
    name,
    searchName:name,
    brand:'İstikbal',
    category:'cat_mobilya',
    vatRate:10,
    tags:['istikbal','mobilya']
  };
  store.products.push(product);
  lookup.register(product);
  return {created:true,product};
}

const a=createFromMalzeme1('KMX91','KMX 91 Yatak');
assert.equal(a.created,true);
assert.equal(a.product.vatRate,10);
assert.equal(a.product.category,'cat_mobilya');
assert.equal(a.product.code,'KMX91');
assert.equal(a.product.itemCode,'KMX91');

const again=createFromMalzeme1('KMX91','KMX 91 Yatak (güncel)');
assert.equal(again.created,false,'aynı Malzeme1 ikinci kez kart açmaz');
assert.equal(again.product.id,a.product.id);
assert.equal(store.products.length,1);

const byItem=lookup.find('','başka ad','KMX91');
assert.equal(byItem.id,a.product.id,'itemCode ile eşleşir');

const other=createFromMalzeme1('KMX92','Comfort baza');
assert.equal(other.created,true);
assert.equal(store.products.length,2);

console.log('OK istikbal-product-code tests passed');
