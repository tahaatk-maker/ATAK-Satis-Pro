'use strict';

const METHOD_LABELS={
  nakit:'Nakit',
  'kredi kartı':'Kredi Kartı',
  'kredi karti':'Kredi Kartı',
  kart:'Kredi Kartı',
  pos:'Kredi Kartı',
  havale:'Havale',
  eft:'Havale',
  'havale/eft':'Havale',
  vadeli:'Cari',
  cari:'Cari',
  senet:'Senet'
};

function moneyTR(n){
  return new Intl.NumberFormat('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(n||0));
}

function methodLabel(method){
  const key=String(method||'').trim().toLocaleLowerCase('tr-TR').replace(/\s+/g,' ');
  return METHOD_LABELS[key]||String(method||'').trim()||'Ödeme';
}

function addPayment(rows,method,amount){
  const amt=Math.round(Number(amount||0)*100)/100;
  if(!(amt>0))return;
  const label=methodLabel(method);
  const key=label.toLocaleLowerCase('tr-TR');
  const existing=rows.find(r=>r.key===key);
  if(existing){
    existing.amount=Math.round((existing.amount+amt)*100)/100;
    return;
  }
  rows.push({key,label,amount:amt});
}

function collectPayments(sale={}){
  const rows=[];
  const payments=Array.isArray(sale.payments)?sale.payments:[];
  for(const p of payments)addPayment(rows,p&&p.method,p&&p.amount);
  const promissoryAmt=Number(sale.promissory&&sale.promissory.amount||0);
  if(promissoryAmt>0&&!rows.some(r=>r.key==='senet'))addPayment(rows,'Senet',promissoryAmt);
  return rows;
}

function formatInvoicePaymentNote(sale={}){
  const rows=collectPayments(sale);
  if(rows.length){
    return 'Ödeme: '+rows.map(r=>`${moneyTR(r.amount)} TL ${r.label}`).join(', ');
  }
  return String(sale.paymentNote||'').trim();
}

module.exports={
  formatInvoicePaymentNote,
  collectPayments,
  methodLabel,
  moneyTR
};
