'use strict';

const personName = require('./person-name');

function foldName(v){
  return String(v||'').replace(/\s+/g,' ').trim().toLocaleLowerCase('tr-TR')
    .replace(/ğ/g,'g').replace(/ü/g,'u').replace(/ş/g,'s')
    .replace(/ı/g,'i').replace(/ö/g,'o').replace(/ç/g,'c');
}

function personNameKey(input){
  const n=personName.normalizePersonName(input||{});
  if(!n.firstName||!n.lastName)return '';
  return foldName(n.firstName)+'|'+foldName(n.lastName);
}

function digits(v){return String(v||'').replace(/\D/g,'')}

function isActiveCustomer(c){
  return !!(c&&c.active!==false&&!c.deletedAt);
}

function findByPersonName(customers,payload){
  const key=personNameKey(payload);
  if(!key)return null;
  return (customers||[]).find(c=>isActiveCustomer(c)&&personNameKey(c)===key)||null;
}

function tcknOf(c){
  const d=digits(c&&c.tckn);
  return d.length===11?d:'';
}

function canMerge(a,b){
  const ta=tcknOf(a),tb=tcknOf(b);
  if(ta&&tb&&ta!==tb)return false;
  return true;
}

function filledCount(c){
  const keys=['phone','email','tckn','taxNo','taxOffice','companyName','address','city','district','customerCode','birthDate'];
  return keys.reduce((n,k)=>n+(String(c&&c[k]||'').trim()?1:0),0);
}

function pickKeeper(rows,txCountFn){
  const list=(rows||[]).filter(Boolean);
  if(!list.length)return null;
  return list.slice().sort((a,b)=>{
    const txA=txCountFn?Number(txCountFn(a)||0):0;
    const txB=txCountFn?Number(txCountFn(b)||0):0;
    if(txB!==txA)return txB-txA;
    const fill=filledCount(b)-filledCount(a);
    if(fill)return fill;
    return String(a.createdAt||'').localeCompare(String(b.createdAt||''));
  })[0];
}

const EMPTY_FILL_KEYS=[
  'firstName','lastName','name','phone','email','birthDate','tckn','taxNo','taxOffice',
  'city','district','address','deliveryCity','deliveryDistrict','deliveryAddress',
  'companyName','companyAddress','companyCity','companyDistrict','workPhone',
  'customerCode','note'
];

function isBlankField(v){
  const s=String(v??'').trim();
  return !s || /^(null|n\/a|undefined|#n\/a|-)$/i.test(s);
}
function fillEmptyFields(target,source){
  if(!target||!source)return target;
  for(const key of EMPTY_FILL_KEYS){
    const cur=String(target[key]||'').trim();
    const next=String(source[key]||'').trim();
    if(!isBlankField(cur)||isBlankField(next))continue;
    if(key==='note')target.note=next;
    else target[key]=source[key];
  }
  if(String(target.note||'').trim()&&String(source.note||'').trim()&&!String(target.note).includes(String(source.note).trim())){
    target.note=[String(target.note).trim(),String(source.note).trim()].filter(Boolean).join(' · ');
  }
  if(!target.invoiceType&&source.invoiceType)target.invoiceType=source.invoiceType;
  if(target.invoiceType!=='corporate'&&source.invoiceType==='corporate')target.invoiceType='corporate';
  return target;
}

function reassignCustomerId(store,fromId,toId){
  const from=String(fromId||''),to=String(toId||'');
  if(!from||!to||from===to)return 0;
  let n=0;
  const bump=row=>{
    if(!row||String(row.customerId||'')!==from)return;
    row.customerId=to;
    n++;
  };
  (store.financeTransactions||[]).forEach(bump);
  (store.promissoryNotes||[]).forEach(bump);
  (store.customerComms||[]).forEach(bump);
  (store.smsLogs||[]).forEach(bump);
  (store.invoiceQueue||[]).forEach(bump);
  (store.cancellationRequests||[]).forEach(row=>{
    if(!row)return;
    if(String(row.targetType||'').startsWith('customer')&&String(row.targetId||'')===from){
      row.targetId=to;
      n++;
    }
  });
  return n;
}

function collapseDuplicateCustomersByName(store){
  const customers=store&&Array.isArray(store.customers)?store.customers:[];
  const groups=new Map();
  for(const c of customers){
    if(!isActiveCustomer(c))continue;
    const key=personNameKey(c);
    if(!key)continue;
    const list=groups.get(key)||[];
    list.push(c);
    groups.set(key,list);
  }
  const txCount=id=>{
    const cid=String(id||'');
    return (store.financeTransactions||[]).filter(t=>String(t.customerId||'')===cid).length;
  };
  let merged=0;
  const now=new Date().toISOString();
  for(const list of groups.values()){
    if(list.length<2)continue;
    const keeper=pickKeeper(list,c=>txCount(c.id));
    if(!keeper)continue;
    for(const extra of list){
      if(extra===keeper||String(extra.id)===String(keeper.id))continue;
      if(!canMerge(keeper,extra))continue;
      fillEmptyFields(keeper,extra);
      reassignCustomerId(store,extra.id,keeper.id);
      extra.active=false;
      extra.deletedAt=now;
      extra.mergedInto=keeper.id;
      extra.updatedAt=now;
      merged++;
    }
  }
  return {merged};
}

module.exports={
  foldName,personNameKey,findByPersonName,canMerge,pickKeeper,
  isBlankField,fillEmptyFields,reassignCustomerId,collapseDuplicateCustomersByName
};
