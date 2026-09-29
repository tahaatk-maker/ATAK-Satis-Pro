/* Basit iskonto / prim hesap testi (Node) — limit yok */
function calc({gross, discountPct, commissionPct}){
  discountPct=Math.min(100,Math.max(0,Number(discountPct)||0));
  const discountAmount=Math.round(gross*(discountPct/100)*100)/100;
  const net=Math.round((gross-discountAmount)*100)/100;
  const commission=Math.round(net*(Number(commissionPct)||0)/100*100)/100;
  return{discountAmount,net,commission};
}

function assert(cond,msg){if(!cond)throw new Error(msg)}

const a=calc({gross:10000,discountPct:7,commissionPct:0.5});
assert(a.discountAmount===700,'iskonto 700 olmalı');
assert(a.net===9300,'net 9300 olmalı');
assert(a.commission===46.5,'prim 46.5 olmalı');

const b=calc({gross:20000,discountPct:5,commissionPct:0.5});
assert(b.discountAmount===1000,'iskonto 1000');
assert(b.net===19000,'net 19000');
assert(b.commission===95,'prim 95');

// Kart/nakit fark etmez: yüksek iskonto da uygulanır
const c=calc({gross:10000,discountPct:15,commissionPct:0.5});
assert(c.discountAmount===1500,'serbest iskonto %15');
assert(c.net===8500,'net 8500');

console.log('OK sales-calc tests passed');
