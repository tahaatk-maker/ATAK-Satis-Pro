'use strict';
const {
  personNameKey,findByPersonName,canMerge,pickKeeper,
  fillEmptyFields,reassignCustomerId,collapseDuplicateCustomersByName
}=require('../lib/customer-dedupe');

function assert(cond,msg){if(!cond)throw new Error(msg)}

assert(personNameKey({firstName:'Ahmet',lastName:'Yılmaz'})==='ahmet|yilmaz','ad soyad anahtar');
assert(personNameKey({name:'AHMET  YILMAZ'})==='ahmet|yilmaz','tek name split');
assert(personNameKey({firstName:'SEZER',lastName:''})==='','tek kelime eşleşmez');

const list=[
  {id:'a',firstName:'Ahmet',lastName:'Yılmaz',name:'Ahmet Yılmaz',phone:'05321111111'},
  {id:'b',firstName:'Mehmet',lastName:'Demir',name:'Mehmet Demir'}
];
assert(findByPersonName(list,{firstName:'AHMET',lastName:'YILMAZ'})?.id==='a','aynı ad soyad bulunur');
assert(!findByPersonName(list,{firstName:'Ali',lastName:'Yılmaz'}),'farklı ad bulunmaz');

assert(canMerge({tckn:'11111111111'},{tckn:''})===true,'tek TC birleşir');
assert(canMerge({tckn:'11111111111'},{tckn:'22222222222'})===false,'farklı TC birleşmez');

const keeper=pickKeeper([
  {id:'new',createdAt:'2026-08-01',phone:''},
  {id:'old',createdAt:'2024-01-01',phone:'0532',tckn:'11111111111'}
],()=>0);
assert(keeper.id==='old','daha dolu kayıt kalır');

const t={phone:'0532',note:'A'};
fillEmptyFields(t,{phone:'0544',email:'x@y.com',note:'B'});
assert(t.phone==='0532','dolu telefon ezilmez');
assert(t.email==='x@y.com','boş mail dolar');
assert(/A/.test(t.note)&&/B/.test(t.note),'notlar birleşir');

const store={
  customers:[
    {id:'c1',firstName:'Ali',lastName:'Sezer',name:'Ali Sezer',phone:'05320000001',createdAt:'2024-01-01'},
    {id:'c2',firstName:'ALİ',lastName:'SEZER',name:'ALİ SEZER',email:'ali@x.com',createdAt:'2026-01-01'}
  ],
  financeTransactions:[{id:'t1',customerId:'c2',kind:'sale'}],
  promissoryNotes:[{id:'n1',customerId:'c2'}],
  customerComms:[],smsLogs:[],invoiceQueue:[],cancellationRequests:[]
};
const out=collapseDuplicateCustomersByName(store);
assert(out.merged===1,'çift kayıt birleşir');
assert(store.customers.filter(c=>c.active!==false&&!c.deletedAt).length===1,'tek aktif kalır');
const keep=store.customers.find(c=>c.active!==false&&!c.deletedAt);
assert(keep.id==='c2','satışı olan kayıt kalır');
assert(keep.phone==='05320000001','boş telefon dolar');
assert(store.financeTransactions[0].customerId==='c2','satış aynı idde kalır');
assert(store.promissoryNotes[0].customerId==='c2','senet aynı idde kalır');
assert(store.customers.find(c=>c.id==='c1').mergedInto==='c2','diğer kayıt kapanır');

const moved=reassignCustomerId({financeTransactions:[{customerId:'x'}]},'x','y');
assert(moved===1&&true,'id taşıma');

console.log('OK customer-dedupe tests passed');
