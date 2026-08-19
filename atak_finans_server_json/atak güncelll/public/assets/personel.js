/* ATAK_PERSONEL_BUILD=fix-v189 */
function sipBtn(phone,opts){return typeof sipCallButton==='function'?sipCallButton(phone,opts||{}):''}
window.atakOnSipCall=function(info){
  const id=info?.customerId||(typeof payState!=='undefined'?payState.selectedId:'');
  if(!id)return;
  const phone=String(info?.href||'').replace(/^sip:/i,'');
  fetch('/web-api/admin/customer/'+encodeURIComponent(id)+'/comm',{
    method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({kind:'call',result:'started',phone})
  }).then(r=>r.json()).then(d=>{
    if(typeof payState!=='undefined' && String(id)===String(payState.selectedId) && typeof renderPayComms==='function')
      renderPayComms(id,d.comms);
  }).catch(()=>{});
};
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
  if(!r.ok){
    const err=new Error(d.error||'İşlem başarısız');
    err.payload=d;
    err.status=r.status;
    throw err;
  }
  return d;
}

let currentUser=null;
let pendingMfaChallengeId='';
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
function canInvoiceCenter(){
  return canScreen('screen_invoice_center')||canSaleInvoice()||has('screen_uninvoiced')
    ||canScreen('screen_sales_center')||has('orders_manage');
}
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
  $$('.pos-finish-card.invoice').forEach(el=>el.classList.toggle('hidden',!canInvoiceCenter()));
  $('#salesWizardOfferBtn')?.classList.toggle('hidden',!canSaleOffer());
}
function hidePanels(){
  ['#financePanel','#paymentsPanel','#salesPanel','#stockPanel','#announcementPanel','#trainingPanel'].forEach(x=>$(x)?.classList.add('hidden'));
  $('#home')?.classList.add('hidden');
  $('#salesStickyDock')?.classList.add('hidden');
  const player=$('#trainingPlayer');
  if(player&&!player.paused)player.pause();
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
    if(canInvoiceCenter()){
      $('#invoiceCard')?.classList.remove('hidden');
      $('#invoiceHeaderBtn')?.classList.remove('hidden');
    }
    if(canScreen('screen_finance')||canFinance())$('#financeCard').classList.remove('hidden');
    if(canScreen('screen_customer_payments')||canFinance())$('#paymentsCard').classList.remove('hidden');
    if(has('stock_manage')||has('stock_view'))$('#stockCard').classList.remove('hidden');
    applyStaffSalePermissions();
    const closed=[];
    if(!canScreen('screen_staff_sales_report'))closed.push('Personel Satış Raporu');
    if(!canScreen('screen_manager_approvals'))closed.push('Yönetici Onayları');
    if(!canInvoiceCenter())closed.push('e-Fatura Merkezi');
    if(!canSaleInvoice())closed.push('Fatura Kes');
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
  showLoginPanel('login');
}
function showLoginPanel(which){
  $('#loginForm')?.classList.toggle('hidden',which!=='login');
  $('#mfaForm')?.classList.toggle('hidden',which!=='mfa');
  $('#forgotForm')?.classList.toggle('hidden',which!=='forgot');
  $('#resetForm')?.classList.toggle('hidden',which!=='reset');
  if(which==='login')$('#loginError').textContent='';
  if(which==='mfa'){if($('#mfaError'))$('#mfaError').textContent='';}
  if(which==='forgot')$('#forgotError').textContent='';
  if(which==='reset')$('#resetError').textContent='';
}
function resetTokenFromUrl(){
  try{return new URLSearchParams(location.search).get('reset')||''}catch(_){return ''}
}

$('#loginForm').onsubmit=async e=>{
  e.preventDefault();
  $('#loginError').textContent='';
  try{
    const r=await api('/foundation-api/login',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({username:$('#username').value,password:$('#password').value})
    });
    if(r.mfaRequired){
      pendingMfaChallengeId=r.challengeId||'';
      const hours=r.trustHours||6;
      if($('#mfaHint'))$('#mfaHint').textContent=`Kod ${r.emailHint||'e-posta'} adresine gitti. Bu tarayıcı ${hours} saat tanınır.`;
      showLoginPanel('mfa');
      $('#mfaCode')?.focus();
      return;
    }
    await loadSession();
  }catch(err){$('#loginError').textContent=err.message}
};
$('#mfaForm')?.addEventListener('submit',async e=>{
  e.preventDefault();
  if($('#mfaError')){$('#mfaError').style.color='#b91c1c';$('#mfaError').textContent=''}
  try{
    await api('/foundation-api/login/verify-mfa',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({challengeId:pendingMfaChallengeId,code:$('#mfaCode')?.value||''})
    });
    pendingMfaChallengeId='';
    await loadSession();
  }catch(err){
    if($('#mfaError'))$('#mfaError').textContent=err.message;
  }
});
$('#mfaBackBtn')?.addEventListener('click',()=>{pendingMfaChallengeId='';showLoginPanel('login')});
$('#forgotOpenBtn')?.addEventListener('click',()=>showLoginPanel('forgot'));
$('#forgotBackBtn')?.addEventListener('click',()=>showLoginPanel('login'));
$('#resetBackBtn')?.addEventListener('click',()=>{
  try{history.replaceState({},'',location.pathname)}catch(_){}
  showLoginPanel('login');
});
$('#forgotForm')?.addEventListener('submit',async e=>{
  e.preventDefault();
  $('#forgotError').textContent='';
  try{
    const r=await api('/foundation-api/forgot-password',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({username:$('#forgotUser').value})
    });
    $('#forgotError').style.color='#15803d';
    $('#forgotError').textContent=r.message||'Mail gönderildiyse gelen kutunuzu kontrol edin.';
  }catch(err){
    $('#forgotError').style.color='#b91c1c';
    $('#forgotError').textContent=err.message;
  }
});
$('#resetForm')?.addEventListener('submit',async e=>{
  e.preventDefault();
  $('#resetError').textContent='';
  const p1=$('#resetPassword')?.value||'';
  const p2=$('#resetPassword2')?.value||'';
  if(p1!==p2){$('#resetError').textContent='Şifreler uyuşmuyor';return}
  const token=resetTokenFromUrl();
  if(!token){$('#resetError').textContent='Geçersiz link';return}
  try{
    const r=await api('/foundation-api/reset-password',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({token,password:p1})
    });
    $('#resetError').style.color='#15803d';
    $('#resetError').textContent=r.message||'Şifre güncellendi';
    setTimeout(()=>{
      try{history.replaceState({},'',location.pathname)}catch(_){}
      showLoginPanel('login');
    },900);
  }catch(err){
    $('#resetError').style.color='#b91c1c';
    $('#resetError').textContent=err.message;
  }
});
if(resetTokenFromUrl()){
  showLogin();
  showLoginPanel('reset');
}
$('#logout').onclick=async()=>{
  await api('/foundation-api/logout',{method:'POST'}).catch(()=>{});
  location.reload();
};
$('#homeBtn').onclick=showHome;
$('#brandHomeBtn')?.addEventListener('click',showHome);

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

function customerOptionLabel(c={}){
  return [c.name||'',c.customerCode||c.rapidCustAccount||'',c.phone||''].filter(Boolean).join(' · ');
}
async function fillNextCustomerCode(id){
  const el=$(id);
  if(!el||el.value)return;
  try{
    const d=await api('/web-api/admin/customer-code-next');
    if(!el.value && d.customerCode) el.value=d.customerCode;
  }catch(_){}
}
function renderCustomers(){
  const term=($('#customerSearch')?.value||'').toLocaleLowerCase('tr-TR');
  const rows=(financeData?.customers||[]).filter(c=>
    `${c.name||''} ${c.phone||''} ${c.taxNo||''} ${c.customerCode||''} ${c.rapidCustAccount||''}`.toLocaleLowerCase('tr-TR').includes(term)
  );
  $('#customerRows').innerHTML=rows.map(c=>`
    <tr>
      <td><b>${c.name||''}</b><small>${[c.customerCode||c.rapidCustAccount,c.taxNo].filter(Boolean).join(' · ')}</small></td>
      <td>${c.phone||'—'} ${sipBtn(c.phone,{className:'sip-call-sm',customerId:c.id})}</td>
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
      ?('<option value="">Müşteri seçin</option>'+salesCustomers.map(c=>`<option value="${c.id}">${customerOptionLabel(c)}</option>`).join(''))
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
function openPersonelInvoiceCenter(){
  const w=window.open('/e-fatura','_blank','noopener');
  if(!w)stToast('Tarayıcı yeni sekmeyi engelledi — e-Fatura ekranı açılamadı');
}
$('#invoiceCard')?.addEventListener('click',openPersonelInvoiceCenter);
$('#invoiceHeaderBtn')?.addEventListener('click',openPersonelInvoiceCenter);
function filterCustomersLocal(list,term){
  const q=String(term||'').trim().toLocaleLowerCase('tr-TR');
  if(!q)return [];
  const digits=q.replace(/\D+/g,'');
  return (list||[]).filter(c=>{
    const hay=`${c.name||''} ${c.phone||''} ${c.taxNo||''} ${c.tckn||''} ${c.companyName||''} ${c.customerCode||''} ${c.rapidCustAccount||''}`.toLocaleLowerCase('tr-TR');
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
    applyStaffBranchLock();
    applyStaffSalePermissions();
    $('#salesScopeHint').textContent=`Satışlar sizin adınıza kaydedilir · ${(cat.products||[]).length} ürün · ${salesCustomerTotal} müşteri${staffBrand()?` · ${staffBrandLabel(staffBrand())} kasası kilitli`:''}`;
    salesReset();
    if(salesCustomers.length && $('#salesCustomerSelect')){
      $('#salesCustomerSelect').innerHTML='<option value="">Müşteri seçin</option>'+
        salesCustomers.map(c=>`<option value="${c.id}">${customerOptionLabel(c)}</option>`).join('');
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
      rows.map(c=>`<option value="${c.id}" ${String(c.id)===String(current)?'selected':''}>${customerOptionLabel(c)}</option>`).join('');
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
  salesDetachKefil({silent:true});
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
    <div><small>Şahıs / Senet</small><b>${c.name||'—'}</b><span style="display:block;font-size:11px;color:#7a879a">Kod ${c.customerCode||c.rapidCustAccount||'—'} · TCKN ${c.tckn||'—'}</span></div>
    <div><small>Telefon</small><b>${c.phone||'—'}</b>${sipBtn(c.phone,{className:'sip-call-sm',customerId:c.id})}</div>
    <div><small>Cari</small><b>${money(c.balance)}</b></div>
    ${hasCorp?`<div><small>Fatura firması</small><b>${c.companyName||'—'}</b><span style="display:block;font-size:11px;color:#7a879a">VKN ${c.taxNo||'—'} · ${c.taxOffice||''}</span></div>`:''}`;
  salesRefreshKefilUI();
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
      <strong title="Malzeme adı">${malzeme}</strong>
      <span title="Madde / malzeme kodu">${madde}<small>${p.brand||p.code||''}</small></span>
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
      <div><strong>${esc(r.name||r.materialCode||r.code||'-')}</strong><small>${esc(r.itemCode||r.code||'')}</small></div>
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
function staffBrand(){
  return currentUser?.brand||'';
}
function staffBrandLabel(brand){
  return brand==='istikbal'?'İstikbal':brand==='beko'?'Beko':'';
}
function lockCashAccounts(list,brand){
  const cash=(list||[]).filter(a=>a&&a.active!==false&&a.type==='cash');
  if(!brand)return cash;
  const m=cash.filter(a=>a.brand===brand);
  return m.length?m:cash.filter(a=>!a.brand);
}
function lockBankAccounts(list,brand){
  const bank=(list||[]).filter(a=>a&&a.active!==false&&a.type==='bank');
  if(!brand)return bank;
  const m=bank.filter(a=>!a.brand||a.brand===brand);
  return m.length?m:bank.filter(a=>!a.brand);
}
function lockDealers(list,brand){
  const d=(list||[]).filter(x=>x&&x.active!==false);
  if(!brand)return d;
  const m=d.filter(x=>x.brand===brand);
  return m.length?m:d;
}
function lockWarehouses(list,brand){
  const w=(list||[]).filter(x=>x&&x.active!==false);
  if(!brand)return w;
  const m=w.filter(x=>x.brand===brand);
  return m.length?m:w;
}
function applyStaffBranchLock(){
  const brand=staffBrand();
  const label=staffBrandLabel(brand);
  const hint=$('#salesBranchLockHint');
  if(hint)hint.textContent=brand?`${label} şubesi — kasa, bayi ve depo ${label}’e kilitli.`:'';
  const dealers=lockDealers(salesData?.dealerSettings||[],brand);
  if($('#salesDealer')){
    const cur=$('#salesDealer').value;
    $('#salesDealer').innerHTML=dealers.map(d=>`<option value="${d.id}">${d.name}</option>`).join('')||'<option value="">Bayi yok</option>';
    if(cur&&[...$('#salesDealer').options].some(o=>o.value===cur))$('#salesDealer').value=cur;
  }
  const whSource=(salesData?.warehouses||[]).length?salesData.warehouses:(financeData?.warehouses||[]);
  const warehouses=lockWarehouses(whSource,brand);
  if($('#salesWarehouse')){
    const cur=$('#salesWarehouse').value;
    $('#salesWarehouse').innerHTML=warehouses.map(w=>`<option value="${w.id}">${w.name}</option>`).join('')||'<option value="">Depo yok</option>';
    if(cur&&[...$('#salesWarehouse').options].some(o=>o.value===cur))$('#salesWarehouse').value=cur;
  }
  syncPayAccounts();
}
function syncPayAccounts(){
  const brand=staffBrand();
  const cashOpts=lockCashAccounts(salesAccounts,brand);
  const bankOpts=lockBankAccounts(salesAccounts,brand);
  const fill=(sel,rows,emptyLabel)=>{
    if(!sel)return;
    const cur=sel.value;
    if(!rows.length){
      sel.innerHTML=`<option value="">${emptyLabel}</option>`;
      return;
    }
    sel.innerHTML=rows.map(a=>`<option value="${a.id}">${a.name}</option>`).join('');
    if(cur && [...sel.options].some(o=>o.value===cur))sel.value=cur;
    else sel.value=rows[0].id;
  };
  fill($('#payCashAccount'),cashOpts,'Kasa hesabı yok — Ayarlar’dan ekleyin');
  fill($('#payCardAccount'),bankOpts,'Banka / POS yok — Ayarlar → Tür: Banka');
  fill($('#payTransferAccount'),bankOpts,'Banka hesabı yok — Ayarlar → Tür: Banka');
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
function salesHighlightPayRow(fieldId){
  document.querySelectorAll('.sales-pay-list .pay-method').forEach(el=>el.classList.remove('pay-row-focus'));
  const map={payCash:'.pay-cash',payCard:'.pay-card',payTransfer:'.pay-transfer',payCredit:'.pay-credit',payNote:'.pay-note'};
  const row=map[fieldId]?document.querySelector('.sales-pay-list '+map[fieldId]):null;
  if(row)row.classList.add('pay-row-focus');
  const accMap={payCash:'#payCashAccount',payCard:'#payCardAccount',payTransfer:'#payTransferAccount'};
  const acc=accMap[fieldId]?$(accMap[fieldId]):null;
  if(acc){
    setTimeout(()=>{try{acc.focus()}catch(_){}},60);
    if((fieldId==='payCard'||fieldId==='payTransfer')&&!acc.value){
      toast('Kart/Havale için önce Ayarlar → Kasa ve Banka’dan Tür=Banka hesabı ekleyin');
    }
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
  salesHighlightPayRow(fieldId);
  if(fieldId==='payCard'||fieldId==='payTransfer'){
    const acc=$(fieldId==='payCard'?'#payCardAccount':'#payTransferAccount');
    if(acc&&acc.value){try{acc.focus()}catch(_){}}
    else{el.focus();try{el.select()}catch(_){}}
  }else{
    el.focus();
    try{el.select()}catch(_){}
  }
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
  const paid=Math.round((s.cash+s.card)*100)/100;
  const due=Math.round((s.credit+s.note+s.transfer+Math.max(0,remaining))*100)/100;
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
    if(Math.abs(remaining)<0.009){hint.className='sales-pay-balance ok';hint.textContent=s.transfer>0?`Dağılım tamam. Havale ${money(s.transfer)} Ödemeler’e gider — banka gelince tahsil edilir.`:'Ödeme net tutara eşit — kaydedebilirsiniz.';}
    else if(remaining>0){hint.className='sales-pay-balance warn';hint.textContent=`Henüz ${money(remaining)} dağıtılmadı. Nakit/kart/havale/vadeli/senet girin.`;}
    else{hint.className='sales-pay-balance bad';hint.textContent=`Dağıtılan tutar netten ${money(Math.abs(remaining))} fazla.`;}
  }
  const preview=$('#payMethodPreview');
  if(preview)preview.textContent=parts.length?`Seçili ödeme: ${parts.join(' + ')}`:'Ödeme seçilmedi — ÖDEME PLANI butonundan dağıtın';
  $('#promissoryWrap')?.classList.toggle('hidden',s.note<=0);
  if(s.note>0)renderPromissorySchedule();
  else salesDetachKefil({silent:true});
  salesRefreshKefilUI();
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
function normalizeSalesGuarantor(g){
  if(!g||typeof g!=='object')return null;
  const name=String(g.name||'').trim();
  if(!name)return null;
  return {
    name,
    tckn:String(g.tckn||g.taxNo||'').trim(),
    phone:String(g.phone||g.gsm||'').trim(),
    workPhone:String(g.workPhone||'').trim(),
    homePhone:String(g.homePhone||'').trim(),
    homeAddress:String(g.homeAddress||g.address||'').trim(),
    workAddress:String(g.workAddress||'').trim(),
    customerId:g.customerId||g.id||''
  };
}
function customerToGuarantor(c){
  if(!c)return null;
  const addr=[c.address,c.district,c.city].filter(Boolean).join(', ');
  return normalizeSalesGuarantor({
    name:c.name,
    tckn:c.tckn||'',
    phone:c.phone||'',
    workPhone:c.workPhone||'',
    homePhone:c.homePhone||'',
    homeAddress:addr||'',
    workAddress:c.workAddress||'',
    customerId:c.id
  });
}
function salesSelectedCustomer(){
  return salesCustomers.find(x=>String(x.id)===String($('#salesCustomerSelect')?.value||''))||null;
}
function salesKefilAttached(){return $('#salesKefilAttached')?.value==='1'}
function salesReadKefilForm(){
  const name=($('#salesKefilName')?.value||'').trim();
  if(!name)return null;
  const tckn=($('#salesKefilTckn')?.value||'').trim();
  if(tckn&&tckn.replace(/\D/g,'').length!==11)throw new Error('Kefil TCKN 11 hane olmalıdır');
  return {
    name,tckn,
    phone:($('#salesKefilPhone')?.value||'').trim(),
    workPhone:($('#salesKefilWorkPhone')?.value||'').trim(),
    homePhone:($('#salesKefilHomePhone')?.value||'').trim(),
    homeAddress:($('#salesKefilHomeAddress')?.value||'').trim(),
    workAddress:($('#salesKefilWorkAddress')?.value||'').trim(),
    customerId:($('#salesKefilCustomerId')?.value||'').trim()
  };
}
function salesFillKefilForm(g={}){
  if($('#salesKefilName'))$('#salesKefilName').value=g.name||'';
  if($('#salesKefilTckn'))$('#salesKefilTckn').value=g.tckn||'';
  if($('#salesKefilPhone'))$('#salesKefilPhone').value=g.phone||'';
  if($('#salesKefilWorkPhone'))$('#salesKefilWorkPhone').value=g.workPhone||'';
  if($('#salesKefilHomePhone'))$('#salesKefilHomePhone').value=g.homePhone||'';
  if($('#salesKefilHomeAddress'))$('#salesKefilHomeAddress').value=g.homeAddress||'';
  if($('#salesKefilWorkAddress'))$('#salesKefilWorkAddress').value=g.workAddress||'';
  if($('#salesKefilCustomerId'))$('#salesKefilCustomerId').value=g.customerId||'';
}
function salesClearKefilForm(){salesFillKefilForm({})}
function salesReadKefilFormSafe(){
  try{return salesReadKefilForm()}catch(_){return null}
}
function salesRefreshKefilUI(){
  const noteAmt=Math.max(0,num($('#payNote')?.value));
  const attached=salesKefilAttached();
  const hint=$('#salesKefilStatusHint');
  const preview=$('#salesKefilPreview');
  if(hint){
    if(noteAmt<=0)hint.textContent='Senet tutarı girilince kefil eklenebilir';
    else if(attached)hint.textContent='Kefil seçildi — sözleşmede KEFİL kutusu dolar';
    else hint.textContent='Kefil ekle → kayıtlı müşterilerden seçin';
  }
  $('#salesKefilAddBtn')?.classList.toggle('hidden',noteAmt<=0||attached);
  $('#salesKefilClearBtn')?.classList.toggle('hidden',!attached);
  $('#salesKefilEdit')?.classList.toggle('hidden',!attached);
  if(preview){
    if(attached){
      const g=normalizeSalesGuarantor(salesReadKefilFormSafe())||{};
      preview.classList.remove('hidden');
      preview.innerHTML=`<b>${esc(g.name||'-')}</b><span>TCKN ${esc(g.tckn||'—')} · GSM ${esc(g.phone||'—')}</span>`;
    }else{preview.classList.add('hidden');preview.innerHTML=''}
  }
}
function salesDetachKefil({silent=false}={}){
  if($('#salesKefilAttached'))$('#salesKefilAttached').value='0';
  salesClearKefilForm();
  salesRefreshKefilUI();
  if(!silent)stToast('Kefil kaldırıldı');
}
function closeSalesKefilPicker(){
  $('#salesKefilPickerModal')?.classList.add('hidden');
}
async function searchSalesKefilCustomers(term=''){
  const st=$('#salesKefilPickerStatus'),list=$('#salesKefilPickerList');
  const debtorId=String($('#salesCustomerSelect')?.value||'');
  const qTerm=String(term||'').trim();
  if(st)st.textContent='Aranıyor...';
  try{
    let rows=[];
    if(qTerm.length>=1){
      const d=await api('/web-api/admin/customers/search?q='+encodeURIComponent(qTerm)+'&limit=60');
      rows=d.rows||[];
    }else{
      rows=(salesCustomers||[]).filter(c=>c.active!==false&&!c.deletedAt).slice(0,80);
    }
    rows=rows.filter(c=>String(c.id)!==debtorId&&c.active!==false&&!c.deletedAt);
    if(list){
      if(!rows.length){
        list.innerHTML=`<div class="muted" style="padding:12px">${qTerm?'Sonuç yok.':'Müşteri listesi boş — arama yazın.'}</div>`;
      }else{
        list.innerHTML=rows.map(c=>{
          const sub=[c.phone,c.tckn?('TCKN '+c.tckn):'',[c.district,c.city].filter(Boolean).join('/')].filter(Boolean).join(' · ');
          return `<button type="button" class="sales-kefil-pick-row" data-kefil-customer="${esc(c.id)}"><b>${esc(c.name||'-')}</b><span>${esc(sub||'—')}</span></button>`;
        }).join('');
      }
    }
    if(st)st.textContent=`${rows.length} müşteri`;
  }catch(e){
    if(list)list.innerHTML='';
    if(st)st.textContent=e.message||'Arama başarısız';
  }
}
async function openSalesKefilPicker(){
  if(Math.max(0,num($('#payNote')?.value))<=0){stToast('Önce senet tutarı girin');return}
  if(!salesSelectedCustomer()){stToast('Önce satış müşterisini seçin');return}
  const m=$('#salesKefilPickerModal');
  if(!m){stToast('Kefil seçim penceresi bulunamadı');return}
  if($('#salesKefilPickerSearch'))$('#salesKefilPickerSearch').value='';
  m.classList.remove('hidden');
  await searchSalesKefilCustomers('');
  $('#salesKefilPickerSearch')?.focus();
}
function salesPickKefilCustomer(c){
  const g=customerToGuarantor(c);
  if(!g){stToast('Seçilen müşteri kefil olarak kullanılamaz');return}
  if(String(c.id)===String($('#salesCustomerSelect')?.value||'')){
    stToast('Borçlu müşteri kefil olarak seçilemez');
    return;
  }
  salesFillKefilForm(g);
  if($('#salesKefilAttached'))$('#salesKefilAttached').value='1';
  salesRefreshKefilUI();
  closeSalesKefilPicker();
  stToast(`Kefil seçildi: ${g.name}`);
}
$('#salesKefilAddBtn')?.addEventListener('click',()=>openSalesKefilPicker());
$('#salesKefilClearBtn')?.addEventListener('click',()=>salesDetachKefil());
$('#salesKefilPickerClose')?.addEventListener('click',closeSalesKefilPicker);
$('#salesKefilPickerModal')?.addEventListener('click',e=>{if(e.target===$('#salesKefilPickerModal'))closeSalesKefilPicker()});
$('#salesKefilPickerSearch')?.addEventListener('input',()=>{
  clearTimeout(window.__kefilSearchT);
  window.__kefilSearchT=setTimeout(()=>searchSalesKefilCustomers($('#salesKefilPickerSearch')?.value||''),220);
});
$('#salesKefilPickerList')?.addEventListener('click',async e=>{
  const btn=e.target.closest('[data-kefil-customer]');if(!btn)return;
  const id=btn.getAttribute('data-kefil-customer');
  let c=(salesCustomers||[]).find(x=>String(x.id)===String(id));
  if(!c){
    try{
      const d=await api('/web-api/admin/customers/search?id='+encodeURIComponent(id)+'&limit=1');
      c=(d.rows||[])[0];
    }catch(_){}
  }
  if(!c){stToast('Müşteri bulunamadı');return}
  const map=new Map((salesCustomers||[]).map(x=>[String(x.id),x]));
  map.set(String(c.id),c);
  salesCustomers=[...map.values()];
  salesPickKefilCustomer(c);
});
['salesKefilWorkPhone','salesKefilHomePhone','salesKefilHomeAddress','salesKefilWorkAddress'].forEach(id=>{
  $('#'+id)?.addEventListener('input',()=>{if(salesKefilAttached())salesRefreshKefilUI()});
});
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
  if(s.card>0 && !$('#payCardAccount')?.value)return{error:'Kart için banka / POS seçin (Ayarlar → Tür: Banka)',status};
  if(s.transfer>0 && !$('#payTransferAccount')?.value)return{error:'Havale için banka seçin (Ayarlar → Tür: Banka)',status};
  const stockSel=$('#salesDeductStock')?.value||'no';
  const canStock=canDeductStock();
  const stockMode=stockSel==='yes'&&canStock?'deduct':(stockSel==='reserve'?'reserve':'none');
  const deductStock=stockMode==='deduct';
  const reserveStock=stockMode==='reserve';
  const warehouseId=$('#salesWarehouse')?.value||'';
  if((deductStock||reserveStock) && !warehouseId)return{error:reserveStock?'Rezerve için depo seçin':'Stoktan düşmek için depo seçin',status};
  if(stockSel==='yes' && !canStock)return{error:'Stok düşme yetkiniz yok — Rezerve et kullanabilirsiniz',status};
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
  let guarantor=null;
  if(s.note>0&&salesKefilAttached()){
    try{guarantor=salesReadKefilForm()}
    catch(err){return{error:err.message||'Kefil bilgisi geçersiz',status}}
    if(!guarantor)return{error:'Kefil eklendi ancak ad soyad boş',status};
  }
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
    paid:Math.round((s.cash+s.card)*100)/100,
    due:Math.round((s.credit+s.note+s.transfer)*100)/100,
    method:methods.join(' + ')||'Karma',
    payments,items:salesCart.map(r=>({productCode:r.code,itemCode:r.itemCode,materialCode:r.materialCode,productName:r.name,quantity:r.qty,unitPrice:num(r.unitPrice)})),
    promissory:s.note>0?{amount:s.note,installments:num($('#promissoryInstallments')?.value)||1,firstDueDate:$('#promissoryFirstDue')?.value,intervalMonths:num($('#promissoryInterval')?.value)||1,schedule}:null,
    guarantor,
    billingParty:customerHasCorp(cust)?'corporate':($('#salesBillingParty')?.value||'individual'),
    invoiceStatus,invoiceNumber:$('#salesInvoiceNumber')?.value||'',invoiceDate:$('#salesInvoiceDate')?.value||'',
    description:$('#salesDescription')?.value||'Mağaza satışı',
    date:$('#salesDate')?.value||new Date().toISOString().slice(0,10),
    deductStock,reserveStock,stockMode,warehouseId,
    warehouse:(salesData?.warehouses||[]).find(w=>String(w.id)===String(warehouseId))
  };
}
function salesPreviewHtml(d){
  const rows=d.items.map(i=>`<tr><td>${esc(i.itemCode||'-')}</td><td>${esc(i.materialCode||i.productName||i.productCode)}</td><td>${i.quantity}</td><td>${money(i.unitPrice)}</td><td>${money(i.quantity*i.unitPrice)}</td></tr>`).join('');
  const payRows=(d.payments||[]).map(p=>`<div class="sales-total-line"><span>${esc(p.method)}${p.method==='Havale'?' · Ödemeler’den tahsil':''}</span><b>${money(p.amount)}</b></div>`).join('');
  const havaleAmt=Math.round(((d.payments||[]).filter(p=>p.method==='Havale').reduce((a,p)=>a+Number(p.amount||0),0))*100)/100;
  const havaleNote=havaleAmt>0?`<div class="preview-note"><b>Havale:</b> ${money(havaleAmt)} kasa/bankaya yazılmaz. Yönetici Ödemeler’den tahsil eder.</div>`:'';
  const note=d.promissory?`<div class="preview-note"><b>Senet:</b> ${money(d.promissory.amount)} · ${d.promissory.installments} taksit · İlk vade ${esc(d.promissory.firstDueDate)}</div>`:'';
  const inv=d.invoiceStatus==='queue_qnb'?'Fatura kuyruğu':(d.invoiceStatus==='pending'?'Daha sonra kesilecek':(d.invoiceStatus==='issued'?`Manuel · ${esc(d.invoiceNumber)}`:'Fatura gerekmiyor'));
  const stockTxt=d.deductStock?`Düşülecek · ${esc(d.warehouse?.name||'')}`:(d.reserveStock?`Rezerve · ${esc(d.warehouse?.name||'')} (teslimde düşülür)`:'Değişmeyecek');
  return `<div class="preview-cards"><div><small>Müşteri</small><b>${esc(d.customer?.name||'-')}</b><span>${esc(d.customer?.phone||'')}</span></div><div><small>Bayi / Satıcı</small><b>${esc(d.dealer?.name||'-')}</b><span>${esc(d.salesperson?.name||'')}</span></div><div><small>Ödeme</small><b>${esc(d.method)}</b><span>Şimdi tahsil: ${money(d.paid)}</span></div></div><div class="table-wrap"><table><thead><tr><th>Madde</th><th>Malzeme</th><th>Adet</th><th>Birim</th><th>Toplam</th></tr></thead><tbody>${rows}</tbody></table></div><div class="preview-totals"><div><span>Brüt</span><b>${money(d.grossTotal)}</b></div><div><span>İskonto</span><b>-${money(d.discountAmount||0)}</b></div><div><span>Net</span><b>${money(d.total)}</b></div>${payRows}<div><span>Prim</span><b>${money(d.commissionAmount||0)}</b></div></div>${havaleNote}${note}<div class="preview-note"><b>Fatura:</b> ${inv}<br><b>Stok:</b> ${stockTxt}<br><b>Açıklama:</b> ${esc(d.description||'-')}</div>`;
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
function salesOfferWhatsAppUrl(d){
  const phone=String(d.customer?.phone||'').replace(/\D/g,'');
  if(!phone)return '';
  const trPhone=phone.startsWith('0')?'90'+phone.slice(1):(phone.startsWith('90')?phone:'90'+phone);
  return `https://wa.me/${trPhone}?text=${encodeURIComponent(salesOfferText(d))}`;
}
function salesOfferSheetHtml(d){
  const rows=(d.items||[]).map(i=>`<tr><td>${esc(i.itemCode||'-')}</td><td>${esc(i.materialCode||i.productName||i.productCode||'')}</td><td class="num">${i.quantity}</td><td class="num">${money(i.unitPrice)}</td><td class="num">${money(i.quantity*i.unitPrice)}</td></tr>`).join('');
  const addr=[d.customer?.address,d.customer?.district,d.customer?.city].filter(Boolean).join(', ');
  const pay=(d.payments||[]).map(p=>`<div><span>${esc(p.method)}</span><b>${money(p.amount)}</b></div>`).join('');
  const note=d.promissory?`<div><span>Senet</span><b>${money(d.promissory.amount)}</b></div>`:'';
  return `<section class="sheet">
    <div class="doc-head"><div class="brand">ATAK PAZARLAMA<small>Satış Teklifi · Müşteri kopyası</small></div>
      <div class="doc-meta"><b>TEKLİF</b><div>Tarih: ${esc(d.date||'')}</div><div>Satıcı: ${esc(d.salesperson?.name||'')}</div></div></div>
    <h2>SATIŞ TEKLİFİ</h2>
    <div class="grid2">
      <div class="box"><small>Müşteri</small><b>${esc(d.customer?.name||'-')}</b><div>${esc(d.customer?.phone||'')}</div></div>
      <div class="box"><small>Geçerlilik</small><b>3 iş günü</b><div>Fiyatlar stok / kampanya durumuna göre değişebilir</div></div>
      <div class="box" style="grid-column:1/-1"><small>Adres</small><b>${esc(addr||'-')}</b></div>
    </div>
    <table><thead><tr><th>Kod</th><th>Ürün / Malzeme</th><th class="num">Adet</th><th class="num">Birim</th><th class="num">Tutar</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="totals">
      <div><span>Brüt Toplam</span><b>${money(d.grossTotal)}</b></div>
      <div><span>İskonto</span><b>-${money(d.discountAmount||0)}</b></div>
      <div class="net"><span>Net Satış</span><b>${money(d.total)}</b></div>
      ${pay}${note}
    </div>
    ${d.promissory?`<div class="note-line"><b>Senet planı:</b> ${money(d.promissory.amount)} · ${d.promissory.installments} taksit · İlk vade ${esc(d.promissory.firstDueDate)}</div>`:''}
    ${d.description?`<div class="note-line"><b>Not:</b> ${esc(d.description)}</div>`:''}
    <div class="terms"><b>Notlar</b><ol><li>Bu belge tekliftir; sipariş onayı / satış kaydı sonrası sözleşme ve senet basılır.</li><li>Mali fatura yerine geçmez.</li></ol></div>
    <div class="signs"><div class="sig"><small>Satış Temsilcisi</small>${esc(d.salesperson?.name||'')}</div><div class="sig"><small>Müşteri</small>${esc(d.customer?.name||'')}</div></div>
  </section>`;
}
function openSalesOfferPrintWindow(d){
  const w=window.open('','_blank');
  if(!w){stToast('Açılır pencere engellendi');return null}
  const wa=salesOfferWhatsAppUrl(d);
  const waBtn=wa?`<a class="btn wa" href="${esc(wa)}" target="_blank" rel="noopener">WhatsApp Gönder</a>`:'';
  w.document.open();
  w.document.write(`<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>Satış Teklifi</title><style>
@page{size:A4;margin:12mm}*{box-sizing:border-box}body{margin:0;background:#d9e2ec;color:#13233f;font:10pt/1.45 Arial,Helvetica,sans-serif}
.toolbar{position:sticky;top:0;z-index:5;display:flex;flex-wrap:wrap;gap:8px;justify-content:center;align-items:center;padding:12px;background:#0b2a55;color:#fff}
.toolbar button,.toolbar a.btn{border:0;border-radius:8px;padding:10px 14px;font-weight:800;cursor:pointer;background:#fff;color:#0b2a55;text-decoration:none;display:inline-block;font:inherit}
.toolbar button.primary{background:#dda20c;color:#1a1300}.toolbar a.btn.wa{background:#25D366;color:#063}
.sheet{width:210mm;min-height:297mm;margin:16px auto;background:#fff;padding:14mm;box-shadow:0 10px 30px #0002}
.doc-head{display:flex;justify-content:space-between;gap:16px;border-bottom:3px solid #0b2a55;padding-bottom:12px;margin-bottom:14px}
.brand{font-size:22px;font-weight:900;color:#0b2a55}.brand small{display:block;font-size:11px;font-weight:600;color:#66768d;margin-top:3px}
.doc-meta{text-align:right;font-size:12px;color:#4b5b73}.doc-meta b{display:block;font-size:16px;color:#0b2a55;margin-bottom:4px}
h2{margin:0 0 12px;font-size:18px;color:#0b2a55}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:12px 0}
.box{border:1px solid #d7e2ef;border-radius:8px;padding:10px 12px;background:#f8fafc}.box small{display:block;color:#66768d;font-size:11px;margin-bottom:3px}
table{width:100%;border-collapse:collapse;margin:14px 0}th,td{border-bottom:1px solid #e3ebf4;padding:8px 6px;text-align:left}th{font-size:11px;text-transform:uppercase;color:#66768d;border-bottom:2px solid #0b2a55}.num{text-align:right;white-space:nowrap}
.totals{width:320px;margin-left:auto}.totals div{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #e8eef5}.totals .net{font-size:16px;font-weight:900;color:#0b2a55;border-bottom:0;padding-top:10px}
.note-line{margin-top:12px;padding:10px 12px;border:1px solid #f0d48a;background:#fff8e8;border-radius:8px;font-size:12px}
.terms{margin-top:16px;font-size:11px;color:#4b5b73}.terms ol{margin:6px 0 0;padding-left:18px}
.signs{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:36px}.sig{border-top:1px solid #9aa8bc;padding-top:8px;text-align:center;min-height:70px}.sig small{display:block;color:#66768d;margin-bottom:28px}
@media print{body{background:#fff}.toolbar{display:none!important}.sheet{margin:0;box-shadow:none;width:auto}}
</style></head><body>
<div class="toolbar"><b>Satış Teklifi</b><button class="primary" onclick="window.print()">Yazdır / PDF Kaydet</button>${waBtn}<button onclick="window.close()">Kapat</button></div>
${salesOfferSheetHtml(d)}
</body></html>`);
  w.document.close();
  try{w.focus()}catch(_){}
  return w;
}
function sendSalesOfferWhatsAppOnly(){
  if(!canSaleOffer()){stToast('Teklif yetkiniz yok');return}
  const d=activeSalesDraft||collectSalesDraft();
  if(d.error){stToast(d.error);return}
  const url=salesOfferWhatsAppUrl(d);
  if(!url){navigator.clipboard?.writeText(salesOfferText(d));stToast('Telefon yok — teklif panoya kopyalandı');return}
  const win=window.open(url,'_blank');
  if(!win){navigator.clipboard?.writeText(salesOfferText(d));stToast('Pencere engellendi — teklif panoya kopyalandı')}
}
/** Teklif: yazdırılabilir şablon (+ WhatsApp) */
function sendSalesOffer(){
  if(!canSaleOffer()){stToast('Teklif yetkiniz yok');return}
  const d=activeSalesDraft||collectSalesDraft();
  if(d.error){stToast(d.error);return}
  activeSalesDraft=d;
  const w=openSalesOfferPrintWindow(d);
  if(w)stToast(salesOfferWhatsAppUrl(d)?'Teklif şablonu açıldı — Yazdır veya WhatsApp':'Teklif şablonu açıldı');
}
function printSalesOffer(){
  if(!canSaleOffer()){stToast('Teklif yetkiniz yok');return}
  const d=activeSalesDraft||collectSalesDraft();
  if(d.error){stToast(d.error);return}
  activeSalesDraft=d;
  openSalesOfferPrintWindow(d);
}
function salesAmountWords(n){
  n=Math.round(Number(n||0)*100)/100;
  const ones=['','bir','iki','üç','dört','beş','altı','yedi','sekiz','dokuz'];
  const tens=['','on','yirmi','otuz','kırk','elli','altmış','yetmiş','seksen','doksan'];
  const chunk=x=>{x=Math.floor(x);if(!x)return '';const y=Math.floor(x/100),o=Math.floor((x%100)/10),b=x%10;return (y?(y===1?'yüz':ones[y]+' yüz'):'')+(tens[o]?((y||b)?' ':'')+tens[o]:'')+(b?(o||y?' ':'')+ones[b]:'')};
  const whole=Math.floor(n),kurus=Math.round((n-whole)*100);
  if(!whole&&!kurus)return 'sıfır Türk Lirası';
  let out='',rest=whole,i=0;const scales=['','bin','milyon','milyar'];
  if(!whole)out='sıfır';
  else{
    const parts=[];
    while(rest>0&&i<scales.length){
      const c=rest%1000;
      if(c){let w=chunk(c);if(i===1&&c===1)w='bin';else if(i>0)w=(w?w+' ':'')+scales[i];parts.unshift(w)}
      rest=Math.floor(rest/1000);i++;
    }
    out=parts.join(' ');
  }
  out=`${out} Türk Lirası`;
  if(kurus)out+=` ${chunk(kurus)} Kuruş`;
  return out.replace(/\s+/g,' ').trim();
}
function salesCombinedContractSenetA4Html(d){
  const items=d.items||[];
  const noteList=Array.isArray(d.promissory?.schedule)?d.promissory.schedule.slice():[];
  const net=Number(d.total||0);
  const companyLegal='ATAK EV GEREÇLERİ PAZ. TİC. LTD. ŞTİ.';
  const site='ATAK EV GEREÇLERİ';
  const companyTaxOffice='Sarıyer';
  const companyTaxNo='0940148218';
  const address='Ferahevler Mah. Adnan Kahveci Cad. No:109 Sarıyer / İstanbul';
  const companyTaxLine=`VD: ${companyTaxOffice} · Vergi No: ${companyTaxNo}`;
  const atakLogoSrc='/assets/atak-header-logo.png';
  const bekoLogoSrc='/assets/beko-logo.png';
  const istikbalLogoSrc='/assets/istikbal-logo.png';
  const partnersLogoSrc='/assets/partners-beko-istikbal.png';
  const atakLogoWhiteSrc='/assets/atak-header-logo-white.png';
  const phone='0212 223 28 71',wa='0543 358 50 60',email='tarabyabeko@gmail.com';
  const personName=d.customer?.name||'';
  const personTax=d.customer?.tckn||d.customer?.taxNo||'';
  const addr=[d.customer?.address,d.customer?.district,d.customer?.city].filter(Boolean).join(', ');
  const guarantor=(d.guarantor&&typeof d.guarantor==='object')?d.guarantor:(d.customer?.guarantor&&typeof d.customer.guarantor==='object'?d.customer.guarantor:{});
  const cashPaid=Math.round(((d.payments||[]).filter(p=>['Nakit','Kredi Kartı'].includes(String(p.method||''))).reduce((a,p)=>a+Number(p.amount||0),0))*100)/100;
  const sumSchedule=noteList.reduce((a,n)=>a+Number(n.amount||0),0);
  const senetTotal=Math.round((Number(d.promissory?.amount||0)||sumSchedule||0)*100)/100;
  const downPayment=cashPaid>0?cashPaid:Math.max(0,Math.round((net-senetTotal)*100)/100);
  const balance=senetTotal>0?senetTotal:Math.max(0,Math.round((net-downPayment)*100)/100);
  const dateTR=x=>{const s=String(x||'').slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return esc(s||'');const[y,m,day]=s.split('-');return `${day}.${m}.${y}`};
  const maxProducts=6;
  const shownItems=items.slice(0,maxProducts);
  const moreProducts=Math.max(0,items.length-shownItems.length);
  const emptyRows=shownItems.length?0:1;
  const productRows=(shownItems.map(i=>{const qty=Number(i.quantity||1);const total=qty*Number(i.unitPrice||0);const matName=i.productName||i.materialCode||i.searchName||i.name||i.productCode||i.itemCode||'-';return `<tr><td class="mat">${esc(matName)}</td><td class="c">${qty}</td><td class="num">${money(i.unitPrice)}</td><td class="num">${money(total)}</td></tr>`;}).join('')||'')+Array.from({length:emptyRows},()=>'<tr><td>&nbsp;</td><td></td><td></td><td></td></tr>').join('')+(moreProducts?`<tr class="more"><td colspan="4">+${moreProducts} ürün daha (toplam ${items.length} kalem)</td></tr>`:'');
  const schedShow=noteList.slice(0,10);
  const scheduleRows=(schedShow.map(n=>`<tr><td class="c">${dateTR(n.dueDate)}</td><td class="num">${money(n.amount)}</td></tr>`).join('')||'<tr><td>&nbsp;</td><td></td></tr>')+`<tr class="tot"><td class="c">TOPLAM</td><td class="num">${money(balance||senetTotal)}</td></tr>`;
  const partyRows=who=>[['Adı Soyadı',who.name||'','nm'],['T.C. Kimlik No',who.tckn||who.taxNo||'',''],['GSM',who.phone||who.gsm||'',''],['Adres',who.homeAddress||who.address||'','']].map(([l,v,cls])=>`<tr><td class="lbl">${l}</td><td class="${cls}">${esc(v)}</td></tr>`).join('');
  const denseClass=shownItems.length>=4?' dense':'';
  const corpLine=customerHasCorp(d.customer||{})?`<div class="pay">Fatura firması: <b>${esc(d.customer.companyName||'')}</b> · VKN ${esc(d.customer.taxNo||'')} · ${esc(d.customer.taxOffice||'')}</div>`:'';
  const senetAmount=senetTotal||balance||0;
  const senetDue=noteList.length?(noteList[noteList.length-1].dueDate||noteList[0].dueDate||''):'';
  const resolveSenetPrintNo=()=>{
    if(d.senetNo!=null&&String(d.senetNo).trim()!=='')return String(d.senetNo).trim();
    if(d.promissory?.printNo!=null&&String(d.promissory.printNo).trim()!=='')return String(d.promissory.printNo).trim();
    const s0=noteList[0];
    if(s0?.printNo!=null&&String(s0.printNo).trim()!=='')return String(s0.printNo).trim();
    const ser=String(s0?.serial||'').trim();
    if(/^\d+$/.test(ser))return String(Number(ser));
    const m=ser.match(/(?:^|[^0-9])(\d{1,6})$/);
    if(m)return String(Number(m[1]));
    return '1';
  };
  const senetNo=resolveSenetPrintNo();
  const senetWords=senetAmount>0?salesAmountWords(senetAmount):'';
  const senetWordsOnly=(senetWords||'').replace(/\s*Türk Lirası.*$/i,'').trim();
  const senetAmtHash=senetAmount>0?('#'+Number(senetAmount).toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2})+'#'):'';
  const saleRef=d.reference||'TASLAK';
  const moreSenets=noteList.length>1?`<div class="note">Tek senet tutarı toplam bakiyedir (${money(senetAmount)}). ${noteList.length} taksitin vade planı yukarıdaki tablodadır.</div>`:'';
  const css=`<style>
.a4c,.a4c *{font-family:Arial,Helvetica,sans-serif!important;box-sizing:border-box}
.a4c{padding:5mm 6mm 3mm!important;font:8pt/1.25 Arial,Helvetica,sans-serif;color:#000;position:relative;overflow:visible!important;display:flex;flex-direction:column;min-height:277mm}
.a4c .logo-top{display:flex;justify-content:flex-start;align-items:center;gap:0;margin:0 0 1.2mm}.a4c .logo-top img{height:9mm;width:auto;max-width:55mm;object-fit:contain;object-position:left center}.a4c .top{display:grid;grid-template-columns:1fr auto;grid-template-areas:'left title' 'meta meta';gap:2px 6px;align-items:start;flex:0 0 auto}.a4c .head-left{grid-area:left}.a4c .mid-head{grid-area:title;text-align:right;padding-top:1px;align-self:center}.a4c .meta-row{grid-area:meta;display:flex;align-items:center;justify-content:flex-start;gap:2.5mm;margin-top:0;min-height:17mm;overflow:visible!important}.a4c .meta-texts{display:flex;flex-direction:column;justify-content:center;gap:1px;flex:1 1 auto;min-width:0;max-width:95mm;min-height:17mm}.a4c .meta-row .meta,.a4c .meta-texts .meta{margin:0;white-space:normal;overflow:visible;font-size:6.7pt!important;line-height:1.2!important}.a4c .partners{display:block;flex:0 0 auto;overflow:visible!important;margin-left:2.5mm}.a4c .partners img.partners-strip{height:16.5mm;width:auto;max-height:16.5mm;max-width:95mm;object-fit:contain;object-position:left center;display:block}
.a4c .senet-side .senet-logo{display:block;width:100%;margin:0 0 3px}.a4c .senet-side .senet-logo img{width:100%;height:auto;max-height:10mm;object-fit:contain;object-position:left top}
.a4c .logo-bottom{display:none}
/* top grid areas */
.a4c .name,.a4c .meta,.a4c .title,.a4c th,.a4c td,.a4c .mat,.a4c .mmeta td,.a4c tr.more td,.a4c .box h3,.a4c .box td,.a4c .box td.lbl,.a4c .box td.nm,.a4c .pay,.a4c .terms h4,.a4c .terms p,.a4c .sig b,.a4c .sig .nm,.a4c .sig .sigpad span,.a4c .senet,.a4c .senet-side,.a4c .senet-side strong,.a4c .senet-bar b,.a4c .senet-bar span,.a4c .fields span,.a4c .fields b,.a4c .sbody,.a4c .sbody b,.a4c .sbody u,.a4c .duo .lab,.a4c .duo .v,.a4c .duo .v.nm,.a4c .keside,.a4c .foot,.a4c.dense td,.a4c.dense .mat,.a4c.dense .terms p,.a4c.dense .sbody{font-size:8pt!important;line-height:1.25!important;font-family:Arial,Helvetica,sans-serif!important;color:#000}
.a4c .name{font-weight:700}
.a4c .meta{margin-top:1px;font-size:7pt!important;line-height:1.2!important}
/* mid-head area */
.a4c .title{font-size:11pt!important;line-height:1.1!important;font-weight:700;letter-spacing:.04em}
.a4c .rule{height:1.5px;background:#000;margin:2px 0 3px;flex:0 0 auto}
.a4c .grid3{display:grid;grid-template-columns:1.7fr .55fr .6fr;gap:3px;flex:0 0 auto}
.a4c table{width:100%;border-collapse:collapse;table-layout:fixed;margin:0}
.a4c th,.a4c td{border:1px solid #c5d0dd;padding:2px 3px;vertical-align:top;color:#000}
.a4c th{background:#0a2748;color:#fff!important;font-weight:700;letter-spacing:.02em;text-transform:uppercase;text-align:center;padding:2px}
.a4c th.mat{text-align:left!important;padding-left:3px}
.a4c td{min-height:10px}
.a4c td.c,.a4c .c{text-align:center;vertical-align:middle}
.a4c td.num,.a4c .num{text-align:right;vertical-align:middle;font-variant-numeric:tabular-nums}
.a4c .mat{text-align:left!important;font-weight:600;white-space:normal!important;overflow:visible!important;text-overflow:clip!important;word-break:break-word;vertical-align:top;padding:2px 3px!important}
.a4c .mmeta td:first-child{width:46%;background:#f3f6fa;font-weight:700}
.a4c .tot td{background:#eef3f9;font-weight:700}
.a4c tr.more td{height:auto;padding:2px 3px;font-weight:700;background:#f8fafc;text-align:left}
.a4c .parties{display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-top:3px;flex:0 0 auto}
.a4c .box{border:1px solid #c5d0dd;border-radius:3px;overflow:hidden;padding:0;background:#fff}
.a4c .box h3{background:#0a2748;color:#fff!important;text-align:center;padding:2px;margin:0;font-weight:700}
.a4c .box table{border:0}
.a4c .box td{border-color:#e4ebf3}
.a4c .box td.lbl{width:32%;background:#f3f6fa;font-weight:700}
.a4c .box td.nm{font-weight:700;white-space:normal;text-align:left}
.a4c .pay{margin:2px 0 1px;flex:0 0 auto;font-size:7.5pt!important}
.a4c .terms{flex:0 0 auto;margin-top:2px;margin-bottom:0}
.a4c .terms h4{display:inline-block;color:#000;border-bottom:1px solid #000;margin:0 0 2px;font-weight:700;font-size:8pt!important}
.a4c .terms p{text-align:justify;margin:0 0 1.5px;font-size:7pt!important;line-height:1.22!important}.a4c .terms p:last-child{margin:0}
.a4c .signs{display:grid;grid-template-columns:1fr 1fr 1fr;gap:5px;margin-top:2mm!important;flex:0 0 auto!important;height:auto;max-height:none}
.a4c .sig{border:1px solid #b8c4d4;border-radius:3px;padding:3px 4px 2px;text-align:center;display:flex;flex-direction:column;background:#fff;min-height:32mm}
.a4c .sig b{display:block;font-weight:700;font-size:8pt!important;margin:0}
.a4c .sig small{display:none}
.a4c .sig .nm{font-weight:700;margin:1px 0 0;font-size:8pt!important;line-height:1.2!important;white-space:normal;word-break:break-word;text-align:center}
.a4c .sig .sigpad{flex:1 1 auto!important;height:22mm!important;min-height:22mm!important;max-height:none!important;margin-top:2px;border-top:1px dashed #9aa8b8;display:flex;align-items:flex-end;justify-content:center;padding-bottom:1px}
.a4c .sig .sigpad span{color:#666;font-size:7pt!important}
.a4c .grow{flex:0 0 auto;display:flex;flex-direction:column;margin-top:5mm!important;padding-top:0;gap:0}
.a4c .senet{border:1.5px solid #0a2748;border-radius:3px;overflow:visible;display:grid;grid-template-columns:20mm 1fr;flex:0 0 auto;height:auto;min-height:0;color:#000}
.a4c .senet-side{background:linear-gradient(180deg,#0a2748,#143a63);color:#fff!important;padding:3px 2px;line-height:1.2;display:flex;flex-direction:column;gap:3px;font-size:7pt!important}
.a4c .senet-side,.a4c .senet-side *{color:#fff!important;font-size:7pt!important;line-height:1.2!important}
.a4c .senet-main{padding:3px 5px 3px;display:flex;flex-direction:column;min-height:0;color:#000}
.a4c .senet-bar{display:flex;justify-content:flex-start;align-items:baseline;margin-bottom:1px}.a4c .senet-bar span,.a4c .keside,.a4c .foot{display:none!important}
.a4c .senet-bar b{font-weight:700;letter-spacing:.05em}
.a4c .fields{display:grid;grid-template-columns:repeat(4,1fr);gap:3px;margin-bottom:1px}
.a4c .fields>div{border-bottom:1px solid #2a3545;padding:0 0 1px}
.a4c .fields span{display:block;font-weight:700;text-transform:uppercase;font-size:7pt!important}
.a4c .fields b{display:block;min-height:10px;margin-top:1px;font-weight:700}
.a4c .sbody{text-align:justify;margin:2mm 0 2mm;flex:0 0 auto;font-size:8pt!important;line-height:1.28!important}
.a4c .sbody b,.a4c .sbody u{font-size:8pt!important;color:#000!important}
.a4c .duo{display:grid;grid-template-columns:1fr 1fr;gap:5px;flex:0 0 auto;margin-top:2mm}
.a4c .duo>div{border:1px solid #c5d0dd;border-radius:3px;padding:3px 5px 4px;min-height:0;height:auto;display:flex;flex-direction:column;background:#fff;overflow:visible}
.a4c .duo .lab{font-size:8pt!important;font-weight:700;margin:0 0 3px;padding:0 0 2px;border-bottom:1px solid #c5d0dd;flex:0 0 auto;line-height:1.15!important}
.a4c .duo .row{display:block;margin:0 0 2px;flex:0 0 auto}
.a4c .duo .k{display:block;font-size:7pt!important;line-height:1.1!important;font-weight:700;color:#444;margin:0 0 1px}
.a4c .duo .v,.a4c .duo .v.nm{display:block;font-size:8pt!important;line-height:1.2!important;font-weight:700;color:#000!important;min-height:11px;margin:0;padding:0 0 2px;border-bottom:1px solid #222;white-space:normal!important;overflow:visible!important;text-align:left!important;word-break:break-word}
.a4c .duo .imza-row{margin-top:2mm!important}.a4c .duo .imza-row .k{margin-bottom:2px!important}.a4c .duo .imza-line{min-height:12mm!important;border-bottom:1px solid #222!important;padding:0!important}.a4c .duo .sigpad{flex:0 0 auto!important;height:14mm!important;min-height:14mm!important;max-height:14mm!important;margin-top:2mm!important;border-top:1px dashed #9aa8b8;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;padding:2px 2px 1px;color:#666;font-size:7pt!important;position:relative;gap:0}.a4c .duo .sigpad span{display:block;width:100%;text-align:center;color:#666;font-size:7pt!important;margin:1px 0 0;order:1}
.a4c .keside{margin-top:1px;text-align:right;font-weight:700;font-size:8pt!important}
.a4c .note{display:none}
.a4c .foot{margin-top:1px;text-align:center;font-size:7pt!important;color:#444;flex:0 0 auto}
.a4c.dense .duo>div{min-height:0;height:auto}
.a4c.senet-only{padding-top:10mm!important}
.a4c.senet-only .senet{margin-top:0;min-height:180mm}
@media print{
.a4c,.a4c *{font-family:Arial,Helvetica,sans-serif!important}
.a4c{page-break-after:avoid!important;min-height:277mm!important;height:277mm!important;font-size:8pt!important;color:#000!important;overflow:visible!important}
.a4c .name,.a4c .title,.a4c th,.a4c td,.a4c .mat,.a4c .pay,.a4c .terms h4,.a4c .sig b,.a4c .sig .nm,.a4c .box td,.a4c .box td.nm,.a4c .senet-bar b,.a4c .senet-bar span,.a4c .fields b,.a4c .sbody,.a4c .sbody b,.a4c .sbody u,.a4c .duo .lab,.a4c .duo .v,.a4c .duo .v.nm,.a4c .keside{font-size:8pt!important;line-height:1.25!important;color:#000!important}
.a4c .meta,.a4c .terms p,.a4c .fields span,.a4c .duo .k,.a4c .sig .sigpad span,.a4c .duo .sigpad,.a4c .foot{font-size:7pt!important;color:#000!important}
.a4c .duo .k{color:#444!important}
.a4c th,.a4c .box h3{color:#fff!important;font-size:8pt!important}
.a4c .senet-side,.a4c .senet-side *{color:#fff!important;font-size:7pt!important}
.a4c .mat{text-align:left!important;white-space:normal!important;overflow:visible!important}
.a4c .signs{margin-top:2mm!important;max-height:none!important}
.a4c .sig{min-height:32mm!important}
.a4c .sig .sigpad{flex:1 1 auto!important;height:22mm!important;min-height:22mm!important;max-height:none!important}
.a4c .duo{margin-top:2mm!important}
.a4c .duo>div{min-height:0!important;height:auto!important}
.a4c .duo .imza-row{margin-top:2mm!important}.a4c .duo .imza-row .k{margin-bottom:2px!important}.a4c .duo .imza-line{min-height:12mm!important;border-bottom:1px solid #222!important;padding:0!important}.a4c .duo .sigpad{flex:0 0 auto!important;min-height:14mm!important;height:14mm!important;max-height:14mm!important;margin-top:2mm!important;align-items:center!important;justify-content:flex-start!important}
.a4c .grow{margin-top:5mm!important;padding-top:0!important}
.a4c .senet{height:auto!important;max-height:none!important;overflow:visible!important}
.a4c .senet .sbody{margin-top:2mm!important;margin-bottom:2mm!important}
.a4c.senet-only{page-break-before:always}
}
</style>`;
  return `<section class="sheet a4c${denseClass}">${css}
  <div class="top"><div class="head-left"><div class="logo-top"><img src="${atakLogoSrc}" alt="ATAK Pazarlama"/></div><div class="name">${esc(companyLegal)}</div></div><div class="mid-head"><div class="title">SATIŞ SÖZLEŞMESİ</div></div><div class="meta-row"><div class="meta-texts"><div class="meta addr">${esc(address)}</div><div class="meta">${esc(phone)} · ${esc(wa)} · ${esc(email)} · ${esc(companyTaxLine)}</div></div><div class="partners"><img src="${partnersLogoSrc}" alt="beko · istikbal" class="partners-strip"/></div></div></div>
  <div class="rule"></div>
  <div class="grid3">
    <table class="prods"><thead><tr><th class="mat" style="width:58%">Malzeme</th><th style="width:10%">Adet</th><th style="width:16%">Birim</th><th style="width:16%">Tutar</th></tr></thead><tbody>${productRows}</tbody></table>
    <table class="mmeta"><tr><td>Satış Tarihi</td><td>${dateTR(d.date)}</td></tr><tr><td>Satış No</td><td>${esc(saleRef)}</td></tr><tr><td>Müşteri No</td><td>${esc(d.customer?.code||d.customer?.id||'')}</td></tr><tr><td>Toplam</td><td>${money(net)}</td></tr><tr><td>Peşinat</td><td>${money(downPayment)}</td></tr><tr><td>Bakiye</td><td>${money(balance)}</td></tr></table>
    <table><thead><tr><th>Vade</th><th>Taksit</th></tr></thead><tbody>${scheduleRows}</tbody></table>
  </div>${corpLine}
  <div class="parties"><div class="box"><h3>KEFİL</h3><table>${partyRows(guarantor)}</table></div><div class="box"><h3>BORÇLU</h3><table>${partyRows({name:personName,tckn:personTax,phone:d.customer?.phone||'',address:addr})}</table></div></div>
  <div class="pay"><b>Ödeme:</b> ${esc(d.method||'-')}${(d.payments||[]).length?` · ${(d.payments||[]).map(p=>`${esc(p.method||'')}: ${money(p.amount)}`).join(' · ')}`:''}${d.salesperson?.name?` · Satıcı: ${esc(d.salesperson.name)}`:''}</div>
  <div class="terms"><h4>ANLAŞMA ŞARTLARI</h4>
  <p><b>1)</b> Alıcı / borçlu, ${esc(companyLegal)}’nden yukarıda cinsi, adedi, özellikleri ve bedeli yazılı ürünleri görüp beğenerek satın almıştır. Peşinat ve taksit tutarlarını vade tarihlerinde, satıcının şube adreslerine makbuz karşılığı ödemeyi kabul ve taahhüt eder. Senetler bu sözleşmenin eki ve ayrılmaz parçasıdır.</p>
  <p><b>2)</b> Taksitlerden herhangi birinin vadesinde ödenmemesi halinde aylık %4 gecikme faizi uygulanır. Ayrıca bakiye üzerinden %20 oranında cezai şart talep edilebilir. Bir taksitin ödenmemesi halinde kalan tüm taksitler muaccel olur; satıcı yasal takip ve tahsilat masraflarını borçludan / kefilden isteyebilir. 4077 sayılı Tüketicinin Korunması Hakkında Kanun hükümleri saklıdır.</p>
  <p><b>3)</b> Ürünlerin teslimi, satıcının alıcı hakkında yapacağı olumlu kredi / risk değerlendirmesine bağlıdır. Beyaz eşya, mobilya, mutfak ve benzeri ürünler üretici / ithalatçı garanti şartlarına tabidir. Montaj ve onarım yetkili servislerce yapılır; aksi halde garanti kapsamı dışına çıkılabilir.</p>
  <p><b>4)</b> Taraflar işbu sözleşmeyi okuyup müzakere ederek imzalamışlardır. Uyuşmazlıklarda İstanbul Mahkemeleri ve İcra Daireleri yetkilidir. Kefil, borçlu ile birlikte müteselsil sorumludur. Bu belge mali fatura yerine geçmez; 4077 sayılı Kanun ve ilgili mevzuat hükümleri uygulanır.</p></div>
  <div class="signs">
    <div class="sig"><b>SATICI</b><small>Kaşe / İmza</small><div class="nm">${esc(companyLegal)}</div><div class="sigpad"><span>İmza / Kaşe</span></div></div>
    <div class="sig"><b>KEFİL</b><small>İşbu anlaşmadaki yazılı bütün şartları borçlu gibi okudum ve aynen kabul ettim.</small><div class="nm">${esc(guarantor.name||'')}</div><div class="sigpad"><span>Kefil İmza</span></div></div>
    <div class="sig"><b>BORÇLU</b><small>İşbu anlaşmadaki yazılı bütün şartları okudum ve aynen kabul ettim.</small><div class="nm">${esc(personName||'')}</div><div class="sigpad"><span>Borçlu İmza</span></div></div>
  </div>
  <div class="grow"><div class="senet"><div class="senet-side"><div class="senet-logo"><img src="${atakLogoWhiteSrc}" alt="ATAK Pazarlama"/></div><div>${esc(address)}<br/>${esc(phone)}<br/>${esc(email)}<br/>${esc(companyTaxLine)}</div></div>
  <div class="senet-main"><div class="senet-bar"><b>SENET</b></div>
  <div class="fields"><div><span>Vade</span><b>${dateTR(senetDue)}</b></div><div><span>Hululü Vade</span><b>${dateTR(senetDue)}</b></div><div><span>Türk Lirası</span><b>${senetAmtHash}</b></div><div><span>No.</span><b>${esc(senetNo)}</b></div></div>
  <p class="sbody">İşbu emre muharrer bono mukabilinde <u>${dateTR(senetDue)||'........'}</u> tarihinde <b>${esc(companyLegal)}</b> veyahut emruhavalesine yukarıda yazılı Yalnız <u>${esc(senetWordsOnly||'....................')}</u> Türk Lirası ödeyeceğim. Bedeli nakden ahzolunmuştur. İşbu bono vadesinde ödenmediği takdirde müteakip bonoların da muacceliyet kesbedeceğini, ihtilaf vukuunda <b>İSTANBUL</b> Mahkemelerinin selahiyetini şimdiden kabul eylerim.</p>
  <div class="duo">
    <div><div class="lab">Ödeyecek / Borçlu</div>
      <div class="row"><span class="k">İsim</span><span class="v nm">${esc(personName)||'—'}</span></div>
      <div class="row"><span class="k">T.C. Kimlik No</span><span class="v">${esc(personTax||'')||'—'}</span></div>
      <div class="row"><span class="k">Adres</span><span class="v">${esc(addr||'')||'—'}</span></div>
      <div class="row imza-row"><span class="k">Borçlu İmza</span><span class="v imza-line">&nbsp;</span></div></div>
    <div><div class="lab">Müteselsil Borçlu / Kefil</div>
      <div class="row"><span class="k">İsim</span><span class="v nm">${esc(guarantor.name||'')||'—'}</span></div>
      <div class="row"><span class="k">T.C. Kimlik No</span><span class="v">${esc(guarantor.tckn||guarantor.taxNo||'')||'—'}</span></div>
      <div class="row"><span class="k">Adres</span><span class="v">${esc(guarantor.homeAddress||guarantor.address||'')||'—'}</span></div>
      <div class="row imza-row"><span class="k">Kefil İmza</span><span class="v imza-line">&nbsp;</span></div></div>
  </div>
  ${moreSenets}</div></div></div>
</section>`;
}

function printSalesContractAndNotes(){
  if(!canSaleDocs()){stToast('Sözleşme / senet yetkiniz yok');return}
  const d=activeSalesDraft||collectSalesDraft();
  if(d.error){stToast(d.error);return}
  if(!d.promissory)stToast('Senet yok — tek A4 sözleşme açılıyor. Senet için ödeme satırına Senet tutarı girin.');
  const w=window.open('','_blank');
  if(!w){stToast('Açılır pencere engellendi');return}
  w.document.open();
  w.document.write(`<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Atak Pazarlama · Sözleşme + Senet (Tek A4)</title>
<style>@page{size:A4;margin:12mm}*{box-sizing:border-box}body{margin:0;background:#d9e2ec;color:#13233f;font:13px/1.45 "Segoe UI",Arial,sans-serif}
.toolbar{position:sticky;top:0;z-index:5;display:flex;flex-wrap:wrap;gap:8px;justify-content:center;align-items:center;padding:12px;background:#0b2a55;color:#fff}
.toolbar button{border:0;border-radius:8px;padding:10px 14px;font-weight:800;cursor:pointer;background:#fff;color:#0b2a55}
.toolbar button.primary{background:#dda20c;color:#1a1300}
.sheet{width:210mm;min-height:297mm;margin:16px auto;background:#fff;padding:14mm;box-shadow:0 10px 30px #0002}
@media print{body{background:#fff}.toolbar{display:none!important}.sheet{margin:0;box-shadow:none;width:auto;min-height:297mm;height:297mm;padding:0}}</style></head><body>
    <div class="toolbar"><b>Atak Pazarlama · Sözleşme + Senet (Tek A4)</b><button class="primary" onclick="window.print()">Yazdır / PDF Kaydet</button><button onclick="window.close()">Kapat</button></div>
    ${salesCombinedContractSenetA4Html(d)}
  </body></html>`);
  w.document.close();
  try{w.focus()}catch(_){}
}
function salesIssueInvoiceNow(){
  if(!canSaleInvoice()){stToast('Fatura kesme yetkiniz yok');return}
  if($('#salesInvoiceStatus'))$('#salesInvoiceStatus').value='queue_qnb';
  openSalesPreview();
  stToast('Fatura: Önizlemede “Satışı Yap” deyince kuyruğa alınır');
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
      payments:d.payments,promissory:d.promissory,guarantor:d.guarantor||null,billingParty:d.billingParty||'individual',
      description:d.description,items:d.items,invoiceStatus,invoiceNumber:d.invoiceNumber,invoiceDate:d.invoiceDate,
      stockMode:d.stockMode||(d.deductStock?'deduct':(d.reserveStock?'reserve':'none')),
      deductStock:Boolean(d.deductStock),reserveStock:Boolean(d.reserveStock)
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
function isoDaysAgo(n){
  const d=new Date();
  d.setDate(d.getDate()-n);
  return d.toISOString().slice(0,10);
}
let rapid360PullToken='';
function rapid360PullBody(extra={}){
  return{
    startDate:$('#rapid360SalesStart')?.value||isoDaysAgo(7),
    endDate:$('#rapid360SalesEnd')?.value||isoDaysAgo(0),
    store:$('#rapid360SalesStoreFilter')?.value||'340334',
    company:$('#rapid360SalesCompanyFilter')?.value||'2521',
    dealerId:$('#rapid360SalesXmlDealer')?.value||'atak-beko',
    pullToken:rapid360PullToken||undefined,
    ...extra
  };
}
function fillRapidAktarDefaults(){
  if($('#rapid360SalesStart') && !$('#rapid360SalesStart').value) $('#rapid360SalesStart').value=isoDaysAgo(7);
  if($('#rapid360SalesEnd') && !$('#rapid360SalesEnd').value) $('#rapid360SalesEnd').value=isoDaysAgo(0);
  if($('#rapid360SalesStoreFilter') && !$('#rapid360SalesStoreFilter').value) $('#rapid360SalesStoreFilter').value='340334';
  if($('#rapid360SalesCompanyFilter') && !$('#rapid360SalesCompanyFilter').value) $('#rapid360SalesCompanyFilter').value='2521';
}
function hideRapidOktaBox(){$('#rapid360OktaBox')?.classList.add('hidden')}
function rapidOktaEsc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function showRapidOktaBox(d){
  const box=$('#rapid360OktaBox');
  if(!box) return;
  box.classList.remove('hidden');
  box.innerHTML=`<div style="font-weight:700;margin-bottom:6px">Okta Verify telefona gidiyor</div>
    <p class="muted" style="margin:6px 0 0">${rapidOktaEsc(d.message||'Açılan pencerede Rapid360 hesabınızı seçin. Okta Verify telefona gider; telefonda onaylayın.')}</p>`;
}
async function loadRapidOktaStatus(){
  const el=$('#rapid360OktaStatus');
  if(!el) return;
  try{
    const d=await api('/web-api/admin/rapid360-okta-status');
    el.textContent=(d.okta&&d.okta.connected)
      ?(`Rapid360 bağlı${d.okta.account?`: ${d.okta.account}`:''}. Yalnız ürünler okunur.`)
      :'Açılan pencerede hesabı seçin, Okta Verify telefona gelir.';
  }catch(_){el.textContent='Açılan pencerede hesabı seçin, Okta Verify telefona gelir.'}
}
async function waitRapidOkta(st, payload, popup){
  showRapidOktaBox(payload||{});
  if(st) st.textContent=payload.message||'Telefonda Okta Verify’ı onaylayın';
  const loginUrl=payload.loginUrl||'';
  if(loginUrl){
    try{
      if(popup && !popup.closed) popup.location.href=loginUrl;
      else window.open(loginUrl,'rapid360okta','popup=yes,width=520,height=740');
    }catch(_){ window.open(loginUrl,'_blank','noopener'); }
  }
  let done=false;
  const onMsg=(ev)=>{
    if(ev.origin!==window.location.origin) return;
    if(ev.data && ev.data.type==='atak-rapid360-okta' && ev.data.ok) done=true;
  };
  window.addEventListener('message',onMsg);
  const interval=Math.max(2000,(Number(payload.interval)||3)*1000);
  const until=Date.now()+Math.min(14*60*1000,(Number(payload.expiresIn)||900)*1000);
  try{
    while(Date.now()<until){
      if(done){ hideRapidOktaBox(); await loadRapidOktaStatus(); return {ok:true,connected:true}; }
      const p=await api('/web-api/admin/rapid360-okta-poll',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pollId:payload.pollId})});
      if(p.ok||p.connected){ hideRapidOktaBox(); await loadRapidOktaStatus(); return p; }
      if(st) st.textContent='Okta Verify bekleniyor… telefonda onaylayın.';
      await new Promise(r=>setTimeout(r,interval));
    }
  }finally{ window.removeEventListener('message',onMsg); }
  throw new Error('Okta Verify süresi doldu. Rapid Aktar’a tekrar basın.');
}
async function pullRapid360Live(autoImport, st){
  const popup=window.open('about:blank','rapid360okta','popup=yes,width=520,height=740');
  try{ if(popup) popup.document.write('<p style="font-family:sans-serif;padding:24px">Rapid360 açılıyor…</p>'); }catch(_){}
  try{
    const d=await api('/web-api/admin/rapid360-sales-pull',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(rapid360PullBody(autoImport?{autoImport:true}:{}))});
    try{ if(popup && !popup.closed) popup.close(); }catch(_){}
    return d;
  }catch(e){
    if(e.status===409 && e.payload && e.payload.needsOkta){
      await waitRapidOkta(st, e.payload, popup);
      try{ if(popup && !popup.closed) popup.close(); }catch(_){}
      return await api('/web-api/admin/rapid360-sales-pull',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(rapid360PullBody(autoImport?{autoImport:true}:{}))});
    }
    try{ if(popup && !popup.closed) popup.close(); }catch(_){}
    throw e;
  }
}
$('#rapid360SalesXmlBtn')?.addEventListener('click',()=>{
  $('#rapid360SalesXmlModal')?.classList.remove('hidden');
  rapid360PullToken='';
  fillRapidAktarDefaults();
  hideRapidOktaBox();
  loadRapidOktaStatus();
});
$('#rapid360SalesXmlClose')?.addEventListener('click',()=>{hideRapidOktaBox();$('#rapid360SalesXmlModal')?.classList.add('hidden')});
$('#rapid360SalesPullBtn')?.addEventListener('click',async()=>{
  const st=$('#rapid360SalesXmlStatus');
  fillRapidAktarDefaults();
  rapid360PullToken='';
  st.textContent='Rapid360’a Okta ile bağlanılıp ürünler çekiliyor…';
  $('#rapid360SalesXmlImportBtn')&&($('#rapid360SalesXmlImportBtn').disabled=true);
  $('#rapid360SalesPullBtn')&&($('#rapid360SalesPullBtn').disabled=true);
  try{
    const d=await pullRapid360Live(true, st);
    rapid360PullToken=d.pullToken||'';
    $('#rapid360SalesXmlTable').innerHTML=(d.rows||[]).map(r=>`<tr><td>${r.salesId||''}</td><td>${r.customerName||''}</td><td>${money(r.total)}</td><td>${r.duplicate?'Kayıtlı':(r.itemCount?'Hazır':'Kalem yok')}</td></tr>`).join('');
    $('#rapid360SalesXmlImportBtn').disabled=true;
    const msg=`${d.imported||0} satış alındı · ${d.skippedDuplicate||0} zaten vardı${d.customersUpdated?` · ${d.customersUpdated} müşteri adı güncellendi`:''}`;
    st.textContent=msg;
    stToast(msg);
  }catch(e){st.textContent=e.message}
  finally{$('#rapid360SalesPullBtn')&&($('#rapid360SalesPullBtn').disabled=false)}
});
$('#rapid360SalesXmlPreviewBtn')?.addEventListener('click',async()=>{
  const st=$('#rapid360SalesXmlStatus');
  const file=$('#rapid360SalesXmlFile')?.files?.[0];
  if(!file){st.textContent='XML seçin veya Rapid Aktar kullanın';return}
  rapid360PullToken='';
  const fd=new FormData();fd.append('file',file);fd.append('dealerId',$('#rapid360SalesXmlDealer')?.value||'atak-beko');
  st.textContent='XML okunuyor…';
  try{
    const d=await api('/web-api/admin/rapid360-sales-preview',{method:'POST',body:fd});
    $('#rapid360SalesXmlTable').innerHTML=(d.rows||[]).map(r=>`<tr><td>${r.salesId||''}</td><td>${r.customerName||''}</td><td>${money(r.total)}</td><td>${r.duplicate?'Kayıtlı':(r.itemCount?'Hazır':'Kalem yok')}</td></tr>`).join('');
    $('#rapid360SalesXmlImportBtn').disabled=!d.importable;
    st.textContent=`${d.importable||0} satış aktarılabilir${d.cancelled?` · ${d.cancelled} iptal atlandı`:''}`;
  }catch(e){st.textContent=e.message}
});
$('#rapid360SalesXmlImportBtn')?.addEventListener('click',async()=>{
  const st=$('#rapid360SalesXmlStatus');
  if(!confirm('Rapid360 satışları Atak listesine eklensin mi?'))return;
  st.textContent='Aktarılıyor…';
  try{
    let r;
    if(rapid360PullToken){
      r=await api('/web-api/admin/rapid360-sales-pull-import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(rapid360PullBody())});
    }else{
      const file=$('#rapid360SalesXmlFile')?.files?.[0];
      if(!file){st.textContent='Önce Rapid Aktar veya XML seçin';return}
      const fd=new FormData();fd.append('file',file);fd.append('dealerId',$('#rapid360SalesXmlDealer')?.value||'atak-beko');
      r=await api('/web-api/admin/rapid360-sales-import',{method:'POST',body:fd});
    }
    st.textContent=`${r.imported||0} satış alındı · ${r.skippedDuplicate||0} zaten vardı${r.customersUpdated?` · ${r.customersUpdated} müşteri adı güncellendi`:''}`;
    stToast(st.textContent);
  }catch(e){st.textContent=e.message}
});
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
$('#salesOpenInvoiceCenterBtn')?.addEventListener('click',openPersonelInvoiceCenter);
$('#salesPreviewClose')?.addEventListener('click',closeSalesPreview);
$('#salesPreviewConfirmBtn')?.addEventListener('click',confirmSalesDraft);
$('#salesPreviewOfferBtn')?.addEventListener('click',sendSalesOfferWhatsAppOnly);
$('#salesPreviewPrintBtn')?.addEventListener('click',printSalesOffer);
$('#salesPreviewDocsBtn')?.addEventListener('click',printSalesContractAndNotes);
$('#salesInvoiceStatus')?.addEventListener('change',salesRecalcPay);
$('#salesDeductStock')?.addEventListener('change',()=>{
  const mode=$('#salesDeductStock')?.value||'no';
  const wrap=$('#salesWarehouseWrap');
  if(wrap)wrap.classList.toggle('hidden',!(mode==='yes'||mode==='reserve'));
});
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

function syncQcInvoiceUI(opts={}){
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
  if(opts.focus&&corp){
    $('#qcTaxNo')?.focus();
    lookupQcVkn();
  }
}
let qcVknLast='';
let qcVknSeq=0;
function setQcVknStatus(text,cls=''){
  const el=$('#qcVknStatus');
  if(!el)return;
  el.textContent=text||'';
  el.className='muted'+(cls?' '+cls:'');
}
function qcVknDigits(v){return String(v||'').replace(/\D/g,'').slice(0,10)}
async function lookupQcVkn({force=false}={}){
  const input=$('#qcTaxNo');
  if(!input)return;
  const vkn=qcVknDigits(input.value);
  if(input.value!==vkn)input.value=vkn;
  if(vkn.length!==10){
    setQcVknStatus(vkn.length?`${vkn.length}/10 hane`:'10 hane yazınca ünvan otomatik dolar');
    return;
  }
  if(!force&&qcVknLast===vkn)return;
  const seq=++qcVknSeq;
  setQcVknStatus('e-Fatura sorgulanıyor…');
  try{
    const d=await api('/web-api/admin/vkn-lookup?vkn='+encodeURIComponent(vkn));
    if(seq!==qcVknSeq)return;
    if(!d.ok){
      setQcVknStatus(d.error||'Ünvan alınamadı. Faturalar kurulumunda firma VKN’yi kaydedin.','vkn-status-err');
      return;
    }
    qcVknLast=vkn;
    const title=String(d.companyName||d.alias||'').trim();
    const company=$('#qcCompanyName');
    if(company&&title&&(!String(company.value||'').trim()||company.dataset.vknAuto==='1')){
      company.value=title;company.dataset.vknAuto='1';
    }
    const office=$('#qcTaxOffice');
    if(office&&d.taxOffice&&(!String(office.value||'').trim()||office.dataset.vknAuto==='1')){
      office.value=d.taxOffice;office.dataset.vknAuto='1';
    }
    const fillEmpty=(id,val)=>{const el=$(id);if(el&&val&&!String(el.value||'').trim())el.value=val};
    fillEmpty('#qcCity',d.city);
    fillEmpty('#qcDistrict',d.district);
    fillEmpty('#qcAddress',d.address);
    if(d.alreadyCustomer)setQcVknStatus(d.message||'Bu VKN zaten kayıtlı','vkn-status-warn');
    else if(title)setQcVknStatus((d.eInvoiceUser?'e-Fatura: ':'')+title+(d.taxOffice?'':' · vergi dairesini yazın'),'vkn-status-ok');
    else setQcVknStatus('Ünvan gelmedi, firma adını elle yazın','vkn-status-warn');
  }catch(err){
    if(seq!==qcVknSeq)return;
    setQcVknStatus(err.message||'VKN sorgusu başarısız.','vkn-status-err');
  }
}
function bindQcVknLookup(){
  const input=$('#qcTaxNo');
  if(!input||input.dataset.vknBound==='1')return;
  input.dataset.vknBound='1';
  input.addEventListener('input',()=>{
    const d=qcVknDigits(input.value);
    if(input.value!==d)input.value=d;
    clearTimeout(window.__qcVknT);
    window.__qcVknT=setTimeout(()=>lookupQcVkn(),280);
  });
  input.addEventListener('blur',()=>lookupQcVkn());
  $('#qcVknLookupBtn')?.addEventListener('click',()=>lookupQcVkn({force:true}));
  $('#qcCompanyName')?.addEventListener('input',()=>{const el=$('#qcCompanyName');if(el)el.dataset.vknAuto='0'});
  $('#qcTaxOffice')?.addEventListener('input',()=>{const el=$('#qcTaxOffice');if(el)el.dataset.vknAuto='0'});
}
bindQcVknLookup();
document.querySelectorAll('input[name="qcInvoiceTypeRadio"]').forEach(r=>r.addEventListener('change',()=>syncQcInvoiceUI({focus:true})));
$('#salesNewCustomerBtn')?.addEventListener('click',()=>{
  $('#salesQuickCustomerForm')?.reset();
  const ind=document.querySelector('input[name="qcInvoiceTypeRadio"][value="individual"]');
  if(ind)ind.checked=true;
  $('#qcStatus').textContent='';
  qcVknLast='';
  setQcVknStatus('10 hane yazınca ünvan otomatik dolar');
  syncQcInvoiceUI();
  $('#salesQuickCustomerModal')?.classList.remove('hidden');
  fillNextCustomerCode('#qcCode');
  $('#qcFirstName')?.focus();
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
        firstName:($('#qcFirstName')?.value||'').trim(),
        lastName:($('#qcLastName')?.value||'').trim(),
        name:[($('#qcFirstName')?.value||'').trim(),($('#qcLastName')?.value||'').trim()].filter(Boolean).join(' '),
        customerCode:($('#qcCode')?.value||'').trim(),
        phone:$('#qcPhone').value,
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
    $('#salesCustomerSelect').innerHTML=`<option value="${row.id}">${customerOptionLabel(row)}</option>`;
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

$('#trainingCard').onclick=async()=>{
  hidePanels();
  $('#trainingPanel').classList.remove('hidden');
  const st=$('#trainingStatus'),player=$('#trainingPlayer');
  if(player?.dataset.loaded==='1'){st.textContent='';return}
  st.textContent='Video yükleniyor…';
  try{
    const d=await api('/foundation-api/training');
    const v=(d.videos||[])[0];
    if(!v?.url)throw new Error('Eğitim videosu henüz yüklenmedi.');
    $('#trainingTitle').textContent=v.title||'Personel ekranı eğitimi';
    $('#trainingDesc').textContent=[v.description,v.duration].filter(Boolean).join(' · ');
    player.src=v.url;
    player.load();
    player.dataset.loaded='1';
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
function payBucketLabel(b){return({overdue:'Geciken',due:'Bu Ay',havale:'Havale',open:'Açık',paid:'Kapalı'}[b]||b||'—')}
function todayLocal(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
function renderPayments(){
  const sum=payState.summary||{};
  const box=$('#paySummary');
  if(box){
    box.innerHTML=`
      <div class="stat"><small>Geciken</small><b>${sum.overdueCustomers||0}</b><span>${money(sum.overdueAmount||0)}</span></div>
      <div class="stat"><small>Bu Ay</small><b>${sum.dueMonthCustomers||0}</b><span>${money(sum.dueMonthAmount||0)}</span></div>
      <div class="stat"><small>Açık Cari</small><b>${sum.openCustomers||0}</b><span>${money(sum.openBalance||0)}</span></div>
      <div class="stat"><small>Havale</small><b>${sum.havaleCustomers||0}</b><span>${money(sum.havaleAmount||0)}</span></div>
      <div class="stat"><small>Listede</small><b>${(payState.rows||[]).length}</b><span>${payBucketLabel(payState.filter)}</span></div>`;
  }
  const tbody=$('#payRows');
  if(tbody){
    tbody.innerHTML=(payState.rows||[]).length
      ?(payState.rows||[]).map(r=>`<tr data-pay-cust="${r.customerId}" class="${r.customerId===payState.selectedId?'active':''}">
          <td><b>${r.customerName||'—'}</b><br><small>${r.customerPhone||''}</small> ${sipBtn(r.customerPhone,{className:'sip-call-sm',customerId:r.customerId})}</td>
          <td><span class="pay-bucket ${r.bucket}">${payBucketLabel(r.bucket)}</span></td>
          <td>${money(r.balance)}${Number(r.pendingHavaleAmount||0)>0.009?`<br><small>Havale ${money(r.pendingHavaleAmount)}</small>`:''}</td>
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
function payCommWhen(iso){
  const d=new Date(iso||'');
  if(!Number.isFinite(d.getTime()))return String(iso||'');
  const p=n=>String(n).padStart(2,'0');
  return `${p(d.getDate())}.${p(d.getMonth()+1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function payCommLabel(row){
  if(row.kind==='sms')return row.result==='failed'?'SMS gönderilemedi':'SMS gönderildi';
  return({started:'Arama başlatıldı',no_answer:'Ulaşılamadı',reached:'Görüşüldü',busy:'Meşgul'}[row.result]||row.result||'Arama');
}
function renderPayComms(customerId,preloaded){
  const box=$('#payCommsBox');if(!box||!customerId)return;
  const paint=rows=>{
    const items=Array.isArray(rows)?rows:[];
    box.innerHTML=`
      <div class="section-title" style="margin:0 0 8px">Arama / SMS kayıtları</div>
      <div class="customer-comms-actions">
        <button type="button" data-pay-comm="no_answer">Ulaşılamadı</button>
        <button type="button" data-pay-comm="reached">Görüşüldü</button>
        <button type="button" data-pay-sms="missed">Hazır SMS: Ulaşılamadı</button>
      </div>
      <label class="field">Not<input id="payCommNote" placeholder="2 kez çaldı, açılmadı"></label>
      <div class="customer-comms-list">${items.length?items.slice(0,12).map(r=>`<article class="customer-comms-item"><div><b>${payCommLabel(r)}</b><small>${payCommWhen(r.at)} · ${esc(r.actor||'—')}</small>${r.message?`<div class="msg">${esc(r.message)}</div>`:(r.note?`<small>${esc(r.note)}</small>`:'')}</div><button type="button" class="customer-comms-del" data-pay-comm-del="${esc(r.id)}">Sil</button></article>`).join(''):'<div class="note">Henüz kayıt yok.</div>'}</div>`;
    box.querySelectorAll('[data-pay-comm]').forEach(btn=>{
      btn.onclick=async()=>{
        try{
          const d=await api('/web-api/admin/customer/'+encodeURIComponent(customerId)+'/comm',{
            method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({kind:'call',result:btn.getAttribute('data-pay-comm'),note:$('#payCommNote')?.value||''})
          });
          renderPayComms(customerId,d.comms);
        }catch(e){stToast(e.message||'Kayıt yazılamadı')}
      };
    });
    box.querySelectorAll('[data-pay-sms]').forEach(btn=>{
      btn.onclick=async()=>{
        if(!confirm('Ulaşılamadı hazır SMS gönderilsin mi?'))return;
        try{
          await api('/web-api/admin/customer/'+encodeURIComponent(customerId)+'/sms',{
            method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({type:'missed'})
          });
          renderPayComms(customerId);
        }catch(e){stToast(e.message||'SMS gönderilemedi')}
      };
    });
    box.querySelectorAll('[data-pay-comm-del]').forEach(btn=>{
      btn.onclick=async()=>{
        if(!confirm('Bu kayıt silinsin mi?'))return;
        try{
          const d=await api('/web-api/admin/customer/'+encodeURIComponent(customerId)+'/comm/'+encodeURIComponent(btn.getAttribute('data-pay-comm-del')),{method:'DELETE'});
          renderPayComms(customerId,d.comms);
        }catch(e){stToast(e.message||'Silinemedi')}
      };
    });
  };
  if(preloaded){paint(preloaded);return}
  api('/web-api/admin/customer-detail/'+encodeURIComponent(customerId)).then(d=>paint(d.comms||[])).catch(()=>{box.innerHTML=''});
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
  const havaleAmt=Number(row.pendingHavaleAmount||0);
  const suggest=havaleAmt>0.009?havaleAmt:(row.overdueAmount>0.009?row.overdueAmount:(row.dueMonthAmount>0.009?row.dueMonthAmount:Math.max(row.balance,0)));
  $('#payCustomerBox').innerHTML=`<b>${row.customerName||''}</b> ${sipBtn(row.customerPhone,{className:'sip-call-sm',customerId:row.customerId})}<br><small>${row.customerPhone||''}</small><br>
    Cari: <b>${money(row.balance)}</b> · Havale: <b>${money(havaleAmt)}</b> · Geciken: <b>${money(row.overdueAmount)}</b>`;
  renderPayComms(row.customerId);
  const havaleBox=$('#payHavale');
  if(havaleBox){
    havaleBox.innerHTML=(row.pendingHavale||[]).length
      ?(row.pendingHavale||[]).map(h=>`<tr><td>${h.saleReference||'—'}</td><td>${h.accountName||'Banka'}</td><td>${money(h.remain)}</td></tr>`).join('')
      :'<tr><td colspan="3">Bekleyen havale yok.</td></tr>';
  }
  const hasHavale=!!(row.pendingHavale||[]).length;
  $('#payHavaleWrap')?.classList.toggle('hidden',!hasHavale);
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
    const list=havaleAmt>0.009?(payState.accounts||[]).filter(a=>a.type==='bank'):(payState.accounts||[]);
    const rows=list.length?list:(payState.accounts||[]);
    const suggested=(row.pendingHavale||[])[0]?.accountId||'';
    const cur=suggested||acc.value;
    acc.innerHTML=rows.map(a=>`<option value="${a.id}">${a.name}</option>`).join('')||'<option value="">Kasa yok</option>';
    if(cur && [...acc.options].some(o=>o.value===cur))acc.value=cur;
  }
  if(havaleAmt>0.009 && $('#payMethod'))$('#payMethod').value='Havale';
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
