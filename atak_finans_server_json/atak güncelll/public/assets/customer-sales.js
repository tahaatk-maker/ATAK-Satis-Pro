/* ATAK Satış Merkezi — iskonto/prim canlı hesap (admin.js üzerine güvenli katman) */
(function(){
  if(typeof window.salesCalculate!=='function' && typeof salesCalculate!=='function')return;
  // admin.js zaten güncel salesCalculate sağlıyor; ekstra bağlar kuruş/ondalık ve limit uyarısını garanti eder.
  function bind(el,ev,fn){if(!el)return;el.addEventListener(ev,fn)}
  const disc=document.querySelector('#salesDiscountPct');
  const dealer=document.querySelector('#salesDealer');
  const method=document.querySelector('#salesPaymentMethod');
  const paid=document.querySelector('#salesPaidAmount');
  const run=()=>{try{(window.salesCalculate||salesCalculate)()}catch(_){}};
  ['input','change','keyup'].forEach(ev=>{
    bind(disc,ev,run);bind(dealer,ev,run);bind(method,ev,run);bind(paid,ev,run);
  });
  document.addEventListener('input',e=>{
    if(e.target&&(e.target.classList.contains('sales-qty')||e.target.classList.contains('sales-price')))run();
  });
  setTimeout(run,50);
})();
