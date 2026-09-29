function allocated(parts){return Math.round(parts.reduce((a,n)=>a+n,0)*100)/100}
function okEqual(net, parts){return Math.abs(allocated(parts)-net)<0.009}

function assert(c,m){if(!c)throw new Error(m)}

// 100000 = 30k kart + 30k senet + 30k nakit + 10k havale
assert(okEqual(100000,[30000,30000,30000,10000]),'örnek dağılım eşit olmalı');
assert(!okEqual(100000,[30000,30000,30000]),'eksik dağılım reddedilmeli');

// taksit bölme
function schedule(total,count){
  const base=Math.floor((total/count)*100)/100;let rem=Math.round(total*100)/100;const rows=[];
  for(let i=0;i<count;i++){const amt=i===count-1?Math.round(rem*100)/100:base;rem=Math.round((rem-amt)*100)/100;rows.push(amt)}
  return rows;
}
const s=schedule(30000,3);
assert(s.length===3,'3 taksit');
assert(Math.round(s.reduce((a,b)=>a+b,0)*100)/100===30000,'taksit toplamı 30000');

console.log('OK multi-pay tests passed');
