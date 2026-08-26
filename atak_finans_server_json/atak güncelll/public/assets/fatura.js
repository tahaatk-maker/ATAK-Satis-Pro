/* ATAK_FATURA_BUILD=fix-v277 */
const q=(s,r=document)=>r.querySelector(s);
const qa=(s,r=document)=>[...r.querySelectorAll(s)];
let state={view:'pending_sales',data:null,selected:new Set(),portal:'admin',canSetup:true,canIssue:true};

function toast(t){const el=q('#toast');if(!el)return;el.textContent=t;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),2600)}
function salesMoney(n){return new Intl.NumberFormat('tr-TR',{style:'currency',currency:'TRY',minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(n||0))}
function invEsc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function invoiceKeepPending(err){
  return !!(err && (err.status===409 || err.payload?.keepPending || err.payload?.eva));
}
function invStatusBadge(st){
  const s=String(st||'pending');
  const label={pending:'Bekliyor',ready:'Hazır',queued:'Kuyruk',draft_sent:'Taslak',queued_remote:'Portal kuyruk',issued:'Kesildi',error:'Hatalı',cancelled:'İptal',archived:'Arşiv'}[s]||s;
  return `<span class="inv-badge ${invEsc(s)}">${invEsc(label)}</span>`;
}
async function api(url,opt={}){
  const r=await fetch(url,{credentials:'same-origin',...opt});
  const text=await r.text();
  let d={};try{d=JSON.parse(text||'{}')}catch(_){d={}}
  if(r.status===401){
    const err=new Error('Oturum yok');
    err.status=401;
    throw err;
  }
  if(!r.ok){
    const err=new Error(d.error||'İşlem başarısız');
    err.status=r.status;
    err.payload=d;
    throw err;
  }
  return d;
}

function applyAccessUi(){
  q('#invIssueSelectedBtn')?.classList.toggle('hidden',!state.canIssue);
  q('#invFirmBox')?.classList.toggle('hidden',!state.canSetup);
  if(q('#backLink'))q('#backLink').href=state.portal==='staff'?'/personel':'/web-admin';
}

async function boot(){
  try{
    let me=null;
    try{me=await api('/web-api/me')}catch(_){me=null}
    if(me?.authenticated){
      state.portal='admin';
      state.canSetup=true;
      state.canIssue=true;
    }else{
      const staff=await api('/foundation-api/me');
      if(!staff.authenticated){q('#gate').classList.remove('hidden');return}
      const p=staff.user?.permissions||[];
      const has=(id)=>p.includes('*')||p.includes(id);
      state.portal='staff';
      state.canSetup=has('settings_manage')||has('invoices_manage');
      state.canIssue=has('sale_invoice_qnb')||has('invoices_manage')||has('finance_manage')||has('screen_sales_center')||has('orders_manage')||has('*');
      if(!(has('screen_invoice_center')||has('invoices_manage')||has('sale_invoice_qnb')||has('screen_uninvoiced')||has('finance_manage')||has('orders_manage')||has('screen_sales_center'))){
        q('#gate').classList.remove('hidden');
        q('#gate p').textContent='Fatura ekranı yetkiniz kapalı.';
        return;
      }
    }
    applyAccessUi();
    q('#app').classList.remove('hidden');
    await loadInvoiceCenter();
  }catch(_){
    q('#gate').classList.remove('hidden');
  }
}

function invApplySearch(rows){
  const term=String(q('#invSearch')?.value||'').toLocaleLowerCase('tr-TR').trim();
  const from=String(q('#invDateFrom')?.value||'').trim();
  const to=String(q('#invDateTo')?.value||'').trim();
  const dealer=String(q('#invDealer')?.value||'').trim();
  return (rows||[]).filter(r=>{
    if(from && String(r.date||'')<from)return false;
    if(to && String(r.date||'')>to)return false;
    if(dealer && String(r.dealerId||'')!==dealer && String(r.dealerName||'')!==dealer)return false;
    if(!term)return true;
    const hay=`${r.reference||''} ${r.customerName||''} ${r.id||''} ${r.dealerName||''}`.toLocaleLowerCase('tr-TR');
    return hay.includes(term);
  });
}
function invFillDealerFilter(rows){
  const sel=q('#invDealer');if(!sel)return;
  const current=sel.value;
  const map=new Map();
  (rows||[]).forEach(r=>{
    const id=String(r.dealerId||r.dealerName||'').trim();
    if(!id)return;
    if(!map.has(id))map.set(id,r.dealerName||id);
  });
  sel.innerHTML='<option value="">Tüm bayiler</option>'+[...map.entries()].map(([id,name])=>`<option value="${invEsc(id)}">${invEsc(name)}</option>`).join('');
  if(current && [...sel.options].some(o=>o.value===current))sel.value=current;
}

function openInvoiceDoc(row){
  const w=window.open(`/web-api/admin/sale/${encodeURIComponent(row.id)}/invoice-print`,'_blank','noopener');
  if(!w)toast('Tarayıcı yeni sekmeyi engelledi');
}

function invRenderTable(rows){
  const head=q('#invTableHead'),body=q('#invTableBody'),empty=q('#invEmpty');
  const issueBtns=state.canIssue;
  if(head)head.innerHTML=`<tr><th></th><th>Müşteri</th><th>Tarih</th><th>Tutar</th><th></th></tr>`;
  if(body)body.innerHTML=rows.map(r=>`<tr data-inv-id="${invEsc(r.id)}">
      <td><input type="checkbox" data-inv-check="${invEsc(r.id)}"/></td>
      <td><b>${invEsc(r.customerName||'-')}</b><small style="display:block;color:#667890">${invEsc(r.reference||'')}${r.dealerName?' · '+invEsc(r.dealerName):''}</small></td>
      <td>${invEsc(r.date||'-')}</td>
      <td>${salesMoney(r.total)}</td>
      <td>
        ${issueBtns?`<button type="button" class="inv-btn primary" data-inv-qnb="${invEsc(r.id)}">Kes</button>`:''}
      </td>
    </tr>`).join('');
  empty?.classList.toggle('hidden',rows.length>0);
  if(q('#invFootCount'))q('#invFootCount').textContent=`${rows.length} fatura`;
  state.selected=new Set();
  qa('[data-inv-check]').forEach(chk=>chk.onchange=()=>{
    const id=chk.dataset.invCheck;
    if(chk.checked)state.selected.add(id);else state.selected.delete(id);
    chk.closest('tr')?.classList.toggle('selected',chk.checked);
  });
  qa('#invTableBody tr[data-inv-id]').forEach(tr=>{
    tr.classList.add('clickable');
    tr.addEventListener('click',e=>{
      if(e.target.closest('button,input,a,label'))return;
      const row=rows.find(x=>String(x.id)===String(tr.dataset.invId));
      if(row)openInvoiceDoc(row);
    });
  });
  qa('[data-inv-qnb]').forEach(btn=>btn.onclick=async()=>{
    try{
      const out=await api('/web-api/admin/sale/'+encodeURIComponent(btn.dataset.invQnb)+'/issue-invoice',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
      toast(out.result?.message||'Fatura Digital Planet’e gönderildi');await loadInvoiceCenter();
    }catch(e){
      toast(e.message);
      if(invoiceKeepPending(e))await loadInvoiceCenter();
    }
  });
}

function invPaintCurrentView(){
  const rows=invApplySearch(state.data?.salesPending||[]);
  invRenderTable(rows);
  if(q('#invFootStatus'))q('#invFootStatus').textContent=state.data?.note||'Aktarım: Rapid360 geteinvoices · Kes = Digital Planet SOAP';
}

async function loadInvoiceCenter(){
  try{
    const d=await api('/web-api/admin/invoice-center');
    state.data=d;
    if(d.canSetup!=null)state.canSetup=!!d.canSetup;
    if(d.canIssue!=null)state.canIssue=!!d.canIssue;
    applyAccessUi();
    fillDigitalPlanet(d.settings?.digitalPlanet||{});
    const url=d.settings?.atakDms?.copyUrl||'';
    if(q('#atakDmsCopyUrl'))q('#atakDmsCopyUrl').value=url;
    invFillDealerFilter(d.salesPending||[]);
    invPaintCurrentView();
  }catch(e){
    if(q('#invFootStatus'))q('#invFootStatus').textContent=e.message;
    toast(e.message);
  }
}

q('#invRefreshBtn')?.addEventListener('click',()=>loadInvoiceCenter());
q('#invSearch')?.addEventListener('input',()=>invPaintCurrentView());
q('#invDateFrom')?.addEventListener('change',()=>invPaintCurrentView());
q('#invDateTo')?.addEventListener('change',()=>invPaintCurrentView());
q('#invDealer')?.addEventListener('change',()=>invPaintCurrentView());
q('#invIssueSelectedBtn')?.addEventListener('click',async()=>{
  if(!state.canIssue)return toast('Fatura kesme yetkiniz yok');
  const ids=[...state.selected];
  if(!ids.length)return toast('Önce satır seçin');
  let sent=0,kept=0;
  for(const id of ids){
    try{await api('/web-api/admin/sale/'+encodeURIComponent(id)+'/issue-invoice',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});sent++}
    catch(e){if(invoiceKeepPending(e))kept++}
  }
  toast(kept?`${sent} kesildi · ${kept} Faturalar listesinde kaldı (Rapid360 Rapid Veri Çek kessin)`:`${sent} satış kesildi`);
  await loadInvoiceCenter();
});

function fillDigitalPlanet(d){
  if(q('#dpCorporateCode'))q('#dpCorporateCode').value=d.corporateCode||'';
  if(q('#dpLoginName'))q('#dpLoginName').value=d.loginName||'';
  if(q('#dpPassword'))q('#dpPassword').value=d.password||'';
  if(q('#dpEnvironment'))q('#dpEnvironment').value=d.environment||'live';
  if(q('#dpTemplateCode'))q('#dpTemplateCode').value=d.templateCode||'';
  if(q('#dpMapCode'))q('#dpMapCode').value=d.mapCode||'';
  if(q('#dpServiceUrl'))q('#dpServiceUrl').value=d.serviceUrl||'';
  if(q('#dpPostbox'))q('#dpPostbox').value=d.receiverPostboxName||'';
  if(q('#dpReadyNote')){
    q('#dpReadyNote').textContent=d.ready
      ?`Hazır: ${d.corporateCode} · ${d.loginName}. Satırdaki Kes NetInvoice SOAP ile yollar.`
      :'SOAP yoksa Kes sahte kuyruk yazmaz. Fatura aktarımı yukarıdaki Rapid360 geteinvoices URL’si ile olur — EVA Rapid Veri Çek.';
  }
}
function dpPayload(){
  return {
    digitalPlanet:{
      enabled:true,
      corporateCode:q('#dpCorporateCode')?.value||'',
      loginName:q('#dpLoginName')?.value||'',
      password:q('#dpPassword')?.value||'',
      environment:q('#dpEnvironment')?.value||'live',
      templateCode:q('#dpTemplateCode')?.value||'',
      mapCode:q('#dpMapCode')?.value||'',
      serviceUrl:q('#dpServiceUrl')?.value||'',
      receiverPostboxName:q('#dpPostbox')?.value||''
    }
  };
}
q('#dpSaveBtn')?.addEventListener('click',async()=>{
  if(!state.canSetup)return toast('Kurulum yetkiniz yok');
  try{
    const r=await api('/web-api/admin/invoice-integration',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({provider:'digital-planet',...dpPayload()})});
    toast('Dijital Planet kaydedildi');
    fillDigitalPlanet(r.settings?.digitalPlanet||dpPayload().digitalPlanet);
    await loadInvoiceCenter();
  }catch(e){toast(e.message)}
});
q('#dpTestBtn')?.addEventListener('click',async()=>{
  if(!state.canSetup)return toast('Kurulum yetkiniz yok');
  try{
    const r=await api('/web-api/admin/invoice-integration/digital-planet-test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(dpPayload().digitalPlanet)});
    toast(r.message||'Giriş başarılı');
  }catch(e){toast(e.message)}
});
q('#atakDmsCopyBtn')?.addEventListener('click',async()=>{
  const url=String(q('#atakDmsCopyUrl')?.value||'').trim();
  if(!url || url.indexOf('client_id=')<0 || url.indexOf('client_secret=')<0)return toast('Hazır URL tam değil, sayfayı yenileyin');
  try{
    await navigator.clipboard.writeText(url);
    toast('Rapid360 geteinvoices URL kopyalandı');
  }catch(_){
    q('#atakDmsCopyUrl')?.select();
    try{document.execCommand('copy');toast('Rapid360 geteinvoices URL kopyalandı')}catch(e){toast('Kopyalanamadı, metni elle alın')}
  }
});

boot();
