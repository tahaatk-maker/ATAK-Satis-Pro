const lock=require('../lib/branch-lock');

function assert(cond,msg){if(!cond)throw new Error(msg)}

const stores=[
  {id:'beko-atak',name:'BEKO ATAK',code:'340334'},
  {id:'istikbal-atak',name:'İSTİKBAL ATAK',code:'IST'},
  {id:'atak-tarabya',name:'Atak Tarabya',code:'TRB'}
];
const accounts=[
  {id:'beko-kasa',name:'BEKO MAĞAZA KASA',type:'cash',storeId:'beko-atak',active:true},
  {id:'ist-kasa',name:'İSTİKBAL KASA',type:'cash',storeId:'istikbal-atak',active:true},
  {id:'merkez-kasa',name:'Merkez Kasa',type:'cash',storeId:'',active:true},
  {id:'qnb',name:'QNB Banka',type:'bank',storeId:'',active:true},
  {id:'beko-pos',name:'BEKO POS',type:'bank',storeId:'beko-atak',active:true}
];
const dealers=[
  {id:'atak-beko',name:'Atak Beko',active:true},
  {id:'atak-istikbal',name:'Atak İstikbal',active:true}
];
const warehouses=[
  {id:'beko-depo',name:'BEKO MAĞAZA DEPO',storeId:'beko-atak',active:true},
  {id:'ist-depo',name:'İSTİKBAL DEPO',storeId:'istikbal-atak',active:true}
];

assert(lock.brandKeyFromText('İSTİKBAL ATAK')==='istikbal','istikbal adı');
assert(lock.brandKeyFromText('BEKO ATAK')==='beko','beko adı');
assert(lock.brandKeyFromText('Atak Tarabya')==='','markasız mağaza');
assert(lock.storeBrand(stores[0])==='beko','beko store');
assert(lock.storeBrand(stores[1])==='istikbal','istikbal store');

const emine={id:'u1',name:'Emine Yakışır',storeId:'istikbal-atak'};
const ali={id:'u2',name:'Ali Beko',storeId:'beko-atak'};
assert(lock.personBrand(emine,stores)==='istikbal','emine istikbal');
assert(lock.personBrand(ali,stores)==='beko','ali beko');
assert(lock.personBrand({id:'u3',storeId:'atak-tarabya'},stores)==='','tarabya kilit yok');
assert(lock.personBrand({id:'system-owner',storeId:'beko-atak',role:'owner'},stores)==='','owner kilit yok');

const istCash=lock.filterCashAccounts(accounts,stores,'istikbal');
assert(istCash.length===1 && istCash[0].id==='ist-kasa','istikbal sadece kendi kasası');
const bekoCash=lock.filterCashAccounts(accounts,stores,'beko');
assert(bekoCash.length===1 && bekoCash[0].id==='beko-kasa','beko sadece kendi kasası');

const istBank=lock.filterBankAccounts(accounts,stores,'istikbal');
assert(istBank.some(a=>a.id==='qnb'),'ortak qnb istikbalde');
assert(!istBank.some(a=>a.id==='beko-pos'),'beko pos istikbalde yok');

const istDealers=lock.filterDealers(dealers,'istikbal');
assert(istDealers.length===1 && istDealers[0].id==='atak-istikbal','istikbal bayi');
const bekoDealers=lock.filterDealers(dealers,'beko');
assert(bekoDealers.length===1 && bekoDealers[0].id==='atak-beko','beko bayi');

let threw=false;
try{
  lock.assertSaleBranchLock({
    stores,accounts,dealers,warehouses,salesperson:emine,
    dealer:dealers[0],
    payments:[{method:'Nakit',accountId:'beko-kasa',amount:100}]
  });
}catch(e){threw=true;assert(/İstikbal/.test(e.message),'istikbal hata metni')}
assert(threw,'beko kasa + beko bayi emine için reddedilir');

lock.assertSaleBranchLock({
  stores,accounts,dealers,warehouses,salesperson:emine,
  dealer:dealers[1],
  payments:[{method:'Nakit',accountId:'ist-kasa',amount:100},{method:'Havale',accountId:'qnb',amount:50}],
  warehouseId:'ist-depo'
});

threw=false;
try{
  lock.assertSaleBranchLock({
    stores,accounts,dealers,warehouses,salesperson:emine,
    dealer:dealers[1],
    payments:[],
    warehouseId:'beko-depo'
  });
}catch(e){threw=true}
assert(threw,'beko depo emine için reddedilir');

const s={
  stores,users:[{id:'u1',name:'Emine Yakışır',storeId:'istikbal-atak'}],staff:[],
  financeAccounts:accounts
};
assert(lock.lockBrandForActor(s,{id:'u1',storeId:'beko-atak'})==='istikbal','oturum fallback storeId yok sayılır');
assert(lock.lockBrandForActor(s,{id:'system-owner',role:'owner',storeId:'beko-atak'})==='','owner actor kilit yok');

const scoped=lock.filterAccountsForActor(s,{id:'u1'},accounts,{staffPortal:true});
assert(scoped.some(a=>a.id==='ist-kasa')&&!scoped.some(a=>a.id==='beko-kasa'),'tahsilat kasası kilitli');
assert(scoped.some(a=>a.id==='qnb'),'ortak banka tahsilatta durur');

threw=false;
try{
  lock.assertAccountBrandLock(s,{id:'u1'},accounts[0],{staffPortal:true});
}catch(e){threw=true}
assert(threw,'personel beko kasaya tahsilat yazamaz');

lock.assertAccountBrandLock(s,{id:'u1'},accounts.find(a=>a.id==='ist-kasa'),{staffPortal:true});
lock.assertAccountBrandLock(s,{id:'u1'},accounts[0],{staffPortal:false});

const noIstCash=accounts.filter(a=>a.id!=='ist-kasa');
const fallback=lock.filterCashAccounts(noIstCash,stores,'istikbal');
assert(fallback.length===1 && fallback[0].id==='merkez-kasa','istikbal kasası yoksa markasız kasa');

console.log('OK branch-lock tests passed');
