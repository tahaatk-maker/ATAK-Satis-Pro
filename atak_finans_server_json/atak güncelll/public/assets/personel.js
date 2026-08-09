const $=s=>document.querySelector(s);
const money=v=>new Intl.NumberFormat('tr-TR',{style:'currency',currency:'TRY',maximumFractionDigits:2}).format(Number(v||0));

async function api(url,opt={}){
  const r=await fetch(url,{credentials:'same-origin',...opt});
  const d=await r.json().catch(()=>({}));
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

function has(permission){
  const p=currentUser?.permissions||[];
  return p.includes('*')||p.includes(permission);
}
function canFinance(){
  return has('finance_manage')||has('finance_view')||has('orders_manage')||has('customers_manage');
}
function hidePanels(){
  ['#financePanel','#paymentsPanel','#salesPanel','#stockPanel','#announcementPanel'].forEach(x=>$(x)?.classList.add('hidden'));
  $('#home')?.classList.add('hidden');
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
    if(has('orders_manage'))$('#salesCard').classList.remove('hidden');
    if(canFinance()){
      $('#financeCard').classList.remove('hidden');
      $('#paymentsCard').classList.remove('hidden');
    }
    if(has('stock_manage'))$('#stockCard').classList.remove('hidden');
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
    if(financeData?.canManage)await loadManagerApprovals();
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
    if(financeData?.canManage)await loadManagerApprovals();
    $('#financeStatus').textContent=d.message||'Talep yönetici onayına düştü.';
  }catch(e){st.textContent=e.message}
}

async function loadManagerApprovals(){
  const wrap=$('#managerApprovalsWrap');
  if(!wrap)return;
  try{
    const d=await api('/web-api/admin/cancellation-requests');
    if(!d.canManage){wrap.classList.add('hidden');return}
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
  const canManage=Boolean(d.canManage);
  const ciro=d.ciro||{brand:{},personnel:[]};
  const brand=ciro.brand||{};
  const summary=d.summary||{};
  const salesTotal=Number(summary.mySalesTotal!=null?summary.mySalesTotal:(brand.total||0));
  const salesCount=Number(summary.mySalesCount!=null?summary.mySalesCount:(brand.count||0));

  $('#adminCiroWrap')?.classList.toggle('hidden',!canManage);
  $('#personnelCiroWrap')?.classList.toggle('hidden',!canManage);
  $('#managerApprovalsWrap')?.classList.toggle('hidden',!canManage);

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

function num(v){const n=Number(String(v??'').replace(',','.'));return Number.isFinite(n)?n:0}
function productPrice(p){return num(p?.cashPrice??p?.price??p?.salePrice??p?.cardPrice)}
function cartGross(){return Math.round(salesCart.reduce((a,r)=>a+num(r.qty)*num(r.unitPrice),0)*100)/100}
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
  if($('#salesNext2'))$('#salesNext2').disabled=!hasCart;
  if($('#salesHint2'))$('#salesHint2').textContent=hasCart?`${salesCart.length} kalem hazır`:'Sepete ürün ekleyin';
  if(salesStep===3){syncPayAccounts();salesRecalcPay()}
}
function salesReset(){
  salesCart=[];
  lastSaleDocsUrl='';
  salesCustomers=[];
  if($('#customerSearchSale'))$('#customerSearchSale').value='';
  if($('#salesCustomerSelect'))$('#salesCustomerSelect').innerHTML='<option value="">Önce arayın, sonra seçin</option>';
  if($('#salesCustomerCount'))$('#salesCustomerCount').textContent=(salesCustomerTotal||0)+' kayıt';
  if($('#salesCustomerSearchHint'))$('#salesCustomerSearchHint').textContent=`Toplam ${salesCustomerTotal||0} müşteri. Ad / telefon / VKN ile arayıp seçin (tüm liste yüklenmez).`;
  if($('#salesDiscountPct'))$('#salesDiscountPct').value='0';
  ['#payCash','#payCard','#payTransfer','#payCredit','#payNote'].forEach(id=>{if($(id))$(id).value=''});
  if($('#salesDate'))$('#salesDate').value=new Date().toISOString().slice(0,10);
  const due=new Date();due.setDate(due.getDate()+30);
  if($('#promissoryFirstDue'))$('#promissoryFirstDue').value=due.toISOString().slice(0,10);
  if($('#promissoryInstallments'))$('#promissoryInstallments').value='1';
  if($('#promissoryInterval'))$('#promissoryInterval').value='1';
  $('#salesSavePrintInlineBtn')?.classList.add('hidden');
  if($('#payInlineStatus'))$('#payInlineStatus').textContent='';
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
    const [cat,fin,custMeta]=await Promise.all([
      api('/web-api/admin/sales-catalog'),
      api('/web-api/admin/finance-center?customers=0'),
      api('/web-api/admin/customers/search').catch(()=>api('/web-api/admin/customer-search').catch(()=>({total:0,rows:[]})))
    ]);
    salesData=cat;
    // 10k+ müşteri select'e basılmaz — Ara ile API'den gelir; küçük listeler fallback
    salesCustomers=[];
    salesCustomerFallback=Array.isArray(cat.customers)?cat.customers:[];
    salesCustomerTotal=Number(fin.customerTotal||custMeta.total||cat.customerTotal||salesCustomerFallback.length||0);
    salesAccounts=(cat.accounts&&cat.accounts.length?cat.accounts:fin.accounts)||[];
    if($('#salesDealer')){
      $('#salesDealer').innerHTML=(cat.dealerSettings||[]).filter(d=>d.active!==false)
        .map(d=>`<option value="${d.id}">${d.name}</option>`).join('')||'<option value="">Bayi yok</option>';
    }
    syncPayAccounts();
    $('#salesScopeHint').textContent=`Satışlar sizin adınıza kaydedilir · ${(cat.products||[]).length} ürün · ${salesCustomerTotal} müşteri`;
    salesReset();
    st.textContent='';
  }catch(e){st.textContent=e.message}
}
async function salesSearchCustomers(){
  const term=String($('#customerSearchSale')?.value||'').trim();
  const btn=$('#customerSearchSaleBtn');
  const hint=$('#salesCustomerSearchHint');
  const current=$('#salesCustomerSelect')?.value||'';
  if(term.length<1){
    if(hint)hint.textContent='Aramak için ad, telefon, VKN veya TCKN yazın.';
    return;
  }
  if(btn)btn.disabled=true;
  if(hint)hint.textContent='Aranıyor…';
  let rows=[],total=0,apiErr='';
  try{
    let d;
    try{d=await api('/web-api/admin/customers/search?q='+encodeURIComponent(term)+'&limit=50')}
    catch(_){d=await api('/web-api/admin/customer-search?q='+encodeURIComponent(term)+'&limit=50')}
    rows=d.rows||[];
    total=Number(d.total||rows.length||0);
  }catch(e){apiErr=e.message||'Arama API hatası'}
  if(!rows.length){
    let local=filterCustomersLocal(salesCustomerFallback,term);
    if(!local.length){
      try{
        const fin=await api('/web-api/admin/finance-center');
        salesCustomerFallback=fin.customers||[];
        if(fin.customerTotal!=null)salesCustomerTotal=Number(fin.customerTotal);
        local=filterCustomersLocal(salesCustomerFallback,term);
      }catch(_){}
    }
    if(local.length){rows=local;total=local.length}
  }
  try{
    const map=new Map(salesCustomers.map(c=>[String(c.id),c]));
    rows.forEach(c=>map.set(String(c.id),c));
    salesCustomers=[...map.values()];
    if($('#salesCustomerCount'))$('#salesCustomerCount').textContent=total>rows.length?`${rows.length}/${total} sonuç`:`${rows.length} sonuç`;
    $('#salesCustomerSelect').innerHTML=(rows.length?'':'<option value="">Sonuç yok — farklı kelime deneyin</option>')+
      rows.map(c=>`<option value="${c.id}" ${String(c.id)===String(current)?'selected':''}>${c.name}${c.phone?' · '+c.phone:''}${c.taxNo?' · '+c.taxNo:''}</option>`).join('');
    if(current && rows.some(c=>String(c.id)===String(current)))$('#salesCustomerSelect').value=current;
    else if(rows.length===1)$('#salesCustomerSelect').value=rows[0].id;
    if(hint)hint.textContent=rows.length
      ?`${rows.length} sonuç listelendi${total>rows.length?' (ilk 50)':''}. Listeden müşteriyi seçin.`
      :(apiErr?`Arama başarısız: ${apiErr}`:'Eşleşen müşteri yok. Yeni müşteri ekleyebilirsiniz.');
    if(!rows.length && apiErr)stToast(apiErr);
    salesCustomerChanged();
  }finally{if(btn)btn.disabled=false}
}
function renderSalesCustomers(){return salesSearchCustomers()}
function stToast(msg){const st=$('#salesStatus');if(st)st.textContent=msg||''}
function salesCustomerChanged(){
  const c=salesCustomers.find(x=>String(x.id)===String($('#salesCustomerSelect')?.value||''));
  const box=$('#salesCustomerInfo');
  if(!c){box?.classList.add('hidden');box&&(box.innerHTML='');setSalesStep(salesStep);return}
  box.classList.remove('hidden');
  const hasCorp=Boolean(String(c.companyName||'').trim()&&String(c.taxNo||'').replace(/\D/g,'').length>=10);
  box.innerHTML=`
    <div><small>Şahıs / Senet</small><b>${c.name||'—'}</b><span style="display:block;font-size:11px;color:#7a879a">TCKN ${c.tckn||'—'}</span></div>
    <div><small>Telefon</small><b>${c.phone||'—'}</b></div>
    <div><small>Cari</small><b>${money(c.balance)}</b></div>
    ${hasCorp?`<div><small>Fatura firması</small><b>${c.companyName||'—'}</b><span style="display:block;font-size:11px;color:#7a879a">VKN ${c.taxNo||'—'} · ${c.taxOffice||''}</span></div>`:''}`;
  setSalesStep(salesStep);
}
function renderProducts(){
  const term=($('#productSearch')?.value||'').toLocaleLowerCase('tr-TR');
  const rows=(salesData?.products||[]).filter(p=>
    `${p.code||''} ${p.name||''} ${p.searchName||''} ${p.itemCode||''} ${p.brand||''}`.toLocaleLowerCase('tr-TR').includes(term)
  ).slice(0,120);
  $('#productRows').innerHTML=rows.map(p=>`
    <button type="button" class="product-item" data-code="${p.code}">
      <div><strong>${p.name||p.searchName||p.code}</strong><small>${p.code||''} · ${p.brand||'—'}</small></div>
      <b>${money(productPrice(p))}</b>
    </button>
  `).join('')||'<div class="status">Ürün bulunamadı.</div>';
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
      <div><strong>${r.name}</strong><small>${r.code}</small></div>
      <input data-qty type="number" min="1" step="1" value="${r.qty}">
      <input data-price type="number" min="0" step="0.01" value="${r.unitPrice}">
      <button type="button" data-del title="Sil">✕</button>
    </div>`).join('');
  setSalesStep(salesStep);
}
function addToCart(code){
  const p=(salesData?.products||[]).find(x=>String(x.code)===String(code));
  if(!p)return;
  const existing=salesCart.find(r=>String(r.code)===String(code));
  if(existing)existing.qty+=1;
  else salesCart.push({code:p.code,name:p.searchName||p.name||p.code,qty:1,unitPrice:productPrice(p),itemCode:p.itemCode||'',materialCode:p.searchName||p.code||''});
  renderCart();
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
function salesFillRemainingTo(fieldId){
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
function salesRecalcPay(){
  const net=cartNet();
  const gross=cartGross();
  const s=paySplits();
  const allocated=Math.round((s.cash+s.card+s.transfer+s.credit+s.note)*100)/100;
  const remaining=Math.round((net-allocated)*100)/100;
  if($('#payGross'))$('#payGross').textContent=money(gross);
  if($('#payDiscount'))$('#payDiscount').textContent=money(Math.max(0,gross-net));
  if($('#payNet'))$('#payNet').textContent=money(net);
  if($('#payAllocated'))$('#payAllocated').textContent=money(allocated);
  if($('#payRemaining'))$('#payRemaining').textContent=money(Math.max(0,remaining));
  const dealer=(salesData?.dealerSettings||[]).find(d=>String(d.id)===String($('#salesDealer')?.value||''));
  const prim=Math.round((net*Number(dealer?.commissionPct||0)/100)*100)/100;
  if($('#salesCommissionPreview'))$('#salesCommissionPreview').textContent=`Prim: ${money(prim)}${dealer?` · ${dealer.name}`:''}`;
  const hint=$('#payBalanceHint');
  if(hint){
    if(Math.abs(remaining)<0.009){hint.className='sales-pay-balance ok';hint.textContent='Ödeme net tutara eşit — kaydedebilirsiniz.';}
    else if(remaining>0){hint.className='sales-pay-balance warn';hint.textContent=`Henüz ${money(remaining)} dağıtılmadı. Nakit/kart/havale/vadeli/senet girin.`;}
    else{hint.className='sales-pay-balance bad';hint.textContent=`Dağıtılan tutar netten ${money(Math.abs(remaining))} fazla.`;}
  }
  const parts=[];
  if(s.cash>0)parts.push(`Nakit ${money(s.cash)}`);
  if(s.card>0)parts.push(`Kart ${money(s.card)}`);
  if(s.transfer>0)parts.push(`Havale ${money(s.transfer)}`);
  if(s.credit>0)parts.push(`Vadeli ${money(s.credit)}`);
  if(s.note>0)parts.push(`Senet ${money(s.note)}`);
  const preview=$('#payMethodPreview');
  if(preview)preview.textContent=parts.length?`Seçili ödeme: ${parts.join(' + ')}`:'Ödeme seçilmedi — aşağıdan dağıtın veya KALAN kullanın';
  $('#promissoryWrap')?.classList.toggle('hidden',s.note<=0);
  $('#salesSavePrintInlineBtn')?.classList.toggle('hidden',s.note<=0);
  // Aktif yöntemleri vurgula (admin gibi)
  const onMap={payCash:s.cash>0,payCard:s.card>0,payTransfer:s.transfer>0,payCredit:s.credit>0,payNote:s.note>0};
  document.querySelectorAll('.pos-pay-tile[data-pay-fill]').forEach(btn=>{
    btn.classList.toggle('on',Boolean(onMap[btn.getAttribute('data-pay-fill')]));
  });
}
function openPayScreen(){
  syncPayAccounts();
  salesRecalcPay();
  document.querySelector('.pay-inline-box')?.scrollIntoView({behavior:'smooth',block:'start'});
  const first=['#payCash','#payCard','#payTransfer','#payCredit','#payNote'].map(id=>$(id)).find(el=>!num(el?.value));
  (first||$('#payCash'))?.focus();
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
async function saveSale(printSenet=false){
  const st=$('#payInlineStatus')||$('#salesStatus');
  const customerId=$('#salesCustomerSelect')?.value||'';
  if(!customerId){st.textContent='Müşteri seçin';return}
  if(!salesCart.length){st.textContent='Sepete ürün ekleyin';return}
  const net=cartNet();
  const s=paySplits();
  const allocated=Math.round((s.cash+s.card+s.transfer+s.credit+s.note)*100)/100;
  if(allocated<=0){st.textContent='En az bir ödeme satırına tutar girin';return}
  if(Math.abs(allocated-net)>0.009){st.textContent=`Dağılım nete eşit olmalı. Net ${money(net)} · Dağıtılan ${money(allocated)} · Kalan ${money(net-allocated)}`;return}
  if(s.note>0 && !$('#promissoryFirstDue')?.value){st.textContent='Senet için ilk vade girin';return}
  if(s.cash>0 && !$('#payCashAccount')?.value){st.textContent='Nakit için kasa seçin';return}
  if(s.card>0 && !$('#payCardAccount')?.value){st.textContent='Kart için hesap seçin';return}
  if(s.transfer>0 && !$('#payTransferAccount')?.value){st.textContent='Havale için banka seçin';return}
  const payments=[];
  if(s.cash>0)payments.push({method:'Nakit',amount:s.cash,accountId:$('#payCashAccount')?.value||''});
  if(s.card>0)payments.push({method:'Kredi Kartı',amount:s.card,accountId:$('#payCardAccount')?.value||''});
  if(s.transfer>0)payments.push({method:'Havale',amount:s.transfer,accountId:$('#payTransferAccount')?.value||''});
  if(s.credit>0)payments.push({method:'Vadeli',amount:s.credit,accountId:''});
  const body={
    customerId,
    dealerId:$('#salesDealer')?.value||'',
    salespersonId:currentUser?.id||'',
    salespersonName:currentUser?.name||'',
    discountPct:num($('#salesDiscountPct')?.value),
    date:$('#salesDate')?.value||new Date().toISOString().slice(0,10),
    items:salesCart.map(r=>({productCode:r.code,itemCode:r.itemCode,materialCode:r.materialCode,productName:r.name,quantity:r.qty,unitPrice:r.unitPrice})),
    payments,
    promissory:s.note>0?{
      amount:s.note,
      installments:num($('#promissoryInstallments')?.value)||1,
      firstDueDate:$('#promissoryFirstDue')?.value,
      intervalMonths:num($('#promissoryInterval')?.value)||1
    }:null,
    deductStock:false
  };
  st.textContent='Satış kaydediliyor...';
  try{
    const r=await api('/web-api/admin/customer-sale',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const ref=r.sale?.reference||r.reference||'OK';
    lastSaleDocsUrl=r.docsUrl||r.promissory?.printUrl||(r.sale?.id?`/web-api/admin/sale/${r.sale.id}/print-docs`:'');
    if(printSenet && lastSaleDocsUrl){
      printSaleDocs(lastSaleDocsUrl);
      st.textContent=`Satış kaydedildi (${ref}) — senet/sözleşme açıldı`;
    }else{
      st.textContent=`Satış kaydedildi: ${ref}`;
    }
    $('#salesStatus').textContent=st.textContent;
    salesReset();
  }catch(e){st.textContent=e.message}
}

document.querySelectorAll('.pos-step').forEach(btn=>btn.addEventListener('click',()=>{
  const to=Number(btn.dataset.posStep);
  if(to>=2 && !$('#salesCustomerSelect')?.value){ $('#salesStatus').textContent='Önce müşteri seçin';return}
  if(to>=3 && !salesCart.length){ $('#salesStatus').textContent='Önce ürün ekleyin';return}
  setSalesStep(to);
}));
$('#salesNext1')?.addEventListener('click',()=>{if($('#salesCustomerSelect')?.value)setSalesStep(2)});
$('#salesNext2')?.addEventListener('click',()=>{if(salesCart.length)setSalesStep(3)});
$('#salesBack2')?.addEventListener('click',()=>setSalesStep(1));
$('#salesBack3')?.addEventListener('click',()=>setSalesStep(2));
$('#salesResetBtn')?.addEventListener('click',salesReset);
$('#customerSearchSaleBtn')?.addEventListener('click',salesSearchCustomers);
$('#customerSearchSale')?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();salesSearchCustomers()}});
$('#customerSearchSale')?.addEventListener('input',()=>{
  clearTimeout(window.__salesCustSearchT);
  const term=String($('#customerSearchSale')?.value||'').trim();
  if(term.length<1)return;
  window.__salesCustSearchT=setTimeout(()=>salesSearchCustomers(),280);
});
$('#salesCustomerSelect')?.addEventListener('change',salesCustomerChanged);
$('#productSearch')?.addEventListener('input',renderProducts);
$('#productRows')?.addEventListener('click',e=>{
  const btn=e.target.closest('[data-code]');
  if(btn)addToCart(btn.dataset.code);
});
$('#cartRows')?.addEventListener('input',e=>{
  const row=e.target.closest('[data-idx]');if(!row)return;
  const i=Number(row.dataset.idx);const item=salesCart[i];if(!item)return;
  if(e.target.matches('[data-qty]'))item.qty=Math.max(1,Math.round(num(e.target.value)||1));
  if(e.target.matches('[data-price]'))item.unitPrice=Math.max(0,num(e.target.value));
  renderCart();
});
$('#cartRows')?.addEventListener('click',e=>{
  const del=e.target.closest('[data-del]');if(!del)return;
  const row=del.closest('[data-idx]');if(!row)return;
  salesCart.splice(Number(row.dataset.idx),1);
  renderCart();
});
$('#salesDiscountPct')?.addEventListener('input',salesRecalcPay);
$('#openPayScreenBtn')?.addEventListener('click',openPayScreen);
$('#salesDealer')?.addEventListener('change',salesRecalcPay);
['#payCash','#payCard','#payTransfer','#payCredit','#payNote'].forEach(id=>{
  $(id)?.addEventListener('input',salesRecalcPay);
  $(id)?.addEventListener('change',salesRecalcPay);
});
document.querySelectorAll('[data-pay-fill]').forEach(btn=>{
  btn.addEventListener('click',()=>salesFillRemainingTo(btn.getAttribute('data-pay-fill')));
});
$('#salesSaveInlineBtn')?.addEventListener('click',()=>saveSale(false));
$('#salesSavePrintInlineBtn')?.addEventListener('click',()=>saveSale(true));

$('#salesNewCustomerBtn')?.addEventListener('click',()=>{
  $('#salesQuickCustomerForm')?.reset();
  $('#qcStatus').textContent='';
  $('#salesQuickCustomerModal')?.classList.remove('hidden');
});
$('#salesQuickCustomerClose')?.addEventListener('click',()=>$('#salesQuickCustomerModal')?.classList.add('hidden'));
$('#salesQuickCustomerForm')?.addEventListener('submit',async e=>{
  e.preventDefault();
  const st=$('#qcStatus');
  st.textContent='Kaydediliyor...';
  try{
    const companyName=($('#qcCompanyName')?.value||'').trim();
    const taxOffice=($('#qcTaxOffice')?.value||'').trim();
    const taxNo=($('#qcTaxNo')?.value||'').trim();
    const tckn=($('#qcTckn')?.value||'').trim();
    let invoiceType=$('#qcInvoiceType')?.value==='corporate'?'corporate':'individual';
    if(invoiceType==='corporate'&&!(companyName&&taxNo.replace(/\D/g,'').length>=10)){
      st.textContent='Kurumsal fatura için firma ünvanı ve VKN zorunlu';return;
    }
    if(!companyName&&!taxNo)invoiceType='individual';
    const r=await api('/web-api/admin/customer',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        name:$('#qcName').value,phone:$('#qcPhone').value,
        city:$('#qcCity').value,district:$('#qcDistrict').value,address:$('#qcAddress').value,
        deliverySameAsBilling:true,invoiceType,tckn,companyName,taxOffice,taxNo
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
