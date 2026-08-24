'use strict';

function foldTr(s){
  return String(s||'')
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g,'i')
    .replace(/i̇/g,'i')
    .replace(/ğ/g,'g')
    .replace(/ü/g,'u')
    .replace(/ş/g,'s')
    .replace(/ö/g,'o')
    .replace(/ç/g,'c');
}

function brandKeyFromText(text){
  const t=foldTr(text);
  const hasIstikbal=t.includes('istikbal');
  const hasBeko=t.includes('beko');
  if(hasIstikbal && !hasBeko)return 'istikbal';
  if(hasBeko && !hasIstikbal)return 'beko';
  return '';
}

function brandLabel(brand){
  if(brand==='istikbal')return 'İstikbal';
  if(brand==='beko')return 'Beko';
  return '';
}

function findStore(stores,storeId){
  const id=String(storeId||'');
  if(!id)return null;
  return (stores||[]).find(s=>String(s.id)===id)||null;
}

function storeBrand(store){
  if(!store)return '';
  return brandKeyFromText(`${store.id||''} ${store.name||''} ${store.code||''}`);
}

function isUnlockedRole(person){
  if(!person)return true;
  if(String(person.id||'')==='system-owner')return true;
  return String(person.role||'').toLowerCase()==='owner';
}

function personBrand(person,stores){
  if(!person || isUnlockedRole(person))return '';
  const store=findStore(stores,person.storeId);
  return storeBrand(store);
}

function accountBrand(acc,stores){
  if(!acc)return '';
  const fromStore=storeBrand(findStore(stores,acc.storeId));
  if(fromStore)return fromStore;
  return brandKeyFromText(`${acc.id||''} ${acc.name||''}`);
}

function dealerBrand(dealer){
  if(!dealer)return '';
  return brandKeyFromText(`${dealer.id||''} ${dealer.name||''}`);
}

function warehouseBrand(wh,stores){
  if(!wh)return '';
  const fromStore=storeBrand(findStore(stores,wh.storeId));
  if(fromStore)return fromStore;
  return brandKeyFromText(`${wh.id||''} ${wh.name||''} ${wh.code||''}`);
}

function filterCashAccounts(accounts,stores,brand){
  const cash=(accounts||[]).filter(a=>a&&a.active!==false&&a.type==='cash');
  if(!brand)return cash;
  const match=cash.filter(a=>accountBrand(a,stores)===brand);
  if(match.length)return match;
  return cash.filter(a=>!accountBrand(a,stores));
}

function filterBankAccounts(accounts,stores,brand){
  const bank=(accounts||[]).filter(a=>a&&a.active!==false&&a.type==='bank');
  if(!brand)return bank;
  const allowed=bank.filter(a=>{
    const b=accountBrand(a,stores);
    return !b||b===brand;
  });
  if(allowed.length)return allowed;
  return bank.filter(a=>!accountBrand(a,stores));
}

function filterDealers(dealers,brand){
  const list=(dealers||[]).filter(d=>d&&d.active!==false);
  if(!brand)return list;
  const match=list.filter(d=>dealerBrand(d)===brand);
  return match.length?match:list;
}

function filterWarehouses(warehouses,stores,brand){
  const list=(warehouses||[]).filter(w=>w&&w.active!==false);
  if(!brand)return list;
  const match=list.filter(w=>warehouseBrand(w,stores)===brand);
  return match.length?match:list;
}

function lockBrandForActor(store,actor){
  if(!actor || isUnlockedRole(actor))return '';
  const users=store?.users||[];
  const staff=store?.staff||[];
  const user=users.find(u=>String(u.id)===String(actor.id))
    ||users.find(u=>String(u.username||'').toLocaleLowerCase('tr-TR')===String(actor.username||'').toLocaleLowerCase('tr-TR'));
  const st=staff.find(x=>String(x.id)===String(actor.id));
  const storeId=String((user&&user.storeId)||(st&&st.storeId)||'');
  if(!storeId)return '';
  return personBrand({id:actor.id,storeId},store?.stores||[]);
}

function decorateAccount(acc,stores){
  return Object.assign({},acc,{brand:accountBrand(acc,stores)});
}

function idSet(rows){
  return new Set((rows||[]).map(x=>String(x.id)));
}

function assertSaleBranchLock({stores,accounts,dealers,warehouses,salesperson,dealer,payments,warehouseId}){
  const brand=personBrand(salesperson,stores);
  if(!brand)return;
  const label=brandLabel(brand);
  const allowedDealers=filterDealers(dealers,brand);
  if(dealer && allowedDealers.length && !allowedDealers.some(d=>String(d.id)===String(dealer.id))){
    throw new Error(`Bu personel ${label} şubesine kilitli. Bayi olarak ${label} seçilmelidir.`);
  }
  const cashAllowed=filterCashAccounts(accounts,stores,brand);
  const bankAllowed=filterBankAccounts(accounts,stores,brand);
  for(const p of payments||[]){
    if(!p?.accountId)continue;
    const acc=(accounts||[]).find(a=>String(a.id)===String(p.accountId));
    if(!acc)continue;
    if(acc.type==='cash'){
      if(cashAllowed.length && !cashAllowed.some(a=>String(a.id)===String(acc.id))){
        throw new Error(`Bu personel ${label} şubesine kilitli. Nakit için ${label} kasası seçilmelidir.`);
      }
    }else if(acc.type==='bank'){
      if(bankAllowed.length && !bankAllowed.some(a=>String(a.id)===String(acc.id))){
        throw new Error(`Bu personel ${label} şubesine kilitli. Bu banka hesabı kullanılamaz.`);
      }
    }
  }
  if(warehouseId){
    const allowedWh=filterWarehouses(warehouses,stores,brand);
    if(allowedWh.length && !allowedWh.some(w=>String(w.id)===String(warehouseId))){
      throw new Error(`Bu personel ${label} şubesine kilitli. Depo olarak ${label} deposu seçilmelidir.`);
    }
  }
}

function assertAccountBrandLock(store,actor,account,{staffPortal=false}={}){
  if(!staffPortal || !account)return;
  const brand=lockBrandForActor(store,actor);
  if(!brand)return;
  const label=brandLabel(brand);
  const accounts=store?.financeAccounts||[];
  const stores=store?.stores||[];
  if(account.type==='cash'){
    const allowed=filterCashAccounts(accounts,stores,brand);
    if(allowed.length && !allowed.some(a=>String(a.id)===String(account.id))){
      throw new Error(`Bu personel ${label} şubesine kilitli. Sadece ${label} kasası seçilebilir.`);
    }
  }else if(account.type==='bank'){
    const allowed=filterBankAccounts(accounts,stores,brand);
    if(allowed.length && !allowed.some(a=>String(a.id)===String(account.id))){
      throw new Error(`Bu personel ${label} şubesine kilitli. Bu banka hesabı kullanılamaz.`);
    }
  }
}

function filterAccountsForActor(store,actor,accounts,{staffPortal=false}={}){
  if(!staffPortal)return accounts||[];
  const brand=lockBrandForActor(store,actor);
  if(!brand)return accounts||[];
  const cash=filterCashAccounts(accounts,store?.stores||[],brand);
  const bank=filterBankAccounts(accounts,store?.stores||[],brand);
  const keep=idSet(cash.concat(bank));
  return (accounts||[]).filter(a=>keep.has(String(a.id)));
}

module.exports={
  foldTr,
  brandKeyFromText,
  brandLabel,
  storeBrand,
  personBrand,
  accountBrand,
  dealerBrand,
  warehouseBrand,
  filterCashAccounts,
  filterBankAccounts,
  filterDealers,
  filterWarehouses,
  lockBrandForActor,
  decorateAccount,
  assertSaleBranchLock,
  assertAccountBrandLock,
  filterAccountsForActor
};
