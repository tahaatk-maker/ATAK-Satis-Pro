/* ATAK_PERSONEL_BUILD=fix-v28 */
const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const money=v=>new Intl.NumberFormat('tr-TR',{style:'currency',currency:'TRY',maximumFractionDigits:2}).format(Number(v||0));
let activeSalesDraft=null;

async function api(url,opt={}){
  const r=await fetch(url,{credentials:'same-origin',...opt});
  const ct=String(r.headers.get('content-type')||'');
  const text=await r.text();
  let d={};
  if(ct.includes('application/json')||/^\s*[{[]/.test(text)){
    try{d=JSON.parse(text||'{}')}catch(_){d={}}
  }else if(r.redirected||/^\s*</.test(text)){
    throw new Error('API bulunamadı (sunucu güncellemesi gerekli)');
  }
  if(!r.ok)throw new Error(d.error||'İşlem başarısız');
  return d;
}

let currentUser=null;
let financeData=null;
let monthData=null;
let salesData=null;
let salesCustomers=[];
let salesCustomerTotal=0;
let salesAccounts=[];
let salesCart=[];
let salesStep=1;
let lastSaleDocsUrl='';
let cancelDraft=null;

function currentMonthValue(){
  const d=new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}

const PERM_ALIASES={
  screen_sales_center:['sales_manage','orders_manage'],
  screen_my_sales:['own_sales_view'],
  screen_staff_sales_report:['sales_reports_view'],
  screen_manager_approvals:['cancellations_approve'],
  screen_customers:['customers_manage'],
  screen_customer_payments:['finance_view'],
  screen_finance:['finance_view','finance_manage'],
  screen_invoice_center:['invoices_manage'],
  screen_uninvoiced:['invoices_manage'],
  screen_sales_tracking:['sales_manage','orders_manage']
};
function has(permission){
  const p=currentUser?.permissions||[];
  if(p.includes('*')||p.includes(permission))return true;
  return (PERM_ALIASES[permission]||[]).some(a=>p.includes(a));
}
function canFinance(){
  return has('screen_finance')||has('finance_manage')||has('finance_view')||has('orders_manage')||has('customers_manage');
}
function canScreen(id){return has(id)}
function canSaleDocs(){return has('sale_docs')||has('*')}
function canSaleOffer(){return has('sale_offer')||has('*')}
function canSaleInvoice(){return has('sale_invoice_qnb')||has('finance_manage')||has('invoices_manage')||has('*')}
function canDeductStock(){return has('sale_deduct_stock')||has('stock_manage')||has('*')}
function applyStaffSalePermissions(){
  $$('[data-need-perm]').forEach(el=>{
    const need=el.getAttribute('data-need-perm');
    let ok=true;
    if(need==='sale_docs')ok=canSaleDocs();
    else if(need==='sale_offer')ok=canSaleOffer();
    else if(need==='sale_invoice_qnb')ok=canSaleInvoice();
    else if(need==='sale_deduct_stock')ok=canDeductStock();
    else ok=has(need);
    el.classList.toggle('perm-locked',!ok);
    el.classList.toggle('hidden',need==='sale_deduct_stock'?!ok:false);
    if(el.tagName==='OPTION'){
      el.disabled=!ok;
      if(!ok && el.selected){
        const sel=el.parentElement;
        if(sel)sel.value='not_required';
      }
    }
  });
  // Docs/offer: sales role has them by default via sale_docs/sale_offer; still show cards for orders_manage
  $$('.pos-finish-card.docs').forEach(el=>el.classList.toggle('hidden',!canSaleDocs()));
  $$('.pos-finish-card.invoice').forEach(el=>el.classList.toggle('hidden',!canSaleInvoice()));
  $('#salesWizardOfferBtn')?.classList.toggle('hidden',!canSaleOffer());
}
function hidePanels(){
  ['#financePanel','#paymentsPanel','#salesPanel','#stockPanel','#announcementPanel'].forEach(x=>$(x)?.classList.add('hidden'));
  $('#home')?.classList.add('hidden');
  $('#salesStickyDock')?.classList.add('hidden');
}
function showHome(){
  hidePanels();
  $('#home').classList.remove('hidden');
}

async function loadSession(){
  try{
    const d=await api('/foundation-api/me');
    if(!d.authenticated)return showLogin();
    currentUser=d.user;
    $('#login').classList.add('hidden');
    $('#app').classList.remove('hidden');
    $('#welcome').textContent=`Hoş geldin, ${currentUser.name||currentUser.username}`;
    $('#roleName').textContent=currentUser.roleName||currentUser.role||'Personel';
    // Finans & Cari ekranları — her biri ayrı yetki
    if(canScreen('screen_sales_center')||has('orders_manage'))$('#salesCard').classList.remove('hidden');
    if(canScreen('screen_finance')||canFinance())$('#financeCard').classList.remove('hidden');
    if(canScreen('screen_customer_payments')||canFinance())$('#paymentsCard').classList.remove('hidden');
    if(has('stock_manage')||has('stock_view'))$('#stockCard').classList.remove('hidden');
    applyStaffSalePermissions();
    const closed=[];
    if(!canScreen('screen_staff_sales_report'))closed.push('Personel Satış Raporu');
    if(!canScreen('screen_manager_approvals'))closed.push('Yönetici Onayları');
    if(!canSaleInvoice())closed.push('Fatura Kes (QNB)');
    if(!canDeductStock())closed.push('Stok düş');
    if($('#permissionText')){
      $('#permissionText').textContent=closed.length
        ?`Açık ekranlar yetkinize göre. Kapalı: ${closed.join(', ')} — yönetici Kullanıcılar’dan açabilir.`
        :'Tüm Finans & Cari ekranları açık.';
    }
    showHome();
  }catch(_){showLogin()}
}
function showLogin(){
  $('#app').classList.add('hidden');
  $('#login').classList.remove('hidden');
}

$('#loginForm').onsubmit=async e=>{
  e.preventDefault();
  $('#loginError').textContent='';
  try{
    await api('/foundation-api/login',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({username:$('#username').value,password:$('#password').value})
    });
    await loadSession();
  }catch(err){$('#loginError').textContent=err.message}
};
$('#logout').onclick=async()=>{
  await api('/foundation-api/logout',{method:'POST'}).catch(()=>{});
  location.reload();
};
$('#homeBtn').onclick=showHome;

function kindLabel(k){
  return({sale:'Satış',collection:'Tahsilat',expense:'Masraf',transfer:'Transfer',sale_cancel:'Satış İptal',collection_cancel:'Tahsilat İptal'}[k]||k||'—');
}
function dealerLabel(id,name){
  if(name)return name;
  const d=String(id||'').toLowerCase();
  if(d.includes('istikbal'))return 'İstikbal';
  if(d.includes('beko'))return 'Beko';
  return '—';
}

function financeQuery(){
  const q=new URLSearchParams();
  const dealer=$('#dealerFilter')?.value||'';
  const person=$('#salespersonFilter')?.value||'';
  if(dealer)q.set('dealerId',dealer);
  if(person)q.set('salespersonId',person);
  const s=q.toString();
  return s?`?${s}`:'';
}

async function loadFinance(){
  const st=$('#financeStatus');
  st.textContent='Finans ve cari bilgiler yükleniyor...';
  try{
    if($('#financeMonth') && !$('#financeMonth').value)$('#financeMonth').value=currentMonthValue();
    financeData=await api('/web-api/admin/finance-center'+financeQuery());
    renderFinance();
    await loadMonthSales();
    if(financeData?.canApprove||canScreen('screen_manager_approvals'))await loadManagerApprovals();
    st.textContent='';
  }catch(e){st.textContent=e.message}
}

function monthQuery(){
  const q=new URLSearchParams();
  const month=$('#financeMonth')?.value||currentMonthValue();
  q.set('month',month);
  const person=$('#monthSalesperson')?.value||'';
  if(person)q.set('salespersonId',person);
  return `?${q.toString()}`;
}

async function loadMonthSales(){
  try{
    monthData=await api('/web-api/admin/staff-sales-month'+monthQuery());
    renderMonthSales();
  }catch(e){
    $('#monthStats').innerHTML=`<div class="stat deduct"><small>Ay özeti</small><b>${e.message}</b></div>`;
    $('#monthSaleRows').innerHTML=`<tr><td colspan="6">${e.message}</td></tr>`;
  }
}

function renderMonthSales(){
  const d=monthData||{};
  const s=d.summary||{};
  const canManage=Boolean(d.canManage);
  $('#monthPersonWrap')?.classList.toggle('hidden',!canManage);
  if(canManage){
    const people=d.people||[];
    const cur=$('#monthSalesperson')?.value||'';
    $('#monthSalesperson').innerHTML='<option value="">Tüm personel</option>'+people.map(p=>`<option value="${p.id}" ${String(p.id)===String(cur)?'selected':''}>${p.name}</option>`).join('');
  }
  $('#monthPrimHint').textContent=canManage
    ?'Seçilen ayda brüt satıştan iptal/iade düşülür; personel primi net üzerinden hesaplanır.'
    :'Bu ay yaptığınız satışlar. İptal/iade onaylanınca düşer; alacağınız prim net tutara göredir.';
  $('#monthStats').innerHTML=`
    <div class="stat"><small>Brüt Satış</small><b>${money(s.grossSales)}</b><small>${s.grossCount||0} adet</small></div>
    <div class="stat deduct"><small>İptal + İade</small><b>- ${money(s.deductedSales)}</b><small>${s.deductedCount||0} adet · İptal ${s.cancelledCount||0} / İade ${s.returnedCount||0}</small></div>
    <div class="stat net"><small>Net Satış</small><b>${money(s.netSales)}</b><small>${s.netCount||0} adet</small></div>
    <div class="stat prim"><small>Prim (Alacağınız)</small><b>${money(s.primEarned)}</b><small>Düşen prim: ${money(s.primLost)}</small></div>
    <div class="stat"><small>Ay</small><b>${d.month||'—'}</b><small>${(d.from||'') } → ${(d.to||'')}</small></div>`;
  $('#monthSaleRows').innerHTML=(d.rows||[]).map(t=>{
    let status='<span class="badge ok">Aktif</span>';
    if(t.cancelled){
      status=t.cancelKind==='return'
        ?`<span class="badge return">İade</span><small>${t.cancelReason||''}</small>`
        :`<span class="badge cancel">İptal</span><small>${t.cancelReason||''}</small>`;
    }else if(t.pendingRequest){
      const k=String(t.pendingRequest.requestKind||'')==='return'||String(t.pendingRequest.targetType||'')==='sale_return'?'İade':'İptal';
      status=`<span class="badge wait">${k} onayı bekliyor</span><small>${t.pendingRequest.reason||''}</small>`;
    }
    const acts=(!t.cancelled && !t.pendingRequest)
      ?`<div class="row-acts">
          <button type="button" class="mini-btn danger" data-cancel-sale="${t.id}" data-kind="cancel" data-ref="${t.reference||''}" data-total="${t.total}" data-prim="${t.commissionAmount}">İptal</button>
          <button type="button" class="mini-btn return" data-cancel-sale="${t.id}" data-kind="return" data-ref="${t.reference||''}" data-total="${t.total}" data-prim="${t.commissionAmount}">İade</button>
        </div>`
      :'<small>—</small>';
    return`<tr>
      <td>${t.date||'—'}<small>${t.reference||''}</small></td>
      <td><b>${t.customerName||'—'}</b><small>${t.salespersonName||''}</small></td>
      <td><b>${money(t.total)}</b></td>
      <td>${money(t.commissionAmount)}<small>%${Number(t.commissionPct||0)}</small></td>
      <td>${status}</td>
      <td>${acts}</td>
    </tr>`;
  }).join('')||'<tr><td colspan="6">Bu ay satış yok.</td></tr>';
  document.querySelectorAll('[data-cancel-sale]').forEach(btn=>{
    btn.onclick=()=>openCancelModal({
      id:btn.dataset.cancelSale,
      kind:btn.dataset.kind||'cancel',
      ref:btn.dataset.ref||'',
      total:btn.dataset.total||0,
      prim:btn.dataset.prim||0
    });
  });
}

function openCancelModal(draft){
  cancelDraft=draft;
  const isReturn=String(draft.kind)==='return';
  $('#cancelModalTitle').textContent=isReturn?'İade Talebi — Yönetici Onayı':'İptal Talebi — Yönetici Onayı';
  $('#cancelModalHint').textContent=isReturn
    ?'İade talebi yöneticiye uyarı olarak gider. Onaylanmadan satış ve priminiz düşmez. Nedeni yazın ki sonra hatırlayasınız.'
    :'İptal talebi yöneticiye uyarı olarak gider. Onaylanmadan satış ve priminiz düşmez. Nedeni yazın ki sonra hatırlayasınız.';
  $('#cancelModalRef').textContent=draft.ref||draft.id;
  $('#cancelModalTotal').textContent=money(draft.total);
  $('#cancelModalPrim').textContent=money(draft.prim);
  $('#cancelReasonInput').value='';
  $('#cancelModalStatus').textContent='';
  $('#cancelReasonModal')?.classList.remove('hidden');
  $('#cancelReasonInput')?.focus();
}
function closeCancelModal(){
  cancelDraft=null;
  $('#cancelReasonModal')?.classList.add('hidden');
}
async function submitCancelRequest(){
  if(!cancelDraft)return;
  const reason=($('#cancelReasonInput')?.value||'').trim();
  const st=$('#cancelModalStatus');
  if(reason.length<3){st.textContent='Sebep zorunlu (en az 3 karakter).';return}
  if(!confirm(`${String(cancelDraft.kind)==='return'?'İADE':'İPTAL'} talebi yöneticiye gidecek.\n\nSatış: ${cancelDraft.ref||cancelDraft.id}\nTutar: ${money(cancelDraft.total)}\nDüşecek prim: ${money(cancelDraft.prim)}\n\nOnaylanmadan işlem yapılmaz. Devam?`))return;
  st.textContent='Talep gönderiliyor...';
  try{
    const d=await api('/web-api/admin/cancellation-request',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        targetType:'sale',
        targetId:cancelDraft.id,
        requestKind:cancelDraft.kind==='return'?'return':'cancel',
        reason
      })
    });
    st.textContent=d.message||'Talep yöneticiye iletildi.';
    closeCancelModal();
    await loadMonthSales();
    if(financeData?.canApprove||canScreen('screen_manager_approvals'))await loadManagerApprovals();
    $('#financeStatus').textContent=d.message||'Talep yönetici onayına düştü.';
  }catch(e){st.textContent=e.message}
}

async function loadManagerApprovals(){
  const wrap=$('#managerApprovalsWrap');
  if(!wrap)return;
  try{
    const d=await api('/web-api/admin/cancellation-requests');
    if(!d.canManage && !canScreen('screen_manager_approvals')){wrap.classList.add('hidden');return}
    wrap.classList.remove('hidden');
    const pending=(d.rows||[]).filter(r=>r.status==='pending'&&['sale','sale_return','collection'].includes(r.targetType));
    $('#approvalRows').innerHTML=pending.map(r=>{
      const isReturn=r.requestKind==='return'||r.targetType==='sale_return';
      return`<div class="approval-card">
        <div><span class="badge ${isReturn?'return':'cancel'}">${isReturn?'İADE TALEBİ':'İPTAL TALEBİ'}</span>
          <b style="margin-left:8px">${r.targetReference||r.targetId}</b>
          <small>${r.customerName||''} · ${money(r.saleTotal||0)} · Prim ${money(r.commissionAmount||0)}</small>
        </div>
        <div><b>${r.requestedByName||'Personel'}</b> istedi · ${(r.requestedAt||'').slice(0,16).replace('T',' ')}
          <small>Neden: ${r.reason||'—'}</small>
        </div>
        <div class="acts">
          <button type="button" class="mini-btn ok" data-appr="${r.id}">Onayla (satış/prim düşer)</button>
          <button type="button" class="mini-btn danger" data-rej="${r.id}">Reddet</button>
        </div>
      </div>`;
    }).join('')||'<div class="soft-hint">Bekleyen iptal/iade talebi yok.</div>';
    document.querySelectorAll('[data-appr]').forEach(b=>b.onclick=async()=>{
      if(!confirm('Onaylarsanız satış iptal/iade edilir ve personel primi düşer. Emin misiniz?'))return;
      try{
        await api('/web-api/admin/cancellation-request/'+b.dataset.appr+'/review',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'approve'})});
        await loadMonthSales();await loadManagerApprovals();await loadFinance();
      }catch(e){alert(e.message)}
    });
    document.querySelectorAll('[data-rej]').forEach(b=>b.onclick=async()=>{
      const note=prompt('Red açıklaması:','')||'';
      try{
        await api('/web-api/admin/cancellation-request/'+b.dataset.rej+'/review',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'reject',note})});
        await loadManagerApprovals();
      }catch(e){alert(e.message)}
    });
  }catch(_){wrap.classList.add('hidden')}
}

function renderFinance(){
  const d=financeData||{};
  const canManage=Boolean(d.canManage)||canScreen('screen_staff_sales_report');
  const canApprove=Boolean(d.canApprove)||canScreen('screen_manager_approvals');
  const ciro=d.ciro||{brand:{},personnel:[]};
  const brand=ciro.brand||{};
  const summary=d.summary||{};
  const salesTotal=Number(summary.mySalesTotal!=null?summary.mySalesTotal:(brand.total||0));
  const salesCount=Number(summary.mySalesCount!=null?summary.mySalesCount:(brand.count||0));

  $('#adminCiroWrap')?.classList.toggle('hidden',!canManage);
  $('#personnelCiroWrap')?.classList.toggle('hidden',!canManage);
  $('#managerApprovalsWrap')?.classList.toggle('hidden',!canApprove);

  // Personel portalında üst özet her zaman satış/tahsilat kartları (yönetici olsa bile)
  $('#financeStats').innerHTML=`
      <div class="stat"><small>Satışlarım (Net)</small><b>${money(salesTotal)}</b></div>
      <div class="stat"><small>Satış Adedi</small><b>${salesCount}</b></div>
      <div class="stat"><small>Tahsilatlarım</small><b>${money(summary.myCollections||0)}</b></div>
      <div class="stat"><small>İlgili Cari</small><b>${(d.customers||[]).length}</b></div>`;

  if(canManage){
    $('#financeScopeHint').textContent='Yönetici görünümü: Beko / İstikbal / Total, personel ciro, aylık prim ve iptal/iade onayları';
    $('#ciroBrandGrid').innerHTML=`
      <div class="ciro-card beko"><small>Beko Ciro</small><b>${money(brand.beko)}</b></div>
      <div class="ciro-card istikbal"><small>İstikbal Ciro</small><b>${money(brand.istikbal)}</b></div>
      <div class="ciro-card total"><small>Toplam Ciro</small><b>${money(brand.total)}</b></div>
      <div class="ciro-card"><small>Satış Adedi</small><b>${Number(brand.count||0)}</b></div>`;
    const people=d.people||[];
    const cur=$('#salespersonFilter')?.value||'';
    $('#salespersonFilter').innerHTML='<option value="">Tüm personel</option>'+people.map(p=>`<option value="${p.id}" ${String(p.id)===String(cur)?'selected':''}>${p.name}</option>`).join('');
    $('#personnelCiroRows').innerHTML=(ciro.personnel||[]).map(p=>`
      <tr>
        <td><b>${p.name||'—'}</b></td>
        <td>${money(p.beko)}</td>
        <td>${money(p.istikbal)}</td>
        <td><b>${money(p.total)}</b></td>
        <td>${p.count||0}</td>
      </tr>`).join('')||'<tr><td colspan="5">Personel cirosu yok.</td></tr>';
  }else{
    $('#financeScopeHint').textContent='Satışlarınız ay bazında toplanır; iptal/iade düşülür. Prim net satışa göredir.';
  }
  renderCustomers();
  renderTransactions();
}

function renderCustomers(){
  const term=($('#customerSearch')?.value||'').toLocaleLowerCase('tr-TR');
  const rows=(financeData?.customers||[]).filter(c=>
    `${c.name||''} ${c.phone||''} ${c.taxNo||''}`.toLocaleLowerCase('tr-TR').includes(term)
  );
  $('#customerRows').innerHTML=rows.map(c=>`
    <tr>
      <td><b>${c.name||''}</b><small>${c.taxNo||''}</small></td>
      <td>${c.phone||'—'}</td>
      <td><b>${money(c.balance)}</b></td>
    </tr>`).join('')||'<tr><td colspan="3">Cari bulunamadı.</td></tr>';
}

function renderTransactions(){
  const term=($('#txSearch')?.value||'').toLocaleLowerCase('tr-TR');
  const rows=(financeData?.transactions||[]).filter(t=>['sale','collection'].includes(t.kind)).filter(t=>
    `${t.customerName||''} ${t.reference||''} ${t.description||''} ${t.dealerName||''}`.toLocaleLowerCase('tr-TR').includes(term)
  ).slice(0,200);
  $('#txRows').innerHTML=rows.map(t=>`
    <tr>
      <td>${(t.date||'').slice(0,10)}<small>${(t.createdAt||'').slice(11,16)||''}</small></td>
      <td>${kindLabel(t.kind)}</td>
      <td><b>${t.customerName||'—'}</b><small>${t.salespersonName||t.createdBy||''}</small></td>
      <td>${dealerLabel(t.dealerId,t.dealerName)}</td>
      <td><b>${money(t.kind==='sale'?(t.total??Math.abs(Number(t.customerDelta||t.amount||0))):(t.total??t.amount))}</b></td>
    </tr>`).join('')||'<tr><td colspan="5">Hareket bulunamadı.</td></tr>';
}

$('#financeCard').onclick=async()=>{
  hidePanels();
  $('#financePanel').classList.remove('hidden');
  if($('#financeMonth') && !$('#financeMonth').value)$('#financeMonth').value=currentMonthValue();
  await loadFinance();
};
$('#financeRefresh')?.addEventListener('click',loadFinance);
$('#financeFilterApply')?.addEventListener('click',loadFinance);
$('#monthRefresh')?.addEventListener('click',loadMonthSales);
$('#financeMonth')?.addEventListener('change',loadMonthSales);
$('#monthSalesperson')?.addEventListener('change',loadMonthSales);
$('#cancelModalClose')?.addEventListener('click',closeCancelModal);
$('#cancelModalCancel')?.addEventListener('click',closeCancelModal);
$('#cancelSubmitBtn')?.addEventListener('click',submitCancelRequest);
$('#customerSearch')?.addEventListener('input',renderCustomers);
$('#txSearch')?.addEventListener('input',renderTransactions);

function num(v){
  if(typeof v==='number')return Number.isFinite(v)?v:0;
  let s=String(v??'').trim().replace(/%/g,'').replace(/₺/g,'').replace(/\s/g,'');
  if(!s)return 0;
  if(s.includes(',')&&s.includes('.')){
    if(s.lastIndexOf(',')>s.lastIndexOf('.'))s=s.replace(/\./g,'').replace(',','.');
    else s=s.replace(/,/g,'');
  }else if(s.includes(','))s=s.replace(',','.');
  const n=Number(s);return Number.isFinite(n)?n:0;
}
function productPrice(p){return num(p?.cashPrice??p?.price??p?.salePrice??p?.cardPrice)}
function itemCodeOf(p){return String(p?.itemCode||'').trim()}
function materialOf(p){return String(p?.searchName||p?.name||p?.code||'').trim()}
function cartGross(){return Math.round(salesCart.reduce((a,r)=>a+num(r.qty)*num(r.unitPrice),0)*100)/100}
function cartHasMissingPrice(){return salesCart.some(r=>num(r.unitPrice)<=0)}
function customerHasCorp(c){return Boolean(String(c?.companyName||'').trim()&&String(c?.taxNo||'').replace(/\D/g,'').length>=10)}
function cartNet(){
  const g=cartGross();
  const d=Math.min(100,Math.max(0,num($('#salesDiscountPct')?.value)));
  return Math.round(g*(1-d/100)*100)/100;
}
function setSalesStep(step){
  salesStep=Math.min(3,Math.max(1,Number(step)||1));
  ['1','2','3'].forEach(n=>{
    $(`#salesStep${n}`)?.classList.toggle('hidden',String(salesStep)!==n);
  });
  document.querySelectorAll('.pos-step').forEach(btn=>{
    const n=Number(btn.dataset.posStep);
    btn.classList.toggle('active',n===salesStep);
    btn.classList.toggle('done',n<salesStep);
  });
  const hasCustomer=!!$('#salesCustomerSelect')?.value;
  const hasCart=salesCart.length>0;
  $('#salesBanner').textContent=salesStep===1
    ?'ADIM 1/3 — Önce müşteri seçin'
    :(salesStep===2?'ADIM 2/3 — Ürün ekleyin':'ADIM 3/3 — Ödeme dağılımını tamamlayın');
  if($('#salesNext1'))$('#salesNext1').disabled=!hasCustomer;
  if($('#salesHint1'))$('#salesHint1').textContent=hasCustomer?'Müşteri seçildi — devam edebilirsiniz':'Müşteri seçmeden devam edilemez';
  const pricesOk=hasCart&&!cartHasMissingPrice();
  if($('#salesNext2'))$('#salesNext2').disabled=!pricesOk;
  if($('#salesHint2'))$('#salesHint2').textContent=!hasCart?'Sepete ürün ekleyin':(!pricesOk?'Her kalemde tutarı elle girin':`${salesCart.length} kalem hazır`);
  const dock=$('#salesStickyDock');
  const salesOpen=!$('#salesPanel')?.classList.contains('hidden');
  dock?.classList.toggle('hidden',!salesOpen);
  if($('#salesDockStep'))$('#salesDockStep').textContent=`${salesStep} / 3`;
  const dockBtn=$('#salesDockPreviewBtn');
  if(dockBtn){
    if(salesStep===1)dockBtn.textContent=hasCustomer?'DEVAM ET → ÜRÜN':'ÖNCE MÜŞTERİ SEÇ';
    else if(salesStep===2)dockBtn.textContent=pricesOk?'DEVAM ET → ÖDEME':'ÖNCE ÜRÜN EKLE';
    else dockBtn.textContent='ÖNİZLE / SATIŞI YAP';
  }
  if(salesStep===3){syncPayAccounts();applyStaffSalePermissions();salesRecalcPay()}
  else salesRecalcPay();
}
function salesReset(){
  salesCart=[];
  lastSaleDocsUrl='';
  // Müşteri listesini silme — finance-center'dan gelenleri koru
  salesCustomers=(salesCustomerFallback||[]).slice(0,500);
  if($('#customerSearchSale'))$('#customerSearchSale').value='';
  if($('#salesCustomerSelect')){
    $('#salesCustomerSelect').innerHTML=salesCustomers.length
      ?('<option value="">Müşteri seçin</option>'+salesCustomers.map(c=>`<option value="${c.id}">${c.name}${c.phone?' · '+c.phone:''}</option>`).join(''))
      :'<option value="">Önce arayın, sonra seçin</option>';
  }
  if($('#salesCustomerCount'))$('#salesCustomerCount').textContent=(salesCustomerTotal||salesCustomers.length||0)+' kayıt';
  if($('#salesCustomerSearchHint'))$('#salesCustomerSearchHint').textContent=
    salesCustomers.length?`Toplam ${salesCustomerTotal||salesCustomers.length} müşteri. Yazarak süzün veya listeden seçin.`
    :'Müşteri yok — önce ekleyin.';
  if($('#salesDiscountPct'))$('#salesDiscountPct').value='0';
  if($('#salesDiscountAmount'))$('#salesDiscountAmount').value='0';
  if($('#salesBillingParty'))$('#salesBillingParty').value='individual';
  if($('#salesInvoiceStatus'))$('#salesInvoiceStatus').value='not_required';
  if($('#salesDescription'))$('#salesDescription').value='Mağaza satışı';
  if($('#salesDeductStock'))$('#salesDeductStock').value='no';
  if($('#salesInvoiceNumber'))$('#salesInvoiceNumber').value='';
  $('#salesInvoiceIssuedFields')?.classList.add('hidden');
  $('#salesBillingAutoHint')?.classList.add('hidden');
  ['#payCash','#payCard','#payTransfer','#payCredit','#payNote'].forEach(id=>{if($(id))$(id).value=''});
  if($('#salesDate'))$('#salesDate').value=new Date().toISOString().slice(0,10);
  const due=new Date();due.setDate(due.getDate()+30);
  if($('#promissoryFirstDue'))$('#promissoryFirstDue').value=due.toISOString().slice(0,10);
  if($('#promissoryInstallments'))$('#promissoryInstallments').value='1';
  if($('#promissoryInterval'))$('#promissoryInterval').value='1';
  if($('#salesPromissorySchedule'))$('#salesPromissorySchedule').innerHTML='';
  if($('#payInlineStatus'))$('#payInlineStatus').textContent='';
  activeSalesDraft=null;
  closeSalesPreview();
  setSalesPayPlanOpen(false);
  salesCustomerChanged();
  renderProducts();
  renderCart();
  setSalesStep(1);
  salesRecalcPay();
  $('#salesStatus').textContent='';
  $('#customerSearchSale')?.focus();
}

$('#salesCard').onclick=async()=>{
  hidePanels();
  $('#salesPanel').classList.remove('hidden');
  $('#salesStickyDock')?.classList.remove('hidden');
  applyStaffSalePermissions();
  await loadSales();
};
function filterCustomersLocal(list,term){
  const q=String(term||'').trim().toLocaleLowerCase('tr-TR');
  if(!q)return [];
  const digits=q.replace(/\D+/g,'');
  return (list||[]).filter(c=>{
    const hay=`${c.name||''} ${c.phone||''} ${c.taxNo||''} ${c.tckn||''} ${c.companyName||''} ${c.email||''}`.toLocaleLowerCase('tr-TR');
    if(hay.includes(q))return true;
    if(digits.length>=3){
      const phoneDigits=String(c.phone||'').replace(/\D+/g,'');
      const taxDigits=`${c.taxNo||''}${c.tckn||''}`.replace(/\D+/g,'');
      if(phoneDigits.includes(digits)||taxDigits.includes(digits))return true;
    }
    return false;
  }).slice(0,50);
}
let salesCustomerFallback=[];
async function loadSales(){
  const st=$('#salesStatus');
  st.textContent='Satış verileri yükleniyor...';
  try{
    const [cat,fin]=await Promise.all([
      api('/web-api/admin/sales-catalog'),
      api('/web-api/admin/finance-center')
    ]);
    salesData=cat;
    const fromFin=Array.isArray(fin.customers)?fin.customers:[];
    const fromCat=Array.isArray(cat.customers)?cat.customers:[];
    salesCustomerFallback=fromFin.length?fromFin:fromCat;
    salesCustomers=salesCustomerFallback.slice(0,500);
    salesCustomerTotal=Number(fin.customerTotal||salesCustomerFallback.length||0);
    salesAccounts=(cat.accounts&&cat.accounts.length?cat.accounts:fin.accounts)||[];
    if($('#salesDealer')){
      $('#salesDealer').innerHTML=(cat.dealerSettings||[]).filter(d=>d.active!==false)
        .map(d=>`<option value="${d.id}">${d.name}</option>`).join('')||'<option value="">Bayi yok</option>';
    }
    if($('#salesWarehouse')){
      const wh=(cat.warehouses||fin.warehouses||[]).filter(w=>w.active!==false);
      $('#salesWarehouse').innerHTML=wh.map(w=>`<option value="${w.id}">${w.name}</option>`).join('')||'<option value="">Depo yok</option>';
    }
    syncPayAccounts();
    applyStaffSalePermissions();
    $('#salesScopeHint').textContent=`Satışlar sizin adınıza kaydedilir · ${(cat.products||[]).length} ürün · ${salesCustomerTotal} müşteri`;
    salesReset();
    if(salesCustomers.length && $('#salesCustomerSelect')){
      $('#salesCustomerSelect').innerHTML='<option value="">Müşteri seçin</option>'+
        salesCustomers.map(c=>`<option value="${c.id}">${c.name}${c.phone?' · '+c.phone:''}</option>`).join('');
    }
    if($('#salesCustomerCount'))$('#salesCustomerCount').textContent=salesCustomerTotal+' kayıt';
    if($('#salesCustomerSearchHint'))$('#salesCustomerSearchHint').textContent=
      salesCustomers.length?`Toplam ${salesCustomerTotal} müşteri yüklendi. Yazarak süzün veya listeden seçin.`
      :'Müşteri yok — önce ekleyin.';
    st.textContent='';
  }catch(e){st.textContent=e.message}
}
async function salesSearchCustomers(){
  const term=String($('#customerSearchSale')?.value||'').trim();
  const btn=$('#customerSearchSaleBtn');
  const hint=$('#salesCustomerSearchHint');
  const current=$('#salesCustomerSelect')?.value||'';
  if(btn)btn.disabled=true;
  if(hint)hint.textContent=term?'Aranıyor…':'Liste…';
  if(!salesCustomerFallback.length){
    try{
      const fin=await api('/web-api/admin/finance-center');
      salesCustomerFallback=fin.customers||[];
      salesCustomerTotal=Number(fin.customerTotal||salesCustomerFallback.length||0);
    }catch(_){}
  }
  let rows=term?filterCustomersLocal(salesCustomerFallback,term):(salesCustomerFallback||[]).slice(0,200);
  const total=rows.length;
  try{
    const map=new Map(salesCustomers.map(c=>[String(c.id),c]));
    rows.forEach(c=>map.set(String(c.id),c));
    salesCustomers=[...map.values()];
    if($('#salesCustomerCount'))$('#salesCustomerCount').textContent=`${rows.length} sonuç`;
    $('#salesCustomerSelect').innerHTML=(rows.length?'':'<option value="">Sonuç yok</option>')+
      rows.map(c=>`<option value="${c.id}" ${String(c.id)===String(current)?'selected':''}>${c.name}${c.phone?' · '+c.phone:''}</option>`).join('');
    if(current && rows.some(c=>String(c.id)===String(current)))$('#salesCustomerSelect').value=current;
    else if(rows.length===1)$('#salesCustomerSelect').value=rows[0].id;
    if(hint)hint.textContent=rows.length?`${rows.length} müşteri. Seçin.`:'Eşleşen müşteri yok.';
    salesCustomerChanged();
  }finally{if(btn)btn.disabled=false}
}
function renderSalesCustomers(){return salesSearchCustomers()}
function stToast(msg){const st=$('#salesStatus');if(st)st.textContent=msg||''}
function salesCustomerChanged(){
  const c=salesCustomers.find(x=>String(x.id)===String($('#salesCustomerSelect')?.value||''));
  const box=$('#salesCustomerInfo');
  const hint=$('#salesBillingAutoHint');
  if(!c){
    box?.classList.add('hidden');box&&(box.innerHTML='');
    if($('#salesBillingParty'))$('#salesBillingParty').value='individual';
    hint?.classList.add('hidden');
    setSalesStep(salesStep);return;
  }
  box.classList.remove('hidden');
  const hasCorp=customerHasCorp(c);
  // Kurumsal bilgi varsa otomatik kurumsal fatura — seçim yok
  if($('#salesBillingParty'))$('#salesBillingParty').value=hasCorp?'corporate':'individual';
  if(hint){
    hint.classList.remove('hidden');
    hint.textContent=hasCorp
      ?`Fatura otomatik kurumsal: ${c.companyName} · VKN ${c.taxNo}`
      :'Fatura bireysel (şahıs / TCKN). Senet her zaman şahsa.';
  }
  box.innerHTML=`
    <div><small>Şahıs / Senet</small><b>${c.name||'—'}</b><span style="display:block;font-size:11px;color:#7a879a">TCKN ${c.tckn||'—'}</span></div>
    <div><small>Telefon</small><b>${c.phone||'—'}</b></div>
    <div><small>Cari</small><b>${money(c.balance)}</b></div>
    ${hasCorp?`<div><small>Fatura firması</small><b>${c.companyName||'—'}</b><span style="display:block;font-size:11px;color:#7a879a">VKN ${c.taxNo||'—'} · ${c.taxOffice||''}</span></div>`:''}`;
  setSalesStep(salesStep);
}
function renderProducts(){
  const itemTerm=($('#salesItemCodeFilter')?.value||'').toLocaleLowerCase('tr-TR').trim();
  const matTerm=($('#salesMaterialCodeFilter')?.value||'').toLocaleLowerCase('tr-TR').trim();
  const term=($('#productSearch')?.value||'').toLocaleLowerCase('tr-TR').trim();
  const rows=(salesData?.products||[]).filter(p=>{
    const item=itemCodeOf(p).toLocaleLowerCase('tr-TR');
    const mat=`${materialOf(p)} ${p.code||''} ${p.name||''}`.toLocaleLowerCase('tr-TR');
    const hay=`${p.code||''} ${p.name||''} ${p.searchName||''} ${p.itemCode||''} ${p.brand||''} ${p.barcode||''}`.toLocaleLowerCase('tr-TR');
    if(itemTerm && !item.includes(itemTerm))return false;
    if(matTerm && !mat.includes(matTerm))return false;
    if(term && !hay.includes(term))return false;
    return true;
  }).slice(0,120);
  $('#productRows').innerHTML=rows.map(p=>{
    const madde=itemCodeOf(p)||'-';
    const malzeme=materialOf(p)||'-';
    const liste=productPrice(p);
    return `<button type="button" class="product-item product-item-grid" data-code="${p.code}">
      <strong title="Madde kodu">${madde}</strong>
      <span title="Malzeme">${malzeme}<small>${p.brand||p.code||''}</small></span>
      <em title="Liste (referans)">${liste?money(liste):'—'}</em>
      <b class="add-chip">EKLE</b>
    </button>`;
  }).join('')||'<div class="status">Ürün bulunamadı.</div>';
}
function renderCart(){
  $('#cartCount').textContent=`${salesCart.length} kalem`;
  $('#cartSubtotal').textContent=money(cartGross());
  if(!salesCart.length){
    $('#cartRows').innerHTML='<div class="status">Sepet boş — listeden ürün ekleyin.</div>';
    setSalesStep(salesStep);
    return;
  }
  $('#cartRows').innerHTML=salesCart.map((r,i)=>`
    <div class="cart-row" data-idx="${i}">
      <div><strong>${r.itemCode||'-'}</strong><small>${r.name||r.materialCode||r.code}</small></div>
      <input data-qty type="number" min="1" step="1" value="${r.qty}">
      <input data-price type="text" inputmode="decimal" value="${r.unitPrice?String(r.unitPrice):''}" placeholder="Elle tutar" autocomplete="off">
      <button type="button" data-del title="Sil">✕</button>
    </div>`).join('');
  setSalesStep(salesStep);
}
function addToCart(code){
  const p=(salesData?.products||[]).find(x=>String(x.code)===String(code));
  if(!p)return;
  const existing=salesCart.find(r=>String(r.code)===String(code));
  if(existing){
    existing.qty+=1;
  }else{
    // Tutar otomatik dolmaz — personel elle girer
    salesCart.push({
      code:p.code,
      name:materialOf(p),
      qty:1,
      unitPrice:0,
      itemCode:itemCodeOf(p),
      materialCode:materialOf(p),
      listPrice:productPrice(p)
    });
  }
  renderCart();
  // Yeni eklenen satırın tutar alanına odaklan
  const rows=[...document.querySelectorAll('#cartRows .cart-row')];
  const last=rows[rows.length-1];
  const priceInput=last?.querySelector('[data-price]');
  if(priceInput && !num(priceInput.value)){
    priceInput.focus();
    try{priceInput.select()}catch(_){}
  }
}
function syncPayAccounts(){
  const cashOpts=salesAccounts.filter(a=>a.type==='cash'&&a.active!==false);
  const bankOpts=salesAccounts.filter(a=>a.type==='bank'&&a.active!==false);
  const all=salesAccounts.filter(a=>a.active!==false);
  const fill=(sel,rows)=>{
    if(!sel)return;
    const cur=sel.value;
    const list=rows.length?rows:all;
    sel.innerHTML=list.map(a=>`<option value="${a.id}">${a.name}</option>`).join('')||'<option value="">Hesap yok</option>';
    if(cur && [...sel.options].some(o=>o.value===cur))sel.value=cur;
  };
  fill($('#payCashAccount'),cashOpts);
  fill($('#payCardAccount'),bankOpts);
  fill($('#payTransferAccount'),bankOpts);
}
function paySplits(){
  return {
    cash:Math.max(0,num($('#payCash')?.value)),
    card:Math.max(0,num($('#payCard')?.value)),
    transfer:Math.max(0,num($('#payTransfer')?.value)),
    credit:Math.max(0,num($('#payCredit')?.value)),
    note:Math.max(0,num($('#payNote')?.value))
  };
}
function salesPayPlanIsOpen(){
  return !$('#salesPayPlanPanel')?.classList.contains('hidden');
}
function setSalesPayPlanOpen(open){
  const panel=$('#salesPayPlanPanel');
  const btn=$('#salesPayPlanToggleBtn');
  if(!panel)return;
  panel.classList.toggle('hidden',!open);
  panel.setAttribute('aria-hidden',open?'false':'true');
  if(btn){
    btn.setAttribute('aria-expanded',open?'true':'false');
    const label=btn.querySelector('span');
    if(label)label.textContent=open?'ÖDEME PLANINI GİZLE':'ÖDEME PLANI';
  }
  if(open){
    setTimeout(()=>panel.scrollIntoView({behavior:'smooth',block:'nearest'}),40);
  }
}
function salesFillRemainingTo(fieldId){
  setSalesPayPlanOpen(true);
  const map={payCash:'cash',payCard:'card',payTransfer:'transfer',payCredit:'credit',payNote:'note'};
  const key=map[fieldId];if(!key)return;
  const net=cartNet();
  const s=paySplits();
  const current=s[key]||0;
  const allocated=s.cash+s.card+s.transfer+s.credit+s.note;
  const others=Math.round((allocated-current)*100)/100;
  const fill=Math.max(0,Math.round((net-others)*100)/100);
  const el=$('#'+fieldId);if(!el)return;
  el.value=fill?String(fill):'';
  salesRecalcPay();
  el.focus();
  try{el.select()}catch(_){}
}
function buildPromissorySchedule(amount,installments,firstDue,intervalMonths){
  const total=Math.max(0,num(amount));
  const count=Math.min(36,Math.max(1,Math.round(num(installments)||1)));
  const interval=Math.min(12,Math.max(1,Math.round(num(intervalMonths)||1)));
  if(total<=0||!firstDue)return[];
  const first=new Date(firstDue+'T12:00:00');
  if(Number.isNaN(first.getTime()))return[];
  const base=Math.floor((total/count)*100)/100;
  let remaining=Math.round(total*100)/100;
  const rows=[];
  for(let i=0;i<count;i++){
    const due=new Date(first);due.setMonth(due.getMonth()+i*interval);
    const amt=i===count-1?Math.round(remaining*100)/100:base;
    remaining=Math.round((remaining-amt)*100)/100;
    rows.push({no:i+1,dueDate:due.toISOString().slice(0,10),amount:amt});
  }
  return rows;
}
function renderPromissorySchedule(){
  const box=$('#salesPromissorySchedule');if(!box)return;
  const noteAmt=Math.max(0,num($('#payNote')?.value));
  if(noteAmt<=0){box.innerHTML='';return}
  const rows=buildPromissorySchedule(noteAmt,$('#promissoryInstallments')?.value,$('#promissoryFirstDue')?.value,$('#promissoryInterval')?.value);
  if(!rows.length){box.innerHTML='<b>⚠ Senet için ilk vade tarihini girin.</b>';return}
  box.innerHTML=`<b>Senet takvimi · ${money(noteAmt)}</b><table><thead><tr><th>#</th><th>Vade</th><th>Tutar</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${r.no}</td><td>${r.dueDate}</td><td>${money(r.amount)}</td></tr>`).join('')}</tbody></table>`;
}
function salesRecalcPay(){
  const net=cartNet();
  const gross=cartGross();
  const discountAmount=Math.max(0,Math.round((gross-net)*100)/100);
  const discountPct=Math.min(100,Math.max(0,num($('#salesDiscountPct')?.value)));
  const s=paySplits();
  const allocated=Math.round((s.cash+s.card+s.transfer+s.credit+s.note)*100)/100;
  const remaining=Math.round((net-allocated)*100)/100;
  const paid=Math.round((s.cash+s.card+s.transfer)*100)/100;
  const due=Math.round((s.credit+s.note+Math.max(0,remaining))*100)/100;
  if($('#salesDiscountAmount'))$('#salesDiscountAmount').value=discountAmount.toFixed(2);
  if($('#payGross'))$('#payGross').textContent=money(gross);
  if($('#payDiscount'))$('#payDiscount').textContent=money(discountAmount);
  if($('#payNet'))$('#payNet').textContent=money(net);
  if($('#payAllocated'))$('#payAllocated').textContent=money(allocated);
  if($('#payRemaining'))$('#payRemaining').textContent=money(Math.max(0,remaining));
  if($('#payAllocatedSummary'))$('#payAllocatedSummary').textContent=money(allocated);
  if($('#payRemainingSummary'))$('#payRemainingSummary').textContent=money(Math.max(0,remaining));
  if($('#salesGrandTotal'))$('#salesGrandTotal').textContent=money(net);
  if($('#salesGrossPreview'))$('#salesGrossPreview').textContent=money(gross);
  if($('#salesDiscountPreview'))$('#salesDiscountPreview').textContent=`-${money(discountAmount)}`;
  if($('#salesDiscountPctLabel'))$('#salesDiscountPctLabel').textContent=`(%${String(discountPct).replace('.',',')})`;
  if($('#salesPaidPreview'))$('#salesPaidPreview').textContent=money(paid);
  if($('#salesDuePreview'))$('#salesDuePreview').textContent=money(due);
  if($('#salesDockNet'))$('#salesDockNet').textContent=money(net);
  if($('#salesDockRemain')){
    $('#salesDockRemain').textContent=money(remaining);
    $('#salesDockRemain').style.color=Math.abs(remaining)<0.009?'#7dffa8':(remaining>0?'#ffd48a':'#ff9b9b');
  }
  const cust=salesCustomers.find(x=>String(x.id)===String($('#salesCustomerSelect')?.value||''));
  if($('#salesDockCustomer'))$('#salesDockCustomer').textContent=cust?(cust.name.length>22?cust.name.slice(0,21)+'…':cust.name):'—';
  const parts=[];
  if(s.cash>0)parts.push(`Nakit ${money(s.cash)}`);
  if(s.card>0)parts.push(`Kart ${money(s.card)}`);
  if(s.transfer>0)parts.push(`Havale ${money(s.transfer)}`);
  if(s.credit>0)parts.push(`Vadeli ${money(s.credit)}`);
  if(s.note>0)parts.push(`Senet ${money(s.note)}`);
  const methodLabel=parts.length?parts.join(' + '):'';
  if($('#payMethodSummary'))$('#payMethodSummary').textContent=methodLabel||'Henüz seçilmedi';
  if($('#salesPayPlanBtnHint')){
    $('#salesPayPlanBtnHint').textContent=Math.abs(remaining)<0.009&&net>0
      ?`Ödeme tamam · ${methodLabel||'Karma'}`
      :(remaining>0?`Kalan ${money(remaining)} — planı açın`:'NAKİT · KART · HAVALE · VADELİ · SENET');
  }
  const dealer=(salesData?.dealerSettings||[]).find(d=>String(d.id)===String($('#salesDealer')?.value||''));
  const commissionPct=Number(dealer?.commissionPct||0);
  const prim=Math.round((net*commissionPct/100)*100)/100;
  if($('#salesCommissionPreview'))$('#salesCommissionPreview').textContent=`Prim: ${money(prim)}${dealer?` · ${dealer.name}`:''}`;
  if($('#salesCommissionAmountPreview'))$('#salesCommissionAmountPreview').textContent=money(prim);
  if($('#salesCommissionPctLabel'))$('#salesCommissionPctLabel').textContent=`(%${String(commissionPct).replace('.',',')})`;
  const hint=$('#payBalanceHint');
  if(hint){
    if(Math.abs(remaining)<0.009){hint.className='sales-pay-balance ok';hint.textContent='Ödeme net tutara eşit — kaydedebilirsiniz.';}
    else if(remaining>0){hint.className='sales-pay-balance warn';hint.textContent=`Henüz ${money(remaining)} dağıtılmadı. Nakit/kart/havale/vadeli/senet girin.`;}
    else{hint.className='sales-pay-balance bad';hint.textContent=`Dağıtılan tutar netten ${money(Math.abs(remaining))} fazla.`;}
  }
  const preview=$('#payMethodPreview');
  if(preview)preview.textContent=parts.length?`Seçili ödeme: ${parts.join(' + ')}`:'Ödeme seçilmedi — ÖDEME PLANI butonundan dağıtın';
  $('#promissoryWrap')?.classList.toggle('hidden',s.note<=0);
  if(s.note>0)renderPromissorySchedule();
  const onMap={payCash:s.cash>0,payCard:s.card>0,payTransfer:s.transfer>0,payCredit:s.credit>0,payNote:s.note>0};
  document.querySelectorAll('.pos-pay-tile[data-pay-fill]').forEach(btn=>{
    btn.classList.toggle('on',Boolean(onMap[btn.getAttribute('data-pay-fill')]));
  });
  const issued=$('#salesInvoiceStatus')?.value==='issued';
  $('#salesInvoiceIssuedFields')?.classList.toggle('hidden',!issued);
}
function openPayScreen(){
  syncPayAccounts();
  setSalesPayPlanOpen(false);
  salesRecalcPay();
  document.querySelector('#salesPayPlanToggleBtn')?.scrollIntoView({behavior:'smooth',block:'center'});
}
function closePayScreen(){ /* inline ödeme — modal yok */ }
function printSaleDocs(url){
  if(!url)return;
  const w=window.open(url,'_blank','noopener,noreferrer');
  if(!w){
    const st=$('#payInlineStatus')||$('#salesStatus');
    if(st)st.textContent='Açılır pencere engellendi — tarayıcı izni verin';
  }
}
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function collectSalesDraft(){
  const status=$('#payInlineStatus')||$('#salesStatus');
  const customerId=$('#salesCustomerSelect')?.value||'';
  if(!customerId)return{error:'Müşteri seçin',status};
  if(!salesCart.length)return{error:'Sepete ürün ekleyin',status};
  if(cartHasMissingPrice())return{error:'Sepette tutarı girilmemiş ürün var — elle tutar yazın',status};
  if(!$('#salesDealer')?.value)return{error:'Bayi seçin',status};
  const net=cartNet();
  const gross=cartGross();
  if(net<=0)return{error:'Net tutar 0 olamaz',status};
  const s=paySplits();
  const allocated=Math.round((s.cash+s.card+s.transfer+s.credit+s.note)*100)/100;
  if(allocated<=0)return{error:'ÖDEME PLANI butonunu açın — NAKİT/KART/… seçin veya tutar girin',status};
  if(Math.abs(allocated-net)>0.009)return{error:`Dağılım nete eşit olmalı. Net ${money(net)} · Dağıtılan ${money(allocated)}`,status};
  if(s.note>0 && !$('#promissoryFirstDue')?.value)return{error:'Senet için ilk vade girin',status};
  if(s.cash>0 && !$('#payCashAccount')?.value)return{error:'Nakit için kasa seçin',status};
  if(s.card>0 && !$('#payCardAccount')?.value)return{error:'Kart için hesap seçin',status};
  if(s.transfer>0 && !$('#payTransferAccount')?.value)return{error:'Havale için banka seçin',status};
  const deductStock=canDeductStock() && $('#salesDeductStock')?.value==='yes';
  const warehouseId=$('#salesWarehouse')?.value||'';
  if(deductStock && !warehouseId)return{error:'Stoktan düşmek için depo seçin',status};
  let invoiceStatus=$('#salesInvoiceStatus')?.value||'not_required';
  if((invoiceStatus==='queue_qnb'||invoiceStatus==='issued') && !canSaleInvoice()){
    return{error:'Fatura kesme yetkiniz yok',status};
  }
  const payments=[];
  if(s.cash>0)payments.push({method:'Nakit',amount:s.cash,accountId:$('#payCashAccount')?.value||''});
  if(s.card>0)payments.push({method:'Kredi Kartı',amount:s.card,accountId:$('#payCardAccount')?.value||''});
  if(s.transfer>0)payments.push({method:'Havale',amount:s.transfer,accountId:$('#payTransferAccount')?.value||''});
  if(s.credit>0)payments.push({method:'Vadeli',amount:s.credit,accountId:''});
  const cust=salesCustomers.find(x=>String(x.id)===String(customerId));
  const dealer=(salesData?.dealerSettings||[]).find(d=>String(d.id)===String($('#salesDealer')?.value||''));
  const discountPct=num($('#salesDiscountPct')?.value);
  const discountAmount=Math.round((gross-net)*100)/100;
  const commissionPct=Number(dealer?.commissionPct||0);
  const schedule=s.note>0?buildPromissorySchedule(s.note,$('#promissoryInstallments')?.value,$('#promissoryFirstDue')?.value,$('#promissoryInterval')?.value):[];
  const methods=[];
  if(s.cash>0)methods.push('Nakit');
  if(s.card>0)methods.push('Kredi Kartı');
  if(s.transfer>0)methods.push('Havale');
  if(s.credit>0)methods.push('Vadeli');
  if(s.note>0)methods.push('Senet');
  return{
    status,customerId,customer:cust,dealer,dealerId:$('#salesDealer')?.value||'',
    salespersonId:currentUser?.id||'',salesperson:{id:currentUser?.id||'',name:currentUser?.name||''},
    discountPct,discountAmount,grossTotal:gross,total:net,
    commissionPct,commissionAmount:Math.round((net*commissionPct/100)*100)/100,
    paid:Math.round((s.cash+s.card+s.transfer)*100)/100,
    due:Math.round((s.credit+s.note)*100)/100,
    method:methods.join(' + ')||'Karma',
    payments,items:salesCart.map(r=>({productCode:r.code,itemCode:r.itemCode,materialCode:r.materialCode,productName:r.name,quantity:r.qty,unitPrice:num(r.unitPrice)})),
    promissory:s.note>0?{amount:s.note,installments:num($('#promissoryInstallments')?.value)||1,firstDueDate:$('#promissoryFirstDue')?.value,intervalMonths:num($('#promissoryInterval')?.value)||1,schedule}:null,
    billingParty:customerHasCorp(cust)?'corporate':($('#salesBillingParty')?.value||'individual'),
    invoiceStatus,invoiceNumber:$('#salesInvoiceNumber')?.value||'',invoiceDate:$('#salesInvoiceDate')?.value||'',
    description:$('#salesDescription')?.value||'Mağaza satışı',
    date:$('#salesDate')?.value||new Date().toISOString().slice(0,10),
    deductStock,warehouseId,
    warehouse:(salesData?.warehouses||[]).find(w=>String(w.id)===String(warehouseId))
  };
}
function salesPreviewHtml(d){
  const rows=d.items.map(i=>`<tr><td>${esc(i.itemCode||'-')}</td><td>${esc(i.materialCode||i.productName||i.productCode)}</td><td>${i.quantity}</td><td>${money(i.unitPrice)}</td><td>${money(i.quantity*i.unitPrice)}</td></tr>`).join('');
  const payRows=(d.payments||[]).map(p=>`<div class="sales-total-line"><span>${esc(p.method)}</span><b>${money(p.amount)}</b></div>`).join('');
  const note=d.promissory?`<div class="preview-note"><b>Senet:</b> ${money(d.promissory.amount)} · ${d.promissory.installments} taksit · İlk vade ${esc(d.promissory.firstDueDate)}</div>`:'';
  const inv=d.invoiceStatus==='queue_qnb'?'QNB Solist kuyruğu':(d.invoiceStatus==='pending'?'Daha sonra kesilecek':(d.invoiceStatus==='issued'?`Manuel · ${esc(d.invoiceNumber)}`:'Fatura gerekmiyor'));
  return `<div class="preview-cards"><div><small>Müşteri</small><b>${esc(d.customer?.name||'-')}</b><span>${esc(d.customer?.phone||'')}</span></div><div><small>Bayi / Satıcı</small><b>${esc(d.dealer?.name||'-')}</b><span>${esc(d.salesperson?.name||'')}</span></div><div><small>Ödeme</small><b>${esc(d.method)}</b><span>Tahsil: ${money(d.paid)}</span></div></div><div class="table-wrap"><table><thead><tr><th>Madde</th><th>Malzeme</th><th>Adet</th><th>Birim</th><th>Toplam</th></tr></thead><tbody>${rows}</tbody></table></div><div class="preview-totals"><div><span>Brüt</span><b>${money(d.grossTotal)}</b></div><div><span>İskonto</span><b>-${money(d.discountAmount||0)}</b></div><div><span>Net</span><b>${money(d.total)}</b></div>${payRows}<div><span>Prim</span><b>${money(d.commissionAmount||0)}</b></div></div>${note}<div class="preview-note"><b>Fatura:</b> ${inv}<br><b>Stok:</b> ${d.deductStock?`Düşülecek · ${esc(d.warehouse?.name||'')}`:'Değişmeyecek'}<br><b>Açıklama:</b> ${esc(d.description||'-')}</div>`;
}
function openSalesPreview(){
  const d=collectSalesDraft();
  if(d.error){d.status.textContent=d.error;return}
  activeSalesDraft=d;
  $('#salesPreviewBody').innerHTML=salesPreviewHtml(d);
  $('#salesPreviewModal')?.classList.remove('hidden');
  $('#salesPreviewModal')?.setAttribute('aria-hidden','false');
  applyStaffSalePermissions();
}
function closeSalesPreview(){
  $('#salesPreviewModal')?.classList.add('hidden');
  $('#salesPreviewModal')?.setAttribute('aria-hidden','true');
}
function salesOfferText(d){
  const pay=(d.payments||[]).map(p=>`${p.method}: ${money(p.amount)}`).join('\n');
  const note=d.promissory?`\nSenet: ${money(d.promissory.amount)} / ${d.promissory.installments} taksit / ilk vade ${d.promissory.firstDueDate}`:'';
  return `ATAK PAZARLAMA TEKLİF\nMüşteri: ${d.customer?.name||''}\n${d.items.map(i=>`${i.quantity} x ${i.itemCode||'-'} / ${i.materialCode||i.productName} - ${money(i.quantity*i.unitPrice)}`).join('\n')}\n\nBrüt: ${money(d.grossTotal)}\nİskonto: -${money(d.discountAmount||0)}\nNet: ${money(d.total)}\nÖdeme:\n${pay}${note}\n${d.description||''}`;
}
function sendSalesOffer(){
  if(!canSaleOffer()){stToast('Teklif yetkiniz yok');return}
  const d=activeSalesDraft||collectSalesDraft();
  if(d.error){stToast(d.error);return}
  const phone=String(d.customer?.phone||'').replace(/\D/g,'');
  const raw=salesOfferText(d),text=encodeURIComponent(raw);
  if(phone){
    const trPhone=phone.startsWith('0')?'90'+phone.slice(1):(phone.startsWith('90')?phone:'90'+phone);
    const win=window.open(`https://wa.me/${trPhone}?text=${text}`,'_blank');
    if(!win){navigator.clipboard?.writeText(raw);stToast('Pencere engellendi — teklif panoya kopyalandı')}
  }else{navigator.clipboard?.writeText(raw);stToast('Telefon yok — teklif panoya kopyalandı')}
}
function printSalesOffer(){
  if(!canSaleOffer()){stToast('Teklif yetkiniz yok');return}
  const d=activeSalesDraft||collectSalesDraft();
  if(d.error){stToast(d.error);return}
  const w=window.open('','_blank');
  if(!w){stToast('Açılır pencere engellendi');return}
  const rows=(d.items||[]).map(i=>`<tr><td>${esc(i.itemCode||'-')}</td><td>${esc(i.materialCode||i.productName)}</td><td>${i.quantity}</td><td>${money(i.unitPrice)}</td><td>${money(i.quantity*i.unitPrice)}</td></tr>`).join('');
  w.document.write(`<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>Teklif</title><style>body{font:14px/1.45 Arial;padding:24px}table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid #ddd;padding:8px;text-align:left}.net{font-size:18px;font-weight:900}</style></head><body><h1>ATAK PAZARLAMA — Satış Teklifi</h1><p><b>${esc(d.customer?.name||'')}</b> · ${esc(d.date||'')}</p><table><thead><tr><th>Kod</th><th>Ürün</th><th>Adet</th><th>Birim</th><th>Tutar</th></tr></thead><tbody>${rows}</tbody></table><p class="net">Net: ${money(d.total)}</p><button onclick="print()">Yazdır / PDF</button></body></html>`);
  w.document.close();
}
function printSalesContractAndNotes(){
  if(!canSaleDocs()){stToast('Sözleşme / senet yetkiniz yok');return}
  const d=activeSalesDraft||collectSalesDraft();
  if(d.error){stToast(d.error);return}
  const w=window.open('','_blank');
  if(!w){stToast('Açılır pencere engellendi');return}
  const rows=(d.items||[]).slice(0,12).map(i=>`<tr><td>${esc(i.itemCode||'-')}</td><td>${esc(i.materialCode||i.productName)}</td><td>${i.quantity}</td><td>${money(i.unitPrice)}</td><td>${money(i.quantity*i.unitPrice)}</td></tr>`).join('');
  const sched=(d.promissory?.schedule||[]).map(r=>`<tr><td>${r.no}</td><td>${esc(r.dueDate)}</td><td>${money(r.amount)}</td></tr>`).join('');
  w.document.write(`<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>Sözleşme + Senet</title><style>@page{size:A4;margin:12mm}body{font:12px/1.4 Arial;padding:16px}table{width:100%;border-collapse:collapse;margin:8px 0}th,td{border-bottom:1px solid #ddd;padding:5px;text-align:left}.box{border:1px solid #0b2a55;padding:10px;border-radius:8px;margin-top:12px}.amount{font-size:22px;font-weight:900;color:#0b2a55}</style></head><body>
  <h2>ATAK PAZARLAMA — Sözleşme + Senet (Tek A4)</h2>
  <p><b>${esc(d.customer?.name||'')}</b> · TCKN ${esc(d.customer?.tckn||'-')} · ${esc(d.date||'')}</p>
  <table><thead><tr><th>Kod</th><th>Ürün</th><th>Adet</th><th>Birim</th><th>Tutar</th></tr></thead><tbody>${rows}</tbody></table>
  <p><b>Net:</b> ${money(d.total)} · <b>Ödeme:</b> ${esc(d.method)}</p>
  <div class="box"><h3>SENET</h3>${d.promissory?`<div class="amount">${money(d.promissory.amount)}</div><p>${d.promissory.installments} taksit · ilk vade ${esc(d.promissory.firstDueDate)}</p><table><thead><tr><th>#</th><th>Vade</th><th>Tutar</th></tr></thead><tbody>${sched}</tbody></table>`:'<p>Bu satışta senet yok. Ödeme planına Senet girin.</p>'}</div>
  <p style="margin-top:16px"><button onclick="print()">Yazdır / PDF</button></p></body></html>`);
  w.document.close();
}
function salesIssueInvoiceNow(){
  if(!canSaleInvoice()){stToast('Fatura kesme yetkiniz yok');return}
  if($('#salesInvoiceStatus'))$('#salesInvoiceStatus').value='queue_qnb';
  openSalesPreview();
  stToast('Fatura: Önizlemede “Satışı Yap” deyince QNB kuyruğuna alınır');
}
async function confirmSalesDraft(){
  const d=activeSalesDraft||collectSalesDraft();
  if(d.error){stToast(d.error);return}
  const st=d.status||$('#payInlineStatus')||$('#salesStatus');
  const btn=$('#salesPreviewConfirmBtn');
  if(btn){btn.disabled=true;btn.textContent='Satış Yapılıyor...'}
  st.textContent='Satış kaydediliyor...';
  try{
    const invoiceStatus=d.invoiceStatus==='queue_qnb'?'pending':d.invoiceStatus;
    const body={
      customerId:d.customerId,dealerId:d.dealerId,salespersonId:d.salespersonId,salespersonName:d.salesperson?.name||'',
      discountPct:d.discountPct,warehouseId:d.warehouseId,date:d.date,paymentMethod:d.method,
      payments:d.payments,promissory:d.promissory,billingParty:d.billingParty||'individual',
      description:d.description,items:d.items,invoiceStatus,invoiceNumber:d.invoiceNumber,invoiceDate:d.invoiceDate,
      deductStock:Boolean(d.deductStock)
    };
    const r=await api('/web-api/admin/customer-sale',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    let noteText='';
    (r.collections||[]).forEach(c=>{if(c?.id)window.open('/web-api/admin/receipt/'+c.id,'_blank')});
    lastSaleDocsUrl=r.docsUrl||r.promissory?.printUrl||(r.sale?.id?`/web-api/admin/sale/${r.sale.id}/print-docs`:'');
    if(lastSaleDocsUrl && canSaleDocs()){printSaleDocs(lastSaleDocsUrl);noteText=' · senet/sözleşme açıldı'}
    const createdSaleId=r.sale?.id||r.saleId||r.id;
    if(d.invoiceStatus==='queue_qnb'&&createdSaleId&&canSaleInvoice()){
      try{
        const inv=await api('/web-api/admin/sale/'+encodeURIComponent(createdSaleId)+'/issue-invoice',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({billingParty:d.billingParty||'individual'})});
        noteText+=` · fatura ${inv.result?.docType||''} (${inv.record?.status||'kuyruk'})`;
      }catch(invErr){noteText+=` · fatura uyarısı: ${invErr.message}`}
    }
    closeSalesPreview();
    st.textContent=`Satış bitti: ${r.sale?.reference||r.reference||'OK'}${noteText}`;
    $('#salesStatus').textContent=st.textContent;
    salesReset();
  }catch(e){st.textContent=e.message||'Satış kaydedilemedi'}
  finally{if(btn){btn.disabled=false;btn.textContent='✓ Kontrol Ettim, Satışı Yap'}}
}
async function saveSale(){openSalesPreview()}

document.querySelectorAll('.pos-step').forEach(btn=>btn.addEventListener('click',()=>{
  const to=Number(btn.dataset.posStep);
  if(to>=2 && !$('#salesCustomerSelect')?.value){ $('#salesStatus').textContent='Önce müşteri seçin';return}
  if(to>=3 && !salesCart.length){ $('#salesStatus').textContent='Önce ürün ekleyin';return}
  setSalesStep(to);
}));
$('#salesNext1')?.addEventListener('click',()=>{if($('#salesCustomerSelect')?.value)setSalesStep(2)});
$('#salesNext2')?.addEventListener('click',()=>{
  if(!salesCart.length){stToast('Sepete ürün ekleyin');return}
  if(cartHasMissingPrice()){stToast('Her ürün için tutarı elle girin');return}
  setSalesStep(3);
  setTimeout(()=>document.querySelector('#salesPayPlanToggleBtn')?.scrollIntoView({behavior:'smooth',block:'center'}),80);
});
$('#salesBack2')?.addEventListener('click',()=>setSalesStep(1));
$('#salesBack3')?.addEventListener('click',()=>setSalesStep(2));
$('#salesResetBtn')?.addEventListener('click',salesReset);
$('#salesFooterResetBtn')?.addEventListener('click',salesReset);
$('#customerSearchSaleBtn')?.addEventListener('click',salesSearchCustomers);
$('#customerSearchSale')?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();salesSearchCustomers()}});
$('#customerSearchSale')?.addEventListener('input',()=>{
  clearTimeout(window.__salesCustSearchT);
  const term=String($('#customerSearchSale')?.value||'').trim();
  if(term.length<1)return;
  window.__salesCustSearchT=setTimeout(()=>salesSearchCustomers(),280);
});
$('#salesCustomerSelect')?.addEventListener('change',salesCustomerChanged);
['#productSearch','#salesItemCodeFilter','#salesMaterialCodeFilter'].forEach(id=>{
  $(id)?.addEventListener('input',()=>{
    clearTimeout(window.__prodFilterT);
    window.__prodFilterT=setTimeout(renderProducts,160);
  });
});
$('#productRows')?.addEventListener('click',e=>{
  const btn=e.target.closest('[data-code]');
  if(btn)addToCart(btn.dataset.code);
});
$('#cartRows')?.addEventListener('input',e=>{
  const row=e.target.closest('[data-idx]');if(!row)return;
  const i=Number(row.dataset.idx);const item=salesCart[i];if(!item)return;
  if(e.target.matches('[data-qty]'))item.qty=Math.max(1,Math.round(num(e.target.value)||1));
  if(e.target.matches('[data-price]'))item.unitPrice=Math.max(0,num(e.target.value));
  // Fiyat yazarken tüm sepeti yeniden çizme — odak kaybolmasın
  if(e.target.matches('[data-price]')){
    $('#cartSubtotal').textContent=money(cartGross());
    setSalesStep(salesStep);
    return;
  }
  renderCart();
});
$('#cartRows')?.addEventListener('click',e=>{
  const del=e.target.closest('[data-del]');if(!del)return;
  const row=del.closest('[data-idx]');if(!row)return;
  salesCart.splice(Number(row.dataset.idx),1);
  renderCart();
});
$('#salesDiscountPct')?.addEventListener('input',salesRecalcPay);
$('#salesDealer')?.addEventListener('change',salesRecalcPay);
['#payCash','#payCard','#payTransfer','#payCredit','#payNote'].forEach(id=>{
  $(id)?.addEventListener('input',salesRecalcPay);
  $(id)?.addEventListener('change',salesRecalcPay);
});
document.querySelectorAll('[data-pay-fill]').forEach(btn=>{
  btn.addEventListener('click',()=>salesFillRemainingTo(btn.getAttribute('data-pay-fill')));
});
$('#salesPayPlanToggleBtn')?.addEventListener('click',()=>setSalesPayPlanOpen(!salesPayPlanIsOpen()));
$('#salesPayPlanCloseBtn')?.addEventListener('click',()=>setSalesPayPlanOpen(false));
$('#salesSaveInlineBtn')?.addEventListener('click',()=>openSalesPreview());
$('#salesJumpPreviewBtn')?.addEventListener('click',()=>openSalesPreview());
$('#salesWizardDocsBtn')?.addEventListener('click',()=>printSalesContractAndNotes());
$('#salesWizardOfferBtn')?.addEventListener('click',()=>sendSalesOffer());
$('#salesWizardInvoiceBtn')?.addEventListener('click',()=>salesIssueInvoiceNow());
$('#salesPreviewClose')?.addEventListener('click',closeSalesPreview);
$('#salesPreviewConfirmBtn')?.addEventListener('click',confirmSalesDraft);
$('#salesPreviewOfferBtn')?.addEventListener('click',sendSalesOffer);
$('#salesPreviewPrintBtn')?.addEventListener('click',printSalesOffer);
$('#salesPreviewDocsBtn')?.addEventListener('click',printSalesContractAndNotes);
$('#salesInvoiceStatus')?.addEventListener('change',salesRecalcPay);
['#promissoryInstallments','#promissoryInterval','#promissoryFirstDue'].forEach(id=>{
  $(id)?.addEventListener('input',renderPromissorySchedule);
  $(id)?.addEventListener('change',renderPromissorySchedule);
});
$('#salesDockPreviewBtn')?.addEventListener('click',()=>{
  if(salesStep===1){if($('#salesCustomerSelect')?.value)setSalesStep(2);return}
  if(salesStep===2){
    if(!salesCart.length){stToast('Sepete ürün ekleyin');return}
    if(cartHasMissingPrice()){stToast('Her ürün için tutarı elle girin');return}
    setSalesStep(3);return;
  }
  openSalesPreview();
});

function syncQcInvoiceUI(){
  const corp=document.querySelector('input[name="qcInvoiceTypeRadio"]:checked')?.value==='corporate';
  if($('#qcInvoiceType'))$('#qcInvoiceType').value=corp?'corporate':'individual';
  // Bireysel bilgiler her zaman görünür; kurumsal alanlar sadece seçilince
  $('#qcIndividualSec')?.classList.remove('hidden');
  $('#qcCompanyWrap')?.classList.toggle('hidden',!corp);
  $('#qcTaxOfficeWrap')?.classList.toggle('hidden',!corp);
  $('#qcTaxNoWrap')?.classList.toggle('hidden',!corp);
  if($('#qcTckn'))$('#qcTckn').required=false;
  if($('#qcCompanyName'))$('#qcCompanyName').required=corp;
  if($('#qcTaxOffice'))$('#qcTaxOffice').required=corp;
  if($('#qcTaxNo'))$('#qcTaxNo').required=corp;
}
document.querySelectorAll('input[name="qcInvoiceTypeRadio"]').forEach(r=>r.addEventListener('change',syncQcInvoiceUI));
$('#salesNewCustomerBtn')?.addEventListener('click',()=>{
  $('#salesQuickCustomerForm')?.reset();
  const ind=document.querySelector('input[name="qcInvoiceTypeRadio"][value="individual"]');
  if(ind)ind.checked=true;
  $('#qcStatus').textContent='';
  syncQcInvoiceUI();
  $('#salesQuickCustomerModal')?.classList.remove('hidden');
});
$('#salesQuickCustomerClose')?.addEventListener('click',()=>$('#salesQuickCustomerModal')?.classList.add('hidden'));
$('#salesQuickCustomerForm')?.addEventListener('submit',async e=>{
  e.preventDefault();
  const st=$('#qcStatus');
  st.textContent='Kaydediliyor...';
  try{
    const invoiceType=document.querySelector('input[name="qcInvoiceTypeRadio"]:checked')?.value==='corporate'?'corporate':'individual';
    const companyName=($('#qcCompanyName')?.value||'').trim();
    const taxOffice=($('#qcTaxOffice')?.value||'').trim();
    const taxNo=($('#qcTaxNo')?.value||'').trim();
    const tckn=($('#qcTckn')?.value||'').trim();
    if(invoiceType==='corporate'){
      if(!companyName)throw new Error('Kurumsal fatura için firma ünvanı zorunludur');
      if(!taxOffice)throw new Error('Kurumsal fatura için vergi dairesi zorunludur');
      if(taxNo.replace(/\D/g,'').length<10)throw new Error('Kurumsal fatura için 10 haneli VKN zorunludur');
    }
    if(tckn&&tckn.replace(/\D/g,'').length!==11)throw new Error('TCKN girildiyse 11 hane olmalıdır');
    const r=await api('/web-api/admin/customer',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        name:$('#qcName').value,phone:$('#qcPhone').value,
        city:$('#qcCity').value,district:$('#qcDistrict').value,address:$('#qcAddress').value,
        deliverySameAsBilling:true,invoiceType,
        tckn:tckn||'',
        companyName:invoiceType==='corporate'?companyName:'',
        taxOffice:invoiceType==='corporate'?taxOffice:'',
        taxNo:invoiceType==='corporate'?taxNo:''
      })
    });
    const row=r.row||{};
    const map=new Map(salesCustomers.map(c=>[String(c.id),c]));
    map.set(String(row.id),row);
    salesCustomers=[...map.values()];
    salesCustomerTotal=Number(salesCustomerTotal||0)+1;
    $('#salesQuickCustomerModal')?.classList.add('hidden');
    if($('#customerSearchSale'))$('#customerSearchSale').value=row.name||'';
    $('#salesCustomerSelect').innerHTML=`<option value="${row.id}">${row.name||''}${row.phone?' · '+row.phone:''}</option>`;
    $('#salesCustomerSelect').value=row.id;
    if($('#salesCustomerCount'))$('#salesCustomerCount').textContent='1 sonuç';
    if($('#salesCustomerSearchHint'))$('#salesCustomerSearchHint').textContent='Yeni müşteri kaydedildi ve seçildi.';
    salesCustomerChanged();
    st.textContent='';
  }catch(err){st.textContent=err.message}
});

$('#stockCard').onclick=async()=>{
  hidePanels();
  $('#stockPanel').classList.remove('hidden');
  const st=$('#stockStatus');
  try{
    const stockData=await api('/web-api/admin/stock-center');
    $('#stockRows').innerHTML=(stockData.stocks||[]).slice(0,300).map(x=>`
      <tr>
        <td><b>${x.productCode||''}</b><small>${x.productName||''}</small></td>
        <td>${x.warehouseName||''}</td>
        <td>${Number(x.quantity||0)}</td>
        <td>${Number(x.available||0)}</td>
      </tr>`).join('')||'<tr><td colspan="4">Stok kaydı bulunamadı.</td></tr>';
    st.textContent='';
  }catch(e){st.textContent=e.message}
};

$('#announceCard').onclick=async()=>{
  hidePanels();
  $('#announcementPanel').classList.remove('hidden');
  try{
    const d=await api('/foundation-api/dashboard');
    $('#announcementList').innerHTML=(d.announcements||[]).map(x=>`
      <div class="announcement ${x.read?'':'unread'}">
        <div><b>${x.title||'Duyuru'}</b><small>${x.message||x.description||''}</small></div>
      </div>`).join('')||'Aktif duyuru yok.';
  }catch(e){$('#announcementList').textContent=e.message}
};

/* ——— Müşteri Ödemeleri ——— */
let payState={filter:'overdue',q:'',rows:[],recentPaid:[],accounts:[],summary:null,selectedId:''};
function payBucketLabel(b){return({overdue:'Geciken',due:'Bu Ay',open:'Açık',paid:'Kapalı'}[b]||b||'—')}
function todayLocal(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
function renderPayments(){
  const sum=payState.summary||{};
  const box=$('#paySummary');
  if(box){
    box.innerHTML=`
      <div class="stat"><small>Geciken</small><b>${sum.overdueCustomers||0}</b><span>${money(sum.overdueAmount||0)}</span></div>
      <div class="stat"><small>Bu Ay</small><b>${sum.dueMonthCustomers||0}</b><span>${money(sum.dueMonthAmount||0)}</span></div>
      <div class="stat"><small>Açık Cari</small><b>${sum.openCustomers||0}</b><span>${money(sum.openBalance||0)}</span></div>
      <div class="stat"><small>Listede</small><b>${(payState.rows||[]).length}</b><span>${payBucketLabel(payState.filter)}</span></div>`;
  }
  const tbody=$('#payRows');
  if(tbody){
    tbody.innerHTML=(payState.rows||[]).length
      ?(payState.rows||[]).map(r=>`<tr data-pay-cust="${r.customerId}" class="${r.customerId===payState.selectedId?'active':''}">
          <td><b>${r.customerName||'—'}</b><br><small>${r.customerPhone||''}</small></td>
          <td><span class="pay-bucket ${r.bucket}">${payBucketLabel(r.bucket)}</span></td>
          <td>${money(r.balance)}</td>
          <td>${money(r.overdueAmount)}</td>
          <td>${money(r.dueMonthAmount)}</td>
          <td>${r.nextDue||'—'}</td>
        </tr>`).join('')
      :'<tr><td colspan="6">Bu filtrede kayıt yok.</td></tr>';
    tbody.querySelectorAll('[data-pay-cust]').forEach(tr=>{
      tr.onclick=()=>selectPayCustomer(tr.dataset.payCust);
    });
  }
  const recent=$('#payRecent');
  if(recent){
    recent.innerHTML=(payState.recentPaid||[]).length
      ?(payState.recentPaid||[]).map(t=>`<tr>
          <td>${t.date||''}</td>
          <td>${t.customerName||'—'}</td>
          <td>${money(t.amount)}</td>
          <td>${t.method||'—'}</td>
          <td><button type="button" class="ghost-btn" data-receipt="${t.receiptUrl||''}">A5 Yazdır</button></td>
        </tr>`).join('')
      :'<tr><td colspan="5">Henüz tahsilat yok.</td></tr>';
    recent.querySelectorAll('[data-receipt]').forEach(btn=>{
      btn.onclick=()=>{if(btn.dataset.receipt)window.open(btn.dataset.receipt+(btn.dataset.receipt.includes('?')?'&':'?')+'autoprint=1','_blank')};
    });
  }
  if(payState.selectedId)selectPayCustomer(payState.selectedId,true);
}
function selectPayCustomer(customerId,keepAmount=false){
  payState.selectedId=String(customerId||'');
  const row=(payState.rows||[]).find(r=>String(r.customerId)===payState.selectedId);
  document.querySelectorAll('#payRows tr').forEach(tr=>tr.classList.toggle('active',tr.dataset.payCust===payState.selectedId));
  const hint=$('#payDetailHint'),body=$('#payDetailBody');
  if(!row){
    if(hint){hint.classList.remove('hidden');hint.textContent='Soldan müşteri seçin.';}
    body?.classList.add('hidden');
    return;
  }
  hint?.classList.add('hidden');
  body?.classList.remove('hidden');
  const suggest=row.overdueAmount>0.009?row.overdueAmount:(row.dueMonthAmount>0.009?row.dueMonthAmount:Math.max(row.balance,0));
  $('#payCustomerBox').innerHTML=`<b>${row.customerName||''}</b><br><small>${row.customerPhone||''}</small><br>
    Cari: <b>${money(row.balance)}</b> · Geciken: <b>${money(row.overdueAmount)}</b> · Bu ay: <b>${money(row.dueMonthAmount)}</b>`;
  $('#payNotes').innerHTML=(row.notes||[]).map(n=>{
    const open=!['paid','cancelled'].includes(String(n.status||'open'));
    return `<tr class="${n.overdue?'pay-note-overdue':''}">
      <td>${open?`<input type="checkbox" class="pay-note-cb" value="${n.id}">`:''}</td>
      <td>${n.serial||String(n.id).slice(0,8)}</td>
      <td>${n.dueDate||'—'}</td>
      <td>${money(n.remain)}</td>
      <td>${n.status==='paid'?'Ödendi':(n.overdue?'Gecikmiş':(n.status==='partial'?'Kısmi':'Açık'))}</td>
    </tr>`;
  }).join('')||'<tr><td colspan="5">Senet kaydı yok — ödeme cari bakiyeden düşer.</td></tr>';
  const acc=$('#payAccount');
  if(acc){
    const cur=acc.value;
    acc.innerHTML=(payState.accounts||[]).map(a=>`<option value="${a.id}">${a.name}</option>`).join('')||'<option value="">Kasa yok</option>';
    if(cur && [...acc.options].some(o=>o.value===cur))acc.value=cur;
  }
  if(!keepAmount || !Number($('#custPayAmount')?.value||0)){
    if($('#custPayAmount'))$('#custPayAmount').value=suggest>0?suggest.toFixed(2):'';
  }
  if($('#payDate') && !$('#payDate').value)$('#payDate').value=todayLocal();
  document.querySelectorAll('.pay-note-cb').forEach(cb=>{
    cb.onchange=()=>{
      const ids=[...document.querySelectorAll('.pay-note-cb:checked')].map(x=>x.value);
      if(!ids.length)return;
      const total=(row.notes||[]).filter(n=>ids.includes(n.id)).reduce((a,n)=>a+Number(n.remain||0),0);
      if($('#custPayAmount'))$('#custPayAmount').value=total.toFixed(2);
    };
  });
}
async function loadPayments(){
  const st=$('#payStatus');
  if(st)st.textContent='Yükleniyor...';
  try{
    const d=await api(`/web-api/admin/customer-payments-board?filter=${encodeURIComponent(payState.filter)}&q=${encodeURIComponent(payState.q||'')}`);
    payState.rows=d.rows||[];
    payState.recentPaid=d.recentPaid||[];
    payState.accounts=d.accounts||[];
    payState.summary=d.summary||null;
    renderPayments();
    if(st)st.textContent='';
  }catch(e){if(st)st.textContent=e.message}
}
$('#paymentsCard')?.addEventListener('click',()=>{
  hidePanels();
  $('#paymentsPanel').classList.remove('hidden');
  loadPayments();
});
$('#payRefresh')?.addEventListener('click',loadPayments);
$('#payFilterToggle')?.addEventListener('click',e=>{
  const btn=e.target.closest('[data-pay-filter]'); if(!btn)return;
  payState.filter=btn.dataset.payFilter||'open';
  document.querySelectorAll('#payFilterToggle .period-btn').forEach(b=>b.classList.toggle('active',b===btn));
  loadPayments();
});
let paySearchTimer=null;
$('#paySearch')?.addEventListener('input',()=>{
  clearTimeout(paySearchTimer);
  paySearchTimer=setTimeout(()=>{payState.q=$('#paySearch').value.trim();loadPayments()},280);
});
$('#payForm')?.addEventListener('submit',async e=>{
  e.preventDefault();
  const st=$('#payStatus');
  if(!payState.selectedId){st.textContent='Önce müşteri seçin.';return}
  const amount=Number($('#custPayAmount').value||0);
  const accountId=$('#payAccount').value;
  if(!(amount>0)||!accountId){st.textContent='Tutar ve kasa zorunlu.';return}
  const noteIds=[...document.querySelectorAll('.pay-note-cb:checked')].map(x=>x.value);
  st.textContent='Kaydediliyor...';
  try{
    const d=await api('/web-api/admin/customer-collection',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        customerId:payState.selectedId,amount,accountId,
        paymentMethod:$('#payMethod').value,
        date:$('#payDate').value||todayLocal(),
        description:$('#payDesc').value.trim()||'Aylık ödeme tahsilatı',
        noteIds
      })
    });
    st.textContent=`Ödeme alındı. Kalan cari: ${money(d.balance)}`;
    if(d.receiptUrl)window.open(d.receiptUrl+(d.receiptUrl.includes('?')?'&':'?')+'autoprint=1','_blank');
    await loadPayments();
    if(payState.selectedId)selectPayCustomer(payState.selectedId);
  }catch(err){st.textContent=err.message}
});

loadSession();
