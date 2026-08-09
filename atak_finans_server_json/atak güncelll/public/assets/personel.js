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
let salesData=null;

function has(permission){
  const p=currentUser?.permissions||[];
  return p.includes('*')||p.includes(permission);
}
function canFinance(){
  return has('finance_manage')||has('finance_view')||has('orders_manage')||has('customers_manage');
}
function hidePanels(){
  ['#financePanel','#salesPanel','#stockPanel','#announcementPanel'].forEach(x=>$(x)?.classList.add('hidden'));
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
    if(canFinance())$('#financeCard').classList.remove('hidden');
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
    financeData=await api('/web-api/admin/finance-center'+financeQuery());
    renderFinance();
    st.textContent='';
  }catch(e){st.textContent=e.message}
}

function renderFinance(){
  const d=financeData||{};
  const canManage=Boolean(d.canManage);
  const ciro=d.ciro||{brand:{},personnel:[]};
  const brand=ciro.brand||{};
  const summary=d.summary||{};

  $('#adminCiroWrap')?.classList.toggle('hidden',!canManage);
  $('#personnelCiroWrap')?.classList.toggle('hidden',!canManage);

  if(canManage){
    $('#financeScopeHint').textContent='Yönetici görünümü: Beko / İstikbal / Total ve personel bazlı ciro';
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
    $('#financeStats').innerHTML=`
      <div class="stat"><small>Toplam Kasa</small><b>${money(summary.cash||summary.totalCash||0)}</b></div>
      <div class="stat"><small>Toplam Banka</small><b>${money(summary.bank||summary.totalBank||0)}</b></div>
      <div class="stat"><small>Alacak</small><b>${money(summary.receivable||0)}</b></div>
      <div class="stat"><small>Müşteri</small><b>${(d.customers||[]).length}</b></div>`;
  }else{
    $('#financeScopeHint').textContent='Sadece sizin yaptığınız satış ve tahsilatlar görünür';
    $('#financeStats').innerHTML=`
      <div class="stat"><small>Satışlarım (Net)</small><b>${money(summary.mySalesTotal||brand.total||0)}</b></div>
      <div class="stat"><small>Satış Adedi</small><b>${Number(summary.mySalesCount||brand.count||0)}</b></div>
      <div class="stat"><small>Tahsilatlarım</small><b>${money(summary.myCollections||0)}</b></div>
      <div class="stat"><small>İlgili Cari</small><b>${(d.customers||[]).length}</b></div>`;
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
      <td><b>${money(t.total??t.amount)}</b></td>
    </tr>`).join('')||'<tr><td colspan="5">Hareket bulunamadı.</td></tr>';
}

$('#financeCard').onclick=async()=>{
  hidePanels();
  $('#financePanel').classList.remove('hidden');
  await loadFinance();
};
$('#financeRefresh')?.addEventListener('click',loadFinance);
$('#financeFilterApply')?.addEventListener('click',loadFinance);
$('#customerSearch')?.addEventListener('input',renderCustomers);
$('#txSearch')?.addEventListener('input',renderTransactions);

$('#salesCard').onclick=async()=>{
  hidePanels();
  $('#salesPanel').classList.remove('hidden');
  await loadSales();
};
async function loadSales(){
  const st=$('#salesStatus');
  st.textContent='Ürünler yükleniyor...';
  try{
    salesData=await api('/web-api/admin/sales-catalog');
    renderProducts();
    st.textContent=`${(salesData.products||[]).length} ürün hazır`;
  }catch(e){st.textContent=e.message}
}
function renderProducts(){
  const term=($('#productSearch')?.value||'').toLocaleLowerCase('tr-TR');
  const rows=(salesData?.products||[]).filter(p=>
    `${p.code||''} ${p.name||''} ${p.searchName||''}`.toLocaleLowerCase('tr-TR').includes(term)
  ).slice(0,150);
  $('#productRows').innerHTML=rows.map(p=>`
    <tr><td><b>${p.code||''}</b></td><td>${p.name||''}</td><td>${p.brand||'—'}</td></tr>
  `).join('')||'<tr><td colspan="3">Ürün bulunamadı.</td></tr>';
}
$('#productSearch')?.addEventListener('input',renderProducts);

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

loadSession();
