/* Havale satışta tahsil sayılmaz; Ödemeler’den düşülür */
function isImmediatePayMethod(method){
  return ['Nakit','Kredi Kartı'].includes(String(method||'').trim());
}
function isHavaleMethod(method){
  return String(method||'').trim()==='Havale';
}
function relatedSaleCollections(s,sale){
  const ids=new Set([String(sale.collectionId||''),...((sale.collectionIds||[]).map(String))].filter(Boolean));
  return (s.financeTransactions||[]).filter(t=>t.kind==='collection'&&!t.cancelled&&ids.has(String(t.id)));
}
function saleHavaleRemain(s,sale,payment){
  const amt=Math.round(Number(payment?.amount||0)*100)/100;
  const marked=Math.round(Number(payment?.collectedAmount||0)*100)/100;
  const cols=relatedSaleCollections(s,sale).filter(c=>isHavaleMethod(c.category));
  const legacy=Math.round(cols.reduce((a,c)=>a+Number(c.amount||0),0)*100)/100;
  return Math.max(0,Math.round((amt-Math.max(marked,legacy))*100)/100);
}
function pendingHavaleForCustomer(s,customerId){
  const cid=String(customerId||'');
  const out=[];
  for(const sale of (s.financeTransactions||[])){
    if(sale.kind!=='sale'||sale.cancelled)continue;
    if(cid&&String(sale.customerId)!==cid)continue;
    for(const p of (sale.payments||[])){
      if(!isHavaleMethod(p.method))continue;
      const remain=saleHavaleRemain(s,sale,p);
      if(remain<=0.009)continue;
      out.push({saleId:sale.id,remain,accountId:p.accountId||''});
    }
  }
  return out;
}
function applyPaymentToPendingHavale(s,customerId,amount,collectionId){
  let left=Math.round(Number(amount||0)*100)/100;
  const updated=[];
  const items=pendingHavaleForCustomer(s,customerId);
  for(const item of items){
    if(left<=0.009)break;
    const sale=s.financeTransactions.find(t=>t.id===item.saleId);
    const p=(sale.payments||[]).find(x=>isHavaleMethod(x.method)&&saleHavaleRemain(s,sale,x)>0.009);
    const remain=saleHavaleRemain(s,sale,p);
    const pay=Math.min(left,remain);
    p.collectedAmount=Math.round((Number(p.collectedAmount||0)+pay)*100)/100;
    p.lastCollectionId=collectionId;
    left=Math.round((left-pay)*100)/100;
    updated.push({saleId:sale.id,applied:pay});
  }
  return{updated,remaining:left};
}
function assert(cond,msg){if(!cond)throw new Error(msg)}

assert(isImmediatePayMethod('Nakit')&&isImmediatePayMethod('Kredi Kartı'),'nakit/kart anında');
assert(!isImmediatePayMethod('Havale'),'havale anında değil');

const s={
  financeTransactions:[
    {id:'sale1',kind:'sale',customerId:'c1',cancelled:false,collectionIds:[],
      payments:[{method:'Havale',amount:15000,accountId:'qnb',pending:true,collectedAmount:0}]},
    {id:'sale2',kind:'sale',customerId:'c1',cancelled:false,collectionIds:['old-h'],
      payments:[{method:'Havale',amount:5000,accountId:'qnb'}]},
    {id:'old-h',kind:'collection',category:'Havale',amount:5000,cancelled:false}
  ]
};
assert(pendingHavaleForCustomer(s,'c1').length===1,'eski tahsil edilmiş havale listede yok');
assert(pendingHavaleForCustomer(s,'c1')[0].remain===15000,'yeni havale 15000 bekler');

const r=applyPaymentToPendingHavale(s,'c1',4000,'col1');
assert(r.updated[0].applied===4000,'kısmi tahsil');
assert(pendingHavaleForCustomer(s,'c1')[0].remain===11000,'kalan 11000');
applyPaymentToPendingHavale(s,'c1',11000,'col2');
assert(pendingHavaleForCustomer(s,'c1').length===0,'tam tahsil kapanır');

console.log('OK havale-odeme tests passed');
