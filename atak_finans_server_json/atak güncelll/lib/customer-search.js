'use strict';

function isActiveCustomer(c){
  return !!(c&&c.active!==false&&!c.deletedAt);
}

function haystack(c){
  const name=String(c&&c.name||'');
  const phone=String(c&&c.phone||'');
  const hay=`${name} ${phone} ${c.taxNo||''} ${c.tckn||''} ${c.companyName||''} ${c.email||''} ${c.city||''} ${c.district||''} ${c.rapidCustAccount||''} ${c.customerCode||''}`.toLocaleLowerCase('tr-TR');
  const digits=`${phone}${c.taxNo||''}${c.tckn||''}${c.customerCode||''}`.replace(/\D/g,'');
  return {c,hay,digits,nameFold:name.toLocaleLowerCase('tr-TR')};
}

function matchEntry(entry,q,qDigits){
  if(q&&entry.hay.includes(q))return true;
  if(qDigits&&qDigits.length>=3&&entry.digits.includes(qDigits))return true;
  return false;
}

function attachIndex(store){
  const customers=(store&&store.customers)||[];
  if(store&&store.__custSearch&&store.__custSearch.n===customers.length)return store.__custSearch;
  const rows=[];
  for(const c of customers){
    if(!isActiveCustomer(c))continue;
    rows.push(haystack(c));
  }
  const idx={n:customers.length,rows};
  if(store)store.__custSearch=idx;
  return idx;
}

function searchIndex(store,opts={}){
  const q=String(opts.q||'').trim().toLocaleLowerCase('tr-TR');
  const id=String(opts.id||'').trim();
  const limit=Math.min(200,Math.max(1,Number(opts.limit)||40));
  const listAll=!!opts.listAll;
  const idx=attachIndex(store);
  if(id){
    const rows=idx.rows.filter(r=>String(r.c.id)===id);
    return {total:rows.length,entries:rows,needQuery:false};
  }
  if(!q){
    if(!listAll)return {total:idx.rows.length,entries:[],needQuery:true};
    return {total:idx.rows.length,entries:idx.rows.slice(0,limit),needQuery:false};
  }
  const qDigits=q.replace(/\D/g,'');
  const hits=[];
  for(const r of idx.rows){
    if(matchEntry(r,q,qDigits))hits.push(r);
  }
  hits.sort((a,b)=>{
    const ap=a.nameFold.startsWith(q)?0:1;
    const bp=b.nameFold.startsWith(q)?0:1;
    if(ap!==bp)return ap-bp;
    if(a.nameFold<b.nameFold)return -1;
    if(a.nameFold>b.nameFold)return 1;
    return 0;
  });
  return {total:hits.length,entries:hits.slice(0,limit),needQuery:false};
}

module.exports={isActiveCustomer,haystack,matchEntry,attachIndex,searchIndex};
