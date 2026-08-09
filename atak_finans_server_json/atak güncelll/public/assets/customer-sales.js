/* ATAK Satış Merkezi — çoklu ödeme + iskonto/prim canlı hesap */
(function(){
  function run(){try{(window.salesCalculate||salesCalculate)()}catch(_){}}
  function bind(el,ev,fn){if(!el)return;el.addEventListener(ev,fn)}
  ['#salesDiscountPct','#payCash','#payCard','#payTransfer','#payCredit','#payNote','#salesDealer'].forEach(sel=>{
    const el=document.querySelector(sel);
    ['input','change','keyup'].forEach(ev=>bind(el,ev,run));
  });
  ['#salesPromissoryInstallments','#salesPromissoryInterval','#salesPromissoryFirstDue'].forEach(sel=>{
    const el=document.querySelector(sel);
    ['input','change'].forEach(ev=>bind(el,ev,()=>{try{(window.salesRenderPromissorySchedule||salesRenderPromissorySchedule)()}catch(_){}}));
  });
  document.addEventListener('input',e=>{
    if(e.target&&(e.target.classList.contains('sales-qty')||e.target.classList.contains('sales-price')))run();
  });
  setTimeout(run,50);
})();
