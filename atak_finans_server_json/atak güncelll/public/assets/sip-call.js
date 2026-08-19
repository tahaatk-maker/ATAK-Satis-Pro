/* ATAK_SIP_BUILD=fix-v176 — MicroSIP tıkla-ara (sip: bağlantısı) */
(function(root){
  function sipDigits(raw){
    let d=String(raw==null?'':raw).replace(/\D+/g,'');
    if(!d)return '';
    if(d.startsWith('00'))d=d.slice(2);
    if(d.startsWith('90')&&d.length>=12)d='0'+d.slice(2);
    if(d.length===10)d='0'+d;
    if(d.length<10)return '';
    return d;
  }
  function sipHref(raw){
    const d=sipDigits(raw);
    return d?('sip:'+d):'';
  }
  function sipCallButton(raw,opts){
    opts=opts||{};
    const href=sipHref(raw);
    const label=opts.label||'Ara';
    const extra=opts.className?(' '+opts.className):'';
    const cid=opts.customerId?` data-customer-id="${String(opts.customerId).replace(/"/g,'')}"`:'';
    if(!href){
      return `<button type="button" class="sip-call-btn is-off${extra}" disabled title="Telefon yok">${label}</button>`;
    }
    return `<a class="sip-call-btn${extra}" href="${href}" title="MicroSIP ile ara"${cid}>${label}</a>`;
  }
  function bindSipCallClicks(doc){
    const d=doc||(typeof document!=='undefined'?document:null);
    if(!d||d.__atakSipBound)return;
    d.__atakSipBound=true;
    d.addEventListener('click',e=>{
      const a=e.target.closest&&e.target.closest('a.sip-call-btn');
      if(!a)return;
      e.stopPropagation();
      if(a.classList.contains('is-off')||a.getAttribute('aria-disabled')==='true'){
        e.preventDefault();
        if(typeof root.toast==='function')root.toast('Müşterinin telefonu yok');
        return;
      }
      if(typeof root.atakOnSipCall==='function'){
        try{root.atakOnSipCall({href:a.getAttribute('href')||'',customerId:a.getAttribute('data-customer-id')||''});}catch(_){}
      }
    });
  }
  const api={sipDigits,sipHref,sipCallButton,bindSipCallClicks};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  root.sipDigits=sipDigits;
  root.sipHref=sipHref;
  root.sipCallButton=sipCallButton;
  root.bindSipCallClicks=bindSipCallClicks;
  if(typeof document!=='undefined'){
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>bindSipCallClicks(document));
    else bindSipCallClicks(document);
  }
})(typeof window!=='undefined'?window:globalThis);
