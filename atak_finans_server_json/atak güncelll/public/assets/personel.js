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
let salesCustomers=[];
let salesAccounts=[];
let salesCart=[];
let salesStep=1;
let selectedPayMethod='';
let lastSaleDocsUrl='';

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
  if(salesStep===3)salesRecalcPay();
}
function salesReset(){
  salesCart=[];
  selectedPayMethod='';
  lastSaleDocsUrl='';
  if($('#salesCustomerSelect'))$('#salesCustomerSelect').value='';
  if($('#salesDiscountPct'))$('#salesDiscountPct').value='0';
  ['#payCash','#payCard','#payTransfer','#payNote','#payAmount'].forEach(id=>{if($(id))$(id).value='0'});
  if($('#salesDate'))$('#salesDate').value=new Date().toISOString().slice(0,10);
  const due=new Date();due.setDate(due.getDate()+30);
  if($('#promissoryFirstDue'))$('#promissoryFirstDue').value=due.toISOString().slice(0,10);
  document.querySelectorAll('.pay-method-btn').forEach(b=>b.classList.remove('active'));
  $('#salesSavePrintSenetBtn')?.classList.add('hidden');
  closePayScreen();
  renderSalesCustomers();
  renderProducts();
  renderCart();
  setSalesStep(1);
  salesRecalcPay();
  $('#salesStatus').textContent='';
}

$('#salesCard').onclick=async()=>{
  hidePanels();
  $('#salesPanel').classList.remove('hidden');
  await loadSales();
};
async function loadSales(){
  const st=$('#salesStatus');
  st.textContent='Satış verileri yükleniyor...';
  try{
    const [cat,fin]=await Promise.all([
      api('/web-api/admin/sales-catalog'),
      api('/web-api/admin/finance-center')
    ]);
    salesData=cat;
    salesCustomers=(fin.customers||[]).filter(c=>c.active!==false);
    salesAccounts=fin.accounts||[];
    if($('#salesDealer')){
      $('#salesDealer').innerHTML=(cat.dealerSettings||[]).filter(d=>d.active!==false)
        .map(d=>`<option value="${d.id}">${d.name}</option>`).join('')||'<option value="">Bayi yok</option>';
    }
    const cashOpts=salesAccounts.filter(a=>a.type==='cash'&&a.active!==false);
    const bankOpts=salesAccounts.filter(a=>a.type==='bank'&&a.active!==false);
    const allOpts=salesAccounts.filter(a=>a.active!==false);
    const fillAcc=(sel,rows)=>{
      if(!sel)return;
      const list=rows.length?rows:allOpts;
      sel.innerHTML=list.map(a=>`<option value="${a.id}">${a.name}</option>`).join('')||'<option value="">Hesap yok</option>';
    };
    fillAcc($('#payCashAccount'),cashOpts);
    fillAcc($('#payBankAccount'),bankOpts);
    $('#salesScopeHint').textContent=`Satışlar sizin adınıza kaydedilir · ${(cat.products||[]).length} ürün`;
    salesReset();
    st.textContent='';
  }catch(e){st.textContent=e.message}
}
function renderSalesCustomers(){
  const term=($('#customerSearchSale')?.value||'').toLocaleLowerCase('tr-TR');
  const current=$('#salesCustomerSelect')?.value||'';
  const rows=salesCustomers.filter(c=>`${c.name||''} ${c.phone||''} ${c.taxNo||''}`.toLocaleLowerCase('tr-TR').includes(term));
  $('#salesCustomerSelect').innerHTML='<option value="">Müşteri seçin</option>'+rows.map(c=>
    `<option value="${c.id}" ${String(c.id)===String(current)?'selected':''}>${c.name}${c.phone?' · '+c.phone:''}</option>`
  ).join('');
  if(current && rows.some(c=>String(c.id)===String(current)))$('#salesCustomerSelect').value=current;
  salesCustomerChanged();
}
function salesCustomerChanged(){
  const c=salesCustomers.find(x=>String(x.id)===String($('#salesCustomerSelect')?.value||''));
  const box=$('#salesCustomerInfo');
  if(!c){box?.classList.add('hidden');box&&(box.innerHTML='');setSalesStep(salesStep);return}
  box.classList.remove('hidden');
  box.innerHTML=`
    <div><small>Müşteri</small><b>${c.name||'—'}</b></div>
    <div><small>Telefon</small><b>${c.phone||'—'}</b></div>
    <div><small>Cari</small><b>${money(c.balance)}</b></div>`;
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
  const list=selectedPayMethod==='Nakit'?(cashOpts.length?cashOpts:all):(bankOpts.length?bankOpts:all);
  const sel=$('#payAccountSelect');
  if(sel)sel.innerHTML=list.map(a=>`<option value="${a.id}">${a.name}</option>`).join('')||'<option value="">Hesap yok</option>';
  if($('#payCashAccount'))$('#payCashAccount').innerHTML=$('#payAccountSelect')?.innerHTML||'';
  if($('#payBankAccount'))$('#payBankAccount').innerHTML=$('#payAccountSelect')?.innerHTML||'';
}
function applyPayMethod(method){
  selectedPayMethod=method||'';
  const net=cartNet();
  ['#payCash','#payCard','#payTransfer','#payNote'].forEach(id=>{if($(id))$(id).value='0'});
  document.querySelectorAll('.pay-method-btn').forEach(b=>b.classList.toggle('active',b.dataset.method===selectedPayMethod));
  const isSenet=selectedPayMethod==='Senet';
  $('#promissoryWrap')?.classList.toggle('hidden',!isSenet);
  $('#payAccountWrap')?.classList.toggle('hidden',isSenet);
  $('#salesSavePrintSenetBtn')?.classList.toggle('hidden',!isSenet);
  if($('#payAmount'))$('#payAmount').value=String(net);
  if(selectedPayMethod==='Nakit')$('#payCash').value=String(net);
  if(selectedPayMethod==='Kredi Kartı')$('#payCard').value=String(net);
  if(selectedPayMethod==='Havale')$('#payTransfer').value=String(net);
  if(selectedPayMethod==='Senet')$('#payNote').value=String(net);
  syncPayAccounts();
  const acc=$('#payAccountSelect')?.value||'';
  if(selectedPayMethod==='Nakit'&&$('#payCashAccount'))$('#payCashAccount').value=acc;
  if((selectedPayMethod==='Kredi Kartı'||selectedPayMethod==='Havale')&&$('#payBankAccount'))$('#payBankAccount').value=acc;
  salesRecalcPay();
}
function salesRecalcPay(){
  const net=cartNet();
  const amount=num($('#payAmount')?.value)||net;
  if(selectedPayMethod==='Nakit')$('#payCash').value=String(amount);
  if(selectedPayMethod==='Kredi Kartı')$('#payCard').value=String(amount);
  if(selectedPayMethod==='Havale')$('#payTransfer').value=String(amount);
  if(selectedPayMethod==='Senet')$('#payNote').value=String(amount);
  const cash=num($('#payCash')?.value),card=num($('#payCard')?.value),tr=num($('#payTransfer')?.value),note=num($('#payNote')?.value);
  const gross=cartGross();
  if($('#payGross'))$('#payGross').textContent=money(gross);
  if($('#payDiscount'))$('#payDiscount').textContent=money(gross-net);
  if($('#payNet'))$('#payNet').textContent=money(net);
  if($('#payScreenNet'))$('#payScreenNet').textContent=money(net);
  const preview=$('#payMethodPreview');
  if(preview){
    preview.textContent=selectedPayMethod
      ?`Seçili ödeme: ${selectedPayMethod} · ${money(amount)}`
      :'Ödeme seçilmedi — Ödeme Ekranı’ndan seçin';
  }
  $('#promissoryWrap')?.classList.toggle('hidden',!(selectedPayMethod==='Senet'||note>0));
}
function openPayScreen(){
  salesRecalcPay();
  if(!selectedPayMethod)applyPayMethod('Nakit');
  else applyPayMethod(selectedPayMethod);
  $('#payScreenStatus').textContent='';
  $('#payScreenModal')?.classList.remove('hidden');
}
function closePayScreen(){$('#payScreenModal')?.classList.add('hidden')}
function printSaleDocs(url){
  if(!url)return;
  const w=window.open(url,'_blank','noopener,noreferrer');
  if(!w)$('#payScreenStatus').textContent='Açılır pencere engellendi — tarayıcı izni verin';
}
async function saveSale(printSenet=false){
  const st=$('#payScreenStatus')||$('#salesStatus');
  const customerId=$('#salesCustomerSelect')?.value||'';
  if(!customerId){st.textContent='Müşteri seçin';return}
  if(!salesCart.length){st.textContent='Sepete ürün ekleyin';return}
  if(!selectedPayMethod){st.textContent='Ödeme şekli seçin';openPayScreen();return}
  const net=cartNet();
  const amount=num($('#payAmount')?.value);
  if(amount<=0){st.textContent='Ödeme tutarı girin';return}
  if(Math.abs(amount-net)>0.009){st.textContent=`Tutar net ile aynı olmalı: ${money(net)}`;return}
  applyPayMethod(selectedPayMethod);
  const cash=num($('#payCash')?.value),card=num($('#payCard')?.value),tr=num($('#payTransfer')?.value),note=num($('#payNote')?.value);
  if(note>0 && !$('#promissoryFirstDue')?.value){st.textContent='Senet için ilk vade girin';return}
  const acc=$('#payAccountSelect')?.value||'';
  if(selectedPayMethod!=='Senet' && !acc){st.textContent='Hesap seçin';return}
  const payments=[];
  if(cash>0)payments.push({method:'Nakit',amount:cash,accountId:acc||$('#payCashAccount')?.value||''});
  if(card>0)payments.push({method:'Kredi Kartı',amount:card,accountId:acc||$('#payBankAccount')?.value||''});
  if(tr>0)payments.push({method:'Havale',amount:tr,accountId:acc||$('#payBankAccount')?.value||''});
  const body={
    customerId,
    dealerId:$('#salesDealer')?.value||'',
    salespersonId:currentUser?.id||'',
    salespersonName:currentUser?.name||'',
    discountPct:num($('#salesDiscountPct')?.value),
    date:$('#salesDate')?.value||new Date().toISOString().slice(0,10),
    items:salesCart.map(r=>({productCode:r.code,itemCode:r.itemCode,materialCode:r.materialCode,productName:r.name,quantity:r.qty,unitPrice:r.unitPrice})),
    payments,
    promissory:note>0?{amount:note,installments:num($('#promissoryInstallments')?.value)||1,firstDueDate:$('#promissoryFirstDue')?.value,intervalMonths:1}:null,
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
    closePayScreen();
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
$('#customerSearchSale')?.addEventListener('input',renderSalesCustomers);
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
$('#salesDiscountPct')?.addEventListener('input',()=>{salesRecalcPay();if(selectedPayMethod)applyPayMethod(selectedPayMethod)});
$('#payAmount')?.addEventListener('input',salesRecalcPay);
$('#openPayScreenBtn')?.addEventListener('click',openPayScreen);
$('#payScreenClose')?.addEventListener('click',closePayScreen);
$('#payScreenModal')?.addEventListener('click',e=>{if(e.target===$('#payScreenModal'))closePayScreen()});
$('#payMethodGrid')?.addEventListener('click',e=>{
  const btn=e.target.closest('[data-method]');
  if(btn)applyPayMethod(btn.dataset.method);
});
$('#payAccountSelect')?.addEventListener('change',()=>{
  const acc=$('#payAccountSelect')?.value||'';
  if($('#payCashAccount'))$('#payCashAccount').value=acc;
  if($('#payBankAccount'))$('#payBankAccount').value=acc;
});
$('#salesSaveBtn')?.addEventListener('click',()=>saveSale(false));
$('#salesSavePrintSenetBtn')?.addEventListener('click',()=>saveSale(true));

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
    const r=await api('/web-api/admin/customer',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        name:$('#qcName').value,phone:$('#qcPhone').value,
        city:$('#qcCity').value,district:$('#qcDistrict').value,address:$('#qcAddress').value,
        deliverySameAsBilling:true,invoiceType:'individual'
      })
    });
    const row=r.row;
    salesCustomers.unshift(row);
    $('#salesQuickCustomerModal')?.classList.add('hidden');
    if($('#customerSearchSale'))$('#customerSearchSale').value='';
    renderSalesCustomers();
    $('#salesCustomerSelect').value=row.id;
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

loadSession();
