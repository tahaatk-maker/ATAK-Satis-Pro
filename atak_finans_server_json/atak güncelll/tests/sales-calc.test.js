/* Basit iskonto / prim hesap testi (Node) */
function calc({gross, discountPct, commissionPct, maxDisc}){
  discountPct=Math.max(0,Number(discountPct)||0);
  if(discountPct>100)discountPct=100;
  const discountAmount=Math.round(gross*(discountPct/100)*100)/100;
  const net=Math.round((gross-discountAmount)*100)/100;
  const commission=Math.round(net*(Number(commissionPct)||0)/100*100)/100;
  return{discountAmount,net,commission,overLimit:discountPct>maxDisc+0.0001};
}

function assert(cond,msg){if(!cond)throw new Error(msg)}

const a=calc({gross:10000,discountPct:7,commissionPct:0.5,maxDisc:10});
assert(a.discountAmount===700,'iskonto 700 olmalı');
assert(a.net===9300,'net 9300 olmalı');
assert(a.commission===46.5,'prim 46.5 olmalı (kuruş kaybolmamalı)');
assert(a.overLimit===false,'%7 nakit limit içinde');

const b=calc({gross:10000,discountPct:7,commissionPct:0.5,maxDisc:5});
assert(b.overLimit===true,'kartta %7 limit aşımı');

const c=calc({gross:186,discountPct:0,commissionPct:0.5,maxDisc:10});
assert(c.commission===0.93,'küçük tutarda prim yuvarlanmalı');

console.log('OK sales-calc tests passed');
