/* ATAK_ADMIN_BUILD=fix-v229 */
function sipBtn(phone,opts){return typeof sipCallButton==='function'?sipCallButton(phone,opts||{}):''}
const q=s=>document.querySelector(s),qa=s=>[...document.querySelectorAll(s)];let store=null,page=1,pageSize=30,selected=new Set();
const money=n=>new Intl.NumberFormat('tr-TR',{style:'currency',currency:'TRY',maximumFractionDigits:0}).format(Number(n||0));
const money2=n=>new Intl.NumberFormat('tr-TR',{style:'currency',currency:'TRY',minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(n||0));
function salesNum(v){
  if(typeof v==='number')return Number.isFinite(v)?v:0;
  let s=String(v??'').trim().replace(/%/g,'').replace(/₺/g,'').replace(/\s/g,'');
  if(!s)return 0;
  if(s.includes(',')&&s.includes('.')){
    if(s.lastIndexOf(',')>s.lastIndexOf('.'))s=s.replace(/\./g,'').replace(',','.');
    else s=s.replace(/,/g,'');
  }else if(s.includes(','))s=s.replace(',','.');
  const n=Number(s);return Number.isFinite(n)?n:0;
}
function salesPreferredPriceMethod(){
  try{
    const s=typeof salesPaymentSplits==='function'?salesPaymentSplits():null;
    if(s&&s.card>s.cash)return 'Kredi Kartı';
  }catch(_){}
  return 'Nakit';
}
function salesProductUnitPrice(p,method=''){
  if(!p)return 0;
  const cash=salesNum(p.cashPrice??p.price??p.salePrice);
  const card=salesNum(p.cardPrice??p.price??p.salePrice);
  const list=salesNum(p.listPrice??p.bekoPrice??p.oldPrice);
  const m=method||salesPreferredPriceMethod();
  if(String(m).includes('Kredi Kartı')||m==='Kredi Kartı')return card||cash||list;
  return cash||card||list||salesNum(p.salePrice)||salesNum(p.bekoPrice);
}
function toast(t){q('#toast').textContent=t;q('#toast').classList.remove('hidden');setTimeout(()=>q('#toast').classList.add('hidden'),2800)}
function uploadTooLargeMessage(){
  const f=typeof selectedCustomerExcelFile==='function'?selectedCustomerExcelFile():null;
  const mb=f&&f.size?` Seçilen dosya ${(f.size/1024/1024).toFixed(1).replace('.',',')} MB.`:'';
  return `Dosya sunucuya sığmadı.${mb} Hostinger’daki yeni deploy komutunu çalıştırın, sonra Ctrl+Shift+R ile yenileyip tekrar Önizle’ye basın.`;
}
async function api(url,opt={}){
  const r=await fetch(url,{credentials:'same-origin',...opt});
  const ct=String(r.headers.get('content-type')||'');
  const text=await r.text();
  let d={};
  if(r.status===413){
    const err=new Error(uploadTooLargeMessage());
    err.status=413;
    throw err;
  }
  if(ct.includes('application/json')||/^\s*[{[]/.test(text)){
    try{d=JSON.parse(text||'{}')}catch(_){d={}}
  }else if(r.status===502||r.status===504||r.status===524){
    throw new Error('Aktarım uzun sürdü. Tekrar Aktar’a basın; kaldığı yerden devam eder.');
  }else if(r.redirected||/^\s*</.test(text)){
    const err=new Error(String(url||'').includes('excel-import')
      ?'Aktarım kesildi. Tekrar Aktar’a basın; kaldığı yerden devam eder.'
      :'API bulunamadı (sunucu güncellemesi gerekli)');
    err.status=r.status;
    throw err;
  }
  if(!r.ok){
    const hint=String(d.error||d.message||d.detail||'').trim()
      ||String(text||'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().slice(0,180);
    const err=new Error(hint||(r.status===401?'Oturum süresi dolmuş. Lütfen tekrar giriş yapın.':`Excel/işlem hatası (kod ${r.status})`));
    err.payload=d;
    err.status=r.status;
    throw err;
  }
  return d;
}
let pendingMfaChallengeId='';
function showLoginPassword(){
  q('#loginForm')?.classList.remove('hidden');
  q('#mfaForm')?.classList.add('hidden');
  pendingMfaChallengeId='';
}
function showLoginMfa(r){
  pendingMfaChallengeId=r.challengeId||'';
  q('#loginForm')?.classList.add('hidden');
  q('#mfaForm')?.classList.remove('hidden');
  const hours=r.trustHours||6;
  if(q('#mfaHint'))q('#mfaHint').textContent=`Kod ${r.emailHint||'e-posta'} adresine gitti. Bu tarayıcı ${hours} saat tanınır; sonra yeniden kod istenir.`;
  if(q('#mfaCode')){q('#mfaCode').value='';q('#mfaCode').focus()}
}
async function check(){const m=await api('/web-api/me');if(m.authenticated){showApp();await load()}else q('#loginView').classList.remove('hidden')}
q('#loginForm').onsubmit=async e=>{
  e.preventDefault();
  try{
    const r=await api('/web-api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:q('#username').value.trim(),password:q('#password').value})});
    if(r.mfaRequired){showLoginMfa(r);return}
    await loadCurrentAdminPermissions();showApp();await load();
  }catch(e){toast(e.message)}
};
q('#mfaForm')?.addEventListener('submit',async e=>{
  e.preventDefault();
  try{
    await api('/web-api/login/verify-mfa',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({challengeId:pendingMfaChallengeId,code:q('#mfaCode').value.trim()})});
    pendingMfaChallengeId='';
    await loadCurrentAdminPermissions();showApp();await load();
  }catch(err){toast(err.message)}
});
q('#mfaBackBtn')?.addEventListener('click',()=>showLoginPassword());
function isMobileUi(){
  try{return window.matchMedia('(max-width:950px)').matches}catch(_){return false}
}
function applyUiScale(v){
  // Mobilde zoom dağınıklık yaratıyor — sabit 1
  const scale=isMobileUi()?'1':String(v||'0.85');
  document.documentElement.style.zoom=scale;
  document.documentElement.setAttribute('data-ui-scale',scale);
  if(!isMobileUi()){try{localStorage.setItem('atak-ui-scale-v4',String(v||scale))}catch(_){}}
  const sel=q('#uiScaleSelect');if(sel&&sel.value!==scale)sel.value=scale;
}
function initUiScale(){
  let scale='0.85';
  try{scale=localStorage.getItem('atak-ui-scale-v4')||'0.85'}catch(_){}
  if(!['0.75','0.85','0.95','1'].includes(scale))scale='0.85';
  applyUiScale(scale);
  q('#uiScaleSelect')?.addEventListener('change',e=>applyUiScale(e.target.value));
  const skinSel=q('#skinSelect');
  if(skinSel){
    const cur=document.documentElement.getAttribute('data-skin')==='classic'?'classic':'calm';
    skinSel.value=cur;
    skinSel.addEventListener('change',e=>{
      const v=e.target.value==='classic'?'classic':'calm';
      document.documentElement.setAttribute('data-skin',v);
      try{localStorage.setItem('atak-skin',v)}catch(_){}
    });
  }
  q('#taskRefreshBtn')?.addEventListener('click',()=>loadTasksCenter().catch(e=>toast(e.message)));
  q('#dashTaskRefresh')?.addEventListener('click',()=>loadTasksCenter().catch(e=>toast(e.message)));
  window.addEventListener('resize',()=>{if(isMobileUi())applyUiScale('1')});
}
initUiScale();
function showApp(){q('#loginView').classList.add('hidden');q('#appView').classList.remove('hidden');let saved=sessionStorage.getItem('atakAdminTab');if(saved==='uninvoicedSales'||saved==='invoiceCenter')saved='dashboard';if(saved&&q('#'+saved))setTimeout(()=>goTab(saved,{remember:false}),0);setTimeout(()=>refreshTaskBadge(),600)}
async function load(){store=await api('/web-api/admin/store');renderAll()}
const productTabs=new Set(['products','productImport','prices']);
function setProductsMenu(open){
  const group=q('#productsNavGroup'),submenu=q('#productsSubmenu'),toggle=q('#productsMenuToggle');
  if(!group||!submenu||!toggle)return;
  group.classList.toggle('open',Boolean(open));
  submenu.classList.toggle('open',Boolean(open));
  toggle.setAttribute('aria-expanded',open?'true':'false');
}
function goTab(id,{remember=true}={}){
  if(id==='uninvoicedSales')id='invoiceCenter';
  if(id==='invoiceCenter'){
    const needed=TAB_PERMISSION_MAP.invoiceCenter;if(needed&&!can(needed)){toast('Bu ekran için yetkiniz yok.');return false}
    window.open('/e-fatura','_blank','noopener');
    return true;
  }
  const needed=TAB_PERMISSION_MAP[id];if(needed&&!can(needed)){toast('Bu ekran için yetkiniz yok.');return false}
  const target=q('#'+id);
  if(!target){toast('Bu ekran henüz bağlı değil: '+id);return false}
  qa('[data-tab]').forEach(x=>x.classList.toggle('active',x.dataset.tab===id));
  qa('.tab').forEach(x=>x.classList.toggle('active',x.id===id));
  const btn=q(`[data-tab="${id}"]`);
  q('#pageTitle').textContent=btn?(btn.dataset.title||btn.textContent.replace(/^[^A-Za-zÇĞİÖŞÜ]+/,'').trim()):id;
  if(remember)sessionStorage.setItem('atakAdminTab',id);
  q('#productsNavGroup')?.classList.toggle('active-group',productTabs.has(id));q('#financeNavGroup')?.classList.toggle('active-group',id==='financeDashboard');
  if(productTabs.has(id))setProductsMenu(true);
  if(id==='users')setTimeout(()=>load().then(()=>renderUsers()).catch(e=>toast(e.message)),20);
  if(id==='foundation')setTimeout(()=>loadFoundation().catch(e=>toast(e.message)),20);
  if(id==='stockCenter')setTimeout(()=>loadStockCenter().catch(e=>toast(e.message)),20);
  if(id==='products')setTimeout(()=>refreshProductsStockWarehouseOptions().catch(()=>{}),20);
  if(id==='financeCenter')setTimeout(()=>loadFinanceCenter().catch(e=>toast(e.message)),20);
  if(id==='moneyCenter')setTimeout(()=>loadMoneyCenter().catch(e=>toast(e.message)),20);
  if(id==='financeReports')setTimeout(()=>loadFinanceCenter().catch(e=>toast(e.message)),20);
  if(id==='customersPage')setTimeout(()=>loadCustomersPage().catch(e=>toast(e.message)),20);
  if(id==='salesCenter')setTimeout(()=>loadSalesCenter(),20);
  if(id==='webOrders')setTimeout(()=>loadWebOrders(),20);
  if(id==='settings')setTimeout(()=>{
    setSettingsTab(settingsTabView);
    loadPromissorySettings();
    loadDealerSettings().catch(()=>{});
    loadMailSettings().catch(()=>{});
    loadSmsSettings().catch(()=>{});
    loadFinanceCenter().catch(()=>{});
  },20);
  if(id==='mySalesReport')setTimeout(loadMySalesReport,20);
  if(id==='staffSalesReport')setTimeout(loadStaffSalesReport,20);
  if(id==='managerApprovals')setTimeout(loadApprovals,20);
  if(id==='profitCenter')setTimeout(()=>loadProfitReport(),20);
  if(id==='reportsHub')setTimeout(()=>loadReportsHub(),20);
  if(id==='salesTracking')setTimeout(loadSalesTracking,20);
  if(id==='customerPayments')setTimeout(()=>loadCustomerPayments().catch(e=>toast(e.message)),20);
  if(id==='training')setTimeout(()=>loadTrainingCenter().catch(e=>toast(e.message)),20);
  if(id==='dynamicsExcelImport')setTimeout(()=>loadDynamicsImport(),20);
  if(id==='purchaseInvoices')setTimeout(()=>loadPurchaseInvoices(),20);
  document.body.classList.toggle('inv-full',id==='invoiceCenter');
  if(id==='invoiceCenter')setTimeout(()=>loadInvoiceCenter().catch(e=>toast(e.message)),20);
  if(id==='tasksCenter')setTimeout(()=>loadTasksCenter().catch(()=>{}),20);
  return true
}
document.addEventListener('click',e=>{
  const tab=e.target.closest('[data-tab]');
  if(tab){e.preventDefault();e.stopPropagation();goTab(tab.dataset.tab);return}
  const go=e.target.closest('[data-go]');
  if(go){e.preventDefault();e.stopPropagation();goTab(go.dataset.go);return}
});
q('#productsMenuToggle')?.addEventListener('click',()=>setProductsMenu(!q('#productsNavGroup')?.classList.contains('open')));
q('#submenuNewProduct')?.addEventListener('click',()=>{goTab('products');q('#newProductBtn')?.click()});
function renderAll(){renderDashboard();renderCategoryOptions();renderBrandOptions();renderProducts();renderBrands();renderCategories();renderCampaigns();renderBanners();renderRevenue();renderUsers();refreshProductsStockWarehouseOptions().catch(()=>{})}
function localDate(d=new Date()){const z=new Date(d.getTime()-d.getTimezoneOffset()*60000);return z.toISOString().slice(0,10)}
function weekStart(d=new Date()){const x=new Date(d),day=(x.getDay()+6)%7;x.setDate(x.getDate()-day);return localDate(x)}
async function fetchRevenueSummary(startDate,endDate){return api(`/web-api/admin/revenue-summary?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`)}
let dashboardRevenue=null;
async function renderDashboardRevenue(){
  try{
    const d=localDate();
    dashboardRevenue=await fetchRevenueSummary(d,d).catch(()=>({channels:{beko:{amount:0,orderCount:0},istikbal:{amount:0,orderCount:0},atakhome:{amount:0,orderCount:0},hepsiburada:{amount:0,orderCount:0}}}));
    const c=dashboardRevenue.channels||{};
    const ch=(k)=>({amount:Number(c[k]?.amount||0),orderCount:Number(c[k]?.orderCount||0)});
    let beko=ch('beko'),istikbal=ch('istikbal');
    const atakhome=ch('atakhome'),hb=ch('hepsiburada');
    let netToday=0,netCount=0,primToday=0,otherPos=0,otherPosCount=0;
    try{
      const board=await api('/web-api/admin/sales-prim-board?period=day&date='+encodeURIComponent(d));
      netToday=Number(board.summary?.net||0);
      netCount=Number(board.summary?.count||board.summary?.netCount||0);
      primToday=Number(board.summary?.commission||board.summary?.primEarned||0);
      // POS bayi ayrımı (Atak Beko / Atak İstikbal) — dashboard kartlarının asıl kaynağı
      if(board.brand||board.summary?.beko!=null){
        const b=board.brand||{};
        beko={
          amount:Number(b.beko?.amount??board.summary?.beko??beko.amount)||0,
          orderCount:Number(b.beko?.orderCount??board.summary?.bekoCount??beko.orderCount)||0
        };
        istikbal={
          amount:Number(b.istikbal?.amount??board.summary?.istikbal??istikbal.amount)||0,
          orderCount:Number(b.istikbal?.orderCount??board.summary?.istikbalCount??istikbal.orderCount)||0
        };
        otherPos=Number(b.other?.amount??board.summary?.other??0)||0;
        otherPosCount=Number(b.other?.orderCount??board.summary?.otherCount??0)||0;
      }
    }catch(_){
      // Eski sunucu / prim board yok: POS satışlarını finance-center'dan say
      try{
        const fin=await api('/web-api/admin/finance-center?customers=0');
        const sales=(fin.sales||fin.transactions||[]).filter(t=>t.kind==='sale'&&!t.cancelled&&String(t.date||t.createdAt||'').slice(0,10)===d);
        netToday=sales.reduce((a,t)=>{
          const v=Number(t.total??t.net??t.amount??t.customerDelta??0);
          return a+Math.abs(v);
        },0);
        netCount=sales.length;
        primToday=sales.reduce((a,t)=>a+Number(t.commissionAmount||t.commission||0),0);
        const split={beko:0,istikbal:0,other:0,bekoCount:0,istikbalCount:0,otherCount:0};
        for(const t of sales){
          const blob=`${t.dealerId||''} ${t.dealerName||''}`.toLocaleLowerCase('tr-TR');
          const key=blob.includes('istikbal')?'istikbal':blob.includes('beko')?'beko':'other';
          const v=Math.abs(Number(t.total??t.net??t.amount??0));
          split[key]+=v;split[key+'Count']+=1;
        }
        beko={amount:split.beko,orderCount:split.bekoCount};
        istikbal={amount:split.istikbal,orderCount:split.istikbalCount};
        otherPos=split.other;otherPosCount=split.otherCount;
      }catch(__){}
    }
    const channelTotal=beko.amount+istikbal.amount+atakhome.amount+hb.amount+otherPos;
    const total=Math.max(channelTotal,netToday);
    const otherLine=otherPos>0?`<div class="stat channel other"><small>Diğer POS bugün</small><strong>${money(otherPos)}</strong><em>${otherPosCount} satış · bayi seçilmemiş</em></div>`:'';
    q('#stats').innerHTML=`
      <div class="stat net-today"><small>Bugün NET Satış (POS)</small><strong>${money(netToday)}</strong><em>${netCount} satış · Prim ${money(primToday)}</em></div>
      <div class="stat channel beko"><small>Beko Mağaza bugün</small><strong>${money(beko.amount)}</strong><em>${beko.orderCount} satış</em></div>
      <div class="stat channel istikbal"><small>İstikbal bugün</small><strong>${money(istikbal.amount)}</strong><em>${istikbal.orderCount} satış</em></div>
      <div class="stat channel atakhome"><small>AtakHome bugün</small><strong>${money(atakhome.amount)}</strong><em>${atakhome.orderCount} otomatik sipariş</em></div>
      <div class="stat channel hb"><small>Hepsiburada bugün</small><strong>${money(hb.amount)}</strong><em>${hb.orderCount} sipariş</em></div>
      ${otherLine}
      <div class="stat total"><small>Toplam ciro</small><strong>${money(total)}</strong><em>KDV dahil · POS dahil</em></div>`;
  }catch(e){console.error(e)}
}
/* ===== Kâr & Maliyet raporu ===== */
let profitData=null;
function profitPct(v){return `%${Number(v||0).toLocaleString('tr-TR',{minimumFractionDigits:1,maximumFractionDigits:1})}`}
function profitRangePreset(kind){
  const now=new Date();
  const iso=d=>localDate(d);
  if(kind==='today')return{from:iso(now),to:iso(now)};
  if(kind==='month')return{from:iso(new Date(now.getFullYear(),now.getMonth(),1)),to:iso(now)};
  if(kind==='prevmonth'){
    const first=new Date(now.getFullYear(),now.getMonth()-1,1);
    const last=new Date(now.getFullYear(),now.getMonth(),0);
    return{from:iso(first),to:iso(last)};
  }
  if(kind==='year')return{from:iso(new Date(now.getFullYear(),0,1)),to:iso(now)};
  return{from:iso(now),to:iso(now)};
}
async function loadProfitReport(){
  const st=q('#profitStatus');
  if(!q('#profitKpis'))return;
  if(!q('#profitFrom').value||!q('#profitTo').value){
    const r=profitRangePreset('month');
    q('#profitFrom').value=r.from;q('#profitTo').value=r.to;
  }
  if(st){st.textContent='Hesaplanıyor…';st.className='form-status'}
  try{
    const p=new URLSearchParams({from:q('#profitFrom').value,to:q('#profitTo').value});
    const dealer=q('#profitDealer')?.value||'';
    if(dealer)p.set('dealerId',dealer);
    const d=await api('/web-api/admin/profit-report?'+p.toString());
    profitData=d;
    renderProfitReport(d);
    if(st){st.textContent=`${d.summary.count} satış · ${d.from} → ${d.to}`;st.className='form-status success'}
  }catch(e){
    if(st){st.textContent=e.message;st.className='form-status error'}
  }
}
function renderProfitReport(d){
  const s=d.summary||{};
  // Maliyeti girilmemiş ürün varsa rakama güvenilmez — açıkça uyar
  const warn=q('#profitWarning');
  if(warn){
    if(Number(s.missingCostCount||0)>0){
      warn.classList.remove('hidden');
      warn.innerHTML=`<b>Dikkat:</b> ${s.missingCostCount} satış kaleminde alış fiyatı girilmemiş (${money(s.missingCostRevenue)} ciro). Bu kalemler maliyetsiz sayıldığı için <b>kâr olduğundan yüksek görünüyor</b>. Ürün kartlarına “Alış fiyatı” girin.`;
    }else{
      warn.classList.add('hidden');
    }
  }
  q('#profitKpis').innerHTML=`
    <article><small>Net Satış (KDV dahil)</small><b>${money(s.revenue)}</b><span>${Number(s.count||0)} satış · iskonto ${money(s.discount)}</span></article>
    <article><small>Matrah (KDV hariç)</small><b>${money(s.revenueExVat)}</b><span>KDV ${money(s.vatAmount)}</span></article>
    <article><small>Maliyet (KDV hariç)</small><b>${money(s.cost)}</b><span>satılan malın maliyeti</span></article>
    <article class="profit-gross"><small>Brüt Kâr</small><b>${money(s.grossProfit)}</b><span>marj ${profitPct(s.marginPct)}</span></article>
    <article class="profit-net"><small>Net Kâr (prim sonrası)</small><b>${money(s.netProfit)}</b><span>prim ${money(s.commission)}</span></article>`;

  const brandRow=(label,cls,v)=>`<tr>
    <td><span class="ck-brand-pill ${cls}">${label}</span></td>
    <td>${Number(v.count||0)}</td>
    <td>${money(v.revenueExVat)}</td>
    <td>${money(v.cost)}</td>
    <td><b>${money(v.grossProfit)}</b></td>
    <td>${profitPct(v.marginPct)}</td>
    <td><b>${money(v.netProfit)}</b></td>
  </tr>`;
  const b=d.byBrand||{};
  q('#profitBrandTable').innerHTML=`<table><thead><tr><th>Bayi</th><th>Satış</th><th>Matrah</th><th>Maliyet</th><th>Brüt Kâr</th><th>Marj</th><th>Net Kâr</th></tr></thead><tbody>
    ${brandRow('Beko','beko',b.beko||{})}
    ${brandRow('İstikbal','istikbal',b.istikbal||{})}
    ${Number(b.other?.count||0)>0?brandRow('Diğer','other',b.other):''}
  </tbody></table>`;

  const inv=d.inventory||{};
  q('#profitInventory').innerHTML=`
    <div class="ck-money-grid">
      <article class="bank"><small>Stok Değeri (KDV hariç)</small><b>${money(inv.valueExVat)}</b></article>
      <article><small>Stok Değeri (KDV dahil)</small><b>${money(inv.valueIncVat)}</b></article>
      <article class="cash"><small>Toplam Adet</small><b>${Number(inv.totalQuantity||0)}</b></article>
      <article class="${Number(inv.missingCostProducts||0)>0?'debt':''}"><small>Maliyeti Eksik Ürün</small><b>${Number(inv.missingCostProducts||0)}</b></article>
    </div>
    ${(inv.byWarehouse||[]).length?`<div class="turnover-table" style="margin-top:12px"><table><thead><tr><th>Depo</th><th>Adet</th><th>Değer (KDV hariç)</th></tr></thead><tbody>${inv.byWarehouse.map(w=>`<tr><td>${w.warehouseName}</td><td>${w.quantity}</td><td><b>${money(w.valueExVat)}</b></td></tr>`).join('')}</tbody></table></div>`:'<p class="note" style="margin-top:10px">Depo bazlı stok kaydı yok.</p>'}`;

  const prods=d.byProduct||[];
  q('#profitProductTable').innerHTML=prods.length
    ?`<table><thead><tr><th>Ürün</th><th>Adet</th><th>Matrah</th><th>Maliyet</th><th>Brüt Kâr</th><th>Marj</th></tr></thead><tbody>${prods.map(p=>{
        const marj=p.revenueExVat>0?p.grossProfit/p.revenueExVat*100:0;
        return `<tr><td><b>${ckEsc(p.productName||p.productCode)}</b>${p.costMissing?'<small class="warn-text">alış fiyatı eksik</small>':''}</td><td>${p.quantity}</td><td>${money(p.revenueExVat)}</td><td>${money(p.cost)}</td><td><b>${money(p.grossProfit)}</b></td><td>${profitPct(marj)}</td></tr>`;
      }).join('')}</tbody></table>`
    :'<p class="note">Bu dönemde satış yok.</p>';

  const rows=d.rows||[];
  if(q('#profitRowCount'))q('#profitRowCount').textContent=`${rows.length} satış`;
  const label={beko:'Beko',istikbal:'İstikbal',other:'Diğer'};
  q('#profitRowsTable').innerHTML=rows.length
    ?`<table><thead><tr><th>Tarih</th><th>Referans</th><th>Bayi</th><th>Personel</th><th>Matrah</th><th>Maliyet</th><th>Brüt Kâr</th><th>Marj</th><th>Net Kâr</th></tr></thead><tbody>${rows.map(r=>`<tr class="${r.costReliable?'':'price-warning'}">
        <td>${ckEsc(r.date||'')}</td>
        <td>${ckEsc(r.reference||'-')}</td>
        <td><span class="ck-brand-pill ${r.brand}">${label[r.brand]||'Diğer'}</span></td>
        <td>${ckEsc(r.salespersonName||'-')}</td>
        <td>${money(r.revenueExVat)}</td>
        <td>${money(r.cost)}${r.missingCostCount?'<small class="warn-text">eksik maliyet</small>':''}</td>
        <td><b>${money(r.grossProfit)}</b></td>
        <td>${profitPct(r.marginPct)}</td>
        <td><b>${money(r.netProfit)}</b></td>
      </tr>`).join('')}</tbody></table>`
    :'<p class="note">Bu dönemde satış yok.</p>';

  const sel=q('#profitDealer');
  if(sel&&sel.options.length<=1&&(d.dealers||[]).length){
    const cur=sel.value;
    sel.innerHTML='<option value="">Tümü</option>'+d.dealers.map(x=>`<option value="${x.id}">${x.name}</option>`).join('');
    sel.value=cur;
  }
}
function profitExportCsv(){
  if(!profitData){toast('Önce raporu getirin');return}
  const s=profitData.summary||{};
  const lines=[];
  const esc=v=>`"${String(v??'').replace(/"/g,'""')}"`;
  lines.push(['ATAK KAR RAPORU',profitData.from+' - '+profitData.to].map(esc).join(';'));
  lines.push([]);
  lines.push(['OZET'].map(esc).join(';'));
  lines.push([['Satış adedi',s.count],['Brüt satış',s.gross],['İskonto',s.discount],['Net satış (KDV dahil)',s.revenue],['Matrah (KDV hariç)',s.revenueExVat],['KDV',s.vatAmount],['Maliyet (KDV hariç)',s.cost],['Brüt kâr',s.grossProfit],['Marj %',s.marginPct],['Prim',s.commission],['Net kâr',s.netProfit],['Maliyeti eksik kalem',s.missingCostCount]].map(r=>r.map(esc).join(';')).join('\n'));
  lines.push([]);
  lines.push(['SATIS DOKUMU'].map(esc).join(';'));
  lines.push(['Tarih','Referans','Bayi','Personel','Matrah','Maliyet','Brüt Kâr','Marj %','Prim','Net Kâr','Eksik maliyet kalemi'].map(esc).join(';'));
  (profitData.rows||[]).forEach(r=>{
    lines.push([r.date,r.reference,r.dealerName||r.brand,r.salespersonName,r.revenueExVat,r.cost,r.grossProfit,r.marginPct,r.commission,r.netProfit,r.missingCostCount].map(esc).join(';'));
  });
  lines.push([]);
  lines.push(['URUN BAZINDA'].map(esc).join(';'));
  lines.push(['Ürün','Adet','Matrah','Maliyet','Brüt Kâr','Alış fiyatı eksik'].map(esc).join(';'));
  (profitData.byProduct||[]).forEach(p=>{
    lines.push([p.productName||p.productCode,p.quantity,p.revenueExVat,p.cost,p.grossProfit,p.costMissing?'EVET':'hayır'].map(esc).join(';'));
  });
  const blob=new Blob(['\ufeff'+lines.join('\n')],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download=`atak-kar-raporu-${profitData.from}_${profitData.to}.csv`;
  document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
q('#profitRefreshBtn')?.addEventListener('click',()=>loadProfitReport());
q('#profitDealer')?.addEventListener('change',()=>loadProfitReport());
q('#profitExportBtn')?.addEventListener('click',profitExportCsv);
qa('[data-profit-range]').forEach(b=>b.addEventListener('click',()=>{
  const r=profitRangePreset(b.dataset.profitRange);
  q('#profitFrom').value=r.from;q('#profitTo').value=r.to;
  loadProfitReport();
}));

/* ===== Raporlar Merkezi ===== */
let reportsHubData=null;
async function loadReportsHub(){
  const st=q('#reportsStatus');
  if(!q('#reportsKpis'))return;
  if(!q('#reportsFrom').value||!q('#reportsTo').value){
    const r=profitRangePreset('month');
    q('#reportsFrom').value=r.from;q('#reportsTo').value=r.to;
  }
  try{
    if(st){st.textContent='Rapor yükleniyor…';st.className='form-status'}
    const p=new URLSearchParams({from:q('#reportsFrom').value,to:q('#reportsTo').value});
    const d=await api('/web-api/admin/reports-hub?'+p.toString());
    reportsHubData=d;
    renderReportsHub(d);
    if(st){st.textContent=`${d.from} → ${d.to}`;st.className='form-status success'}
  }catch(e){
    if(st){st.textContent=e.message;st.className='form-status error'}
  }
}
function renderReportsHub(d){
  const s=d.sales||{}, cat=d.catalog||{}, inv=d.inventory||{};
  const esc=typeof ckEsc==='function'?ckEsc:(t)=>String(t??'').replace(/[&<>"']/g,m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
  q('#reportsKpis').innerHTML=`
    <article><small>Satış Adedi</small><b>${s.count||0}</b><span>${d.from} – ${d.to}</span></article>
    <article><small>Ciro (KDV dah.)</small><b>${money(s.revenue)}</b><span>matrah ${money(s.revenueExVat)}</span></article>
    <article class="profit-gross"><small>Brüt Kâr</small><b>${money(s.grossProfit)}</b><span>marj ${profitPct(s.marginPct)}</span></article>
    <article class="profit-net"><small>Net Kâr</small><b>${money(s.netProfit)}</b><span>prim ${money(s.commission)}</span></article>
    <article><small>Aktif Ürün</small><b>${cat.active||0}</b><span>alışı eksik ${cat.missingPurchase||0}</span></article>`;

  const brandRow=(label,cls,v)=>`<tr>
    <td><span class="ck-brand-pill ${cls}">${label}</span></td>
    <td>${v.count||0}</td><td>${money(v.revenue)}</td><td>${money(v.cost)}</td>
    <td><b>${money(v.grossProfit)}</b></td><td>${profitPct(v.marginPct)}</td></tr>`;
  const b=d.byBrand||{};
  q('#reportsBrandTable').innerHTML=`<table><thead><tr><th>Bayi</th><th>Satış</th><th>Ciro</th><th>Maliyet</th><th>Brüt Kâr</th><th>Marj</th></tr></thead><tbody>
    ${brandRow('Beko','beko',b.beko||{})}
    ${brandRow('İstikbal','istikbal',b.istikbal||{})}
    ${Number(b.other?.count||0)>0?brandRow('Diğer','other',b.other):''}
  </tbody></table>`;

  const bc=cat.brandCount||{};
  q('#reportsCatalog').innerHTML=`
    <div class="reports-catalog-grid">
      <div><small>Beko / Grundig</small><b>${bc.beko||0}</b></div>
      <div><small>İstikbal</small><b>${bc.istikbal||0}</b></div>
      <div><small>Diğer marka</small><b>${bc.other||0}</b></div>
      <div><small>Stok maliyeti</small><b>${money(inv.valueIncVat||inv.totalCost||inv.total||0)}</b></div>
    </div>`;

  const cats=cat.byCategory||[];
  q('#reportsCategoryTable').innerHTML=cats.length
    ?`<table><thead><tr><th>Kategori</th><th>Ürün</th><th>Alışı dolu</th></tr></thead><tbody>${
      cats.map(c=>`<tr><td><b>${esc(c.name)}</b></td><td>${c.count}</td><td>${c.withCost}</td></tr>`).join('')
    }</tbody></table>`
    :'<p class="note">Kategori verisi yok</p>';

  const purchases=d.purchases?.recent||[];
  q('#reportsPurchaseTable').innerHTML=purchases.length
    ?`<table><thead><tr><th>Tarih</th><th>Tedarikçi</th><th>Kalem</th><th>Toplam</th></tr></thead><tbody>${
      purchases.map(x=>`<tr><td>${esc(x.date||'-')}</td><td>${esc(x.supplierName||'-')}<small>${esc(x.invoiceNo||'')}</small></td><td>${x.itemCount||0}</td><td><b>${money(x.total)}</b></td></tr>`).join('')
    }</tbody></table>`
    :'<p class="note">Henüz alış aktarımı yok</p>';

  q('#reportsLinks').innerHTML=(d.links||[]).map(l=>`
    <button type="button" class="reports-link-card" data-go="${esc(l.tab)}">
      <b>${esc(l.title)}</b><small>${esc(l.desc||'')}</small>
    </button>`).join('');
}
function reportsExportCsv(){
  if(!reportsHubData){toast('Önce raporu getirin');return}
  const d=reportsHubData,s=d.sales||{},esc=v=>`"${String(v??'').replace(/"/g,'""')}"`;
  const lines=[];
  lines.push(['ATAK RAPORLAR',`${d.from} - ${d.to}`].map(esc).join(';'));
  lines.push(['Satış',s.count,'Ciro',s.revenue,'Brüt Kâr',s.grossProfit,'Net Kâr',s.netProfit].map(esc).join(';'));
  lines.push(['Bayi','Satış','Ciro','Kâr'].map(esc).join(';'));
  Object.entries(d.byBrand||{}).forEach(([k,v])=>{
    lines.push([k,v.count,v.revenue,v.grossProfit].map(esc).join(';'));
  });
  const blob=new Blob(['\ufeff'+lines.join('\n')],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=`atak-raporlar-${d.from}_${d.to}.csv`;
  document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
q('#reportsRefreshBtn')?.addEventListener('click',()=>loadReportsHub());
q('#reportsExportBtn')?.addEventListener('click',reportsExportCsv);
qa('[data-reports-range]').forEach(b=>b.addEventListener('click',()=>{
  const r=profitRangePreset(b.dataset.reportsRange);
  q('#reportsFrom').value=r.from;q('#reportsTo').value=r.to;
  loadReportsHub();
}));

/* ===== Kokpit: SVG grafikler (harici kütüphane yok) ===== */
const CK_PALETTES={classic:{beko:'#1565c0',istikbal:'#c4a15a',other:'#94a3b8'},calm:{beko:'#1f6f5c',istikbal:'#a98436',other:'#b8c2bc'}};
const CK_COLORS=new Proxy({},{get:(_,k)=>{const skin=document.documentElement.getAttribute('data-skin')==='classic'?'classic':'calm';return CK_PALETTES[skin][k]}});
function ckShortMoney(n){
  const v=Number(n||0);
  if(Math.abs(v)>=1000000)return (v/1000000).toFixed(1).replace('.',',')+'M';
  if(Math.abs(v)>=1000)return Math.round(v/1000)+'B';
  return String(Math.round(v));
}
function ckEsc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function ckRenderTrend(series){
  const box=q('#ckTrendChart');
  if(!box)return;
  const rows=Array.isArray(series)?series:[];
  if(!rows.length){box.innerHTML='<div class="ck-empty">Veri yok</div>';return}
  const W=720,H=230,padL=44,padR=10,padT=14,padB=26;
  const innerW=W-padL-padR,innerH=H-padT-padB;
  const max=Math.max(1,...rows.map(r=>Number(r.total||0)));
  const slot=innerW/rows.length;
  const barW=Math.max(6,Math.min(30,slot*0.56));
  const yFor=v=>padT+innerH-(Number(v||0)/max)*innerH;

  let grid='';
  for(let i=0;i<=4;i++){
    const y=padT+(innerH/4)*i;
    const val=max-(max/4)*i;
    grid+=`<line class="grid-line" x1="${padL}" y1="${y}" x2="${W-padR}" y2="${y}"/>`;
    grid+=`<text class="axis-label" x="${padL-8}" y="${y+3}" text-anchor="end">${ckShortMoney(val)}</text>`;
  }
  let bars='';
  rows.forEach((r,i)=>{
    const cx=padL+slot*i+slot/2;
    const x=cx-barW/2;
    const beko=Number(r.beko||0),ist=Number(r.istikbal||0),other=Number(r.other||0);
    const stackTotal=beko+ist+other;
    let cursorY=padT+innerH;
    const seg=(val,color)=>{
      if(val<=0)return '';
      const h=(val/max)*innerH;
      cursorY-=h;
      return `<rect class="ck-bar" x="${x}" y="${cursorY}" width="${barW}" height="${Math.max(1,h)}" rx="3" fill="${color}"><title>${ckEsc(r.date)} · ${ckShortMoney(val)}</title></rect>`;
    };
    bars+=seg(beko,CK_COLORS.beko)+seg(ist,CK_COLORS.istikbal)+seg(other,CK_COLORS.other);
    if(stackTotal<=0){
      bars+=`<rect x="${x}" y="${padT+innerH-2}" width="${barW}" height="2" rx="1" fill="#e2e8f0"/>`;
    }
    if(rows.length<=16||i%Math.ceil(rows.length/10)===0){
      bars+=`<text class="axis-label" x="${cx}" y="${H-8}" text-anchor="middle">${ckEsc(String(r.date||'').slice(8,10))}.${ckEsc(String(r.date||'').slice(5,7))}</text>`;
    }
  });
  box.innerHTML=`<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Günlük satış grafiği">${grid}${bars}</svg>`;
}
function ckRenderDonut(month){
  const box=q('#ckBrandDonut');
  if(!box)return;
  const parts=[
    {key:'beko',label:'Beko',value:Number(month?.beko||0),color:CK_COLORS.beko},
    {key:'istikbal',label:'İstikbal',value:Number(month?.istikbal||0),color:CK_COLORS.istikbal},
    {key:'other',label:'Diğer',value:Number(month?.other||0),color:CK_COLORS.other}
  ].filter(p=>p.value>0);
  const total=parts.reduce((a,p)=>a+p.value,0);
  const R=70,SW=22,C=90,circ=2*Math.PI*R;
  let ring='',offset=0;
  if(total>0){
    parts.forEach(p=>{
      const len=(p.value/total)*circ;
      ring+=`<circle cx="${C}" cy="${C}" r="${R}" fill="none" stroke="${p.color}" stroke-width="${SW}"
        stroke-dasharray="${len} ${circ-len}" stroke-dashoffset="${-offset}"
        transform="rotate(-90 ${C} ${C})" stroke-linecap="butt"><title>${p.label}: ${money(p.value)}</title></circle>`;
      offset+=len;
    });
  }else{
    ring=`<circle cx="${C}" cy="${C}" r="${R}" fill="none" stroke="#e8eef6" stroke-width="${SW}"/>`;
  }
  const legend=parts.length
    ? parts.map(p=>`<div><i style="background:${p.color}"></i><span>${p.label}</span><b>${money(p.value)}</b></div>`).join('')
    : '<div><i style="background:#e2e8f0"></i><span>Bu ay satış yok</span><b>₺0</b></div>';
  box.innerHTML=`
    <svg viewBox="0 0 180 180" role="img" aria-label="Marka dağılımı">
      ${ring}
      <text x="${C}" y="${C-4}" text-anchor="middle" font-size="13" font-weight="800" fill="#667890">AY TOPLAM</text>
      <text x="${C}" y="${C+18}" text-anchor="middle" font-size="17" font-weight="900" fill="#0c1a33">${ckShortMoney(total)}</text>
    </svg>
    <div class="ck-donut-legend">${legend}</div>`;
}
function ckRenderMoney(fin){
  const box=q('#ckMoneyGrid');
  if(!box)return;
  box.innerHTML=`
    <article class="cash"><small>Toplam Kasa</small><b>${money(fin?.cash)}</b></article>
    <article class="bank"><small>Toplam Banka</small><b>${money(fin?.bank)}</b></article>
    <article class="debt"><small>Müşteri Alacağı</small><b>${money(fin?.receivable)}</b></article>
    <article><small>Bugünkü Masraf</small><b>${money(fin?.todayExpense)}</b></article>`;
}
function ckRenderAlerts(alerts){
  const box=q('#ckAlerts');
  if(!box)return;
  const items=[
    {n:Number(alerts?.pendingInvoices||0),tone:'warn',icon:'F',title:'Kesilmeyen fatura',sub:'e-Fatura Merkezi’nde bekliyor',tab:'invoiceCenter'},
    {n:Number(alerts?.overdueNotes||0),tone:'bad',icon:'S',title:'Vadesi geçen senet',sub:'Müşteri Ödemeleri ekranı',tab:'customerPayments'},
    {n:Number(alerts?.lowStock||0),tone:'warn',icon:'D',title:'Stoğu biten ürün',sub:'Stok & Depo kontrolü',tab:'stockCenter'}
  ];
  box.innerHTML=items.map(it=>`
    <button type="button" class="ck-alert ${it.n>0?it.tone:'ok'}" data-go="${it.tab}">
      <i>${it.icon}</i>
      <div><b>${it.title}</b><small>${it.n>0?it.sub:'Bekleyen yok'}</small></div>
      <em>${it.n}</em>
    </button>`).join('');
}
function ckRenderRecent(rows){
  const body=q('#ckRecentRows');
  if(!body)return;
  const list=Array.isArray(rows)?rows:[];
  if(!list.length){
    body.innerHTML='<tr><td colspan="5"><div class="ck-empty">Henüz satış yok</div></td></tr>';
    return;
  }
  const label={beko:'Beko',istikbal:'İstikbal',other:'Diğer'};
  body.innerHTML=list.map(r=>`<tr>
    <td>${ckEsc(r.date||'-')}</td>
    <td><b>${ckEsc(r.customerName||'-')}</b></td>
    <td><span class="ck-brand-pill ${ckEsc(r.brand||'other')}">${label[r.brand]||'Diğer'}</span></td>
    <td>${ckEsc(r.salespersonName||'-')}</td>
    <td class="num">${money(r.total)}</td>
  </tr>`).join('');
}
/* ——— Bekleyen İşler sekmesi: mevcut uçlardan görev listesi ——— */
async function loadTasksCenter(){
  const boxes=[q('#taskList'),q('#dashTaskList')].filter(Boolean);
  if(!boxes.length)return;
  boxes.forEach(b=>{b.innerHTML='<div class="task-empty">Yükleniyor…</div>'});
  const tasks=[];
  const safe=async(url)=>{try{return await api(url)}catch(_){return null}};
  const [ck,pay,appr]=await Promise.all([
    safe('/web-api/admin/dashboard-cockpit?days=14'),
    can('screen_customer_payments')?safe('/web-api/admin/customer-payments-board?filter=overdue'):null,
    can('screen_manager_approvals')?safe('/web-api/admin/cancellation-requests'):null
  ]);

  const overdueCount=Number(pay?.summary?.overdueCustomers||0);
  const overdueAmount=Number(pay?.summary?.overdueAmount||0);
  if(overdueCount>0){
    tasks.push({tone:'bad',title:`${overdueCount} müşterinin taksidi gecikti`,
      sub:`Toplam ${money(overdueAmount)} · gecikme SMS gönderebilirsiniz`,
      go:'customerPayments',label:'Ödemeleri aç',btn:'bad'});
  }
  const pendingInv=Number(ck?.alerts?.pendingInvoices||0);
  if(pendingInv>0){
    tasks.push({tone:'warn',title:`${pendingInv} satışın faturası kesilmedi`,
      sub:'e-Fatura Merkezi kuyruğunda bekliyor',go:'invoiceCenter',label:'Fatura kes',btn:'warn'});
  }
  const overdueNotes=Number(ck?.alerts?.overdueNotes||0);
  if(overdueNotes>0){
    tasks.push({tone:'bad',title:`${overdueNotes} senedin vadesi geçti`,
      sub:'Müşteri Ödemeleri · senet takibi',go:'customerPayments',label:'Senetleri gör',btn:''});
  }
  const apprRows=Array.isArray(appr?.rows)?appr.rows.filter(r=>r.status==='pending'):[];
  if(apprRows.length){
    tasks.push({tone:'',title:`${apprRows.length} talep onayınızı bekliyor`,
      sub:'Personelin iptal / düzenleme istekleri',go:'managerApprovals',label:'İncele',btn:'primary'});
  }
  const lowStock=Number(ck?.alerts?.lowStock||0);
  if(lowStock>0){
    tasks.push({tone:'warn',title:`${lowStock} ürünün stoğu bitti`,
      sub:'Stok Merkezi · depo miktarları',go:'stockCenter',label:'Stoğu aç',btn:'warn'});
  }

  const badge=q('#taskNavBadge');
  if(badge){badge.textContent=String(tasks.length);badge.classList.toggle('hidden',tasks.length===0)}
  [q('#taskCount'),q('#dashTaskCount')].forEach(el=>{if(el)el.textContent=String(tasks.length)});

  if(!tasks.length){
    boxes.forEach(b=>{b.innerHTML='<div class="task-empty">Bekleyen iş yok. Her şey güncel.</div>'});
    return;
  }
  const html=tasks.map(t=>`
    <div class="task-row">
      <span class="dot ${t.tone}"></span>
      <span class="txt"><b>${ckEsc(t.title)}</b><small>${ckEsc(t.sub)}</small></span>
      <button type="button" class="go ${t.btn}" data-go="${t.go}">${ckEsc(t.label)}</button>
    </div>`).join('');
  boxes.forEach(b=>{b.innerHTML=html});
}
async function refreshTaskBadge(){
  try{await loadTasksCenter()}catch(_){}
}
async function renderCockpit(){
  if(!q('#ckTrendChart'))return;
  try{
    const d=await api('/web-api/admin/dashboard-cockpit?days=14');
    ckRenderTrend(d.series);
    ckRenderDonut(d.month);
    ckRenderMoney(d.finance);
    ckRenderAlerts(d.alerts);
    ckRenderRecent(d.recent);
    loadTasksCenter().catch(()=>{});
  }catch(e){
    const box=q('#ckTrendChart');
    if(box)box.innerHTML=`<div class="ck-empty">Grafik yüklenemedi: ${ckEsc(e.message)}</div>`;
  }
}
function renderDashboard(){const ps=store.products,active=ps.filter(p=>p.active),campaigns=store.campaigns.filter(c=>c.active),missingImage=ps.filter(p=>!p.image),zeroStock=ps.filter(p=>!p.stock);renderDashboardRevenue();renderCockpit();q('#healthCards').innerHTML=`<div class="health"><b>${missingImage.length}</b><span>Görseli eksik ürün</span></div><div class="health"><b>${zeroStock.length}</b><span>Stok 0 / sorunuz</span></div><div class="health"><b>${campaigns.length}</b><span>Aktif kampanya</span></div><div class="health"><b>${ps.filter(p=>Number(p.cashPrice||0)<Number(p.minimumSalePrice||0)&&Number(p.minimumSalePrice||0)>0).length}</b><span>Minimum fiyat altı</span></div>`;q('#auditList').innerHTML=(store.auditLogs||[]).slice(0,12).map(a=>`<div class="activity"><i></i><div><b>${a.action}</b><br><small>${a.entity} · ${new Date(a.date).toLocaleString('tr-TR')}</small></div></div>`).join('')||'<p>Henüz işlem kaydı yok.</p>'}
function renderCategoryOptions(){const opts=store.categories.sort((a,b)=>a.sort-b.sort).map(c=>`<option value="${c.id}">${c.name}</option>`).join('');q('#filterCategory').innerHTML='<option value="all">Tüm kategoriler</option>'+opts;q('#bulkCategory').innerHTML='<option value="all">Tüm ürünler</option>'+opts;q('#pCategory').innerHTML=opts}
function renderBrandOptions(){const opts=(store.brands||[]).filter(b=>b.active).sort((a,b)=>a.sort-b.sort).map(b=>`<option value="${b.name}">${b.name}</option>`).join('');q('#pBrand').innerHTML=opts}
function filteredProducts(){const term=(q('#adminSearch').value||q('#globalSearch').value||'').toLocaleLowerCase('tr-TR'),cat=q('#filterCategory').value,status=q('#filterStatus').value;return store.products.filter(p=>`${p.code} ${p.name} ${p.brand}`.toLocaleLowerCase('tr-TR').includes(term)&&(cat==='all'||p.category===cat)&&(status==='all'||(status==='active'&&p.active)||(status==='passive'&&!p.active)||(status==='featured'&&p.featured)))}
function renderProducts(){const list=filteredProducts(),pages=Math.max(1,Math.ceil(list.length/pageSize));page=Math.min(page,pages);const slice=list.slice((page-1)*pageSize,page*pageSize),cats=Object.fromEntries(store.categories.map(c=>[c.id,c.name]));q('#productTable').innerHTML=slice.map(p=>{const minWarn=Number(p.minimumSalePrice||0)>0&&Number(p.cashPrice||0)<Number(p.minimumSalePrice||0);return `<tr class="${minWarn?'price-warning':''}"><td><input class="row-check" type="checkbox" data-id="${p.id}" ${selected.has(p.id)?'checked':''}></td><td><b>${p.code}</b></td><td>${p.barcode||'—'}</td><td class="product-name">${p.name}</td><td>${p.brand||'—'}</td><td>${cats[p.category]||p.category}</td><td>${money(p.purchasePrice)}</td><td>${money(p.listPrice)}</td><td><b>${money(p.cashPrice)}</b>${minWarn?'<small class="warn-text">Minimum altı</small>':''}</td><td>${money(p.cardPrice)}</td><td>%${p.vatRate||20}</td><td>${p.stock}</td><td><span class="status ${p.active?'':'off'}">${p.active?'Yayında':'Pasif'}</span></td><td class="row-actions"><button onclick="editProduct('${p.id}')">Düzenle</button><button onclick="disableProduct('${p.id}')">Pasif</button></td></tr>`}).join('');q('#pageInfo').textContent=`${page} / ${pages} · ${list.length} ürün`;q('#prevPage').disabled=page<=1;q('#nextPage').disabled=page>=pages;qa('.row-check').forEach(x=>x.onchange=()=>{x.checked?selected.add(x.dataset.id):selected.delete(x.dataset.id);renderSelection()});renderSelection()}
function renderSelection(){q('#selectionBar').classList.toggle('hidden',selected.size===0);q('#selectedCount').textContent=selected.size}
q('#adminSearch').oninput=()=>{page=1;renderProducts()};q('#globalSearch').oninput=()=>{q('#adminSearch').value=q('#globalSearch').value;goTab('products');page=1;renderProducts()};q('#filterCategory').onchange=q('#filterStatus').onchange=()=>{page=1;renderProducts()};q('#prevPage').onclick=()=>{page--;renderProducts()};q('#nextPage').onclick=()=>{page++;renderProducts()};q('#selectAll').onchange=e=>{filteredProducts().slice((page-1)*pageSize,page*pageSize).forEach(p=>e.target.checked?selected.add(p.id):selected.delete(p.id));renderProducts()};q('#clearSelection').onclick=()=>{selected.clear();q('#selectAll').checked=false;renderProducts()};
qa('[data-bulk]').forEach(b=>b.onclick=async()=>{const map={active:['active',true],passive:['active',false],featured:['featured',true],unfeatured:['featured',false]},[action,value]=map[b.dataset.bulk];if(!selected.size)return;await bulk({action,value});});
async function bulk(body){const r=await api('/web-api/admin/bulk-products',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:[...selected],...body})});toast(`${r.count} ürün güncellendi`);selected.clear();await load()}
q('#newProductBtn').onclick=()=>openProduct({active:true,featured:false,brand:'Beko',priceMode:'same',stock:0,tags:[],vatRate:20,purchasePrice:0,listPrice:0,cashPrice:0,cardPrice:0,minimumSalePrice:0,barcode:''});q('#quickNewProduct')?.addEventListener('click',()=>{goTab('products');q('#newProductBtn')?.click()});q('#closeModal').onclick=()=>q('#productModal').classList.add('hidden');window.editProduct=id=>openProduct(store.products.find(p=>p.id===id));window.disableProduct=async id=>{if(!confirm('Ürün pasife alınsın mı?'))return;await api('/web-api/admin/product/'+id,{method:'DELETE'});toast('Ürün pasife alındı');await load()};
async function refreshProductsStockWarehouseOptions(){
  const sel=q('#productsStockWarehouse');if(!sel)return;
  try{
    const data=await api('/web-api/admin/stock-center');
    const wh=(data.warehouses||[]).filter(x=>x.active!==false&&!x.deletedAt);
    const cur=sel.value;
    sel.innerHTML='<option value="">Depo seç</option>'+wh.map(x=>`<option value="${x.id}">${x.name}</option>`).join('');
    if(cur&&wh.some(x=>x.id===cur))sel.value=cur;
    else if(wh[0])sel.value=wh[0].id;
  }catch(_){/* ignore */}
}
q('#productsExcelExportBtn')?.addEventListener('click',async()=>{
  try{
    const params=new URLSearchParams({
      category:q('#filterCategory')?.value||'all',
      status:q('#filterStatus')?.value||'all',
      q:q('#adminSearch')?.value||''
    });
    const r=await fetch('/web-api/admin/products-stock-excel?'+params.toString(),{credentials:'same-origin'});
    if(!r.ok){
      let msg='Excel indirilemedi';
      try{const j=await r.json();if(j.error)msg=j.error}catch(_){}
      throw new Error(msg);
    }
    const blob=await r.blob();
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    const cat=q('#filterCategory')?.value||'all';
    const catName=cat==='all'?'tum':(q('#filterCategory')?.selectedOptions?.[0]?.textContent||cat).trim().replace(/\s+/g,'-');
    a.href=url;a.download=`atak-stok-giris-${catName}.xlsx`;
    document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1500);
    toast('Excel indirildi — Adet sütununu doldurup yükleyin');
  }catch(e){toast(e.message||'Excel indirilemedi')}
});
q('#productsExcelImportBtn')?.addEventListener('click',async()=>{
  const wh=q('#productsStockWarehouse')?.value;
  if(!wh){toast('Önce depo seçin');return}
  if(!q('#productsStockWarehouse')?.options?.length)await refreshProductsStockWarehouseOptions();
  q('#productsExcelImportFile')?.click();
});
q('#productsExcelImportFile')?.addEventListener('change',async e=>{
  const file=e.target.files?.[0];
  e.target.value='';
  if(!file)return;
  const warehouseId=q('#productsStockWarehouse')?.value;
  if(!warehouseId){toast('Depo seçin');return}
  try{
    const fd=new FormData();
    fd.append('file',file);
    fd.append('warehouseId',warehouseId);
    const r=await api('/web-api/admin/stock-import',{method:'POST',body:fd});
    toast(`${r.imported||0} ürün stoğu güncellendi${r.skipped?` · ${r.skipped} atlandı`:''}`);
    await load();
  }catch(err){toast(err.message||'Stok yüklenemedi')}
});
q('#productsClearMobilyaPurchaseBtn')?.addEventListener('click',async()=>{
  if(!confirm('Mobilya kategorisindeki TÜM ürünlerde ALIŞ fiyatı sıfırlansın mı?\nÜrünler silinmez — sadece Alış = ₺0 olur.'))return;
  try{
    const r=await api('/web-api/admin/products/zero-purchase-costs',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({scope:'mobilya',categoryId:'mobilya'})
    });
    toast(`${r.cleared||0} mobilya ürününde alış sıfırlandı`);
    await load();
  }catch(e){toast(e.message||'Alışlar silinemedi')}
});
function resolveVatRateClient(p={}){
  const cat=String(p.category||'').toLocaleLowerCase('tr-TR');
  const brand=String(p.brand||'').toLocaleLowerCase('tr-TR');
  const text=`${p.code||''} ${p.name||''} ${p.searchName||''} ${p.itemCode||''} ${p.barcode||''}`.toLocaleLowerCase('tr-TR').replace(/\s+/g,' ').trim();
  const compact=text.replace(/\s/g,'');
  if(cat==='yazar-kasa'||cat==='yazarkasa')return 10;
  if(/\bx30\s*tr\b/.test(text)||compact.includes('x30tr')||/yazar\s*kasa/.test(text)||compact.includes('yazarkasa'))return 10;
  if(cat==='mobilya')return 10;
  if(brand.includes('istikbal'))return 10;
  return 20;
}
function vatForCategory(){
  return resolveVatRateClient({
    category:q('#pCategory')?.value,
    brand:q('#pBrand')?.value,
    code:q('#pCode')?.value,
    name:q('#pName')?.value,
    barcode:q('#pBarcode')?.value
  });
}
function refreshVatField(){if(q('#pVatRate'))q('#pVatRate').value=vatForCategory()}
function refreshProfit(){const purchase=Number(q('#pPurchasePrice').value||0),cash=Number(q('#pCashPrice').value||0),card=Number(q('#pCardPrice').value||0),minimum=Number(q('#pMinimumSalePrice').value||0);const row=(name,price)=>{const profit=price-purchase,pct=purchase?profit/purchase*100:0,warn=minimum>0&&price<minimum;return `<span class="${warn?'bad':''}"><b>${name}</b> Kâr: ${money(profit)} · %${pct.toFixed(1)}${warn?' · Minimum altı':''}</span>`};q('#profitPreview').innerHTML=row('Nakit',cash)+row('Kart',card)}
function openProduct(p){q('#pId').value=p.id||'';q('#pCode').value=p.code||'';q('#pBarcode').value=p.barcode||'';q('#pBrand').value=p.brand||'Beko';q('#pName').value=p.name||'';q('#pCategory').value=p.category||store.categories[0]?.id||'';refreshVatField();q('#pPurchasePrice').value=p.purchasePrice||0;q('#pListPrice').value=p.listPrice||p.oldPrice||0;q('#pCashPrice').value=p.cashPrice||p.salePrice||0;q('#pCardPrice').value=p.cardPrice||p.salePrice||0;q('#pMinimumSalePrice').value=p.minimumSalePrice||0;q('#pBekoPrice').value=p.bekoPrice||0;q('#pOldPrice').value=p.oldPrice||0;q('#pPriceMode').value=p.priceMode||'same';q('#pPriceValue').value=p.priceValue||0;q('#pStock').value=p.stock||0;q('#pTags').value=(p.tags||[]).join(', ');q('#pImage').value=p.image||'';q('#pDescription').value=p.description||'';q('#pActive').checked=p.active!==false;q('#pFeatured').checked=!!p.featured;q('#productModal').classList.remove('hidden');refreshProfit()}
['#pCategory','#pBrand','#pCode','#pName','#pBarcode'].forEach(id=>q(id)?.addEventListener('change',refreshVatField));
['#pCode','#pName','#pBarcode'].forEach(id=>q(id)?.addEventListener('input',refreshVatField));
['#pPurchasePrice','#pCashPrice','#pCardPrice','#pMinimumSalePrice'].forEach(id=>q(id).oninput=refreshProfit);
q('#productForm').onsubmit=async e=>{e.preventDefault();const data={id:q('#pId').value,code:q('#pCode').value,barcode:q('#pBarcode').value,brand:q('#pBrand').value,name:q('#pName').value,category:q('#pCategory').value,vatRate:vatForCategory(),purchasePrice:q('#pPurchasePrice').value,listPrice:q('#pListPrice').value,cashPrice:q('#pCashPrice').value,cardPrice:q('#pCardPrice').value,minimumSalePrice:q('#pMinimumSalePrice').value,bekoPrice:q('#pBekoPrice').value,oldPrice:q('#pOldPrice').value,priceMode:q('#pPriceMode').value,priceValue:q('#pPriceValue').value,stock:q('#pStock').value,tags:q('#pTags').value.split(',').map(x=>x.trim()).filter(Boolean),image:q('#pImage').value,description:q('#pDescription').value,active:q('#pActive').checked,featured:q('#pFeatured').checked};if(Number(data.minimumSalePrice)>0&&Number(data.cashPrice)<Number(data.minimumSalePrice)&&!confirm('Nakit fiyat minimum satış fiyatının altında. Yine de kaydedilsin mi?'))return;try{await api('/web-api/admin/product',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});q('#productModal').classList.add('hidden');toast('Ürün kaydedildi');await load()}catch(e){toast(e.message)}};
function renderBrands(){q('#brandList').innerHTML=(store.brands||[]).sort((a,b)=>a.sort-b.sort).map(b=>`<div class="admin-card"><div><h3>${b.name}</h3><p>${store.products.filter(p=>String(p.brand).toLocaleLowerCase('tr-TR')===String(b.name).toLocaleLowerCase('tr-TR')).length} ürün · ${b.active?'Aktif':'Pasif'}</p></div><div class="admin-card-actions"><button onclick="editBrand('${b.id}')">Düzenle</button><button onclick="deleteBrand('${b.id}')">Sil</button></div></div>`).join('')}
window.editBrand=id=>{const b=store.brands.find(x=>x.id===id);q('#brandId').value=b.id;q('#brandName').value=b.name;q('#brandLogo').value=b.logo||'';q('#brandSort').value=b.sort||0;q('#brandActive').checked=b.active};window.deleteBrand=async id=>{if(!confirm('Marka silinsin mi?'))return;try{await api('/web-api/admin/brand/'+id,{method:'DELETE'});toast('Marka silindi');await load()}catch(e){toast(e.message)}};q('#brandReset').onclick=()=>{q('#brandForm').reset();q('#brandId').value=''};q('#brandForm').onsubmit=async e=>{e.preventDefault();await api('/web-api/admin/brand',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:q('#brandId').value,name:q('#brandName').value,logo:q('#brandLogo').value,sort:q('#brandSort').value,active:q('#brandActive').checked})});toast('Marka kaydedildi');q('#brandForm').reset();q('#brandId').value='';await load()};
function renderCategories(){q('#categoryList').innerHTML=store.categories.sort((a,b)=>a.sort-b.sort).map(c=>`<div class="admin-card"><div><h3>${c.name}</h3><p>${c.description||'Açıklama yok'} · ${store.products.filter(p=>p.category===c.id).length} ürün · ${c.active?'Yayında':'Pasif'}</p></div><div class="admin-card-actions"><button onclick="editCategory('${c.id}')">Düzenle</button><button onclick="deleteCategory('${c.id}')">Sil</button></div></div>`).join('')}
window.editCategory=id=>{const c=store.categories.find(x=>x.id===id);q('#catId').value=c.id;q('#catName').value=c.name;q('#catDescription').value=c.description||'';q('#catSort').value=c.sort||0;q('#catActive').checked=c.active};window.deleteCategory=async id=>{if(!confirm('Kategori silinsin mi?'))return;try{await api('/web-api/admin/category/'+id,{method:'DELETE'});toast('Kategori silindi');await load()}catch(e){toast(e.message)}};q('#catReset').onclick=()=>q('#categoryForm').reset();q('#categoryForm').onsubmit=async e=>{e.preventDefault();await api('/web-api/admin/category',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:q('#catId').value,name:q('#catName').value,description:q('#catDescription').value,sort:q('#catSort').value,active:q('#catActive').checked})});toast('Kategori kaydedildi');q('#categoryForm').reset();q('#catId').value='';await load()};
function renderCampaigns(){q('#campaignList').innerHTML=store.campaigns.sort((a,b)=>a.sort-b.sort).map(c=>`<div class="admin-card"><div><h3>${c.label} · ${c.title}</h3><p>${c.subtitle||''} · ${c.startDate||'Başlangıç yok'} → ${c.endDate||'Bitiş yok'} · ${c.active?'Aktif':'Pasif'}</p></div><div class="admin-card-actions"><button onclick="editCampaign('${c.id}')">Düzenle</button><button onclick="deleteCampaign('${c.id}')">Sil</button></div></div>`).join('')}
window.editCampaign=id=>{const c=store.campaigns.find(x=>x.id===id);q('#campaignId').value=c.id;q('#campaignTitle').value=c.title;q('#campaignSubtitle').value=c.subtitle||'';q('#campaignLabel').value=c.label||'FIRSAT';q('#campaignSort').value=c.sort||0;q('#campaignStart').value=c.startDate||'';q('#campaignEnd').value=c.endDate||'';q('#campaignActive').checked=c.active;q('#campaignHomepage').checked=c.homepage};window.deleteCampaign=async id=>{if(!confirm('Kampanya silinsin mi?'))return;await api('/web-api/admin/campaign/'+id,{method:'DELETE'});toast('Kampanya silindi');await load()};q('#campaignReset').onclick=()=>{q('#campaignForm').reset();q('#campaignId').value=''};q('#campaignForm').onsubmit=async e=>{e.preventDefault();await api('/web-api/admin/campaign',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:q('#campaignId').value,title:q('#campaignTitle').value,subtitle:q('#campaignSubtitle').value,label:q('#campaignLabel').value,sort:q('#campaignSort').value,startDate:q('#campaignStart').value,endDate:q('#campaignEnd').value,active:q('#campaignActive').checked,homepage:q('#campaignHomepage').checked})});toast('Kampanya kaydedildi');q('#campaignForm').reset();q('#campaignId').value='';await load()};

function bannerPreview(type,url=''){
  const box=q(type==='desktop'?'#bannerDesktopPreview':'#bannerMobilePreview');
  const img=box.querySelector('img'),text=box.querySelector('span');
  img.src=url||'';
  img.style.display=url?'block':'none';
  text.style.display=url?'none':'block';
}
async function uploadBannerFile(type,file){
  if(!file)return'';
  const fd=new FormData();fd.append('file',file);fd.append('type',type);
  const result=await api('/web-api/admin/banner/upload',{method:'POST',body:fd});
  return result.url;
}
function resetBannerForm(){
  q('#bannerForm').reset();
  q('#bannerId').value='';
  q('#bannerCtaText').value='Ürünleri keşfet';
  q('#bannerCtaUrl').value='#products';
  q('#bannerSort').value='0';
  q('#bannerActive').checked=true;
  q('#bannerDesktopImage').value='';
  q('#bannerMobileImage').value='';
  q('#bannerDesktopFile').value='';
  q('#bannerMobileFile').value='';
  q('#bannerSaveTitle').textContent='Yeni banner hazırlanıyor';
  bannerPreview('desktop','');bannerPreview('mobile','');
}
function renderBanners(){
  const banners=[...(store.banners||[])].sort((a,b)=>a.sort-b.sort);
  q('#bannerCount').textContent=banners.length;
  q('#bannerList').innerHTML=banners.length?banners.map(b=>`
    <article class="banner-list-card ${b.active?'':'passive'}" data-banner-edit="${b.id}">
      <div class="banner-list-image">
        ${b.desktopImage?`<img src="${b.desktopImage}" alt="">`:'<span>Görsel yok</span>'}
      </div>
      <div class="banner-list-body">
        <div><b>${b.headline}</b><small>${b.subheadline||'Alt metin yok'}</small></div>
        <div class="banner-meta"><span>Sıra ${b.sort}</span><span class="${b.active?'on':'off'}">${b.active?'Aktif':'Pasif'}</span></div>
      </div>
      <div class="banner-list-actions">
        <button type="button" data-banner-edit-btn="${b.id}">Düzenle</button>
        <button type="button" data-banner-delete="${b.id}">Sil</button>
      </div>
    </article>`).join(''):'<div class="empty-state"><b>Henüz banner yok</b><p>Soldaki formdan ilk bannerınızı ekleyin.</p></div>';

  qa('[data-banner-edit-btn]').forEach(btn=>btn.onclick=e=>{e.stopPropagation();editBanner(btn.dataset.bannerEditBtn)});
  qa('[data-banner-edit]').forEach(card=>card.onclick=()=>editBanner(card.dataset.bannerEdit));
  qa('[data-banner-delete]').forEach(btn=>btn.onclick=async e=>{
    e.stopPropagation();
    if(!confirm('Banner silinsin mi?'))return;
    await api('/web-api/admin/banner/'+btn.dataset.bannerDelete,{method:'DELETE'});
    toast('Banner silindi');await load();resetBannerForm();
  });
}
window.editBanner=id=>{
  const b=store.banners.find(x=>x.id===id);if(!b)return;
  q('#bannerId').value=b.id;q('#bannerHeadline').value=b.headline;q('#bannerSubheadline').value=b.subheadline||'';
  q('#bannerCtaText').value=b.ctaText||'';q('#bannerCtaUrl').value=b.ctaUrl||'';
  q('#bannerDesktopImage').value=b.desktopImage||'';q('#bannerMobileImage').value=b.mobileImage||'';
  q('#bannerSort').value=b.sort||0;q('#bannerActive').checked=b.active;
  q('#bannerSaveTitle').textContent='Banner düzenleniyor';
  bannerPreview('desktop',b.desktopImage||'');bannerPreview('mobile',b.mobileImage||'');
  window.scrollTo({top:0,behavior:'smooth'});
};
q('#bannerReset').onclick=resetBannerForm;
qa('[data-banner-pick]').forEach(btn=>btn.onclick=()=>q(btn.dataset.bannerPick==='desktop'?'#bannerDesktopFile':'#bannerMobileFile').click());
q('#bannerDesktopFile').onchange=e=>{const f=e.target.files[0];if(f)bannerPreview('desktop',URL.createObjectURL(f))};
q('#bannerMobileFile').onchange=e=>{const f=e.target.files[0];if(f)bannerPreview('mobile',URL.createObjectURL(f))};
qa('[data-banner-remove]').forEach(btn=>btn.onclick=()=>{
  const type=btn.dataset.bannerRemove;
  q(type==='desktop'?'#bannerDesktopImage':'#bannerMobileImage').value='';
  q(type==='desktop'?'#bannerDesktopFile':'#bannerMobileFile').value='';
  bannerPreview(type,'');
});
q('#bannerForm').onsubmit=async e=>{
  e.preventDefault();
  const saveBtn=q('#bannerSaveBtn');saveBtn.disabled=true;saveBtn.textContent='Yükleniyor...';
  try{
    let desktop=q('#bannerDesktopImage').value,mobile=q('#bannerMobileImage').value;
    const desktopFile=q('#bannerDesktopFile').files[0],mobileFile=q('#bannerMobileFile').files[0];
    if(desktopFile)desktop=await uploadBannerFile('desktop',desktopFile);
    if(mobileFile)mobile=await uploadBannerFile('mobile',mobileFile);
    if(!desktop)return toast('Lütfen masaüstü banner görselini seçin');
    await api('/web-api/admin/banner',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      id:q('#bannerId').value,headline:q('#bannerHeadline').value,subheadline:q('#bannerSubheadline').value,
      ctaText:q('#bannerCtaText').value,ctaUrl:q('#bannerCtaUrl').value,
      desktopImage:desktop,mobileImage:mobile,sort:q('#bannerSort').value,active:q('#bannerActive').checked
    })});
    toast('Banner kaydedildi');resetBannerForm();await load();
  }catch(error){toast(error.message)}
  finally{saveBtn.disabled=false;saveBtn.textContent='Bannerı Kaydet'}
};
q('#bulkForm').onsubmit=async e=>{e.preventDefault();const ids=q('#bulkTarget').value==='selected'?[...selected]:[];if(q('#bulkTarget').value==='selected'&&!ids.length)return toast('Önce Ürünler ekranından ürün seçin');const r=await api('/web-api/admin/bulk-products',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids,category:q('#bulkCategory').value,action:'price',mode:q('#bulkMode').value,amount:q('#bulkValue').value})});toast(`${r.count} ürüne fiyat uygulandı`);selected.clear();await load()};
const channelLabels={beko:'Beko Mağaza',istikbal:'İstikbal Mağaza',atakhome:'AtakHome',hepsiburada:'Hepsiburada'};
function saleNetPreview(){const gross=Number(q('#saleGrossAmount').value||0),ret=Number(q('#saleReturnAmount').value||0);q('#saleNetPreview').textContent=`Net ciro: ${money(Math.max(0,gross-ret))}`}
['#saleGrossAmount','#saleReturnAmount'].forEach(id=>q(id).oninput=saleNetPreview);
function resetSaleForm(){q('#saleId').value='';q('#saleStartDate').value=localDate();q('#saleEndDate').value=localDate();q('#saleChannel').value='beko';q('#saleGrossAmount').value='';q('#saleReturnAmount').value='0';q('#saleOrderCount').value='1';q('#saleNote').value='';saleNetPreview()}
q('#saleResetBtn').onclick=resetSaleForm;
q('#revenueFilterStart').value=localDate();q('#revenueFilterEnd').value=localDate();resetSaleForm();
async function renderRevenue(){
  const start=q('#revenueFilterStart').value||localDate(),end=q('#revenueFilterEnd').value||start;
  let summary;try{summary=await fetchRevenueSummary(start,end)}catch(e){q('#revenueCards').innerHTML=`<div class="panel">${e.message}</div>`;return}
  const c=summary.channels,cards=[['Beko Mağaza',c.beko],['İstikbal Mağaza',c.istikbal],['AtakHome',c.atakhome],['Hepsiburada',c.hepsiburada],['Toplam',{amount:Object.values(c).reduce((a,b)=>a+Number(b.amount||0),0),orderCount:Object.values(c).reduce((a,b)=>a+Number(b.orderCount||0),0)}]];
  q('#revenueCards').innerHTML=cards.map(([name,x])=>`<div class="revenue-card"><small>${name}</small><b>${money(x.amount)}</b><span>${x.orderCount||0} adet${x.source==='automatic'?' · Otomatik':''}</span></div>`).join('');
  q('#salesList').innerHTML=(store.sales||[]).filter(s=>s.source!=='automatic'&&s.channel!=='atakhome').slice(0,60).map(s=>`<div class="admin-card"><div><h3>${channelLabels[s.channel]||s.channel} · ${money(s.amount)}</h3><p>${s.startDate||s.date} → ${s.endDate||s.date} · Brüt ${money(s.grossAmount??s.amount)} · İade ${money(s.returnAmount||0)} · ${s.orderCount||0} adet</p><small>${s.note||''}</small></div><div class="admin-card-actions"><button onclick="editSale('${s.id}')">Düzenle</button><button onclick="deleteSale('${s.id}')">Sil</button></div></div>`).join('')||'<p>Henüz manuel ciro kaydı yok.</p>';
}
q('#revenueFilterBtn').onclick=renderRevenue;
q('#saleForm').onsubmit=async e=>{e.preventDefault();const payload={id:q('#saleId').value,startDate:q('#saleStartDate').value,endDate:q('#saleEndDate').value,channel:q('#saleChannel').value,grossAmount:q('#saleGrossAmount').value,returnAmount:q('#saleReturnAmount').value,orderCount:q('#saleOrderCount').value,note:q('#saleNote').value};try{await api('/web-api/admin/sale',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});toast('Ciro kaydı kaydedildi');resetSaleForm();await load()}catch(err){if(err.status===409||/çakışan/.test(err.message)){if(confirm('Bu kanal için çakışan dönem kaydı var. Eski kayıt silinip bu kayıt yazılsın mı?')){payload.replaceOverlap=true;await api('/web-api/admin/sale',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});toast('Çakışan kayıt değiştirildi');resetSaleForm();await load()}return}toast(err.message)}};
window.editSale=id=>{const s=(store.sales||[]).find(x=>x.id===id);if(!s)return;q('#saleId').value=s.id;q('#saleStartDate').value=s.startDate||s.date;q('#saleEndDate').value=s.endDate||s.date;q('#saleChannel').value=s.channel;q('#saleGrossAmount').value=s.grossAmount??s.amount;q('#saleReturnAmount').value=s.returnAmount||0;q('#saleOrderCount').value=s.orderCount||0;q('#saleNote').value=s.note||'';saleNetPreview();window.scrollTo({top:0,behavior:'smooth'})};
window.deleteSale=async id=>{if(!confirm('Ciro kaydı silinsin mi?'))return;await api('/web-api/admin/sale/'+id,{method:'DELETE'});toast('Ciro kaydı silindi');await load()};
q('#importForm').onsubmit=async e=>{e.preventDefault();const f=q('#csvFile').files[0];if(!f)return;const fd=new FormData();fd.append('file',f);try{const r=await api('/web-api/admin/import-csv',{method:'POST',body:fd});toast(`${r.added} yeni, ${r.updated} güncel, ${r.skipped} atlandı`);await load()}catch(e){toast(e.message)}};q('#refreshBtn').onclick=load;q('#logoutBtn').onclick=async()=>{await api('/web-api/logout',{method:'POST'});location.reload()};
function importCategoryOptions(selected=''){q('#importCategory').innerHTML=(store?.categories||[]).filter(x=>x.active!==false).map(x=>`<option value="${x.id}" ${x.id===selected?'selected':''}>${x.name}</option>`).join('')}
function guessImportCategory(p){const t=`${p?.name||''} ${p?.category||''} ${p?.code||''}`.toLocaleLowerCase('tr-TR');if(/x30\s*tr|yazar\s*kasa/.test(t))return'yazar-kasa';if(/istikbal|mobilya|koltuk|yatak|baza|kanepe/.test(t))return'mobilya';if(/klima/.test(t))return'klima';if(/televizyon|smart tv|google tv|oled|qled|\btv\b/.test(t))return'tv-elektronik';if(/buzdolabı|çamaşır|kurutma|bulaşık|fırın|ocak|dondurucu|beyaz/.test(t))return'beyaz-esya';return'kucuk-ev-aletleri'}
function setImportStatus(text,type=''){const e=q('#importStatus');e.textContent=text;e.className=type}
function renderImportProduct(p){importDraft=p;const imgs=p.images||[],specs=p.specifications||[],docs=p.documents||[];q('#importCode').value=p.code||'';q('#importBrand').value=p.brand||'Beko';q('#importName').value=p.name||'';q('#importPrice').value=Number(p.bekoPrice||p.price||0)||'';q('#importStock').value=0;const guessed=p.category||guessImportCategory(p);q('#importVat').value=resolveVatRateClient({category:guessed,brand:p.brand,code:p.code,name:p.name});q('#importPriceMode').value='same';q('#importPriceValue').value=0;q('#importDescription').value=p.description||'';importCategoryOptions(guessed);q('#importMainImage').src=imgs[0]||'';q('#importThumbs').innerHTML=imgs.map((src,i)=>`<button type="button" class="${i===0?'active':''}" data-img="${src}"><img src="${src}" alt=""></button>`).join('');qa('#importThumbs button').forEach(b=>b.onclick=()=>{q('#importMainImage').src=b.dataset.img;qa('#importThumbs button').forEach(x=>x.classList.toggle('active',x===b))});q('#importImageCount').textContent=imgs.length;q('#importSpecCount').textContent=specs.length;q('#importDocCount').textContent=docs.length;q('#importSpecs').innerHTML=specs.length?specs.map(x=>`<article><b>${x.name}</b><span>${x.value}</span></article>`).join(''):'<p>Teknik özellik bulunamadı.</p>';q('#importDocs').innerHTML=docs.length?docs.map(x=>`<a href="${x.url}" target="_blank" rel="noopener">${x.title} ↗</a>`).join(''):'<p>Geçerli belge bulunamadı.</p>';q('#importEmpty').classList.add('hidden');q('#importPreview').classList.remove('hidden')}
q('#importFetchForm').onsubmit=async e=>{e.preventDefault();const url=q('#importUrl').value.trim(),btn=q('#importFetchBtn');if(!url)return;btn.disabled=true;btn.textContent='Getiriliyor...';setImportStatus('Beko sayfası okunuyor...','loading');try{const r=await api('/web-api/admin/product-import/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url})});renderImportProduct(r.product);setImportStatus('Ürün getirildi. Kontrol edip kaydedin.','success')}catch(err){setImportStatus(err.message,'error')}finally{btn.disabled=false;btn.textContent='Ürünü Getir'}};
q('#importCategory')?.addEventListener('change',()=>{
  q('#importVat').value=resolveVatRateClient({category:q('#importCategory').value,brand:q('#importBrand').value,code:q('#importCode').value,name:q('#importName').value});
});
q('#importSaveBtn').onclick=async()=>{if(!importDraft)return toast('Önce ürünü getirin');const btn=q('#importSaveBtn');const vat=resolveVatRateClient({category:q('#importCategory').value,brand:q('#importBrand').value.trim(),code:q('#importCode').value.trim(),name:q('#importName').value.trim()});q('#importVat').value=vat;const product={...importDraft,code:q('#importCode').value.trim(),brand:q('#importBrand').value.trim(),name:q('#importName').value.trim(),bekoPrice:Number(q('#importPrice').value||0),listPrice:Number(q('#importPrice').value||0),cashPrice:Number(q('#importPrice').value||0),cardPrice:Number(q('#importPrice').value||0),category:q('#importCategory').value,stock:Number(q('#importStock').value||0),vatRate:vat,priceMode:q('#importPriceMode').value,priceValue:Number(q('#importPriceValue').value||0),description:q('#importDescription').value.trim(),image:q('#importMainImage').src,active:true};btn.disabled=true;btn.textContent='Kaydediliyor...';try{const r=await api('/web-api/admin/product-import/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({product})});toast(r.created?'Ürün, Ürünler listesine eklendi':'Mevcut ürün güncellendi');await load();goTab('products')}catch(err){setImportStatus(err.message,'error')}finally{btn.disabled=false;btn.textContent="Ürünler'e Kaydet"}};
q('#importResetBtn').onclick=()=>{importDraft=null;q('#importUrl').value='';q('#importPreview').classList.add('hidden');q('#importEmpty').classList.remove('hidden');setImportStatus('Hazır')};


const ROLE_LABELS={owner:'Sahip / Tam Yetki',admin:'Yönetici',sales:'Satış Personeli',warehouse:'Depo',accounting:'Muhasebe',service:'Servis',viewer:'Sadece Görüntüleme'};

let permissionDefs=[],rolePermissionMap={};
function currentCheckedPermissions(){
  return qa('[data-user-permission].on').map(x=>x.dataset.userPermission||x.value).filter(Boolean);
}
function renderPermissionEditor(selected=[]){
  const box=q('#userPermissionList');if(!box)return;
  const selectedSet=new Set(selected),groups={};
  permissionDefs.forEach(p=>(groups[p.group]||(groups[p.group]=[])).push(p));
  box.innerHTML=Object.entries(groups).map(([group,rows])=>{
    const onCount=rows.filter(p=>selectedSet.has(p.id)||selectedSet.has('*')).length;
    return `<details class="perm-group" open>
      <summary><b>${group}</b><small>${onCount}/${rows.length} açık</small></summary>
      <div class="perm-chip-row">${rows.map(p=>{
        const on=selectedSet.has(p.id)||selectedSet.has('*');
        return `<button type="button" class="perm-chip ${on?'on':''}" data-user-permission="${p.id}" aria-pressed="${on?'true':'false'}">${p.name}</button>`;
      }).join('')}</div>
    </details>`;
  }).join('');
  qa('[data-user-permission]').forEach(btn=>{
    if(!box.contains(btn))return;
    btn.onclick=()=>{
      const on=!btn.classList.contains('on');
      btn.classList.toggle('on',on);
      btn.setAttribute('aria-pressed',on?'true':'false');
      const group=btn.closest('.perm-group');
      if(group){
        const total=group.querySelectorAll('[data-user-permission]').length;
        const openN=group.querySelectorAll('[data-user-permission].on').length;
        const small=group.querySelector('summary small');
        if(small)small.textContent=`${openN}/${total} açık`;
      }
    };
  });
}
function applyRoleDefaultPermissions(){
  const role=q('#userRole')?.value||'viewer',perms=rolePermissionMap[role]||[];
  renderPermissionEditor(perms.includes('*')?permissionDefs.map(p=>p.id):perms);
}
async function loadPermissionDefinitions(){
  try{
    const d=await api('/web-api/admin/roles');permissionDefs=d.permissions||[];
    rolePermissionMap=Object.fromEntries((d.roles||[]).map(r=>[r.id,r.permissions||[]]));
    if(q('#userRole'))q('#userRole').innerHTML=(d.roles||[]).map(r=>`<option value="${r.id}">${r.name}</option>`).join('');
    applyRoleDefaultPermissions();
  }catch(e){}
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
  screen_sales_tracking:['sales_manage','orders_manage'],
  screen_profit:['reports_view','finance_manage']
};
function can(permission,user=window.__currentAdminUser){
  const p=user?.permissions||[];
  if(p.includes('*')||p.includes(permission))return true;
  return (PERM_ALIASES[permission]||[]).some(a=>p.includes(a));
}
const TAB_PERMISSION_MAP={
  dashboard:'dashboard_view',
  tasksCenter:'dashboard_view',
  financeCenter:'screen_finance',
  moneyCenter:'screen_money_center',
  financeReports:'screen_finance',
  customerPayments:'screen_customer_payments',
  customersPage:'screen_customers',
  salesCenter:'screen_sales_center',
  salesTracking:'screen_sales_tracking',
  mySalesReport:'screen_my_sales',
  staffSalesReport:'screen_staff_sales_report',
  managerApprovals:'screen_manager_approvals',
  profitCenter:'screen_profit',
  reportsHub:'screen_profit',
  invoiceCenter:'screen_invoice_center',
  uninvoicedSales:'screen_uninvoiced',
  financeDashboard:'screen_finance',
  products:'products_view',dynamicsExcelImport:'products_manage',purchaseInvoices:'products_manage',stockCenter:'stock_view',prices:'products_manage',
  brands:'products_manage',categories:'products_manage',productImport:'web_manage',campaigns:'web_manage',
  banners:'web_manage',webOrders:'web_manage',foundation:'foundation_manage',revenue:'reports_view',
  sync:'sync_manage',users:'users_manage',training:'screen_training',settings:'settings_manage'
};
function applyPermissionVisibility(){
  qa('[data-tab]').forEach(el=>{
    const needed=TAB_PERMISSION_MAP[el.dataset.tab];
    if(needed)el.classList.toggle('permission-hidden',!can(needed));
  });
}
async function loadCurrentAdminPermissions(){
  try{const d=await api('/web-api/me');window.__currentAdminUser=d.user||null;applyPermissionVisibility()}catch(e){}
}
function syncUserStatusUi(){
  const active=q('#userActive')?.checked!==false;
  const st=q('#userStatusText');
  const btn=q('#userActivateBtn');
  const box=q('#userStatusBox');
  if(st){st.textContent=active?'AKTİF':'PASİF';st.style.color=active?'#15803d':'#b91c1c'}
  if(box){box.style.background=active?'#f0fdf4':'#fef2f2';box.style.borderColor=active?'#86efac':'#fca5a5'}
  if(btn){
    const hasId=!!String(q('#userId')?.value||'').trim();
    btn.style.display=(!active&&hasId)?'inline-flex':'none';
  }
}
function fillUserStoreOptions(selected=''){
  const sel=q('#userStore'); if(!sel)return;
  const stores=(store?.stores||[]).filter(x=>x.active!==false);
  const cur=selected||sel.value||'';
  sel.innerHTML='<option value="">Mağaza seçilmedi</option>'+stores.map(s=>`<option value="${s.id}">${s.name}</option>`).join('');
  if(cur && [...sel.options].some(o=>o.value===cur))sel.value=cur;
}
function resetUserForm(){
  q('#userId').value='';
  q('#userName').value='';
  q('#userUsername').value='';
  if(q('#userEmail'))q('#userEmail').value='';
  q('#userRole').value='viewer';
  q('#userPassword').value='';
  q('#userActive').checked=true;
  if(q('#userHireDate'))q('#userHireDate').value='';
  fillUserStoreOptions('');
  syncUserStatusUi();
  setTimeout(applyRoleDefaultPermissions,0);
}
function fillUserForm(u){
  if(!u)return;
  q('#userId').value=u.id||'';
  q('#userName').value=u.name;
  q('#userUsername').value=u.username||String(u.name||'').toLocaleLowerCase('tr-TR').replace(/ı/g,'i').replace(/[^a-z0-9._-]+/g,'.').replace(/^\.+|\.+$/g,'');
  if(q('#userEmail'))q('#userEmail').value=u.email||'';
  q('#userRole').value=ROLE_LABELS[u.role]?u.role:'sales';
  q('#userPassword').value='';
  q('#userActive').checked=u.active!==false;
  fillUserStoreOptions(u.storeId||'');
  if(q('#userHireDate'))q('#userHireDate').value=String(u.hireDate||'').slice(0,10);
  renderPermissionEditor((u.permissions||[]).includes('*')?permissionDefs.map(p=>p.id):(u.permissions||[]));
  syncUserStatusUi();
  if(u.fromStaff)setTimeout(applyRoleDefaultPermissions,0);
  goTab('users');
}
async function activateUser(id){
  const users=store?.users||[];
  const uid=String(id||q('#userId')?.value||'').trim();
  const u=users.find(x=>String(x.id)===uid);
  if(!u){toast('Önce listeden kullanıcı seçin');return}
  if(u.active!==false){toast('Kullanıcı zaten aktif');return}
  try{
    await api('/web-api/admin/user',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      id:u.id,name:u.name,username:u.username,email:u.email||'',role:u.role,active:true,
      permissions:u.permissions||[],password:''
    })});
    await load();
    const updated=(store?.users||[]).find(x=>String(x.id)===uid);
    if(updated)fillUserForm(updated);
    toast('Kullanıcı aktifleştirildi');
  }catch(e){toast(e.message||'Aktifleştirilemedi')}
}
async function deleteUser(id){
  const users=store?.users||[];
  const uid=String(id||q('#userId')?.value||'').trim();
  if(!uid){toast('Silmek için listeden kullanıcı seçin');return}
  const u=users.find(x=>String(x.id)===uid);
  const label=u?`${u.name} (@${u.username})`:uid;
  const alreadyPassive=u?.active===false;
  if(alreadyPassive){
    if(!confirm(`“${label}” zaten pasif.\n\nKalıcı silinsin mi? Bu işlem geri alınamaz.`))return;
  }else{
    if(!confirm(`“${label}” pasife alınsın mı?\n\nTekrar Sil derseniz kalıcı silinir. Aktifleştir ile geri açabilirsiniz.`))return;
  }
  try{
    const url='/web-api/admin/user/'+encodeURIComponent(uid)+(alreadyPassive?'?force=1':'');
    const r=await api(url,{method:'DELETE'});
    resetUserForm();
    await load();
    if(r.deleted)toast('Kullanıcı kalıcı silindi');
    else toast(r.message||'Kullanıcı pasife alındı');
  }catch(e){toast(e.message||'Silinemedi')}
}
function userKey(x){
  return String(x?.username||'').trim().toLocaleLowerCase('tr-TR');
}
function usersForList(){
  const users=[...(store?.users||[])];
  const seen=new Set(users.map(u=>userKey(u)).filter(Boolean));
  const ids=new Set(users.map(u=>String(u.id)));
  for(const st of (store?.staff||[])){
    const key=userKey(st);
    if(key&&seen.has(key))continue;
    if(st.userId&&ids.has(String(st.userId)))continue;
    if(st.id&&ids.has(String(st.id)))continue;
    const storeName=(store?.stores||[]).find(s=>String(s.id)===String(st.storeId||''))?.name||st.storeName||'';
    users.push({
      id:st.id,name:st.name,username:st.username||'',email:'',
      role:ROLE_LABELS[st.role]?st.role:'sales',
      roleName:'Personel kaydı',
      storeId:st.storeId||'',storeName,
      hireDate:st.hireDate||'',
      active:st.active!==false,fromStaff:true
    });
    if(key)seen.add(key);
    if(st.id)ids.add(String(st.id));
  }
  return users;
}
function renderUsers(){
  if(!q('#userList'))return;
  const users=usersForList();
  q('#userRole').innerHTML=Object.entries(ROLE_LABELS).map(([id,name])=>`<option value="${id}">${name}</option>`).join('');
  fillUserStoreOptions(q('#userStore')?.value||'');
  q('#userList').innerHTML=users.length?users.map(u=>`<div class="admin-card user-card" style="display:flex;gap:8px;align-items:stretch;flex-wrap:wrap">
    <div style="flex:1;min-width:160px">
      <h3>${u.name}</h3>
      <p>${u.username?('@'+u.username):'Kullanıcı adı yok'} · ${u.roleName||ROLE_LABELS[u.role]||'Personel'}</p>
      <p style="margin:2px 0 0;font-size:12px;color:#0b4f96;font-weight:750">${u.storeName?('Mağaza: '+u.storeName):'Mağaza seçilmedi'}</p>
      ${u.hireDate?`<p style="margin:2px 0 0;font-size:12px;color:#9a3412;font-weight:750">İşe başlama: ${String(u.hireDate).slice(0,10)}</p>`:''}
      <p style="margin:2px 0 0;font-size:12px;color:#64748b">${u.email?u.email:'<span style="color:#b91c1c">E-posta yok — şifre unuttum çalışmaz</span>'}</p>
      <small style="font-weight:800;color:${u.active!==false?'#15803d':'#b91c1c'}">${u.active!==false?'AKTİF':'PASİF'}${u.fromStaff?' · Personel kartından':''}</small>
    </div>
    <div class="admin-card-actions" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
      <button type="button" data-user-edit="${u.id}">Düzenle</button>
      ${u.fromStaff?'':(u.active===false
        ?`<button type="button" class="primary" data-user-activate="${u.id}">Aktifleştir</button>`
        :`<button type="button" data-user-disable="${u.id}">Pasife al</button>`)}
      ${u.fromStaff?'':`<button type="button" class="secondary-btn" data-user-del="${u.id}">Sil</button>`}
    </div>
  </div>`).join(''):'<p>Henüz ek kullanıcı yok. Soldan ad / kullanıcı adı / şifre girip Kaydet’e basın.</p>';
  qa('[data-user-edit]').forEach(b=>b.onclick=()=>{
    const u=users.find(x=>String(x.id)===String(b.dataset.userEdit));if(!u)return;fillUserForm(u);
  });
  qa('[data-user-activate]').forEach(b=>b.onclick=()=>activateUser(b.dataset.userActivate));
  qa('[data-user-disable]').forEach(b=>b.onclick=()=>deleteUser(b.dataset.userDisable));
  qa('[data-user-del]').forEach(b=>b.onclick=()=>deleteUser(b.dataset.userDel));
}
q('#userForm').onsubmit=async e=>{
  e.preventDefault();
  const payload={
    id:q('#userId').value||undefined,
    name:q('#userName').value.trim(),
    username:q('#userUsername').value.trim(),
    email:q('#userEmail')?.value.trim()||'',
    role:q('#userRole').value,
    storeId:q('#userStore')?.value||'',
    hireDate:q('#userHireDate')?.value||'',
    password:q('#userPassword').value,
    active:q('#userActive').checked,
    permissions:currentCheckedPermissions()
  };
  try{
    await api('/web-api/admin/user',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    resetUserForm();
    await load();
    toast(payload.id?'Kullanıcı güncellendi':'Kullanıcı eklendi');
  }catch(err){toast(err.message||'Kaydedilemedi')}
};
q('#userReset').onclick=resetUserForm;
q('#userActivateBtn')?.addEventListener('click',()=>activateUser());
q('#userDeleteBtn')?.addEventListener('click',()=>deleteUser());
q('#userActive')?.addEventListener('change',syncUserStatusUi);
syncUserStatusUi();
q('#applyRolePermissions')?.addEventListener('click',applyRoleDefaultPermissions);
q('#userRole')?.addEventListener('change',applyRoleDefaultPermissions);


function setFinanceMenu(open){
  const group=q('#financeNavGroup'),submenu=q('#financeSubmenu'),toggle=q('#financeMenuToggle');
  if(!group||!submenu||!toggle)return;
  group.classList.toggle('open',Boolean(open));submenu.classList.toggle('open',Boolean(open));
  toggle.setAttribute('aria-expanded',open?'true':'false');
}
function openFinancePage(page='dashboard'){
  const frame=q('#financeFrame');
  if(frame)frame.src=`/finance/?embed=1#${page}`;
  goTab('financeDashboard');setFinanceMenu(true);
}
q('#financeMenuToggle')?.addEventListener('click',()=>setFinanceMenu(!q('#financeNavGroup')?.classList.contains('open')));
qa('[data-finance-page]').forEach(b=>b.onclick=()=>openFinancePage(b.dataset.financePage));
qa('[data-finance-open]').forEach(b=>b.onclick=()=>openFinancePage(b.dataset.financeOpen));



// V6.2.1 — never allow foundation forms to navigate away from the SPA.
['storeFoundationForm','staffFoundationForm','announcementFoundationForm'].forEach(id=>{
  const form=q('#'+id); if(form) form.addEventListener('submit',e=>e.preventDefault(),true);
});


// V6.2.3 — no admin form is allowed to navigate the browser natively.
qa('#appView form').forEach(form=>form.addEventListener('submit',e=>{
  // Existing onsubmit/addEventListener handlers still run; this only blocks browser navigation.
  e.preventDefault();
},true));

let foundationData=null;
async function loadFoundation(){
  foundationData=await api('/web-api/admin/foundation');
  renderFoundation();
}
function renderFoundation(){
  if(!foundationData||!q('#foundationSummary'))return;
  const f=foundationData,s=f.summary;
  q('#foundationSummary').innerHTML=`<article><b>${money(s.totalTurnover)}</b><span>Bugünkü Ciro · ${Number(s.saleCount||0)} satış</span></article><article><b>${money(s.beko)} / ${money(s.istikbal)}</b><span>Beko / İstikbal</span></article><article><b>${s.completedStores}/${s.storeCount}</b><span>Satış Yapan Mağaza</span></article><article><b>${(f.staff||[]).filter(x=>x.active!==false).length}</b><span>Aktif Personel</span></article>`;
  const activeStores=f.stores.filter(x=>x.active);
  const passiveStores=f.stores.filter(x=>!x.active);
  // Pasif mağazalar seçilemez ama listede görünür — "neden yok?" karışıklığını önler
  const passiveOptions=passiveStores.map(x=>`<option value="${x.id}" disabled>${x.name} (Pasif — Mağaza sekmesinden aktif edin)</option>`).join('');
  const activeOptions=activeStores.map(x=>`<option value="${x.id}">${x.name}</option>`).join('');
  if(q('#fStaffStore'))q('#fStaffStore').innerHTML=(activeOptions||'<option value="">Aktif mağaza yok</option>')+passiveOptions;
  q('#fAnnouncementStore').innerHTML=`<option value="">Tüm mağazalar</option>`+activeOptions+passiveOptions;
  if(q('#fStaffStoreHint')){
    q('#fStaffStoreHint').textContent=passiveStores.length
      ? `${activeStores.length} aktif mağaza. Pasif: ${passiveStores.map(x=>x.name).join(', ')} — seçebilmek için Mağaza sekmesinden aktif edin.`
      : `${activeStores.length} aktif mağaza listelendi.`;
  }
  q('#fStoreList').innerHTML=f.stores.map(x=>`<button type="button" class="${x.active?'':'fnd-passive'}" data-fstore="${x.id}"><b>${x.name}</b><small>${x.code||''} · ${x.active?'Aktif':'Pasif — seçilemez'}</small></button>`).join('')||'<p class="note">Henüz mağaza yok.</p>';
  q('#fStaffList').innerHTML=(f.staff||[]).map(x=>`<button type="button" data-go-user="${x.id}" data-go-user-name="${(x.username||'').replace(/"/g,'&quot;')}" data-go-user-full="${String(x.name||'').replace(/"/g,'&quot;')}"><b>${x.name}</b><small>${x.storeName||'Mağaza yok'} · ${x.active!==false?'Aktif':'Pasif'}</small></button>`).join('')||'<p class="note">Kullanıcılar ekranından personel ekleyin.</p>';
  q('#fAnnouncementList').innerHTML=f.announcements.map(x=>`<div><b>${x.title}</b><small>${x.storeId?f.stores.find(s=>s.id===x.storeId)?.name:'Tüm personel'}</small><button type="button" data-fannouncement-delete="${x.id}">Sil</button></div>`).join('');
  q('#fTurnoverCount').textContent=`${f.turnovers.length} gün · mağaza satırı`;
  const brandPill=x=>{
    const parts=[];
    if(Number(x.beko||0)>0)parts.push(`<span class="ck-brand-pill beko">Beko ${money(x.beko)}</span>`);
    if(Number(x.istikbal||0)>0)parts.push(`<span class="ck-brand-pill istikbal">İstikbal ${money(x.istikbal)}</span>`);
    if(Number(x.other||0)>0)parts.push(`<span class="ck-brand-pill other">Diğer ${money(x.other)}</span>`);
    return parts.join(' ')||'—';
  };
  q('#fTurnoverList').innerHTML=f.turnovers.length
    ?`<table><thead><tr><th>Tarih</th><th>Mağaza</th><th>Personel</th><th>Satış</th><th>Bayi Dağılımı</th><th>Net Ciro</th></tr></thead><tbody>${f.turnovers.map(x=>`<tr><td>${x.date}</td><td>${x.storeName}</td><td>${x.staffName}</td><td>${x.orderCount}</td><td>${brandPill(x)}</td><td><b>${money(x.netAmount)}</b></td></tr>`).join('')}</tbody></table>`
    :'<p class="note">Bu dönemde satış yok. Satış girildikçe bu tablo kendiliğinden dolar.</p>';
  qa('[data-fstore]').forEach(b=>b.onclick=()=>{const x=f.stores.find(v=>v.id===b.dataset.fstore);q('#fStoreId').value=x.id;q('#fStoreName').value=x.name;q('#fStoreCode').value=x.code||'';q('#fStoreAddress').value=x.address||'';q('#fStoreActive').checked=x.active});
  qa('[data-go-user]').forEach(b=>b.onclick=async()=>{
    const uid=b.dataset.goUser;
    const uname=String(b.dataset.goUserName||'').toLocaleLowerCase('tr-TR');
    const full=String(b.dataset.goUserFull||'').trim().toLocaleLowerCase('tr-TR');
    try{await load()}catch(_){}
    const users=usersForList();
    const u=users.find(x=>String(x.id)===String(uid))
      || (uname&&users.find(x=>String(x.username||'').toLocaleLowerCase('tr-TR')===uname))
      || (full&&users.find(x=>String(x.name||'').trim().toLocaleLowerCase('tr-TR')===full));
    if(u){fillUserForm(u);return}
    goTab('users');
    toast('Kullanıcı listesi yenilendi — personeli listeden seçin');
  });
  qa('[data-fannouncement-delete]').forEach(b=>b.onclick=async()=>{if(!confirm('Duyuru silinsin mi?'))return;await api('/web-api/admin/announcement/'+b.dataset.fannouncementDelete,{method:'DELETE'});await loadFoundation()});
  if(q('#fndCountStore'))q('#fndCountStore').textContent=`${f.stores.length} kayıt`;
  if(q('#fndCountStaff'))q('#fndCountStaff').textContent=`${(f.staff||[]).filter(x=>x.active!==false).length} aktif`;
  if(q('#fndCountAnnounce'))q('#fndCountAnnounce').textContent=`${f.announcements.filter(x=>x.active).length} yayında`;
  if(q('#fndCountTurnover'))q('#fndCountTurnover').textContent=`otomatik · ${f.turnovers.length} satır`;
  renderFoundationWarehouses();
}
async function ensureStockDataForWarehouses(){
  if(stockData?.warehouses)return stockData;
  stockData=await api('/web-api/admin/stock-center');
  return stockData;
}
function renderFoundationWarehouses(){
  if(!q('#warehouseList')||!q('#warehouseForm'))return;
  const stores=foundationData?.stores||[];
  if(q('#warehouseStore')){
    q('#warehouseStore').innerHTML='<option value="">Mağazaya bağlı değil</option>'+stores.map(x=>`<option value="${x.id}">${x.name}</option>`).join('');
  }
  const list=stockData?.warehouses||[];
  const rows=list.filter(x=>!x.deletedAt);
  q('#warehouseList').innerHTML=rows.length
    ?rows.map(x=>{
      const storeName=stores.find(s=>String(s.id)===String(x.storeId||''))?.name||'Bağlı değil';
      return `<div class="warehouse-list-row">
        <button type="button" class="warehouse-edit-main" data-warehouse-edit="${x.id}"><b>${x.name}</b><small>${x.code||'—'} · ${storeName} · ${x.active!==false?'Aktif':'Pasif'}</small></button>
        <button type="button" class="warehouse-delete-btn" data-warehouse-delete="${x.id}" title="Depoyu sil">Sil</button>
      </div>`;
    }).join('')
    :'<p class="note">Henüz depo yok. Soldan ekleyin.</p>';
  if(q('#fndCountWarehouse'))q('#fndCountWarehouse').textContent=`${rows.filter(x=>x.active!==false).length} aktif`;
  qa('[data-warehouse-edit]').forEach(b=>b.onclick=()=>{
    const x=(stockData?.warehouses||[]).find(v=>v.id===b.dataset.warehouseEdit);if(!x)return;
    q('#warehouseId').value=x.id;q('#warehouseName').value=x.name;q('#warehouseCode').value=x.code||'';
    q('#warehouseStore').value=x.storeId||'';q('#warehouseActive').checked=x.active!==false;
    setFoundationTab('warehouse');
  });
  qa('[data-warehouse-delete]').forEach(b=>b.onclick=async()=>{
    const x=(stockData?.warehouses||[]).find(v=>v.id===b.dataset.warehouseDelete);if(!x)return;
    if(!confirm(`${x.name} deposu silinsin mi? Depoda stok varsa sistem silmeye izin vermeyecek.`))return;
    try{await api('/web-api/admin/warehouse/'+encodeURIComponent(x.id),{method:'DELETE'});toast('Depo silindi');await loadStockCenter();renderFoundationWarehouses()}catch(e){toast(e.message)}
  });
}
/* Foundation alt sekmeleri: Mağaza / Depo / Personel / Duyuru / Ciro */
function setFoundationTab(name){
  const target=name||'store';
  qa('.fnd-tab').forEach(b=>b.classList.toggle('active',b.dataset.fndTab===target));
  qa('.fnd-pane').forEach(p=>p.classList.toggle('active',p.dataset.fndPane===target));
  try{sessionStorage.setItem('atakFoundationTab',target)}catch(e){}
  if(target==='warehouse'){
    ensureStockDataForWarehouses().then(()=>renderFoundationWarehouses()).catch(e=>toast(e.message));
  }
}
qa('.fnd-tab').forEach(b=>b.addEventListener('click',()=>setFoundationTab(b.dataset.fndTab)));
function resetFoundationForm(kind){
  if(kind==='store'){
    q('#storeFoundationForm')?.reset();
    if(q('#fStoreId'))q('#fStoreId').value='';
    if(q('#fStoreActive'))q('#fStoreActive').checked=true;
  }else if(kind==='staff'){
    q('#staffFoundationForm')?.reset();
    if(q('#fStaffId'))q('#fStaffId').value='';
    if(q('#fStaffActive'))q('#fStaffActive').checked=true;
  }else if(kind==='announce'){
    q('#announcementFoundationForm')?.reset();
  }else if(kind==='warehouse'){
    q('#warehouseForm')?.reset();
    if(q('#warehouseId'))q('#warehouseId').value='';
    if(q('#warehouseActive'))q('#warehouseActive').checked=true;
  }
  renderFoundation();
}
qa('[data-fnd-reset]').forEach(b=>b.addEventListener('click',()=>resetFoundationForm(b.dataset.fndReset)));
q('#storeFoundationForm').onsubmit=async e=>{e.preventDefault();try{const result=await api('/web-api/admin/store-location',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:q('#fStoreId').value,name:q('#fStoreName').value,code:q('#fStoreCode').value,address:q('#fStoreAddress').value,active:q('#fStoreActive').checked})});e.target.reset();q('#fStoreId').value='';q('#fStoreActive').checked=true;await loadFoundation();toast(`Mağaza kaydedildi: ${result.row?.name||''}`)}catch(err){toast('Mağaza kaydedilemedi: '+err.message)}};
q('#announcementFoundationForm').onsubmit=async e=>{e.preventDefault();await api('/web-api/admin/announcement',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:q('#fAnnouncementType').value,title:q('#fAnnouncementTitle').value,message:q('#fAnnouncementMessage').value,storeId:q('#fAnnouncementStore').value,endDate:q('#fAnnouncementEnd').value,active:true})});e.target.reset();await loadFoundation();toast('Duyuru yayınlandı')};
const oldGoTab=goTab;goTab=function(id){
  oldGoTab(id);
  if(id==='foundation'){
    let saved='store';
    try{saved=sessionStorage.getItem('atakFoundationTab')||'store'}catch(e){}
    setFoundationTab(saved);
    loadFoundation().catch(e=>toast(e.message));
  }
};


let stockData=null;
async function loadStockCenter(){stockData=await api('/web-api/admin/stock-center');renderStockCenter()}
function renderStockCenter(){
  if(!stockData||!q('#stockSummary'))return;
  const activeWarehouses=stockData.warehouses.filter(x=>x.active!==false&&!x.deletedAt);
  const total=stockData.stocks.reduce((a,x)=>a+Number(x.quantity||0),0);
  const reserved=stockData.stocks.reduce((a,x)=>a+Number(x.reserved||0),0);
  const critical=stockData.stocks.filter(x=>Number(x.available||0)<=2).length;
  q('#stockSummary').innerHTML=`<article><b>${total}</b><span>Toplam Fiziksel Stok</span></article><article><b>${reserved}</b><span>Rezerve Stok</span></article><article><b>${activeWarehouses.length}</b><span>Aktif Depo</span></article><article><b>${critical}</b><span>Kritik Stok Satırı</span></article>`;
  const whOpts=activeWarehouses.map(x=>`<option value="${x.id}">${x.name}</option>`).join('');
  ['#stockWarehouse','#transferFrom','#transferTo','#importWarehouse'].forEach(id=>{if(q(id))q(id).innerHTML=whOpts});
  const productOpts=stockData.products.filter(x=>x.active).map(x=>`<option value="${x.code}">${x.code} — ${x.name}</option>`).join('');
  ['#stockProduct','#transferProduct'].forEach(id=>{if(q(id))q(id).innerHTML=productOpts});
  renderFoundationWarehouses();
  renderStockTable();
  q('#movementCount').textContent=`${stockData.movements.length} hareket`;
  q('#movementTable').innerHTML=stockData.movements.length?`<table><thead><tr><th>Tarih</th><th>Ürün</th><th>Depo</th><th>İşlem</th><th>Değişim</th><th>Sonuç</th></tr></thead><tbody>${stockData.movements.map(x=>`<tr><td>${new Date(x.createdAt).toLocaleString('tr-TR')}</td><td>${x.productCode}</td><td>${stockData.warehouses.find(w=>w.id===x.warehouseId)?.name||x.warehouseId}</td><td>${x.type}</td><td class="${x.quantity>=0?'stock-plus':'stock-minus'}">${x.quantity>=0?'+':''}${x.quantity}</td><td>${x.after}</td></tr>`).join('')}</tbody></table>`:'<p>Henüz stok hareketi yok.</p>';
}
function renderStockTable(){
  const term=(q('#stockSearch')?.value||'').toLocaleLowerCase('tr-TR');
  const rows=stockData.stocks.filter(x=>`${x.productCode} ${x.productName} ${x.warehouseName}`.toLocaleLowerCase('tr-TR').includes(term));
  q('#stockTable').innerHTML=rows.length?`<table><thead><tr><th>Ürün</th><th>Depo</th><th>Fiziksel</th><th>Rezerve</th><th>Satılabilir</th></tr></thead><tbody>${rows.map(x=>`<tr><td><b>${x.productCode}</b><small>${x.productName}</small></td><td>${x.warehouseName}</td><td>${x.quantity}</td><td>${x.reserved||0}</td><td><b>${x.available}</b></td></tr>`).join('')}</tbody></table>`:'<p>Stok kaydı bulunamadı.</p>';
}
q('#stockSearch')?.addEventListener('input',renderStockTable);
q('#warehouseForm')?.addEventListener('submit',async e=>{
  e.preventDefault();
  await api('/web-api/admin/warehouse',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:q('#warehouseId').value,name:q('#warehouseName').value,code:q('#warehouseCode').value,storeId:q('#warehouseStore').value,active:q('#warehouseActive').checked})});
  e.target.reset();q('#warehouseId').value='';q('#warehouseActive').checked=true;
  await loadStockCenter();renderFoundationWarehouses();toast('Depo kaydedildi');
});
q('#stockAdjustForm')?.addEventListener('submit',async e=>{e.preventDefault();await api('/web-api/admin/stock-adjust',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({productCode:q('#stockProduct').value,warehouseId:q('#stockWarehouse').value,quantity:q('#stockQuantity').value,note:q('#stockNote').value})});e.target.reset();await loadStockCenter();toast('Stok güncellendi')});
q('#stockTransferForm')?.addEventListener('submit',async e=>{e.preventDefault();await api('/web-api/admin/stock-transfer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({productCode:q('#transferProduct').value,fromWarehouseId:q('#transferFrom').value,toWarehouseId:q('#transferTo').value,quantity:q('#transferQuantity').value,note:q('#transferNote').value})});e.target.reset();q('#transferQuantity').value=1;await loadStockCenter();toast('Transfer tamamlandı')});
q('#stockImportForm')?.addEventListener('submit',async e=>{e.preventDefault();const fd=new FormData();fd.append('file',q('#stockImportFile').files[0]);fd.append('warehouseId',q('#importWarehouse').value);const r=await api('/web-api/admin/stock-import',{method:'POST',body:fd});e.target.reset();await loadStockCenter();toast(`${r.imported} stok satırı aktarıldı`)});
q('#stockZeroAllBtn')?.addEventListener('click',async()=>{
  if(!confirm('TÜM depolardaki fiziksel stoklar 0 yapılsın mı?\nRezerveler de temizlenir. Hareket kaydı tutulur.'))return;
  if(!confirm('Emin misin? Bu işlem stok bakiyelerini sıfırlar.'))return;
  try{
    const r=await api('/web-api/admin/stock-zero',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirm:'ZERO'})});
    toast(`Stok sıfırlandı · ${r.cleared||0} satır · ${r.units||0} adet`);
    await loadStockCenter();
  }catch(e){toast(e.message)}
});
q('#stockGoWarehouseBtn')?.addEventListener('click',()=>{
  goTab('foundation');
  setFoundationTab('warehouse');
});
const foundationGoTab=goTab;goTab=function(id){foundationGoTab(id);if(id==='stockCenter'){if(!foundationData)loadFoundation().then(loadStockCenter);else loadStockCenter().catch(e=>toast(e.message))}};


let financeData=null;
let financeReportView='movements';
function setFinanceReportView(name){
  financeReportView=name||'movements';
  qa('#financeReportToggle [data-fin-report]').forEach(b=>b.classList.toggle('active',b.dataset.finReport===financeReportView));
  qa('[data-fin-report-panel]').forEach(p=>p.classList.toggle('hidden',p.dataset.finReportPanel!==financeReportView));
}
qa('#financeReportToggle [data-fin-report]').forEach(b=>b.addEventListener('click',()=>setFinanceReportView(b.dataset.finReport)));
q('#financeReportsRefresh')?.addEventListener('click',()=>loadFinanceCenter().catch(e=>toast(e.message)));
function financeKindLabel(kind){
  const m={
    collection:'Tahsilat',sale:'Satış (cari)',transfer:'Transfer',income:'Gelir',expense:'Gider',
    reversal:'Ters kayıt',collection_cancel:'Tahsilat iptali',sale_cancel:'Satış iptali'
  };
  return m[String(kind||'').toLowerCase()]||String(kind||'-');
}
function financeMoneyInRows(){
  // Kimden ne geldi: tahsilat + pozitif girişler (transfer hariç satış satırı tutarsız olabilir)
  return (financeData?.transactions||[]).filter(t=>{
    const k=String(t.kind||'').toLowerCase();
    if(k==='transfer'||k==='sale')return false;
    if(k==='collection'||k==='income')return true;
    return Number(t.amount||0)>0;
  });
}
function financeMonthRange( whicht ){
  const now=new Date();
  const y=now.getFullYear(),m=now.getMonth();
  const pad=n=>String(n).padStart(2,'0');
  if(whicht==='all')return{from:'',to:''};
  if(whicht==='last'){
    const d=new Date(y,m-1,1);
    const end=new Date(y,m,0);
    return{from:`${d.getFullYear()}-${pad(d.getMonth()+1)}-01`,to:`${end.getFullYear()}-${pad(end.getMonth()+1)}-${pad(end.getDate())}`};
  }
  const end=new Date(y,m+1,0);
  return{from:`${y}-${pad(m+1)}-01`,to:`${y}-${pad(m+1)}-${pad(end.getDate())}`};
}
function setFinanceMoveMonth(which){
  const r=financeMonthRange(which||'this');
  if(q('#finMoveFrom'))q('#finMoveFrom').value=r.from;
  if(q('#finMoveTo'))q('#finMoveTo').value=r.to;
  qa('#finMoveMonthToggle [data-fin-month]').forEach(b=>b.classList.toggle('active',b.dataset.finMonth===(which||'this')));
  renderFinanceMovements();
}
function openFinanceAccountPicker(){
  const modal=q('#finAccountPickerModal');
  const list=q('#finAccountPickerList');
  if(!modal||!list||!financeData)return;
  const cur=q('#finMoveAccount')?.value||'';
  list.innerHTML=(financeData.accounts||[]).map(a=>{
    const on=String(a.id)===String(cur);
    const type=a.type==='bank'?'Banka':'Kasa';
    return `<button type="button" data-fin-pick-account="${a.id}" style="width:100%;text-align:left;padding:12px 14px;border-radius:12px;border:2px solid ${on?'#2563eb':'#e2e8f0'};background:${on?'#eff6ff':'#fff'};cursor:pointer">
      <b style="display:block;font-size:15px">${a.name}</b>
      <small style="color:#64748b">${type} · bakiye ${money(a.balance)}</small>
    </button>`;
  }).join('')||'<p class="note">Hesap yok — Ayarlar’dan ekleyin.</p>';
  modal.classList.remove('hidden');
  modal.style.display='flex';
}
function closeFinanceAccountPicker(){
  const modal=q('#finAccountPickerModal');
  if(!modal)return;
  modal.classList.add('hidden');
  modal.style.display='none';
}
function selectFinanceMoveAccount(accountId,opts={}){
  const id=String(accountId||'');
  if(q('#finMoveAccount'))q('#finMoveAccount').value=id;
  if(opts.openMovements!==false)setFinanceReportView('movements');
  closeFinanceAccountPicker();
  renderFinanceMovements();
  const acc=(financeData?.accounts||[]).find(a=>String(a.id)===id);
  if(id&&acc)toast(`${acc.name} — sadece bu hesap`);
  else if(!id)toast('Tüm hesaplar');
}
function financeFilteredMovements(){
  const from=q('#finMoveFrom')?.value||'';
  const to=q('#finMoveTo')?.value||'';
  const acc=q('#finMoveAccount')?.value||'';
  const term=(q('#finMoveSearch')?.value||'').toLocaleLowerCase('tr-TR');
  return financeMoneyInRows().filter(x=>{
    const day=String(x.date||'').slice(0,10);
    if(from&&day<from)return false;
    if(to&&day>to)return false;
    if(acc&&String(x.accountId||'')!==acc)return false;
    if(term){
      const hay=`${x.customerName||''} ${x.accountName||''} ${x.category||''} ${x.description||''} ${x.reference||''} ${x.salespersonName||''}`.toLocaleLowerCase('tr-TR');
      if(!hay.includes(term))return false;
    }
    return true;
  });
}
function renderFinanceAccountChips(){
  const box=q('#finMoveAccountChips');
  if(!box||!financeData)return;
  const cur=q('#finMoveAccount')?.value||'';
  const accounts=financeData.accounts||[];
  box.innerHTML=[
    `<button type="button" data-fin-chip-account="" class="period-btn ${cur?'':'active'}" style="min-height:40px;padding:8px 12px">Tümü</button>`,
    ...accounts.map(a=>{
      const on=String(a.id)===String(cur);
      const type=a.type==='bank'?'Banka':'Kasa';
      return `<button type="button" data-fin-chip-account="${a.id}" class="period-btn ${on?'active':''}" style="min-height:40px;padding:8px 12px;text-align:left">
        <b>${a.name}</b> <small style="opacity:.8">${type}</small>
      </button>`;
    })
  ].join('');
  qa('[data-fin-chip-account]').forEach(b=>b.onclick=()=>selectFinanceMoveAccount(b.dataset.finChipAccount||''));
}
function renderFinanceMovements(){
  if(!financeData)return;
  if(q('#finMoveAccount')){
    const cur=q('#finMoveAccount').value;
    q('#finMoveAccount').innerHTML='<option value="">Tüm hesaplar</option>'+(financeData.accounts||[]).map(a=>`<option value="${a.id}">${a.name}</option>`).join('');
    if(cur&&[...q('#finMoveAccount').options].some(o=>o.value===cur))q('#finMoveAccount').value=cur;
  }
  if(!q('#finMoveFrom')?.value&&!q('#finMoveTo')?.value&&!q('#finMoveMonthToggle')?.dataset.init){
    setFinanceMoveMonth('this');
    if(q('#finMoveMonthToggle'))q('#finMoveMonthToggle').dataset.init='1';
    return; // setFinanceMoveMonth already re-renders
  }
  renderFinanceAccountChips();
  const accId=q('#finMoveAccount')?.value||'';
  const acc=(financeData.accounts||[]).find(a=>String(a.id)===String(accId));
  const lab=q('#finMoveSelectedLabel');
  if(lab){
    if(acc){
      lab.style.display='block';
      lab.innerHTML=`Seçili hesap: <b>${acc.name}</b> · ${acc.type==='bank'?'Banka':'Kasa'} · bakiye ${money(acc.balance)} — sadece bu hesaba gelenler`;
    }else{
      lab.style.display='none';
      lab.textContent='';
    }
  }
  const rows=financeFilteredMovements();
  if(q('#financeMovementCount'))q('#financeMovementCount').textContent=`${rows.length} kayıt`;
  const byMethod={};
  let totalIn=0;
  rows.forEach(x=>{
    const m=String(x.category||financeKindLabel(x.kind)||'Diğer').trim()||'Diğer';
    byMethod[m]=(byMethod[m]||0)+Math.abs(Number(x.amount||0));
    totalIn+=Math.abs(Number(x.amount||0));
  });
  if(q('#financeMovementKpis')){
    const parts=Object.entries(byMethod).sort((a,b)=>b[1]-a[1]).slice(0,6)
      .map(([k,v])=>`<article><b>${money(v)}</b><span>${k}</span></article>`).join('');
    q('#financeMovementKpis').innerHTML=`<article><b>${money(totalIn)}</b><span>Toplam gelen${acc?` · ${acc.name}`:''}</span></article>${parts}`
      ||`<article><b>${money(0)}</b><span>Toplam gelen</span></article>`;
  }
  if(!q('#financeMovementTable'))return;
  if(!rows.length){
    q('#financeMovementTable').innerHTML=`<p class="note">${acc?`“${acc.name}” için bu dönemde tahsilat yok.`:'Bu filtrede tahsilat yok. Hesap seçin veya satış/tahsilat yapın.'}</p>`;
    return;
  }
  q('#financeMovementTable').innerHTML=`<table><thead><tr>
    <th>Tarih</th><th>Kimden</th><th>Ne geldi</th><th>Nereye (hesap)</th><th>Tutar</th><th>Personel</th><th>Açıklama</th><th></th>
  </tr></thead><tbody>${rows.map(x=>`<tr>
    <td>${x.date||'-'}</td>
    <td><b>${x.customerName||'-'}</b></td>
    <td>${x.category||financeKindLabel(x.kind)}</td>
    <td>${x.accountName||'-'}${x.counterAccountName?` ← ${x.counterAccountName}`:''}</td>
    <td class="stock-plus"><b>${money(Math.abs(Number(x.amount||0)))}</b></td>
    <td>${x.salespersonName||x.createdBy||'-'}</td>
    <td><small>${x.description||x.reference||''}</small></td>
    <td>${x.id?`<a class="receipt-link" href="/web-api/admin/receipt/${x.id}" target="_blank">Makbuz</a>`:''}</td>
  </tr>`).join('')}</tbody></table>`;
}
function financeReportTitle(){
  return financeReportView==='customers'?'Müşteri Cari'
    :(financeReportView==='accounts'?'Hesap Bakiyeleri':'Kimden Ne Geldi');
}
function financeReportCsvLines(){
  if(!financeData)return null;
  const esc=v=>`"${String(v??'').replace(/"/g,'""')}"`;
  const lines=[];
  const s=financeData.summary||{};
  const day=new Date().toISOString().slice(0,10);
  lines.push(['ATAK FINANS RAPORU',financeReportTitle(),day].map(esc).join(';'));
  lines.push(['Toplam Kasa',s.cash,'Toplam Banka',s.bank,'Musteri Alacagi',s.receivable,'Bugunku Masraf',s.todayExpense].map(esc).join(';'));
  lines.push([]);
  if(financeReportView==='customers'){
    lines.push(['Musteri','Telefon','VKN/TCKN','Bakiye','Durum'].map(esc).join(';'));
    const term=(q('#customerSearch')?.value||'').toLocaleLowerCase('tr-TR');
    (financeData.customers||[]).filter(x=>`${x.name} ${x.phone} ${x.taxNo}`.toLocaleLowerCase('tr-TR').includes(term)).forEach(x=>{
      const st=x.balance>0?'Borçlu':x.balance<0?'Alacaklı':'Kapalı';
      lines.push([x.name,x.phone||'',x.taxNo||'',x.balance,st].map(esc).join(';'));
    });
  }else if(financeReportView==='accounts'){
    lines.push(['Hesap','Tur','Magaza','Durum','Bakiye'].map(esc).join(';'));
    (financeData.accounts||[]).forEach(x=>{
      const store=(financeData.stores||[]).find(s=>s.id===x.storeId)?.name||'Merkez';
      lines.push([x.name,x.type==='bank'?'Banka':'Kasa',store,x.active===false?'Pasif':'Aktif',x.balance].map(esc).join(';'));
    });
  }else{
    lines.push(['Tarih','Kimden','Ne geldi','Nereye','Tutar','Personel','Aciklama','Referans'].map(esc).join(';'));
    financeFilteredMovements().forEach(x=>{
      lines.push([
        x.date||'',x.customerName||'',x.category||financeKindLabel(x.kind),
        x.accountName||'',Math.abs(Number(x.amount||0)),x.salespersonName||x.createdBy||'',
        x.description||'',x.reference||''
      ].map(esc).join(';'));
    });
  }
  return lines;
}
function financeReportsExportExcel(){
  const lines=financeReportCsvLines();
  if(!lines){toast('Önce rapor yüklensin (Yenile)');return}
  const blob=new Blob(['\ufeff'+lines.join('\n')],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  const slug=financeReportView==='customers'?'musteri-cari':(financeReportView==='accounts'?'hesap-bakiyeleri':'kimden-ne-geldi');
  a.href=url;a.download=`atak-finans-${slug}-${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  toast('Excel (CSV) indirildi — Excel ile açın');
}
function financeReportsPrint(){
  if(!financeData){toast('Önce rapor yüklensin (Yenile)');return}
  const panel=q(`[data-fin-report-panel="${financeReportView}"] .turnover-table`);
  const tableHtml=panel?.innerHTML||'<p>Veri yok</p>';
  const s=financeData.summary||{};
  const kpis=q('#financeMovementKpis')?.innerHTML||'';
  const w=window.open('','_blank','noopener,noreferrer,width=1100,height=760');
  if(!w){toast('Açılır pencere engellendi');return}
  w.document.write(`<!doctype html><html lang="tr"><head><meta charset="utf-8"/><title>${financeReportTitle()}</title>
<style>
body{font-family:Arial,sans-serif;color:#111;margin:24px}
h1{font-size:20px;margin:0 0 6px} .meta{color:#555;margin:0 0 16px;font-size:13px}
.kpis,.foundation-summary{display:flex;gap:12px;flex-wrap:wrap;margin:0 0 18px}
.kpis div,.foundation-summary article{border:1px solid #ddd;padding:8px 12px;border-radius:8px;min-width:120px}
.kpis b,.foundation-summary b{display:block;font-size:16px}
.foundation-summary span{font-size:12px;color:#555}
table{width:100%;border-collapse:collapse;font-size:12px}
th,td{border:1px solid #ccc;padding:6px 8px;text-align:left}
th{background:#f3f4f6}
.toolbar{margin:0 0 16px}
.toolbar button{padding:8px 14px;font-weight:700;cursor:pointer}
@media print{.toolbar{display:none}}
</style></head><body>
<div class="toolbar"><button onclick="window.print()">Yazdır / PDF Kaydet</button></div>
<h1>ATAK — ${financeReportTitle()}</h1>
<p class="meta">${new Date().toLocaleString('tr-TR')}</p>
${financeReportView==='movements'?`<div class="foundation-summary">${kpis}</div>`:`<div class="kpis">
  <div><span>Toplam Kasa</span><b>${money(s.cash)}</b></div>
  <div><span>Toplam Banka</span><b>${money(s.bank)}</b></div>
  <div><span>Müşteri Alacağı</span><b>${money(s.receivable)}</b></div>
</div>`}
${tableHtml}
<script>setTimeout(function(){try{window.focus()}catch(e){}},200)<\\/script>
</body></html>`);
  w.document.close();
}
q('#financeReportsExcelBtn')?.addEventListener('click',financeReportsExportExcel);
q('#financeReportsPrintBtn')?.addEventListener('click',financeReportsPrint);
q('#finMoveFilterBtn')?.addEventListener('click',()=>renderFinanceMovements());
q('#finMoveSearch')?.addEventListener('input',()=>renderFinanceMovements());
['#finMoveFrom','#finMoveTo','#finMoveAccount'].forEach(id=>q(id)?.addEventListener('change',()=>renderFinanceMovements()));
qa('#finMoveMonthToggle [data-fin-month]').forEach(b=>b.addEventListener('click',()=>setFinanceMoveMonth(b.dataset.finMonth)));
q('#finMovePickAccountBtn')?.addEventListener('click',openFinanceAccountPicker);
q('#finMoveClearAccountBtn')?.addEventListener('click',()=>selectFinanceMoveAccount(''));
q('#finAccountPickerClose')?.addEventListener('click',closeFinanceAccountPicker);
q('#finAccountPickerModal')?.addEventListener('click',e=>{
  if(e.target===q('#finAccountPickerModal'))closeFinanceAccountPicker();
  const btn=e.target.closest?.('[data-fin-pick-account]');
  if(btn)selectFinanceMoveAccount(btn.getAttribute('data-fin-pick-account')||'');
});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeFinanceAccountPicker()});
async function loadFinanceCenter(){
  financeData=await api('/web-api/admin/finance-center');
  renderFinanceCenter();
}
function financeSummaryHtml(s){
  return `<article><b>${money(s.cash)}</b><span>Toplam Kasa</span></article><article><b>${money(s.bank)}</b><span>Toplam Banka</span></article><article><b>${money(s.receivable)}</b><span>Müşteri Alacağı</span></article><article><b>${money(s.todayExpense)}</b><span>Bugünkü Masraf</span></article>`;
}
function renderFinanceCenter(){
  if(!financeData)return;
  const s=financeData.summary||{};
  if(q('#financeSummary'))q('#financeSummary').innerHTML=financeSummaryHtml(s);
  if(q('#financeReportsSummary'))q('#financeReportsSummary').innerHTML=financeSummaryHtml(s);
  if(q('#financeAccountStore')){
    const storeOpts='<option value="">Merkez / Bağımsız</option>'+(financeData.stores||[]).map(x=>`<option value="${x.id}">${x.name}</option>`).join('');
    q('#financeAccountStore').innerHTML=storeOpts;
  }
  const accountOpts=(financeData.accounts||[]).filter(x=>x.active!==false).map(x=>`<option value="${x.id}">${x.name} — ${money(x.balance)}</option>`).join('');
  ['#transferFromAccount','#transferToAccount'].forEach(id=>{if(q(id))q(id).innerHTML=accountOpts});
  if(q('#financeAccountList')){
    q('#financeAccountList').innerHTML=(financeData.accounts||[]).length
      ?(financeData.accounts||[]).map(x=>`<div class="fin-acc-row" style="display:flex;gap:6px;align-items:stretch;margin:0 0 6px">
        <button type="button" data-fin-account="${x.id}" style="flex:1;text-align:left"><b>${x.name}</b><small>${x.type==='bank'?'Banka':'Kasa'} · ${money(x.balance)}${x.active===false?' · PASİF':''}</small></button>
        ${x.active===false?`<button type="button" class="primary" data-fin-activate="${x.id}" title="Aktifleştir" style="min-width:110px">Aktifleştir</button>`:''}
        <button type="button" class="secondary-btn" data-fin-del="${x.id}" title="Sil" style="min-width:64px">Sil</button>
      </div>`).join('')
      :'<p class="note">Henüz hesap yok. Yukarıdan ekleyip Kaydet’e basın.</p>';
  }
  if(q('#financeAccountCount'))q('#financeAccountCount').textContent=`${(financeData.accounts||[]).length} hesap`;
  if(q('#financeAccountsTable')){
    q('#financeAccountsTable').innerHTML=`<table><thead><tr><th>Hesap</th><th>Tür</th><th>Mağaza</th><th>Durum</th><th>Bakiye</th><th></th></tr></thead><tbody>${(financeData.accounts||[]).map(x=>`<tr data-fin-open-account="${x.id}" style="cursor:pointer" title="Tıklayınca bu hesabın girişlerini aç">
      <td><b>${x.name}</b></td>
      <td>${x.type==='bank'?'Banka':'Kasa'}</td>
      <td>${(financeData.stores||[]).find(s=>s.id===x.storeId)?.name||'Merkez'}</td>
      <td>${x.active===false?'Pasif':'Aktif'}</td>
      <td><b>${money(x.balance)}</b></td>
      <td><button type="button" class="secondary-btn" data-fin-open-account="${x.id}">Gör</button></td>
    </tr>`).join('')||'<tr><td colspan="6">Hesap yok</td></tr>'}</tbody></table>`;
    qa('[data-fin-open-account]').forEach(el=>el.onclick=e=>{
      e.preventDefault();e.stopPropagation();
      selectFinanceMoveAccount(el.getAttribute('data-fin-open-account')||el.dataset.finOpenAccount||'');
    });
  }
  renderCustomerTable();
  renderFinanceMovements();
  // Eski hareket tablosu (varsa) — ters kayıt butonu için
  if(q('#financeTransactionTable')){
    const txs=financeData.transactions||[];
    q('#financeTransactionTable').innerHTML=txs.length?`<table><thead><tr><th>Tarih</th><th>İşlem</th><th>Hesap</th><th>Müşteri</th><th>Tutar</th><th></th></tr></thead><tbody>${txs.map(x=>`<tr><td>${x.date}</td><td>${financeKindLabel(x.kind)}</td><td>${x.accountName}${x.counterAccountName?` ← ${x.counterAccountName}`:''}</td><td>${x.customerName||'-'}</td><td class="${x.amount>=0?'stock-plus':'stock-minus'}">${money(x.amount)}</td><td><a class="receipt-link" href="/web-api/admin/receipt/${x.id}" target="_blank">Makbuz</a> ${x.reversedBy?'Ters kayıt oluşturuldu':`<button type="button" data-reverse-finance="${x.id}">Ters Kayıt</button>`}</td></tr>`).join('')}</tbody></table>`:'<p>Henüz finans hareketi yok.</p>';
  }
  qa('[data-fin-account]').forEach(b=>b.onclick=()=>{
    const x=financeData.accounts.find(v=>v.id===b.dataset.finAccount);if(!x)return;
    fillFinanceAccountForm(x);
  });
  qa('[data-fin-activate]').forEach(b=>b.onclick=async e=>{
    e.preventDefault();e.stopPropagation();
    await activateFinanceAccount(b.dataset.finActivate);
  });
  qa('[data-fin-del]').forEach(b=>b.onclick=async e=>{
    e.preventDefault();e.stopPropagation();
    await deleteFinanceAccount(b.dataset.finDel);
  });
  qa('[data-reverse-finance]').forEach(b=>b.onclick=async()=>{if(!confirm('Bu hareket için ters kayıt oluşturulsun mu?'))return;await api('/web-api/admin/finance-reverse/'+b.dataset.reverseFinance,{method:'POST'});await loadFinanceCenter();toast('Ters kayıt oluşturuldu')});
  setFinanceReportView(financeReportView);
  syncFinanceAccountStatusUi();
}
function syncFinanceAccountStatusUi(){
  const active=q('#financeAccountActive')?.checked!==false;
  const st=q('#financeAccountStatusText');
  const btn=q('#financeAccountActivateBtn');
  const box=q('#financeAccountStatusBox');
  if(st){
    st.textContent=active?'AKTİF':'PASİF';
    st.style.color=active?'#15803d':'#b91c1c';
  }
  if(box)box.style.background=active?'#f0fdf4':'#fef2f2';
  if(box)box.style.borderColor=active?'#86efac':'#fca5a5';
  if(btn){
    const hasId=!!String(q('#financeAccountId')?.value||'').trim();
    btn.style.display=(!active&&hasId)?'inline-flex':'none';
  }
}
function fillFinanceAccountForm(x){
  if(!x)return;
  if(q('#financeAccountId'))q('#financeAccountId').value=x.id;
  if(q('#financeAccountName'))q('#financeAccountName').value=x.name;
  if(q('#financeAccountType'))q('#financeAccountType').value=x.type;
  if(q('#financeAccountStore'))q('#financeAccountStore').value=x.storeId||'';
  if(q('#financeOpeningBalance'))q('#financeOpeningBalance').value=x.openingBalance||0;
  if(q('#financeAccountActive'))q('#financeAccountActive').checked=x.active!==false;
  syncFinanceAccountStatusUi();
}
function resetFinanceAccountForm(){
  const f=q('#financeAccountForm');
  if(f)f.reset();
  if(q('#financeAccountId'))q('#financeAccountId').value='';
  if(q('#financeOpeningBalance'))q('#financeOpeningBalance').value=0;
  if(q('#financeAccountActive'))q('#financeAccountActive').checked=true;
  syncFinanceAccountStatusUi();
}
async function activateFinanceAccount(id){
  const accId=String(id||q('#financeAccountId')?.value||'').trim();
  if(!accId){toast('Önce listeden pasif hesabı seçin');return}
  const row=(financeData?.accounts||[]).find(a=>String(a.id)===accId);
  if(!row){toast('Hesap bulunamadı');return}
  if(row.active!==false){toast('Hesap zaten aktif');return}
  try{
    await api('/web-api/admin/finance-account',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      id:row.id,name:row.name,type:row.type,storeId:row.storeId||'',openingBalance:row.openingBalance||0,active:true
    })});
    await loadFinanceCenter();
    const updated=(financeData?.accounts||[]).find(a=>String(a.id)===accId);
    if(updated)fillFinanceAccountForm(updated);
    toast('Hesap aktifleştirildi');
  }catch(e){toast(e.message||'Aktifleştirilemedi')}
}
async function deleteFinanceAccount(id){
  const accId=String(id||q('#financeAccountId')?.value||'').trim();
  if(!accId){toast('Silmek için listeden hesap seçin');return}
  const row=(financeData?.accounts||[]).find(a=>String(a.id)===accId);
  const label=row?.name||accId;
  const alreadyPassive=row?.active===false;
  const bal=Number(row?.balance||0);
  if(Math.abs(bal)>0.009){
    if(!confirm(`“${label}” bakiyesi ${money(bal)}.\n\nBakiyesi olan hesap silinmez — pasife alınır. Devam?`))return;
  }else if(alreadyPassive){
    if(!confirm(`“${label}” zaten pasif (bakiye 0).\n\nKalıcı silinsin mi? Geçmiş hareketlerde hesap adı boş görünebilir.`))return;
  }else{
    if(!confirm(`“${label}” hesabını silmek istiyor musunuz?\n\nGeçmiş hareket varsa önce pasife alınır; tekrar Sil derseniz kalıcı silinir.`))return;
  }
  try{
    const force=alreadyPassive||Math.abs(bal)<=0.009&&alreadyPassive;
    const url='/web-api/admin/finance-account/'+encodeURIComponent(accId)+(alreadyPassive?'?force=1':'');
    const r=await api(url,{method:'DELETE'});
    resetFinanceAccountForm();
    await loadFinanceCenter();
    if(r.deleted)toast('Hesap kalıcı silindi');
    else toast(r.message||'Hesap pasife alındı — tekrar Sil ile kalıcı silebilirsiniz');
  }catch(e){toast(e.message||'Silinemedi')}
}
function renderCustomerTable(){
  if(!financeData||!q('#customerTable'))return;
  const term=(q('#customerSearch')?.value||'').toLocaleLowerCase('tr-TR');
  const rows=financeData.customers.filter(x=>`${x.name} ${x.phone} ${x.taxNo} ${x.tckn||''} ${x.customerCode||''} ${x.rapidCustAccount||''}`.toLocaleLowerCase('tr-TR').includes(term));
  q('#customerTable').innerHTML=rows.length?`<table><thead><tr><th>Kod</th><th>Müşteri</th><th>Telefon</th><th>VKN/TCKN</th><th>Bakiye</th><th>Durum</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${x.customerCode||x.rapidCustAccount||'-'}</td><td><b>${x.name}</b></td><td>${x.phone||'-'} ${sipBtn(x.phone,{className:'sip-call-sm',customerId:x.id})}</td><td>${x.taxNo||'-'}</td><td><b>${money(x.balance)}</b></td><td>${x.balance>0?'Borçlu':x.balance<0?'Alacaklı':'Kapalı'}</td></tr>`).join('')}</tbody></table>`:'<p>Müşteri bulunamadı.</p>';
}
q('#customerSearch')?.addEventListener('input',renderCustomerTable);
if(q('#transferDate'))q('#transferDate').value=new Date().toISOString().slice(0,10);
q('#financeAccountForm')?.addEventListener('submit',async e=>{e.preventDefault();await api('/web-api/admin/finance-account',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:q('#financeAccountId').value,name:q('#financeAccountName').value,type:q('#financeAccountType').value,storeId:q('#financeAccountStore').value,openingBalance:q('#financeOpeningBalance').value,active:q('#financeAccountActive').checked})});resetFinanceAccountForm();await loadFinanceCenter();toast('Hesap kaydedildi')});
q('#financeAccountNewBtn')?.addEventListener('click',()=>{resetFinanceAccountForm();toast('Yeni hesap formu hazır')});
q('#financeAccountDeleteBtn')?.addEventListener('click',()=>deleteFinanceAccount());
q('#financeAccountActivateBtn')?.addEventListener('click',()=>activateFinanceAccount());
q('#financeAccountActive')?.addEventListener('change',syncFinanceAccountStatusUi);
syncFinanceAccountStatusUi();

q('#financeTransferForm')?.addEventListener('submit',async e=>{e.preventDefault();await api('/web-api/admin/finance-transfer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({date:q('#transferDate').value,fromAccountId:q('#transferFromAccount').value,toAccountId:q('#transferToAccount').value,amount:q('#transferFinanceAmount').value,description:q('#transferFinanceDescription').value})});e.target.reset();q('#transferDate').value=new Date().toISOString().slice(0,10);closeFinanceTransfer();await loadFinanceCenter();toast('Transfer tamamlandı')});
function openFinanceTransfer(){
  const m=q('#financeTransferModal');
  if(!m)return;
  if(q('#transferDate')&&!q('#transferDate').value)q('#transferDate').value=new Date().toISOString().slice(0,10);
  m.classList.remove('hidden');
  setTimeout(()=>q('#transferFinanceAmount')?.focus(),40);
}
function closeFinanceTransfer(){q('#financeTransferModal')?.classList.add('hidden')}
q('#financeTransferOpenBtn')?.addEventListener('click',openFinanceTransfer);
q('#financeTransferClose')?.addEventListener('click',closeFinanceTransfer);
q('#financeTransferModal')?.addEventListener('click',e=>{if(e.target===q('#financeTransferModal'))closeFinanceTransfer()});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeFinanceTransfer()});
const stockGoTab=goTab;goTab=function(id){stockGoTab(id);if(id==='financeCenter'||id==='financeReports'||id==='settings')loadFinanceCenter().catch(e=>toast(e.message))};



async function renderV4FinancePreview(){try{const d=await api('/web-api/admin/finance-center');const cash=q('#v4CashPreview'),bank=q('#v4BankPreview');if(cash)cash.textContent=money(d.summary.cash);if(bank)bank.textContent=money(d.summary.bank)}catch(e){const cash=q('#v4CashPreview'),bank=q('#v4BankPreview');if(cash)cash.textContent='₺0';if(bank)bank.textContent='₺0'}}
const oldRenderDashboardV4=renderDashboard;renderDashboard=function(){oldRenderDashboardV4();renderV4FinancePreview()};
q('#mobileMenuBtn')?.addEventListener('click',()=>document.body.classList.toggle('v4-menu-open'));qa('aside nav button, aside nav a').forEach(el=>el.addEventListener('click',()=>document.body.classList.remove('v4-menu-open')));



let webOrders=[];
const webOrderStatusNames={new:'Yeni',preparing:'Hazırlanıyor',service:'Servise Verildi',shipped:'Sevk Edildi',completed:'Teslim Edildi',cancelled:'İptal',returned:'İade'};
function webOrderDate(value){if(!value)return '-';const d=new Date(value);return Number.isNaN(d.getTime())?String(value).slice(0,10):d.toLocaleString('tr-TR',{dateStyle:'short',timeStyle:'short'})}
async function loadWebOrders(){
  try{const d=await api('/web-api/admin/web-orders');webOrders=d.orders||[];renderWebOrders()}
  catch(e){toast(e.message)}
}
function renderWebOrders(){
  const term=(q('#webOrderSearch')?.value||'').toLocaleLowerCase('tr-TR');
  const status=q('#webOrderStatus')?.value||'all',from=q('#webOrderDateFrom')?.value||'',to=q('#webOrderDateTo')?.value||'';
  const rows=webOrders.filter(o=>{
    const text=`${o.number} ${o.customerName} ${o.phone} ${(o.items||[]).map(i=>i.name).join(' ')}`.toLocaleLowerCase('tr-TR');
    const day=String(o.date||'').slice(0,10);
    return text.includes(term)&&(status==='all'||o.status===status)&&(!from||day>=from)&&(!to||day<=to)
  });
  const counts={all:webOrders.length,new:0,preparing:0,completed:0,cancelled:0};webOrders.forEach(o=>{if(counts[o.status]!==undefined)counts[o.status]++});
  q('#webOrderStats').innerHTML=`<article><small>Toplam</small><strong>${counts.all}</strong></article><article><small>Yeni</small><strong>${counts.new}</strong></article><article><small>Hazırlanıyor</small><strong>${counts.preparing}</strong></article><article><small>Teslim</small><strong>${counts.completed}</strong></article><article><small>İptal</small><strong>${counts.cancelled}</strong></article>`;
  q('#webOrderTable').innerHTML=rows.map(o=>`<tr><td><b>${o.number}</b><small>${o.id}</small></td><td>${webOrderDate(o.date)}</td><td><b>${o.customerName}</b><small>${o.phone||o.email||'-'}</small></td><td>${(o.items||[]).slice(0,2).map(i=>`${i.quantity}× ${i.name}`).join('<br>')||'-'}${(o.items||[]).length>2?`<small>+${o.items.length-2} ürün</small>`:''}</td><td>${o.paymentMethod}<small>${o.paymentStatus||''}</small></td><td><b>${money(o.total)}</b></td><td><select class="web-order-status" data-order-id="${o.id}">${Object.entries(webOrderStatusNames).map(([k,v])=>`<option value="${k}" ${o.status===k?'selected':''}>${v}</option>`).join('')}</select></td><td><button class="secondary-btn" data-web-order-detail="${o.id}">Detay</button></td></tr>`).join('');
  q('#webOrderEmpty').classList.toggle('hidden',rows.length>0);
  qa('.web-order-status').forEach(s=>s.onchange=async()=>{try{await api('/web-api/admin/web-orders/'+encodeURIComponent(s.dataset.orderId)+'/status',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:s.value})});toast('Sipariş durumu güncellendi');await loadWebOrders()}catch(e){toast(e.message)}});
  qa('[data-web-order-detail]').forEach(b=>b.onclick=()=>{const o=webOrders.find(x=>x.id===b.dataset.webOrderDetail);if(!o)return;alert(`${o.number}\n${o.customerName}\n${(o.items||[]).map(i=>`${i.quantity} x ${i.name}`).join('\n')}\nToplam: ${money(o.total)}`)});
}
q('#webOrdersRefresh')?.addEventListener('click',loadWebOrders);
['#webOrderSearch','#webOrderStatus','#webOrderDateFrom','#webOrderDateTo'].forEach(s=>q(s)?.addEventListener(s==='#webOrderSearch'?'input':'change',renderWebOrders));
q('[data-tab="webOrders"]')?.addEventListener('click',()=>setTimeout(loadWebOrders,30));

q('.v4-website-menu')?.querySelectorAll('button[data-tab]').forEach(btn=>btn.addEventListener('click',()=>{q('.v4-website-menu').open=false}));



let dealerSettingsData=[];
async function loadDealerSettings(){
  try{
    const d=await api('/web-api/admin/dealer-settings');dealerSettingsData=d.rows||[];
    qa('.dealer-setting-card').forEach(card=>{
      const id=card.querySelector('[data-dealer-id]')?.value;
      const r=dealerSettingsData.find(x=>x.id===id);if(!r)return;
      card.querySelector('[data-dealer-margin]').value=r.marginDividePct;
      card.querySelector('[data-dealer-commission]').value=r.commissionPct;
      card.querySelector('[data-dealer-cash]').value=r.cashMaxDiscountPct;
      card.querySelector('[data-dealer-card]').value=r.cardMaxDiscountPct;
    });
  }catch(e){}
}
q('#dealerSettingsForm')?.addEventListener('submit',async e=>{
  e.preventDefault();const st=q('#dealerSettingsStatus');
  const rows=qa('.dealer-setting-card').map(card=>({
    id:card.querySelector('[data-dealer-id]').value,
    name:card.querySelector('h3').textContent.trim(),
    marginDividePct:Number(card.querySelector('[data-dealer-margin]').value||0),
    commissionPct:Number(card.querySelector('[data-dealer-commission]').value||0),
    cashMaxDiscountPct:Number(card.querySelector('[data-dealer-cash]').value||0),
    cardMaxDiscountPct:Number(card.querySelector('[data-dealer-card]').value||0),
    active:true
  }));
  try{await api('/web-api/admin/dealer-settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({rows})});st.textContent='Bayi ayarları kaydedildi.';st.className='form-status success';await loadDealerSettings();await loadSalesCenter()}catch(err){st.textContent=err.message;st.className='form-status error'}
});

/* ===== Müşteriler sayfası ===== */
let customersPageData={customers:[],selectedId:'',total:0};
function customerInvoiceType(prefix){
  const checked=document.querySelector(`input[name="${prefix}InvoiceType"]:checked`);
  return checked?.value==='corporate'?'corporate':'individual';
}
function customerHasCorporate(c={}){
  return Boolean(String(c.companyName||'').trim()&&String(c.taxNo||'').replace(/\D/g,'').length>=10);
}
function syncCustomerFormUI(prefix){
  const same=q(`#${prefix}DeliverySame`)?.checked!==false;
  q(`#${prefix}DeliveryWrap`)?.classList.toggle('hidden',same);
  const corp=customerInvoiceType(prefix)==='corporate';
  q(`#${prefix}IndividualSec`)?.classList.remove('hidden');
  q(`#${prefix}CorporateSec`)?.classList.remove('hidden');
  const tckn=q(`#${prefix}Tckn`);
  const company=q(`#${prefix}CompanyName`);
  const office=q(`#${prefix}TaxOffice`);
  const vkn=q(`#${prefix}TaxNo`);
  const phone=q(`#${prefix}Phone`);
  const work=q(`#${prefix}WorkPhone`);
  q(`#${prefix}PhoneWrap`)?.classList.remove('hidden');
  if(tckn)tckn.required=false;
  if(company)company.required=false;
  if(office)office.required=false;
  if(vkn)vkn.required=false;
  if(phone)phone.required=true;
  if(work)work.required=false;
  if(corp&&work&&phone&&!String(work.value||'').trim()&&String(phone.value||'').trim())work.value=phone.value;
  if(!corp&&phone&&work&&!String(phone.value||'').trim()&&String(work.value||'').trim())phone.value=work.value;
}
function splitCustomerName(full){
  const parts=String(full||'').replace(/\s+/g,' ').trim().split(' ').filter(Boolean);
  if(!parts.length)return {firstName:'',lastName:''};
  if(parts.length===1)return {firstName:parts[0],lastName:''};
  return {firstName:parts.slice(0,-1).join(' '),lastName:parts[parts.length-1]};
}
function collectCustomerPayload(prefix,{requireActive=false}={}){
  const firstName=(q(`#${prefix}FirstName`)?.value||'').trim();
  const lastName=(q(`#${prefix}LastName`)?.value||'').trim();
  const name=[firstName,lastName].filter(Boolean).join(' ').trim()||(q(`#${prefix}Name`)?.value||'').trim();
  const invoiceType=customerInvoiceType(prefix);
  const workPhone=(q(`#${prefix}WorkPhone`)?.value||'').trim();
  const phone=((q(`#${prefix}Phone`)?.value||'').trim()||workPhone);
  const city=(q(`#${prefix}City`)?.value||'').trim();
  const district=(q(`#${prefix}District`)?.value||'').trim();
  const address=(q(`#${prefix}Address`)?.value||'').trim();
  const deliverySame=q(`#${prefix}DeliverySame`)?.checked!==false;
  const deliveryCity=(q(`#${prefix}DeliveryCity`)?.value||'').trim();
  const deliveryDistrict=(q(`#${prefix}DeliveryDistrict`)?.value||'').trim();
  const deliveryAddress=(q(`#${prefix}DeliveryAddress`)?.value||'').trim();
  const companyName=(q(`#${prefix}CompanyName`)?.value||'').trim();
  const taxOffice=(q(`#${prefix}TaxOffice`)?.value||'').trim();
  const taxNo=(q(`#${prefix}TaxNo`)?.value||'').trim();
  const tckn=(q(`#${prefix}Tckn`)?.value||'').trim();
  if(!firstName)throw new Error('Ad zorunludur');
  if(!lastName)throw new Error('Soyad zorunludur');
  if(!phone)throw new Error(invoiceType==='corporate'?'İş telefonu zorunludur':'Telefon zorunludur');
  if(!city||!district||!address)throw new Error('Ev adres (il, ilçe, ev adres) zorunludur');
  if(!deliverySame&&(!deliveryCity||!deliveryDistrict||!deliveryAddress))throw new Error('Teslimat adresi için il, ilçe ve açık adres girin');
  if(invoiceType==='corporate'&&!companyName&&!taxNo){
    throw new Error('Kurumsal fatura için kurumsal ünvan veya vergi no girin');
  }
  if(tckn&&tckn.replace(/\D/g,'').length!==11)throw new Error('TC girildiyse 11 hane olmalıdır');
  const email=(q(`#${prefix}Email`)?.value||'').trim();
  if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error('Geçerli bir mail girin (e-Fatura / e-Arşiv için)');
  const payload={
    firstName,lastName,name,phone,
    email,
    birthDate:(q(`#${prefix}BirthDate`)?.value||'').trim(),
    city,district,address,
    deliverySameAsBilling:deliverySame,
    deliveryCity,deliveryDistrict,deliveryAddress,
    invoiceType:companyName||taxNo?'corporate':invoiceType,
    companyName,
    companyAddress:(q(`#${prefix}CompanyAddress`)?.value||'').trim(),
    companyCity:(q(`#${prefix}CompanyCity`)?.value||'').trim(),
    companyDistrict:(q(`#${prefix}CompanyDistrict`)?.value||'').trim(),
    workPhone:workPhone||phone,
    taxOffice,
    taxNo,
    tckn:tckn||'',
    note:(q(`#${prefix}Note`)?.value||'').trim(),
    customerCode:(q(`#${prefix}Code`)?.value||'').trim(),
    active:true
  };
  if(requireActive||q(`#${prefix}Active`))payload.active=String(q(`#${prefix}Active`)?.value||'true')!=='false';
  const id=(q(`#${prefix}Id`)?.value||'').trim();
  if(id)payload.id=id;
  return payload;
}
function fillCustomerForm(prefix,c={}){
  if(q(`#${prefix}Id`))q(`#${prefix}Id`).value=c.id||'';
  const split=(!c.firstName||!c.lastName)?splitCustomerName(c.name||''):null;
  if(q(`#${prefix}FirstName`))q(`#${prefix}FirstName`).value=c.firstName||split?.firstName||'';
  if(q(`#${prefix}LastName`))q(`#${prefix}LastName`).value=c.lastName||split?.lastName||'';
  if(q(`#${prefix}Name`))q(`#${prefix}Name`).value=c.name||'';
  if(q(`#${prefix}Phone`))q(`#${prefix}Phone`).value=c.phone||'';
  if(q(`#${prefix}WorkPhone`))q(`#${prefix}WorkPhone`).value=c.workPhone||c.phone||'';
  if(q(`#${prefix}Email`))q(`#${prefix}Email`).value=c.email||'';
  if(q(`#${prefix}City`))q(`#${prefix}City`).value=c.city||'';
  if(q(`#${prefix}District`))q(`#${prefix}District`).value=c.district||'';
  if(q(`#${prefix}Address`))q(`#${prefix}Address`).value=c.address||'';
  if(q(`#${prefix}BirthDate`))q(`#${prefix}BirthDate`).value=String(c.birthDate||'').slice(0,10);
  if(q(`#${prefix}CompanyAddress`))q(`#${prefix}CompanyAddress`).value=c.companyAddress||'';
  if(q(`#${prefix}CompanyCity`))q(`#${prefix}CompanyCity`).value=c.companyCity||'';
  if(q(`#${prefix}CompanyDistrict`))q(`#${prefix}CompanyDistrict`).value=c.companyDistrict||'';
  if(q(`#${prefix}DeliverySame`))q(`#${prefix}DeliverySame`).checked=c.deliverySameAsBilling!==false;
  if(q(`#${prefix}DeliveryCity`))q(`#${prefix}DeliveryCity`).value=c.deliveryCity||'';
  if(q(`#${prefix}DeliveryDistrict`))q(`#${prefix}DeliveryDistrict`).value=c.deliveryDistrict||'';
  if(q(`#${prefix}DeliveryAddress`))q(`#${prefix}DeliveryAddress`).value=c.deliveryAddress||'';
  const type=(c.invoiceType==='corporate'||c.companyName||c.taxNo)?'corporate':'individual';
  document.querySelectorAll(`input[name="${prefix}InvoiceType"]`).forEach(r=>{r.checked=r.value===type});
  if(q(`#${prefix}CompanyName`)){q(`#${prefix}CompanyName`).value=c.companyName||'';q(`#${prefix}CompanyName`).dataset.vknAuto='0'}
  if(q(`#${prefix}TaxOffice`)){q(`#${prefix}TaxOffice`).value=c.taxOffice||'';q(`#${prefix}TaxOffice`).dataset.vknAuto='0'}
  if(q(`#${prefix}TaxNo`))q(`#${prefix}TaxNo`).value=c.taxNo||'';
  if(q(`#${prefix}Tckn`))q(`#${prefix}Tckn`).value=c.tckn||(!c.companyName&&String(c.taxNo||'').replace(/\D/g,'').length===11?c.taxNo:'')||'';
  if(q(`#${prefix}Note`))q(`#${prefix}Note`).value=c.note||'';
  if(q(`#${prefix}Code`))q(`#${prefix}Code`).value=c.customerCode||c.rapidCustAccount||c.code||'';
  if(q(`#${prefix}Active`))q(`#${prefix}Active`).value=c.active===false?'false':'true';
  const taxDigits=String(c.taxNo||'').replace(/\D/g,'');
  vknLookupState[prefix]=taxDigits.length===10?taxDigits:'';
  setVknStatus(prefix, taxDigits.length===10?'Kayıtlı VKN':'10 hane yazınca ünvan otomatik dolar');
  syncCustomerFormUI(prefix);
}
const vknLookupState={};
const vknLookupSeq={};
function setVknStatus(prefix,text,cls=''){
  const el=q(`#${prefix}VknStatus`);
  if(!el)return;
  el.textContent=text||'';
  el.className='field-hint'+(cls?' '+cls:'');
}
function vknOnlyDigits(v){return String(v||'').replace(/\D/g,'').slice(0,10)}
function fillFromVknLookup(prefix,data={}){
  const title=String(data.companyName||data.alias||'').trim();
  const company=q(`#${prefix}CompanyName`);
  if(company&&title&&(!String(company.value||'').trim()||company.dataset.vknAuto==='1')){
    company.value=title;
    company.dataset.vknAuto='1';
  }
  const office=q(`#${prefix}TaxOffice`);
  const taxOffice=String(data.taxOffice||'').trim();
  if(office&&taxOffice&&(!String(office.value||'').trim()||office.dataset.vknAuto==='1')){
    office.value=taxOffice;
    office.dataset.vknAuto='1';
  }
  const fillEmpty=(id,val)=>{
    const el=q(id); if(!el||!val)return;
    if(!String(el.value||'').trim())el.value=val;
  };
  fillEmpty(`#${prefix}City`,data.city);
  fillEmpty(`#${prefix}District`,data.district);
  fillEmpty(`#${prefix}Address`,data.address);
  fillEmpty(`#${prefix}Email`,data.email);
}
async function lookupVkn(prefix,{force=false}={}){
  const input=q(`#${prefix}TaxNo`);
  if(!input)return;
  const vkn=vknOnlyDigits(input.value);
  if(input.value!==vkn)input.value=vkn;
  if(vkn.length!==10){
    setVknStatus(prefix,vkn.length?`${vkn.length}/10 hane`:'10 hane yazınca ünvan otomatik dolar');
    return;
  }
  if(!force&&vknLookupState[prefix]===vkn)return;
  vknLookupSeq[prefix]=(vknLookupSeq[prefix]||0)+1;
  const seq=vknLookupSeq[prefix];
  setVknStatus(prefix,'e-Fatura sorgulanıyor…');
  try{
    const d=await api('/web-api/admin/vkn-lookup?vkn='+encodeURIComponent(vkn));
    if(seq!==vknLookupSeq[prefix])return;
    if(!d.ok){
      setVknStatus(prefix,d.error||'Ünvan alınamadı. e-Fatura Merkezi’nde QNB ayarlarını kaydedin.','vkn-status-err');
      return;
    }
    vknLookupState[prefix]=vkn;
    fillFromVknLookup(prefix,d);
    const title=String(d.companyName||d.alias||'').trim();
    if(d.alreadyCustomer){
      setVknStatus(prefix,d.message||'Bu VKN zaten kayıtlı','vkn-status-warn');
    }else if(title){
      setVknStatus(prefix,(d.eInvoiceUser?'e-Fatura: ':'')+title+(d.taxOffice?'':' · vergi dairesini yazın'),'vkn-status-ok');
    }else{
      setVknStatus(prefix,'Ünvan gelmedi, firma adını elle yazın','vkn-status-warn');
    }
  }catch(err){
    if(seq!==vknLookupSeq[prefix])return;
    setVknStatus(prefix,err.message||'VKN sorgusu başarısız. QNB kullanıcı/şifre kaydedin.','vkn-status-err');
  }
}
function bindVknLookup(prefix){
  const input=q(`#${prefix}TaxNo`);
  if(!input||input.dataset.vknBound==='1')return;
  input.dataset.vknBound='1';
  input.addEventListener('input',()=>{
    const d=vknOnlyDigits(input.value);
    if(input.value!==d)input.value=d;
    clearTimeout(window['__vknT_'+prefix]);
    window['__vknT_'+prefix]=setTimeout(()=>lookupVkn(prefix),280);
  });
  input.addEventListener('blur',()=>lookupVkn(prefix));
  q(`#${prefix}CompanyName`)?.addEventListener('input',()=>{const el=q(`#${prefix}CompanyName`);if(el)el.dataset.vknAuto='0'});
  q(`#${prefix}TaxOffice`)?.addEventListener('input',()=>{const el=q(`#${prefix}TaxOffice`);if(el)el.dataset.vknAuto='0'});
}
function onCustomerInvoiceTypeChange(prefix){
  syncCustomerFormUI(prefix);
  if(customerInvoiceType(prefix)!=='corporate')return;
  q(`#${prefix}TaxNo`)?.focus();
  lookupVkn(prefix);
}
function customerOptionLabel(c={}){
  return [c.name||'',c.customerCode||c.rapidCustAccount||'',c.phone||''].filter(Boolean).join(' · ');
}
async function fillNextCustomerCode(prefix){
  const el=q(`#${prefix}Code`);
  if(!el||el.value)return;
  try{
    const d=await api('/web-api/admin/customer-code-next');
    if(!el.value && d.customerCode) el.value=d.customerCode;
  }catch(_){}
}
function openCustomerModal(c=null){
  q('#customerPageForm')?.reset();
  q('#customerPageStatus').textContent='';
  q('#customerPageStatus').className='form-status';
  q('#customerFormTitle').textContent=c?'Müşteri Düzenle':'Yeni Müşteri Ekle';
  fillCustomerForm('customerPage',c||{});
  if(!c&&q('#customerPageDeliverySame'))q('#customerPageDeliverySame').checked=true;
  syncCustomerFormUI('customerPage');
  q('#customerModal')?.classList.remove('hidden');
  if(!c) fillNextCustomerCode('customerPage');
  q('#customerPageFirstName')?.focus();
}
function renderCustomerPageList(){
  const rows=(customersPageData.customers||[]).filter(c=>c.active!==false&&!c.deletedAt);
  if(q('#customerPageCount'))q('#customerPageCount').textContent=String(customersPageData.total!=null?customersPageData.total:rows.length);
  const box=q('#customerPageList');if(!box)return;
  if(!rows.length){box.innerHTML='<div class="note" style="padding:16px">Müşteri bulunamadı. + Yeni Müşteri ile ekleyin veya aramayı temizleyin.</div>';return}
  box.innerHTML=rows.map(c=>{
    const bal=Number(c.balance||0);
    const balCls=bal>0?'debt':bal<0?'credit':'closed';
    const sub=[c.customerCode||c.rapidCustAccount,c.phone,c.email,c.city&&c.district?`${c.district}/${c.city}`:(c.address||'')].filter(Boolean).join(' · ');
    const active=String(c.id)===String(customersPageData.selectedId)?'active':'';
    const badge=customerHasCorporate(c)?(c.invoiceType==='corporate'?' · Şahıs+Firma':' · Firma kayıtlı'):' · Bireysel';
    return `<div class="customer-card ${active}"><button type="button" class="customer-card-pick" data-customer-id="${c.id}"><div><b>${c.name||'-'}</b><small>${sub||'Adres yok'}${badge}${c.companyName?` · ${c.companyName}`:''}</small></div></button>${sipBtn(c.phone,{className:'sip-call-sm',customerId:c.id})}<div class="customer-card-balance ${balCls}"><small>Cari</small><strong>${money2(bal)}</strong></div></div>`;
  }).join('');
  qa('#customerPageList [data-customer-id]').forEach(btn=>btn.addEventListener('click',()=>selectCustomerPage(btn.dataset.customerId)));
}
async function loadCustomersPage(){
  const term=String(q('#customerPageSearch')?.value||'').trim();
  try{
    // Satış Merkezi ile aynı kaynak: customers/search (tüm aktif müşteriler)
    const url=term
      ? `/web-api/admin/customers/search?q=${encodeURIComponent(term)}&limit=100`
      : `/web-api/admin/customers/search?list=1&limit=200`;
    const d=await api(url);
    const rows=d.rows||[];
    customersPageData.total=Number(d.total!=null?d.total:rows.length);
    customersPageData.customers=rows;
  }catch(e){
    toast(e.message||'Müşteriler yüklenemedi');
    customersPageData.customers=[];
    customersPageData.total=0;
  }
  renderCustomerPageList();
  if(customersPageData.selectedId&&customersPageData.customers.some(c=>String(c.id)===String(customersPageData.selectedId))){
    await selectCustomerPage(customersPageData.selectedId);
  }else{
    customersPageData.selectedId='';
    q('#customerEmptyState')?.classList.remove('hidden');
    q('#customerDetailContent')?.classList.add('hidden');
  }
}
function customerTxKindLabel(kind=''){
  return({sale:'Mağaza satışı',sale_cancel:'Satış iptali',collection:'Cari tahsilat',collection_cancel:'Tahsilat iptali',payment:'Ödeme',expense:'Gider',reversal:'Ters kayıt'}[kind]||kind||'Hareket');
}
function renderCustomerSaleItems(items=[]){
  if(!items.length)return '<div class="customer-sale-empty">Ürün kalemi yok</div>';
  return `<div class="customer-sale-items">${items.map(i=>{
    const name=i.productName||i.materialCode||i.productCode||'Ürün';
    const code=[i.itemCode,i.productCode].filter(Boolean).join(' · ');
    const qty=Number(i.quantity||1);
    const line=Number(i.total!=null?i.total:(qty*Number(i.unitPrice||0)));
    return `<div class="customer-sale-item"><div><b>${qty}× ${name}</b>${code?`<small>${code}</small>`:''}<small>Birim: ${money2(i.unitPrice||0)}</small></div><strong>${money2(line)}</strong></div>`;
  }).join('')}</div>`;
}
function customerSaleActionButtons(t,{compact=false}={}){
  const kind=String(t.kind||'');
  if(kind!=='sale'||t.cancelled||!t.id)return '';
  const id=String(t.id).replace(/"/g,'&quot;');
  const ref=salesEsc(t.reference||'');
  if(t.needsCompletion||t.rapidDraft){
    const btn=`<button type="button" class="primary" data-sale-complete="${id}">Satışa git / Tamamla</button>`;
    const drop=`<button type="button" data-sale-discard="${id}" data-ref="${ref}">Taslağı sil</button>`;
    return compact?`<div class="customer-sale-actions compact">${btn}${drop}</div>`:`<div class="customer-sale-actions">${btn}${drop}</div>`;
  }
  if(compact){
    return `<div class="customer-sale-actions compact">
      <button type="button" class="secondary-btn" data-sale-edit="${id}">Düzenle</button>
      <button type="button" class="secondary-btn" data-sale-return="${id}" data-ref="${ref}">İade</button>
      <button type="button" data-sale-cancel="${id}" data-ref="${ref}">İptal</button>
    </div>`;
  }
  return `<div class="customer-sale-actions">
    <button type="button" class="secondary-btn" data-sale-edit="${id}">Düzenle / Kısmi İade</button>
    <button type="button" class="secondary-btn" data-sale-return="${id}" data-ref="${ref}">Tam İade</button>
    <button type="button" data-sale-cancel="${id}" data-ref="${ref}">İptal</button>
    <button type="button" class="tx-docs-btn" data-sale-docs="${id}">Belge Yazdır</button>
  </div>`;
}
function bindCustomerSaleActions(root){
  if(!root)return;
  root.querySelectorAll('[data-sale-docs]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const id=btn.dataset.saleDocs;
      if(id)window.open('/web-api/admin/sale/'+encodeURIComponent(id)+'/print-docs','_blank');
    });
  });
  root.querySelectorAll('[data-sale-complete]').forEach(btn=>{
    btn.addEventListener('click',()=>openRapidSaleInSalesCenter(btn.dataset.saleComplete));
  });
  root.querySelectorAll('[data-sale-discard]').forEach(btn=>{
    btn.addEventListener('click',()=>discardRapidDraft(btn.dataset.saleDiscard,btn.dataset.ref||''));
  });
  root.querySelectorAll('[data-sale-edit]').forEach(btn=>{
    btn.addEventListener('click',()=>openSaleEditModal(btn.dataset.saleEdit));
  });
  root.querySelectorAll('[data-sale-return]').forEach(btn=>{
    btn.addEventListener('click',()=>requestCancellation('sale',btn.dataset.saleReturn,btn.dataset.ref||'',{requestKind:'return'}));
  });
  root.querySelectorAll('[data-sale-cancel]').forEach(btn=>{
    btn.addEventListener('click',()=>requestCancellation('sale',btn.dataset.saleCancel,btn.dataset.ref||'',{requestKind:'cancel'}));
  });
}
function renderCustomerSaleCard(t){
  const kind=String(t.kind||'');
  const cancelled=t.cancelled||kind==='sale_cancel';
  const label=customerTxKindLabel(kind);
  const net=Number(t.displayAmount!=null?t.displayAmount:(t.total!=null?t.total:Math.abs(Number(t.customerDelta||0))));
  const gross=Number(t.grossTotal!=null?t.grossTotal:net);
  const disc=Number(t.discountAmount!=null?t.discountAmount:Math.max(0,gross-net));
  const meta=[t.reference,t.salespersonName||t.createdBy,t.paymentMethod,t.dealerName].filter(Boolean).join(' · ');
  const itemCount=(t.items||[]).length;
  return `<article class="customer-sale-card${cancelled?' is-cancelled':''}">
    <div class="customer-tx-sale-head">
      <div><b>${t.date||'-'} · ${label}</b><small>${meta||t.description||''}</small>${itemCount?`<small>${itemCount} kalem</small>`:''}</div>
      <strong class="${kind==='sale_cancel'?'credit':'debt'}">${money2(net)}</strong>
    </div>
    ${renderCustomerSaleItems(t.items||[])}
    <div class="customer-sale-totals">
      <span>Brüt ${money2(gross)}</span>
      ${disc>0?`<span>İskonto %${Number(t.discountPct||0)} (−${money2(disc)})</span>`:''}
      <span><b>Net ${money2(net)}</b></span>
    </div>
    ${customerSaleActionButtons(t)}
  </article>`;
}
function renderCustomerTransaction(t){
  const kind=String(t.kind||'');
  const isSale=kind==='sale'||kind==='sale_cancel';
  const cancelled=t.cancelled||kind.endsWith('_cancel');
  const label=customerTxKindLabel(kind);
  if(isSale){
    const net=Number(t.displayAmount!=null?t.displayAmount:(t.total!=null?t.total:Math.abs(Number(t.customerDelta||0))));
    const summary=t.itemSummary||(t.items||[]).map(i=>`${i.quantity||1}× ${i.productName||i.materialCode||i.productCode||'Ürün'}`).join(', ');
    const meta=[t.reference,t.paymentMethod,summary].filter(Boolean).join(' · ');
    return `<div class="customer-tx customer-tx-sale-compact${cancelled?' is-cancelled':''}"><div><b>${t.date||'-'} · ${label}</b><small>${meta||t.description||'-'}</small>${customerSaleActionButtons(t,{compact:true})}</div><strong class="${kind==='sale_cancel'?'credit':'debt'}">${money2(net)}</strong></div>`;
  }
  const amt=Number(t.displayAmount!=null?t.displayAmount:t.amount||0);
  const cls=amt<0||kind==='collection'||kind==='collection_cancel'?(amt<=0&&kind==='collection'?'credit':(amt<0?'credit':'debt')):(Number(t.customerDelta||0)<0?'credit':'debt');
  const showAmt=kind==='collection'?Math.abs(amt):amt;
  const receipt=kind==='collection'&&t.receiptUrl
    ?`<button type="button" class="tx-receipt-btn" data-receipt-url="${String(t.receiptUrl).replace(/"/g,'&quot;')}">Makbuz Yazdır</button>`
    :'';
  return `<div class="customer-tx${cancelled?' is-cancelled':''}"><div><b>${t.date||'-'} · ${label}</b><small>${[t.reference,t.description,t.accountName,t.category].filter(Boolean).join(' · ')||'-'}</small>${receipt}</div><strong class="${cls}">${money2(showAmt)}</strong></div>`;
}
function customerNoteRemain(n){
  const amt=Number(n.amount||0),paid=Number(n.paidAmount||0);
  return Math.max(0,Math.round((amt-paid)*100)/100);
}
function renderCustomerDebtAndPay(d){
  const c=d.customer||{};
  const notes=(d.promissoryNotes||[]).map(n=>{
    const remain=n.remain!=null?Number(n.remain):customerNoteRemain(n);
    const status=remain<=0.009&&String(n.status)!=='cancelled'?'paid':(String(n.status||'open'));
    const overdue=remain>0.009&&status!=='cancelled'&&String(n.dueDate||'')<localDate();
    return{...n,remain,status,overdue};
  });
  const openNotes=notes.filter(n=>!['paid','cancelled'].includes(String(n.status)));
  const orphanNotes=openNotes.filter(n=>n.orphan||(!n.saleId&&!n.saleReference));
  const overdueAmount=openNotes.filter(n=>n.overdue).reduce((a,n)=>a+n.remain,0);
  const openSenet=openNotes.reduce((a,n)=>a+n.remain,0);
  const month=localDate().slice(0,7);
  const dueMonth=openNotes.filter(n=>String(n.dueDate||'').startsWith(month)).reduce((a,n)=>a+n.remain,0);
  const balance=Number(c.balance||0);
  const debtBox=q('#customerDebtBox');
  if(debtBox){
    debtBox.innerHTML=`
      <article class="${balance>0.009?'bad':''}"><small>Cari borç</small><b>${money2(Math.max(balance,0))}</b></article>
      <article class="${openSenet>0.009?'warn':''}"><small>Açık senet</small><b>${money2(openSenet)}</b></article>
      <article class="${overdueAmount>0.009?'bad':''}"><small>Geciken senet</small><b>${money2(overdueAmount)}</b></article>
      <article class="${dueMonth>0.009?'warn':''}"><small>Bu ay vade</small><b>${money2(dueMonth)}</b></article>`;
  }
  const orphanWarn=q('#customerNotesOrphanWarn');
  if(orphanWarn){
    if(orphanNotes.length){
      const tot=orphanNotes.reduce((a,n)=>a+n.remain,0);
      orphanWarn.classList.remove('hidden');
      orphanWarn.innerHTML=`⚠ ${orphanNotes.length} senet <b>satışa bağlı değil</b> (toplam ${money2(tot)}). Cari bakiyeyi şişirmez ama tahsilat / müşteri ödemelerinde alacak gibi görünür. Hatalıysa satırdan <b>İptal</b> edin.`;
    }else{orphanWarn.classList.add('hidden');orphanWarn.innerHTML=''}
  }
  const tbody=q('#customerNotesList');
  if(tbody){
    tbody.innerHTML=notes.length
      ?notes.map(n=>{
        const open=!['paid','cancelled'].includes(String(n.status));
        const link=n.orphan||(!n.saleId&&!n.saleReference)
          ?`<span class="note-link orphan">Satışa bağlı değil</span>`
          :(n.saleCancelled
            ?`<span class="note-link warn">${salesEsc(n.linkLabel||n.saleReference||'Satış iptal')}</span>`
            :`<span class="note-link">${salesEsc(n.saleReference||n.linkLabel||'—')}</span>`);
        const cancelBtn=open
          ?`<button type="button" class="note-cancel-btn" data-note-cancel="${n.id}" data-ref="${salesEsc(n.serial||'')}">İptal</button>`
          :'';
        return `<tr class="${n.overdue?'pay-note-overdue':''} ${n.status==='paid'?'pay-note-paid':''} ${n.status==='cancelled'?'pay-note-cancelled':''} ${n.orphan?'pay-note-orphan':''}">
          <td>${open?`<input type="checkbox" class="customer-pay-note" value="${n.id}">`:''}</td>
          <td>${salesEsc(n.serial||String(n.id||'').slice(0,8))}</td>
          <td>${link}</td>
          <td>${n.dueDate||'—'}</td>
          <td>${money2(n.amount)}</td>
          <td>${money2(n.remain)}</td>
          <td>${n.status==='cancelled'?'İptal':(n.status==='paid'?'Ödendi':(n.overdue?'Gecikmiş':(n.status==='partial'?'Kısmi':'Açık')))}</td>
          <td>${cancelBtn}</td>
        </tr>`;
      }).join('')
      :'<tr><td colspan="8">Senet / taksit yok. Tahsilat cari bakiyeden düşer.</td></tr>';
    tbody.querySelectorAll('[data-note-cancel]').forEach(btn=>{
      btn.addEventListener('click',()=>cancelCustomerPromissoryNote(btn.dataset.noteCancel,btn.dataset.ref||''));
    });
  }
  const acc=q('#customerPayAccount');
  if(acc){
    const cur=acc.value;
    acc.innerHTML=(d.accounts||[]).map(a=>`<option value="${a.id}">${a.name}</option>`).join('')||'<option value="">Kasa yok</option>';
    if(cur&&[...acc.options].some(o=>o.value===cur))acc.value=cur;
  }
  const suggest=overdueAmount>0.009?overdueAmount:(dueMonth>0.009?dueMonth:(openSenet>0.009?openSenet:Math.max(balance,0)));
  if(q('#customerPayAmount'))q('#customerPayAmount').value=suggest>0?suggest.toFixed(2):'';
  if(q('#customerPayDate')&&!q('#customerPayDate').value)q('#customerPayDate').value=localDate();
  if(q('#customerPayDesc'))q('#customerPayDesc').value='';
  if(q('#customerPayStatus')){q('#customerPayStatus').textContent='';q('#customerPayStatus').className='form-status'}
  if(q('#customerPayReceiptBtn'))q('#customerPayReceiptBtn').classList.add('hidden');
  customersPageData._notes=notes;
  customersPageData._accounts=d.accounts||[];
  customersPageData._lastReceiptUrl='';
  qa('.customer-pay-note').forEach(cb=>{
    cb.onchange=()=>{
      const ids=[...qa('.customer-pay-note:checked')].map(x=>x.value);
      if(!ids.length)return;
      const total=(customersPageData._notes||[]).filter(n=>ids.includes(String(n.id))).reduce((a,n)=>a+Number(n.remain||0),0);
      if(q('#customerPayAmount'))q('#customerPayAmount').value=total.toFixed(2);
    };
  });
}
function cancelCustomerPromissoryNote(noteId,ref=''){
  openReasonModal({
    title:'Senet İptal Sebebi',
    hint:`${ref||'Senet'} iptal edilecek. Satışa bağlı değilse tahsilat listesindeki sahipsiz alacak kalkar. Cari bakiye değişmez.`,
    onSubmit:async(reason)=>{
      try{
        await api('/web-api/admin/promissory-note/'+encodeURIComponent(noteId)+'/cancel',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reason})});
        toast('Senet iptal edildi');
        if(customersPageData.selectedId)await selectCustomerPage(customersPageData.selectedId);
      }catch(e){toast(e.message)}
    }
  });
}
function renderCustomerBillingCards(c={}){
  const box=q('#customerBillingCards');if(!box)return;
  const addr=[c.address,c.district,c.city].filter(Boolean).join(', ')||'-';
  const deliv=c.deliverySameAsBilling!==false?'Teslimat = fatura adresi':([c.deliveryAddress,c.deliveryDistrict,c.deliveryCity].filter(Boolean).join(', ')||'-');
  const hasCorp=customerHasCorporate(c);
  const def=c.invoiceType==='corporate'?'Kurumsal':'Bireysel';
  box.innerHTML=`
    <article class="billing-card person">
      <small>BİREYSEL · SENET / ŞAHIS</small>
      <b>${c.name||'-'}</b>
      <span>Müşteri no: ${c.customerCode||c.rapidCustAccount||'—'}</span>
      <span>TC: ${c.tckn||'—'}${c.birthDate?' · Doğum '+String(c.birthDate).slice(0,10):''}</span>
      <span>${c.phone||'—'}${c.email?' · '+c.email:''}</span>
    </article>
    <article class="billing-card company${hasCorp?'':' empty'}">
      <small>KURUMSAL · FATURA FİRMASI</small>
      <b>${hasCorp?(c.companyName||'-'):'Firma bilgisi yok'}</b>
      <span>${hasCorp?`Vergi no: ${c.taxNo||'—'} · ${c.taxOffice||'—'}`:'Şahsa senet / firmaya fatura için ekleyin'}</span>
      <span>${hasCorp&&(c.companyAddress||c.companyDistrict||c.companyCity)?[c.companyAddress,c.companyDistrict,c.companyCity].filter(Boolean).join(', '):'Varsayılan fatura: '+def}</span>
    </article>
    <article class="billing-card address">
      <small>EV ADRES</small>
      <b>${addr}</b>
      <span>${deliv}</span>
      ${c.note?`<span>Not: ${c.note}</span>`:''}
    </article>`;
}
function commWhen(iso){
  const d=new Date(iso||'');
  if(!Number.isFinite(d.getTime()))return String(iso||'');
  const p=n=>String(n).padStart(2,'0');
  return `${p(d.getDate())}.${p(d.getMonth()+1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function commResultLabel(row){
  if(row.kind==='sms')return row.result==='failed'?'SMS gönderilemedi':'SMS gönderildi';
  return({started:'Arama başlatıldı',no_answer:'Ulaşılamadı',reached:'Görüşüldü',busy:'Meşgul',voicemail:'Sesli mesaj'}[row.result]||row.result||'Arama');
}
function renderCustomerComms(rows){
  const list=q('#customerCommsList'),count=q('#customerCommsCount');
  const items=Array.isArray(rows)?rows:[];
  customersPageData._comms=items;
  if(count)count.textContent=items.length?`${items.length} kayıt`:'kayıt yok';
  if(!list)return;
  if(!items.length){
    list.innerHTML='<div class="note" style="padding:12px 0">Henüz arama / SMS kaydı yok. Ara ve kaydet veya SMS gönderin.</div>';
    return;
  }
  list.innerHTML=items.map(r=>{
    const who=salesEsc(r.actor||'—');
    const when=commWhen(r.at);
    const phone=salesEsc(r.phone||'');
    const note=r.note?`<small>${salesEsc(r.note)}</small>`:'';
    const msg=r.message?`<div class="msg">${salesEsc(r.message)}</div>`:'';
    const extra=r.kind==='sms'&&r.provider?`<small>${r.manual?'Elle kayıt':salesEsc(r.provider)}</small>`:'';
    return `<article class="customer-comms-item"><div><b>${commResultLabel(r)}</b><small>${when} · ${who}${phone?' · '+phone:''}</small>${note}${extra}${msg}</div><button type="button" class="customer-comms-del" data-comm-del="${salesEsc(r.id)}">Sil</button></article>`;
  }).join('');
}
function syncCustomerCallLinks(c={}){
  const href=typeof sipHref==='function'?sipHref(c.phone):'';
  ['#customerDetailCallBtn','#customerCommsCallBtn'].forEach(sel=>{
    const el=q(sel);if(!el)return;
    el.setAttribute('data-customer-id',c.id||'');
    if(href){el.href=href;el.classList.remove('is-off');el.removeAttribute('aria-disabled')}
    else{el.href='#';el.classList.add('is-off');el.setAttribute('aria-disabled','true')}
  });
}
async function postCustomerComm(payload){
  const c=customersPageData._selected;
  if(!c?.id){toast('Önce müşteri seçin');return null}
  const d=await api('/web-api/admin/customer/'+encodeURIComponent(c.id)+'/comm',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(payload)
  });
  renderCustomerComms(d.comms||[]);
  return d;
}
window.atakOnSipCall=function(info){
  const id=info?.customerId||customersPageData.selectedId||customersPageData._selected?.id||'';
  if(!id)return;
  const phone=String(info?.href||'').replace(/^sip:/i,'');
  const note=q('#customerCommNote')?.value||'';
  fetch('/web-api/admin/customer/'+encodeURIComponent(id)+'/comm',{
    method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({kind:'call',result:'started',phone,note})
  }).then(r=>r.json()).then(d=>{
    if(String(id)===String(customersPageData._selected?.id))renderCustomerComms(d.comms||[]);
  }).catch(()=>{});
};
function printCustomerComms(){
  const c=customersPageData._selected;
  const rows=customersPageData._comms||[];
  if(!c){toast('Önce müşteri seçin');return}
  const body=rows.length?rows.map(r=>`<tr><td>${commWhen(r.at)}</td><td>${commResultLabel(r)}</td><td>${salesEsc(r.actor||'')}</td><td>${salesEsc(r.phone||'')}</td><td>${salesEsc(r.note||r.message||'')}</td></tr>`).join('')
    :'<tr><td colspan="5">Kayıt yok</td></tr>';
  const w=window.open('','_blank');
  if(!w){toast('Yazdırma penceresi engellendi');return}
  w.document.write(`<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>İletişim kayıtları · ${salesEsc(c.name||'')}</title>
  <style>body{font-family:Segoe UI,Arial,sans-serif;padding:24px;color:#123}h1{font-size:18px;margin:0 0 6px}p{margin:0 0 14px;color:#456}
  table{width:100%;border-collapse:collapse;font-size:13px}th,td{border:1px solid #ccd;padding:8px;text-align:left;vertical-align:top}th{background:#f3f6fa}</style></head><body>
  <h1>ATAK EV GEREÇLERİ · Müşteri iletişim kayıtları</h1>
  <p><b>${salesEsc(c.name||'')}</b> · ${salesEsc(c.phone||'')} · ${new Date().toLocaleString('tr-TR')}</p>
  <table><thead><tr><th>Tarih / saat</th><th>İşlem</th><th>Personel</th><th>Telefon</th><th>Not / SMS</th></tr></thead><tbody>${body}</tbody></table>
  </body></html>`);
  w.document.close();
  w.focus();
  w.print();
}
async function selectCustomerPage(id){
  customersPageData.selectedId=id;
  renderCustomerPageList();
  const empty=q('#customerEmptyState'),content=q('#customerDetailContent');
  try{
    const d=await api('/web-api/admin/customer-detail/'+encodeURIComponent(id));
    const c=d.customer||{};
    empty?.classList.add('hidden');content?.classList.remove('hidden');
    if(q('#customerDetailName'))q('#customerDetailName').textContent=c.name||'-';
    if(q('#customerDetailCode'))q('#customerDetailCode').textContent=c.customerCode||c.rapidCustAccount?`Kod: ${c.customerCode||c.rapidCustAccount}`:'';
    if(q('#customerDetailPhone'))q('#customerDetailPhone').textContent=[c.phone,c.email].filter(Boolean).join(' · ')||'-';
    customersPageData._selected=c;
    syncCustomerCallLinks(c);
    renderCustomerComms(d.comms||[]);
    if(q('#customerCommNote'))q('#customerCommNote').value='';
    if(q('#customerDetailStatus')){
      const bits=[];
      if(c.active===false)bits.push('Pasif');else bits.push('Aktif');
      if(customerHasCorporate(c))bits.push('Şahıs+Firma');
      else bits.push('Bireysel');
      if(c.invoiceType==='corporate')bits.push('Fatura: Kurumsal');
      q('#customerDetailStatus').textContent=bits.join(' · ');
    }
    if(q('#customerDetailBalance'))q('#customerDetailBalance').textContent=money2(c.balance);
    renderCustomerBillingCards(c);
    renderCustomerDebtAndPay(d);
    const tx=d.transactions||[];
    const sales=tx.filter(t=>t.kind==='sale'||t.kind==='sale_cancel');
    const activeSales=sales.filter(t=>t.kind==='sale'&&!t.cancelled);
    const salesTotal=activeSales.reduce((a,t)=>a+Number(t.displayAmount!=null?t.displayAmount:t.total||0),0);
    if(q('#customerSalesCount'))q('#customerSalesCount').textContent=activeSales.length?`${activeSales.length} alışveriş · ${money2(salesTotal)}`:(sales.length?`${sales.length} kayıt`:'0 alışveriş');
    const salesList=q('#customerSalesList');
    if(salesList){
      salesList.innerHTML=sales.length
        ?sales.slice(0,50).map(renderCustomerSaleCard).join('')
        :'<div class="note">Bu müşterinin henüz alışverişi yok.</div>';
      bindCustomerSaleActions(salesList);
    }
    if(q('#customerTransactionCount'))q('#customerTransactionCount').textContent=`${tx.length} hareket · ${activeSales.length} satış`;
    const list=q('#customerTransactionList');
    if(list){
      const banners=[];
      if(d.pendingDelete)banners.push(`<div class="customer-pending-banner danger">Bekleyen silme onayı var · ${salesEsc(d.pendingDelete.requestedByName||'Personel')} · ${String(d.pendingDelete.requestedAt||'').replace('T',' ').slice(0,16)} · ${salesEsc(d.pendingDelete.reason||'')}</div>`);
      if(d.pendingEdit)banners.push(`<div class="customer-pending-banner">Bekleyen düzenleme onayı var · ${salesEsc(d.pendingEdit.requestedByName||'Personel')} · ${String(d.pendingEdit.requestedAt||'').replace('T',' ').slice(0,16)}</div>`);
      list.innerHTML=banners.join('')+(tx.length?tx.slice(0,80).map(renderCustomerTransaction).join(''):'<div class="note">Henüz cari hareket yok.</div>');
      bindCustomerSaleActions(list);
      list.querySelectorAll('[data-receipt-url]').forEach(btn=>{
        btn.addEventListener('click',()=>{
          const url=btn.dataset.receiptUrl;
          if(url)window.open(url+(url.includes('?')?'&':'?')+'size=a5&autoprint=1','_blank');
        });
      });
    }
    customersPageData._selected=c;
    customersPageData._canManage=Boolean(d.canManage);
    customersPageData._pendingDelete=d.pendingDelete||null;
    customersPageData._smsType='';
    q('#customerSmsPanel')?.classList.add('hidden');
    if(q('#customerSmsStatus')){q('#customerSmsStatus').textContent='';q('#customerSmsStatus').className='form-status'}
    const delBtn=q('[data-customer-action="delete"]');
    if(delBtn){
      delBtn.disabled=Boolean(d.pendingDelete)||c.active===false;
      delBtn.textContent=d.pendingDelete?'🗑 Silme onayı bekliyor':'🗑 Sil (Onaya)';
    }
  }catch(e){toast(e.message);empty?.classList.remove('hidden');content?.classList.add('hidden')}
}
async function openCustomerSmsPanel(type){
  const c=customersPageData._selected;
  if(!c?.id){toast('Önce müşteri seçin');return}
  customersPageData._smsType=type==='overdue'?'overdue':'custom';
  const panel=q('#customerSmsPanel');
  panel?.classList.remove('hidden');
  if(q('#customerSmsTitle'))q('#customerSmsTitle').textContent=type==='overdue'?'Gecikme SMS':'Özel SMS';
  if(q('#customerSmsHint'))q('#customerSmsHint').textContent=type==='overdue'
    ?'Geciken senet / cari borca göre şablon doldurulur. İsterseniz metni düzenleyip gönderin.'
    :'Serbest metin yazın; bağlı SMS firması üzerinden gider.';
  if(q('#customerSmsPhone'))q('#customerSmsPhone').value=c.phone||'';
  if(q('#customerSmsStatus')){q('#customerSmsStatus').textContent='';q('#customerSmsStatus').className='form-status'}
  if(type==='overdue'){
    try{
      const p=await api('/web-api/admin/customer/'+encodeURIComponent(c.id)+'/sms',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({type:'overdue',preview:true,phone:q('#customerSmsPhone')?.value||c.phone||''})
      });
      if(q('#customerSmsMessage'))q('#customerSmsMessage').value=p.message||'';
      if(q('#customerSmsStatus')){
        q('#customerSmsStatus').textContent=p.configured
          ?`Önizleme hazır · geciken ${money2(p.overdueAmount||0)} · cari ${money2(p.balance||0)}`
          :'SMS ayarı eksik — Ayarlar → SMS';
        q('#customerSmsStatus').className='form-status '+(p.configured?'success':'error');
      }
    }catch(err){
      if(q('#customerSmsMessage'))q('#customerSmsMessage').value='';
      if(q('#customerSmsStatus')){q('#customerSmsStatus').textContent=err.message;q('#customerSmsStatus').className='form-status error'}
      toast(err.message);
    }
  }else if(q('#customerSmsMessage')){
    q('#customerSmsMessage').value='';
    q('#customerSmsMessage').focus();
  }
  panel?.scrollIntoView({behavior:'smooth',block:'nearest'});
}
async function sendCustomerSmsFromPanel(){
  const c=customersPageData._selected;
  const st=q('#customerSmsStatus');
  if(!c?.id){toast('Önce müşteri seçin');return}
  const type=customersPageData._smsType==='overdue'?'overdue':'custom';
  const phone=q('#customerSmsPhone')?.value||c.phone||'';
  const message=q('#customerSmsMessage')?.value||'';
  try{
    const r=await api('/web-api/admin/customer/'+encodeURIComponent(c.id)+'/sms',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({type,phone,message})
    });
    if(st){st.textContent=`SMS gönderildi → ${r.to}`;st.className='form-status success'}
    toast('SMS gönderildi');
    await selectCustomerPage(c.id);
  }catch(err){
    if(st){st.textContent=err.message;st.className='form-status error'}
    toast(err.message||'SMS gönderilemedi');
  }
}
q('#newCustomerBtn')?.addEventListener('click',()=>openCustomerModal(null));
q('#customerExcelBtn')?.addEventListener('click',()=>{
  q('#customerExcelModal')?.classList.remove('hidden');
  if(q('#customerExcelStatus')){q('#customerExcelStatus').textContent='Excel seçin, sonra Önizle.';q('#customerExcelStatus').className='form-status'}
});
q('#customerExcelClose')?.addEventListener('click',()=>q('#customerExcelModal')?.classList.add('hidden'));
function customerExcelEsc(s){return String(s??'').replace(/[&<>"']/g,c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]))}
function selectedCustomerExcelFile(){return q('#customerExcelFile')?.files?.[0]||window.__customerExcelFile||null}
function setCustomerExcelFile(file){
  window.__customerExcelFile=file||null;
  if(q('#customerExcelFileName'))q('#customerExcelFileName').textContent=file?`${file.name} · ${Math.max(1,Math.round((file.size||0)/1024))} KB`:'Dosya seçilmedi';
  if(q('#customerExcelImportBtn'))q('#customerExcelImportBtn').disabled=true;
}
function renderCustomerExcelPreview(d){
  const c=d.counts||{};
  if(q('#customerExcelSummary'))q('#customerExcelSummary').innerHTML=
    `<article><b>${c.ready||0}</b><span>Yeni</span></article>
     <article><b>${c.corporate||0}</b><span>Kurumsal</span></article>
     <article><b>${c.individual||0}</b><span>Bireysel</span></article>
     <article><b>${c.update||0}</b><span>Düzeltilecek</span></article>
     <article><b>${c.existing||0}</b><span>Kayıtlı</span></article>
     <article><b>${(c.noPhone||0)+(c.shortPhone||0)}</b><span>Telefonsuz</span></article>`;
  const map=d.mapping||{};
  const mapTxt=Object.entries(map).map(([k,v])=>`${k} ← ${v}`).join(' · ');
  if(q('#customerExcelMap'))q('#customerExcelMap').textContent=
    `Başlık satır ${d.headerRow||'-'}${d.sheet?` · sayfa ${d.sheet}`:''}${mapTxt?` · ${mapTxt}`:''}`;
  const label={ready:'Yeni',update:'Güncellenecek',existing:'Kayıtlı',skip_noname:'Ünvan yok',skip_short:'7 hane atlandı',skip_nophone:'Telefonsuz',skip_dupfile:'Dosyada tekrar'};
  const rows=d.preview||[];
  if(q('#customerExcelPreview'))q('#customerExcelPreview').innerHTML=rows.map(r=>{
    const fatura=(r.companyName||r.taxNo)&&(r.tckn||r.name)?'Şahıs+Firma':(r.invoiceType==='corporate'||r.companyName||r.taxNo)?'Kurumsal':'Bireysel';
    const ids=[r.companyName||'',r.taxNo?`VKN ${r.taxNo}`:'',r.tckn?`TC ${r.tckn}`:''].filter(Boolean).join(' · ')||'—';
    const phoneTxt=r.phone||r.rawPhone||'-';
    return `<tr>
      <td>${customerExcelEsc(label[r.status]||r.status)}${r.reason?`<small>${customerExcelEsc(r.reason)}</small>`:''}</td>
      <td><b>${customerExcelEsc(r.name||'-')}</b></td>
      <td>${customerExcelEsc(phoneTxt)}</td>
      <td>${fatura}</td>
      <td>${customerExcelEsc(ids)}</td>
      <td>${customerExcelEsc([r.district,r.city].filter(Boolean).join(' / ')||'-')}</td>
    </tr>`;
  }).join('')||'<tr><td colspan="6">Önizlemede satır yok</td></tr>';
  const btn=q('#customerExcelImportBtn');
  if(btn)btn.disabled=!(c.ready>0||c.update>0);
  q('#customerExcelModal')?.classList.remove('hidden');
}
async function previewCustomerExcelFile(file){
  const st=q('#customerExcelStatus');
  const chosen=file||selectedCustomerExcelFile();
  if(!chosen){
    if(st){st.textContent='Önce Excel seçin.';st.className='form-status error'}
    return;
  }
  setCustomerExcelFile(chosen);
  const fd=new FormData();fd.append('file',chosen);
  if(st){st.textContent=`${chosen.name} okunuyor…`;st.className='form-status'}
  if(q('#customerExcelPreview'))q('#customerExcelPreview').innerHTML='<tr><td colspan="6">Okunuyor…</td></tr>';
  try{
    const d=await api('/web-api/admin/customers-excel-preview',{method:'POST',body:fd});
    window.__customerExcelJobId=d.jobId||'';
    window.__customerExcelOffset=0;
    renderCustomerExcelPreview(d);
    if(st){
      const ready=Number(d.counts?.ready||0);
      st.textContent=ready>0
        ?`Önizleme hazır: ${ready} yeni müşteri aktarılabilir. Aktar’a basın.`
        :`Dosya okundu ama yeni aktarılacak satır yok. Kayıtlı ${d.counts?.existing||0} · telefonsuz ${d.counts?.noPhone||0} · 7 hane ${d.counts?.shortPhone||0}. ${d.error||d.note||''}`.trim();
      st.className=ready>0?'form-status success':'form-status';
    }
  }catch(err){
    if(q('#customerExcelPreview'))q('#customerExcelPreview').innerHTML=`<tr><td colspan="6">${customerExcelEsc(err.message||'Excel okunamadı')}</td></tr>`;
    if(st){st.textContent=err.message||'Excel okunamadı';st.className='form-status error'}
    if(q('#customerExcelImportBtn'))q('#customerExcelImportBtn').disabled=true;
    q('#customerExcelModal')?.classList.remove('hidden');
  }
}
q('#customerExcelFile')?.addEventListener('change',()=>{
  const file=q('#customerExcelFile')?.files?.[0];
  setCustomerExcelFile(file||null);
  if(file)previewCustomerExcelFile(file);
});
q('#customerExcelPreviewBtn')?.addEventListener('click',()=>previewCustomerExcelFile());
(()=>{
  const drop=q('#customerExcelDrop');
  if(!drop)return;
  drop.addEventListener('dragover',e=>{e.preventDefault();drop.classList.add('drag')});
  drop.addEventListener('dragleave',()=>drop.classList.remove('drag'));
  drop.addEventListener('drop',e=>{
    e.preventDefault();drop.classList.remove('drag');
    const file=e.dataTransfer?.files?.[0];
    if(!file)return;
    const input=q('#customerExcelFile');
    if(input){
      try{
        const dt=new DataTransfer();
        dt.items.add(file);
        input.files=dt.files;
      }catch(_){}
    }
    setCustomerExcelFile(file);
    previewCustomerExcelFile(file);
  });
})();
q('#customerExcelImportBtn')?.addEventListener('click',async()=>{
  const file=selectedCustomerExcelFile();
  const st=q('#customerExcelStatus');
  if(!file&&!window.__customerExcelJobId){if(st){st.textContent='Önce Excel seçip Önizle’ye basın.';st.className='form-status error'}return}
  if(st){st.textContent='Aktarılıyor…';st.className='form-status'}
  const btn=q('#customerExcelImportBtn');if(btn)btn.disabled=true;
  try{
    let jobId=window.__customerExcelJobId||'';
    let offset=Number(window.__customerExcelOffset||0)||0;
    let last=null;
    while(true){
      const fd=new FormData();
      if(jobId)fd.append('jobId',jobId);
      else if(file)fd.append('file',file);
      fd.append('offset',String(offset));
      last=await api('/web-api/admin/customers-excel-import',{method:'POST',body:fd});
      jobId=last.jobId||jobId;
      window.__customerExcelJobId=jobId;
      offset=Number(last.nextOffset||offset);
      window.__customerExcelOffset=offset;
      const total=Number(last.totalReady||0);
      if(st)st.textContent=last.done
        ?`Aktarıldı: ${last.imported||0} yeni · ${last.updated||0} düzeltildi · ${last.existing||0} kayıtlı · ${last.noPhone||0} telefonsuz`
        :`Aktarılıyor… ${last.imported||0} yeni / ${last.updated||0} düzeltildi / ${total||'?'}`;
      if(last.done)break;
    }
    window.__customerExcelOffset=0;
    window.__customerExcelJobId='';
    const extra=(last.errors||[]).length?` · ${last.errors.slice(0,3).join(' | ')}`:'';
    if(st){st.textContent=`Aktarıldı: ${last.imported||0} yeni · ${last.updated||0} düzeltildi · ${last.existing||0} kayıtlı · ${last.noPhone||0} telefonsuz · ${last.shortPhone||0} yedi haneli${extra}`;st.className='form-status success'}
    toast(`${last.imported||0} müşteri aktarıldı`);
    await loadCustomersPage().catch(()=>{});
  }catch(err){
    if(st){st.textContent=err.message||'Aktarılamadı';st.className='form-status error'}
    if(btn)btn.disabled=false;
  }
});
q('#customerModalClose')?.addEventListener('click',()=>q('#customerModal')?.classList.add('hidden'));
q('#customerPageSearch')?.addEventListener('input',()=>{clearTimeout(window.__custSearchT);window.__custSearchT=setTimeout(()=>loadCustomersPage().catch(e=>toast(e.message)),140)});
q('#customerPageDeliverySame')?.addEventListener('change',()=>syncCustomerFormUI('customerPage'));
document.querySelectorAll('input[name="customerPageInvoiceType"]').forEach(r=>r.addEventListener('change',()=>onCustomerInvoiceTypeChange('customerPage')));
['customerPage','salesQuickCustomer'].forEach(bindVknLookup);
document.querySelectorAll('[data-vkn-lookup]').forEach(btn=>{
  btn.addEventListener('click',()=>lookupVkn(btn.dataset.vknLookup,{force:true}));
});
document.addEventListener('click',e=>{
  const edit=e.target.closest('[data-customer-action="edit"]');
  if(edit){e.preventDefault();if(customersPageData._selected)openCustomerModal(customersPageData._selected)}
  const pay=e.target.closest('[data-customer-action="pay"]');
  if(pay){
    e.preventDefault();
    q('#customerPayPanel')?.scrollIntoView({behavior:'smooth',block:'start'});
    q('#customerPayAmount')?.focus();
  }
  const sale=e.target.closest('[data-customer-action="sale"]');
  if(sale){
    e.preventDefault();
    const c=customersPageData._selected;
    goTab('salesCenter');
    if(c?.id){
      setTimeout(()=>{
        if(q('#salesCustomerSelect')){
          // satış merkezi müşteri listesine ekle/seç
          const opt=[...q('#salesCustomerSelect').options].find(o=>String(o.value)===String(c.id));
          if(!opt){
            const o=document.createElement('option');
            o.value=c.id;o.textContent=c.name||c.id;
            q('#salesCustomerSelect').appendChild(o);
          }
          q('#salesCustomerSelect').value=c.id;
          q('#salesCustomerSelect').dispatchEvent(new Event('change'));
        }
      },80);
    }
  }
  const smsOver=e.target.closest('[data-customer-action="sms-overdue"]');
  if(smsOver){e.preventDefault();openCustomerSmsPanel('overdue');return}
  const smsCust=e.target.closest('[data-customer-action="sms-custom"]');
  if(smsCust){e.preventDefault();openCustomerSmsPanel('custom');return}
  const del=e.target.closest('[data-customer-action="delete"]');
  if(del){
    e.preventDefault();
    requestCustomerDelete();
  }
  const goCust=e.target.closest('#openCustomersPage');
  if(goCust){e.preventDefault();goTab('customersPage')}
});
q('#customerSmsClose')?.addEventListener('click',()=>q('#customerSmsPanel')?.classList.add('hidden'));
q('#customerSmsSendBtn')?.addEventListener('click',()=>sendCustomerSmsFromPanel());
q('#customerSmsPreviewBtn')?.addEventListener('click',()=>{
  if(customersPageData._smsType==='overdue')openCustomerSmsPanel('overdue');
  else toast('Özel SMS’de metni yazıp Gönder’e basın');
});
document.addEventListener('click',e=>{
  const resBtn=e.target.closest('[data-comm-result]');
  if(resBtn){
    e.preventDefault();
    const result=resBtn.getAttribute('data-comm-result');
    const note=q('#customerCommNote')?.value||'';
    postCustomerComm({kind:'call',result,note,phone:customersPageData._selected?.phone||''})
      .then(()=>toast(result==='no_answer'?'Ulaşılamadı kaydedildi':(result==='reached'?'Görüşüldü kaydedildi':'Kayıt alındı')))
      .catch(err=>toast(err.message||'Kayıt yazılamadı'));
  }
});
q('#customerCommsPrintBtn')?.addEventListener('click',()=>printCustomerComms());
document.addEventListener('click',e=>{
  const del=e.target.closest('[data-comm-del]');
  if(del){
    e.preventDefault();
    const commId=del.getAttribute('data-comm-del');
    const c=customersPageData._selected;
    if(!c?.id||!commId)return;
    if(!confirm('Bu kayıt silinsin mi? (deneme veya yanlış işaret)'))return;
    api('/web-api/admin/customer/'+encodeURIComponent(c.id)+'/comm/'+encodeURIComponent(commId),{method:'DELETE'})
      .then(d=>{renderCustomerComms(d.comms||[]);toast('Kayıt silindi')})
      .catch(err=>toast(err.message||'Silinemedi'));
  }
  const smsBtn=e.target.closest('[data-comm-sms]');
  if(smsBtn){
    e.preventDefault();
    const type=smsBtn.getAttribute('data-comm-sms');
    const c=customersPageData._selected;
    if(!c?.id){toast('Önce müşteri seçin');return}
    const label=type==='missed'?'Ulaşılamadı hazır SMS':'Gecikme hazır SMS';
    if(!confirm(label+' gönderilsin mi?'))return;
    api('/web-api/admin/customer/'+encodeURIComponent(c.id)+'/sms',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({type,phone:c.phone||''})
    }).then(async r=>{
      toast((type==='missed'?'Ulaşılamadı SMS':'Gecikme SMS')+' gönderildi → '+(r.to||''));
      await selectCustomerPage(c.id);
    }).catch(err=>toast(err.message||'SMS gönderilemedi'));
  }
});
q('#customerDetailPayForm')?.addEventListener('submit',async e=>{
  e.preventDefault();
  const st=q('#customerPayStatus');
  const customerId=customersPageData.selectedId||customersPageData._selected?.id;
  if(!customerId){st.textContent='Önce müşteri seçin';st.className='form-status error';return}
  const amount=Number(q('#customerPayAmount')?.value||0);
  const accountId=q('#customerPayAccount')?.value||'';
  if(!(amount>0)||!accountId){st.textContent='Tutar ve kasa zorunlu';st.className='form-status error';return}
  const noteIds=[...qa('.customer-pay-note:checked')].map(x=>x.value);
  st.textContent='Kaydediliyor…';st.className='form-status';
  try{
    const d=await api('/web-api/admin/customer-collection',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        customerId,
        amount,
        accountId,
        paymentMethod:q('#customerPayMethod')?.value||'Nakit',
        date:q('#customerPayDate')?.value||localDate(),
        description:q('#customerPayDesc')?.value?.trim()||'Müşteri kartı tahsilatı',
        noteIds
      })
    });
    st.textContent=`Tahsilat alındı · kalan cari ${money2(d.balance)}`;
    st.className='form-status success';
    toast('Tahsilat kaydedildi');
    customersPageData._lastReceiptUrl=d.receiptUrl||'';
    const rb=q('#customerPayReceiptBtn');
    if(rb&&d.receiptUrl){
      rb.classList.remove('hidden');
      rb.onclick=()=>window.open(d.receiptUrl+(d.receiptUrl.includes('?')?'&':'?')+'autoprint=1','_blank');
    }
    if(d.receiptUrl)window.open(d.receiptUrl+(d.receiptUrl.includes('?')?'&':'?')+'autoprint=1','_blank');
    await loadCustomersPage().catch(()=>{});
    await selectCustomerPage(customerId);
  }catch(err){
    st.textContent=err.message;st.className='form-status error';
  }
});
q('#customerPayReceiptBtn')?.addEventListener('click',()=>{
  const url=customersPageData._lastReceiptUrl;
  if(url)window.open(url+(url.includes('?')?'&':'?')+'autoprint=1','_blank');
  else toast('Önce tahsilat yapın');
});
async function requestCustomerDelete(){
  const c=customersPageData._selected;
  if(!c?.id){toast('Önce müşteri seçin');return}
  if(customersPageData._pendingDelete){toast('Bu müşteri için zaten bekleyen silme onayı var');return}
  if(c.active===false){toast('Müşteri zaten pasif');return}
  const bal=Number(c.balance||0);
  const balNote=Math.abs(bal)>0.009?`\nGüncel cari: ${money2(bal)}`:'';
  const reason=prompt(`“${c.name||'Müşteri'}” silme talebi yönetici onayına gidecek.${balNote}\n\nSilme sebebini yazın:`,'Müşteri kaydı silinsin');
  if(reason===null)return;
  const clean=String(reason||'').trim();
  if(clean.length<3){toast('Silme sebebi en az 3 karakter olmalı');return}
  if(!confirm(`Silme talebi yöneticiye gönderilsin mi?\n\nMüşteri: ${c.name||'-'}\nSebep: ${clean}`))return;
  try{
    await api('/web-api/admin/customer/'+encodeURIComponent(c.id)+'/delete-request',{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reason:clean})
    });
    toast('Silme talebi yönetici onayına gönderildi');
    await selectCustomerPage(c.id);
    await loadApprovals().catch(()=>{});
  }catch(err){toast(err.message||'Talep gönderilemedi')}
}
q('#customerPageSaveBtn')?.addEventListener('click',async()=>{
  const st=q('#customerPageStatus');
  try{
    const payload=collectCustomerPayload('customerPage',{requireActive:true});
    const isEdit=Boolean(payload.id);
    if(isEdit&&!customersPageData._canManage){
      const reason=prompt('Düzenleme sebebi (yönetici onayına gidecek):','Müşteri bilgisi güncelleme');
      if(reason===null)return;
      payload.reason=String(reason||'').trim()||'Müşteri bilgisi güncelleme';
    }
    st.textContent=isEdit?'Onaya / kayda gönderiliyor...':'Kaydediliyor...';st.className='form-status';
    const r=await api('/web-api/admin/customer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    q('#customerModal')?.classList.add('hidden');
    if(r.pendingApproval){
      st.textContent='Düzenleme yönetici onayına gönderildi.';st.className='form-status success';
      toast('Müşteri düzenlemesi yönetici onayına gönderildi');
      await loadCustomersPage();
      if(payload.id)await selectCustomerPage(payload.id);
      await loadApprovals().catch(()=>{});
      return;
    }
    st.textContent=r.reused?'Bu ad soyad kayıtlıydı, mevcut müşteri güncellendi.':'Müşteri kaydedildi.';st.className='form-status success';
    toast(r.reused?'Bu ad soyad zaten vardı, tek kayıt kullanıldı':'Müşteri kaydedildi');
    await loadCustomersPage();
    if(r.row?.id)await selectCustomerPage(r.row.id);
  }catch(err){st.textContent=err.message;st.className='form-status error'}
});

let salesCenterData={customers:[],accounts:[],products:[],categories:[],warehouses:[],stocks:[],dealerSettings:[],salespeople:[],currentUser:null,canManage:false,customerTotal:0,_customerFallback:[]};
function filterCustomersLocal(list,term){
  const q=String(term||'').trim().toLocaleLowerCase('tr-TR');
  if(!q)return [];
  const digits=q.replace(/\D+/g,'');
  return (list||[]).filter(c=>{
    const hay=`${c.name||''} ${c.phone||''} ${c.taxNo||''} ${c.tckn||''} ${c.companyName||''} ${c.email||''} ${c.customerCode||''} ${c.rapidCustAccount||''}`.toLocaleLowerCase('tr-TR');
    if(hay.includes(q))return true;
    if(digits.length>=3){
      const phoneDigits=String(c.phone||'').replace(/\D+/g,'');
      const taxDigits=`${c.taxNo||''}${c.tckn||''}`.replace(/\D+/g,'');
      if(phoneDigits.includes(digits)||taxDigits.includes(digits))return true;
    }
    return false;
  }).slice(0,50);
}
async function loadSalesCustomersFallback(){
  // 1) finance-center (tam müşteri)  2) sales-catalog  3) store.json
  const bags=[];
  try{
    const fin=await api('/web-api/admin/finance-center');
    if(Array.isArray(fin.customers)&&fin.customers.length)bags.push(fin.customers);
    if(fin.customerTotal!=null)salesCenterData.customerTotal=Number(fin.customerTotal);
    if(Array.isArray(fin.accounts)&&fin.accounts.length)salesCenterData.accounts=fin.accounts;
  }catch(_){}
  try{
    const cat=await api('/web-api/admin/sales-catalog');
    if(Array.isArray(cat.customers)&&cat.customers.length)bags.push(cat.customers);
    if(!salesCenterData.customerTotal && cat.customerTotal!=null)salesCenterData.customerTotal=Number(cat.customerTotal);
    if(!salesCenterData.accounts?.length && Array.isArray(cat.accounts))salesCenterData.accounts=cat.accounts;
  }catch(_){}
  if(!bags.length){
    try{
      const st=await api('/web-api/admin/store');
      const rows=(st.customers||[]).filter(c=>c.active!==false);
      if(rows.length)bags.push(rows);
      if(!salesCenterData.customerTotal)salesCenterData.customerTotal=rows.length;
    }catch(_){}
  }
  const map=new Map();
  bags.flat().forEach(c=>{if(c&&c.id!=null)map.set(String(c.id),c)});
  const list=[...map.values()].sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'tr'));
  salesCenterData._customerFallback=list;
  salesCenterData.customers=list.slice(0,500);
  if(!salesCenterData.customerTotal)salesCenterData.customerTotal=list.length;
  return list;
}
function salesFillCustomerSelect(list,current=''){
  const rows=list||[];
  if(!q('#salesCustomerSelect'))return;
  if(rows.length && rows.length<=500){
    q('#salesCustomerSelect').innerHTML='<option value="">Müşteri seçin</option>'+
      rows.map(c=>`<option value="${c.id}">${customerOptionLabel(c)}</option>`).join('');
  }else if(rows.length){
    q('#salesCustomerSelect').innerHTML='<option value="">Önce arayın, sonra seçin</option>';
  }else{
    q('#salesCustomerSelect').innerHTML='<option value="">Müşteri yok — yeni ekleyin</option>';
  }
  if(current && rows.some(c=>String(c.id)===String(current)))q('#salesCustomerSelect').value=current;
  if(q('#salesCustomerCount'))q('#salesCustomerCount').textContent=(salesCenterData.customerTotal||rows.length||0)+' kayıt';
  if(q('#salesCustomerSearchHint'))q('#salesCustomerSearchHint').textContent=
    rows.length?`Toplam ${salesCenterData.customerTotal||rows.length} müşteri. Listeden seçin veya yazarak süzün.`
    :'Müşteri bulunamadı. Önce Müşteriler’den ekleyin.';
}
async function loadSalesCenter(){
  try{
    // Müşterileri ÖNCE yükle (customers/search eski sunucuda 302)
    const customersPromise=loadSalesCustomersFallback();
    const [cat,stock,people,list]=await Promise.all([
      api('/web-api/admin/sales-catalog').catch(()=>({products:[],categories:[],dealerSettings:[],accounts:[]})),
      api('/web-api/admin/stock-center').catch(()=>({warehouses:[],stocks:[]})),
      api('/web-api/admin/salespeople').catch(()=>({rows:[],currentUser:null,canManage:false})),
      customersPromise
    ]);
    salesCenterData.products=cat.products||[];
    salesCenterData.categories=cat.categories||[];
    salesCenterData.dealerSettings=cat.dealerSettings||[];
    const catAcc=cat.accounts||[];
    if(!salesCenterData.accounts?.length)salesCenterData.accounts=catAcc;
    else salesCenterData.accounts=salesCenterData.accounts.map(a=>{
      const tagged=catAcc.find(x=>String(x.id)===String(a.id));
      return Object.assign({},a,{brand:tagged?.brand||a.brand||''});
    });
    salesCenterData.warehouses=(stock.warehouses||cat.warehouses||[]).map(w=>{
      const tagged=(cat.warehouses||[]).find(x=>String(x.id)===String(w.id));
      return Object.assign({},w,{brand:tagged?.brand||w.brand||''});
    });
    salesCenterData.stocks=stock.stocks||[];
    salesCenterData.salespeople=people.rows||[];
    salesCenterData.currentUser=people.currentUser||null;
    salesCenterData.canManage=Boolean(people.canManage);
    if(q('#salesCategoryFilter'))q('#salesCategoryFilter').innerHTML='<option value="">Tüm kategoriler</option>'+salesCenterData.categories.map(c=>`<option value="${c.id}">${c.name}</option>`).join('');
    if(q('#salesSalesperson')){
      const cur=salesCenterData.currentUser;
      q('#salesSalesperson').innerHTML='<option value="">Satıcı seçin</option>'+salesCenterData.salespeople.map(p=>`<option value="${p.id}">${p.name}</option>`).join('');
      if(cur){
        const match=salesCenterData.salespeople.find(p=>String(p.id)===String(cur.id)||String(p.name).toLocaleLowerCase('tr-TR')===String(cur.name||'').toLocaleLowerCase('tr-TR'));
        if(match)q('#salesSalesperson').value=match.id;
      }
    }
    salesApplyBranchLock();
    salesFillCustomerSelect(list||salesCenterData.customers||[]);
    if(typeof refreshSalesProductSelects==='function')refreshSalesProductSelects();
    if(typeof loadSalesPromissoryDefaults==='function')loadSalesPromissoryDefaults();
    if(typeof salesSyncCartEmpty==='function')salesSyncCartEmpty();
    if(typeof salesCalculate==='function')salesCalculate();
    q('#salesCustomerSearch')?.focus();
  }catch(e){if(typeof toast==='function')toast(e.message||'Satış merkezi verileri yüklenemedi')}
}
function salesMoney(v){return money2(Number(v||0))}
function salesMaterialCode(p){return String(p?.searchName||p?.name||p?.code||'').trim()}
function salesItemCode(p){return String(p?.itemCode||p?.code||'').trim()}
function salesProductLabel(p){
  const madde=salesItemCode(p)||'-';
  const malzeme=salesMaterialCode(p)||'-';
  // Satış listesinde malzeme adı önde
  if(malzeme && malzeme!==madde)return `${malzeme} · ${madde}`;
  return malzeme||madde;
}
function salesProductDisplayName(p){
  // Satışta görünen ürün/malzeme adı (kod değil)
  return salesMaterialCode(p)||String(p?.name||p?.dynamicsName||p?.code||'').trim();
}
function salesProductOptions(selected=''){
  const itemTerm=(q('#salesItemCodeFilter')?.value||'').trim().toLocaleLowerCase('tr-TR');
  const materialTerm=(q('#salesMaterialCodeFilter')?.value||'').trim().toLocaleLowerCase('tr-TR');
  const category=(q('#salesCategoryFilter')?.value||'').trim();
  const source=(salesCenterData.products||[]).filter(p=>{
    const item=salesItemCode(p).toLocaleLowerCase('tr-TR');
    const material=`${salesMaterialCode(p)} ${p.code||''} ${p.name||''}`.toLocaleLowerCase('tr-TR');
    if(itemTerm && !item.includes(itemTerm))return false;
    if(materialTerm && !material.includes(materialTerm))return false;
    if(category && String(p.category||'')!==category)return false;
    return true;
  });
  if(q('#salesProductSearchCount'))q('#salesProductSearchCount').textContent=`${source.length} ürün`;
  return '<option value="">Madde / Malzeme seçin</option>'+source.map(p=>{
    const madde=salesItemCode(p), malzeme=salesMaterialCode(p);
    return `<option value="${p.code}" data-name="${malzeme||p.name||p.code}" data-item-code="${madde}" data-material-code="${malzeme}" ${String(p.code)===String(selected)?'selected':''}>${salesProductLabel(p)}</option>`;
  }).join('');
}

function salesAvailableStock(productCode){
  const mode=q('#salesDeductStock')?.value||'no';
  if(mode!=='yes'&&mode!=='reserve')return undefined;
  const warehouseId=q('#salesWarehouse')?.value||'';
  if(!warehouseId)return null;
  const row=(salesCenterData.stocks||[]).find(s=>String(s.productCode)===String(productCode)&&String(s.warehouseId)===String(warehouseId));
  if(!row)return 0;
  return Math.max(0,Number(row.quantity||0)-Number(row.reserved||0));
}
function salesSyncCartEmpty(){
  const wrap=q('#salesRows');if(!wrap)return;
  const rows=qa('.sales-row');
  const empty=q('#salesCartEmpty');
  if(q('#salesCartCount'))q('#salesCartCount').textContent=`${rows.length} kalem`;
  if(!rows.length){
    if(!empty)wrap.innerHTML='<div class="pos-cart-empty" id="salesCartEmpty">Sepet boş — barkod okutun veya listeden ekleyin.</div>';
  }else{
    empty?.remove();
  }
}
function salesPosQuickAdd(){
  const input=q('#salesPosBarcode');
  const term=(input?.value||'').trim();
  if(!term){toast('Barkod veya ürün kodu girin');input?.focus();return}
  const exact=term.toLocaleLowerCase('tr-TR');
  const products=salesCenterData.products||[];
  let p=products.find(x=>String(x.itemCode||'')===term||String(x.code||'')===term);
  if(!p)p=products.find(x=>String(x.itemCode||'').toLocaleLowerCase('tr-TR')===exact||String(x.code||'').toLocaleLowerCase('tr-TR')===exact||String(x.searchName||'').toLocaleLowerCase('tr-TR')===exact);
  if(!p)p=products.find(x=>`${x.itemCode||''} ${x.code||''} ${x.searchName||''} ${x.name||''}`.toLocaleLowerCase('tr-TR').includes(exact));
  if(!p){toast('Ürün bulunamadı: '+term);input?.select();return}
  const existing=[...qa('.sales-row')].find(r=>String(r.querySelector('.sales-product')?.value||'')===String(p.code));
  if(existing){
    const qtyEl=existing.querySelector('.sales-qty');
    qtyEl.value=String(Math.max(1,salesNum(qtyEl.value)+1));
    salesCalculate();
  }else{
    salesAddRow(p.code);
  }
  if(input){input.value='';input.focus()}
  toast(`${salesMaterialCode(p)||p.code} sepete eklendi`);
}
function salesAddRow(selectedCode='', extras={}){
  const wrap=q('#salesRows');
  if(!wrap)return;
  q('#salesCartEmpty')?.remove();
  const product=(salesCenterData.products||[]).find(p=>String(p.code)===String(selectedCode));
  const qtyVal=Math.max(1,Math.round(Number(extras.qty||extras.quantity||1)));
  const priceOverride=extras.unitPrice!=null&&extras.unitPrice!==''?Number(extras.unitPrice):null;
  const unit=priceOverride!=null&&Number.isFinite(priceOverride)?priceOverride:salesProductUnitPrice(product,salesPreferredPriceMethod());
  const row=document.createElement('div');
  row.className='sales-row';
  row.innerHTML=`
    <select class="sales-product">${salesProductOptions(selectedCode)}</select>
    <input class="sales-qty" type="number" min="1" step="1" value="${qtyVal}" title="Adet"/>
    <input class="sales-price" type="number" min="0" step="0.01" value="${unit}" placeholder="Birim fiyat"/>
    <span class="sales-stock-info">-</span>
    <b class="sales-row-total">${salesMoney(unit*qtyVal)}</b>
    <button class="sales-row-delete" type="button" title="Sil">×</button>`;
  wrap.appendChild(row);
  const sel=row.querySelector('.sales-product');
  if(selectedCode && ![...sel.options].some(o=>String(o.value)===String(selectedCode))){
    const o=document.createElement('option');
    o.value=selectedCode;
    o.textContent=extras.productName||extras.materialCode||selectedCode;
    o.dataset.name=extras.productName||extras.materialCode||selectedCode;
    o.dataset.itemCode=extras.itemCode||'';
    o.dataset.materialCode=extras.materialCode||extras.productName||'';
    o.selected=true;
    sel.appendChild(o);
  }
  const qty=row.querySelector('.sales-qty');
  const price=row.querySelector('.sales-price');
  const stockInfo=row.querySelector('.sales-stock-info');
  const updateStockInfo=()=>{
    const available=salesAvailableStock(sel.value);
    stockInfo.textContent=available===undefined?'Stok takibi kapalı':available===null?'Stok: depo seçin':`Stok: ${available}`;
  };
  sel.addEventListener('change',()=>{
    const p=(salesCenterData.products||[]).find(x=>String(x.code)===String(sel.value));
    if(p){
      price.value=salesProductUnitPrice(p,salesPreferredPriceMethod());
      const opt=sel.selectedOptions[0];
      if(opt)opt.dataset.name=p.name||p.code;
    }
    updateStockInfo();salesCalculate();
  });
  qty.addEventListener('input',salesCalculate);
  qty.addEventListener('change',salesCalculate);
  price.addEventListener('input',salesCalculate);
  price.addEventListener('change',salesCalculate);
  row.querySelector('.sales-row-delete').addEventListener('click',()=>{row.remove();salesSyncCartEmpty();salesCalculate()});
  updateStockInfo();
  salesSyncCartEmpty();
  salesCalculate();
  if(!selectedCode){price.focus();price.select()}
  else q('#salesPosBarcode')?.focus();
}
function salesRefreshRowStocks(){
  qa('.sales-row').forEach(row=>{
    const code=row.querySelector('.sales-product')?.value||'';
    const info=row.querySelector('.sales-stock-info');
    if(!info)return;
    const available=salesAvailableStock(code);
    info.textContent=available===undefined?'Stok takibi kapalı':available===null?'Stok: depo seçin':`Stok: ${available}`;
  });
}

let completingSaleId='';
function salesReset(opts={}){
  completingSaleId='';
  if(q('#salesRows'))q('#salesRows').innerHTML='';
  salesSyncCartEmpty();
  if(q('#salesPosBarcode'))q('#salesPosBarcode').value='';
  if(q('#salesDiscountPct'))q('#salesDiscountPct').value='0';
  if(q('#salesDiscountAmount'))q('#salesDiscountAmount').value='0';
  ['#payCash','#payCard','#payTransfer','#payCredit','#payNote','#salesPaidAmount'].forEach(id=>{if(q(id))q(id).value=''});
  if(q('#salesDescription'))q('#salesDescription').value='';
  if(q('#salesInvoiceStatus'))q('#salesInvoiceStatus').value='not_required';
  if(q('#salesInvoiceNumber'))q('#salesInvoiceNumber').value='';
  if(q('#salesCustomerSearch'))q('#salesCustomerSearch').value='';
  if(q('#salesCustomerSelect'))q('#salesCustomerSelect').value='';
  if(q('#salesStatus')){q('#salesStatus').textContent='';q('#salesStatus').className='form-status'}
  if(q('#salesDate'))q('#salesDate').value=new Date().toISOString().slice(0,10);
  if(q('#salesPromissoryDescription'))q('#salesPromissoryDescription').value='';
  if(q('#salesPromissorySchedule'))q('#salesPromissorySchedule').innerHTML='';
  setSalesPayPlanOpen(false);
  salesCustomerChanged();
  salesInvoiceChanged();
  loadSalesPromissoryDefaults();
  salesPaymentChanged();
  salesCalculate();
  salesSetWizardStep(1);
  if(!opts.silent)toast('Yeni satış formu hazır');
}
function salesSelectCustomerRecord(customer){
  if(!customer?.id || !q('#salesCustomerSelect'))return;
  const id=String(customer.id);
  if(!(salesCenterData.customers||[]).some(c=>String(c.id)===id)){
    salesCenterData.customers=[customer,...(salesCenterData.customers||[])];
  }
  if(![...q('#salesCustomerSelect').options].some(o=>String(o.value)===id)){
    const o=document.createElement('option');
    o.value=id;
    o.textContent=typeof customerOptionLabel==='function'?customerOptionLabel(customer):(customer.name||id);
    q('#salesCustomerSelect').appendChild(o);
  }
  q('#salesCustomerSelect').value=id;
  if(q('#salesCustomerSearch'))q('#salesCustomerSearch').value=customer.name||'';
  q('#salesCustomerSelect').dispatchEvent(new Event('change'));
}
function salesFillPaymentSplits(splits){
  const s=splits||{};
  const set=(id,v)=>{if(q(id))q(id).value=Number(v)>0?String(v):''};
  set('#payCash',s.cash);set('#payCard',s.card);set('#payTransfer',s.transfer);set('#payCredit',s.credit);set('#payNote',s.note);
  if(Number(s.note)>0)setSalesPayPlanOpen(true);
  salesPaymentChanged();
  salesCalculate();
}
async function openRapidSaleInSalesCenter(saleId){
  const id=String(saleId||'').trim();
  if(!id)return;
  if(qa('.sales-row').length && completingSaleId!==id){
    if(!confirm('Açık satış formu var. Rapid satış yüklensin mi?'))return;
  }
  closeRapid360SalesXmlModal();
  goTab('salesCenter');
  try{
    await loadSalesCenter();
    salesReset({silent:true});
    const d=await api('/web-api/admin/sale/'+encodeURIComponent(id));
    const sale=d.sale||{};
    completingSaleId=String(sale.id||id);
    if(d.customer)salesSelectCustomerRecord(d.customer);
    if(sale.dealerId && q('#salesDealer') && [...q('#salesDealer').options].some(o=>String(o.value)===String(sale.dealerId)))q('#salesDealer').value=sale.dealerId;
    if(sale.salespersonId && q('#salesSalesperson') && [...q('#salesSalesperson').options].some(o=>String(o.value)===String(sale.salespersonId)))q('#salesSalesperson').value=sale.salespersonId;
    if(sale.date && q('#salesDate'))q('#salesDate').value=String(sale.date).slice(0,10);
    if(q('#salesDiscountPct'))q('#salesDiscountPct').value=String(sale.discountPct||0);
    if(q('#salesDescription'))q('#salesDescription').value=sale.description||(`Rapid ${sale.rapidSalesId||sale.reference||''}`.trim());
    if(q('#salesInvoiceStatus'))q('#salesInvoiceStatus').value='not_required';
    (sale.items||[]).forEach(item=>{
      salesAddRow(item.productCode||item.itemCode||'',{
        qty:item.quantity,unitPrice:item.unitPrice,
        productName:item.productName||item.materialCode,itemCode:item.itemCode,materialCode:item.materialCode
      });
    });
    salesFillPaymentSplits(d.paymentSplits||{});
    const senet=(sale.payments||[]).find(p=>/senet/i.test(String(p.method||'')));
    if(senet && Number(senet.installments)>0 && q('#salesPromissoryInstallments'))q('#salesPromissoryInstallments').value=String(senet.installments);
    salesSetWizardStep((sale.items||[]).length?2:1);
    const hint=`Rapid satış yüklendi (${sale.rapidSalesId||sale.reference||''}). Fiyat, ödeme ve müşteri bilgisini kontrol edip Satışı Yap ile tamamlayın. Kasa/stok şimdi işler.`;
    if(q('#salesStatus')){q('#salesStatus').textContent=hint;q('#salesStatus').className='form-status success'}
    toast(hint);
  }catch(e){toast(e.message||'Satış yüklenemedi')}
}
function salesPersonBrand(){
  const id=q('#salesSalesperson')?.value||'';
  const p=(salesCenterData.salespeople||[]).find(x=>String(x.id)===String(id));
  return p?.brand||'';
}
function salesBrandLabel(brand){
  return brand==='istikbal'?'İstikbal':brand==='beko'?'Beko':'';
}
function salesLockCash(list,brand){
  const cash=(list||[]).filter(a=>a&&a.active!==false&&a.type==='cash');
  if(!brand)return cash;
  const m=cash.filter(a=>a.brand===brand);
  return m.length?m:cash.filter(a=>!a.brand);
}
function salesLockBank(list,brand){
  const bank=(list||[]).filter(a=>a&&a.active!==false&&a.type==='bank');
  if(!brand)return bank;
  const m=bank.filter(a=>!a.brand||a.brand===brand);
  return m.length?m:bank.filter(a=>!a.brand);
}
function salesLockDealers(list,brand){
  const d=(list||[]).filter(x=>x&&x.active!==false);
  if(!brand)return d;
  const m=d.filter(x=>x.brand===brand);
  return m.length?m:d;
}
function salesLockWarehouses(list,brand){
  const w=(list||[]).filter(x=>x&&x.active!==false);
  if(!brand)return w;
  const m=w.filter(x=>x.brand===brand);
  return m.length?m:w;
}
function salesApplyBranchLock(){
  const brand=salesPersonBrand();
  const label=salesBrandLabel(brand);
  const hint=q('#salesBranchLockHint');
  if(hint)hint.textContent=brand?`${label} personeli — kasa, bayi ve depo ${label} şubesine kilitli.`: '';
  const dealers=salesLockDealers(salesCenterData.dealerSettings||[],brand);
  const dealerSel=q('#salesDealer');
  if(dealerSel){
    const cur=dealerSel.value;
    dealerSel.innerHTML=dealers.map(d=>`<option value="${d.id}">${d.name}</option>`).join('')||'<option value="">Bayi tanımlı değil</option>';
    if(cur&&[...dealerSel.options].some(o=>o.value===cur))dealerSel.value=cur;
  }
  const warehouses=salesLockWarehouses(salesCenterData.warehouses||[],brand);
  const whSel=q('#salesWarehouse');
  if(whSel){
    const cur=whSel.value;
    whSel.innerHTML=warehouses.map(w=>`<option value="${w.id}">${w.name}</option>`).join('');
    if(cur&&[...whSel.options].some(o=>o.value===cur))whSel.value=cur;
  }
  syncSalesPayAccounts();
  if(typeof salesCalculate==='function')salesCalculate();
}
function syncSalesPayAccounts(){
  const all=(salesCenterData?.accounts||[]).filter(a=>a&&a.active!==false);
  const brand=salesPersonBrand();
  const cash=salesLockCash(all,brand);
  const bank=salesLockBank(all,brand);
  const fill=(sel,rows,emptyLabel)=>{
    if(!sel)return;
    const cur=sel.value;
    if(!rows.length){
      sel.innerHTML=`<option value="">${emptyLabel}</option>`;
      return;
    }
    sel.innerHTML=rows.map(a=>`<option value="${a.id}">${a.name}</option>`).join('');
    if(cur&&[...sel.options].some(o=>o.value===cur))sel.value=cur;
    else sel.value=rows[0].id;
  };
  fill(q('#payCashAccount'),cash,'Kasa hesabı yok — Ayarlar’dan ekleyin');
  fill(q('#payCardAccount'),bank,'Banka / POS yok — Ayarlar → Tür: Banka');
  fill(q('#payTransferAccount'),bank,'Banka hesabı yok — Ayarlar → Tür: Banka');
  if(q('#salesAccount')){
    const cur=q('#salesAccount').value;
    const locked=cash.concat(bank);
    q('#salesAccount').innerHTML=locked.map(a=>`<option value="${a.id}">${a.name}</option>`).join('')||'<option value="">Hesap yok</option>';
    if(cur&&[...q('#salesAccount').options].some(o=>o.value===cur))q('#salesAccount').value=cur;
  }
}
function salesHighlightPayRow(fieldId){
  qa('.sales-pay-list .pay-method').forEach(el=>el.classList.remove('pay-row-focus'));
  const map={payCash:'.pay-cash',payCard:'.pay-card',payTransfer:'.pay-transfer',payCredit:'.pay-credit',payNote:'.pay-note'};
  const row=map[fieldId]?q('.sales-pay-list '+map[fieldId]):null;
  if(row)row.classList.add('pay-row-focus');
  const accMap={payCash:'#payCashAccount',payCard:'#payCardAccount',payTransfer:'#payTransferAccount'};
  const acc=accMap[fieldId]?q(accMap[fieldId]):null;
  if(acc){
    setTimeout(()=>{try{acc.focus()}catch(_){}},60);
    if((fieldId==='payCard'||fieldId==='payTransfer')&&!acc.value){
      toast('Kart/Havale için önce Ayarlar → Kasa ve Banka’dan Tür=Banka hesabı ekleyin');
    }
  }
}
function salesPaymentSplits(){
  return{
    cash:Math.max(0,salesNum(q('#payCash')?.value)),
    card:Math.max(0,salesNum(q('#payCard')?.value)),
    transfer:Math.max(0,salesNum(q('#payTransfer')?.value)),
    credit:Math.max(0,salesNum(q('#payCredit')?.value)),
    note:Math.max(0,salesNum(q('#payNote')?.value)),
    cashAccountId:q('#payCashAccount')?.value||'',
    cardAccountId:q('#payCardAccount')?.value||'',
    transferAccountId:q('#payTransferAccount')?.value||''
  };
}
function salesCollectedAmount(splits){
  const p=splits||salesPaymentSplits();
  return Math.round((p.cash+p.card)*100)/100;
}
function salesAllocatedAmount(splits){
  const p=splits||salesPaymentSplits();
  return Math.round((p.cash+p.card+p.transfer+p.credit+p.note)*100)/100;
}
function salesBuildPromissorySchedule(amount,installments,firstDue,intervalMonths){
  const total=Math.max(0,salesNum(amount));
  const count=Math.min(36,Math.max(1,Math.round(salesNum(installments)||1)));
  const interval=Math.min(12,Math.max(1,Math.round(salesNum(intervalMonths)||1)));
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
function salesRenderPromissorySchedule(){
  const box=q('#salesPromissorySchedule');if(!box)return;
  const noteAmt=Math.max(0,salesNum(q('#payNote')?.value));
  if(noteAmt<=0){box.innerHTML='';return}
  const rows=salesBuildPromissorySchedule(noteAmt,q('#salesPromissoryInstallments')?.value,q('#salesPromissoryFirstDue')?.value,q('#salesPromissoryInterval')?.value);
  if(!rows.length){box.innerHTML='<b>⚠ Senet için ilk vade tarihini girin.</b>';return}
  box.innerHTML=`<b>Senet takvimı · ${salesMoney(noteAmt)}</b><table><thead><tr><th>#</th><th>Vade</th><th>Tutar</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${r.no}</td><td>${r.dueDate}</td><td>${salesMoney(r.amount)}</td></tr>`).join('')}</tbody></table>`;
}
function salesCalcState(){
  let gross=0;
  qa('.sales-row').forEach(row=>{
    const qty=Math.max(0,salesNum(row.querySelector('.sales-qty')?.value));
    const price=Math.max(0,salesNum(row.querySelector('.sales-price')?.value));
    const line=Math.round(qty*price*100)/100;
    gross+=line;
    const cell=row.querySelector('.sales-row-total');
    if(cell)cell.textContent=salesMoney(line);
  });
  gross=Math.round(gross*100)/100;
  const dealer=(salesCenterData.dealerSettings||[]).find(d=>String(d.id)===String(q('#salesDealer')?.value||''));
  let discountPct=Math.max(0,salesNum(q('#salesDiscountPct')?.value));
  if(discountPct>100)discountPct=100;
  const discountAmount=Math.round(gross*(discountPct/100)*100)/100;
  const net=Math.round((gross-discountAmount)*100)/100;
  const commissionPct=salesNum(dealer?.commissionPct);
  const commission=Math.round(net*(commissionPct/100)*100)/100;
  const splits=salesPaymentSplits();
  const paid=salesCollectedAmount(splits);
  const allocated=salesAllocatedAmount(splits);
  const remaining=Math.round((net-allocated)*100)/100;
  const due=Math.round((splits.credit+splits.note+splits.transfer+Math.max(0,remaining))*100)/100;
  if(q('#salesPaidAmount'))q('#salesPaidAmount').value=String(paid);
  const methods=[];
  if(splits.cash>0)methods.push('Nakit');
  if(splits.card>0)methods.push('Kredi Kartı');
  if(splits.transfer>0)methods.push('Havale');
  if(splits.credit>0)methods.push('Vadeli');
  if(splits.note>0)methods.push('Senet');
  const method=methods.length?methods.join(' + '):'Karma';
  if(q('#salesPaymentMethod'))q('#salesPaymentMethod').value=method;
  return{gross,discountPct,discountAmount,net,commissionPct,commission,dealer,method,paid,due,splits,allocated,remaining};
}
function salesUpdateDock(c){
  if(q('#salesDockNet'))q('#salesDockNet').textContent=salesMoney(c?.net||0);
  if(q('#salesDockRemain')){
    const rem=c?.remaining??0;
    q('#salesDockRemain').textContent=salesMoney(rem);
    q('#salesDockRemain').style.color=Math.abs(rem)<0.009?'#7dffa8':(rem>0?'#ffd48a':'#ff9b9b');
  }
  const cust=(salesCenterData.customers||[]).find(x=>String(x.id)===String(q('#salesCustomerSelect')?.value||''));
  if(q('#salesDockCustomer'))q('#salesDockCustomer').textContent=cust?(cust.name.length>22?cust.name.slice(0,21)+'…':cust.name):'—';
  const map={payCash:'cash',payCard:'card',payTransfer:'transfer',payCredit:'credit',payNote:'note'};
  qa('#posPayTiles .pos-pay-tile').forEach(btn=>{
    const field=btn.getAttribute('data-pay-fill');
    const key=map[field];
    const on=key?Math.max(0,salesNum(c?.splits?.[key]))>0:false;
    btn.classList.toggle('on',on);
    const small=btn.querySelector('small');
    if(small&&key)small.textContent=on?salesMoney(c.splits[key]):(key==='credit'?'Cariye yaz':key==='note'?'Vade planı':'Kalanı yaz');
  });
}
let salesWizardStep=1;
function salesWizardPanels(){
  return{
    1:q('.sales-customer-panel'),
    2:q('.sales-products-panel'),
    3:q('#salesPaymentStep')
  };
}
function salesApplyWizardVisibility(){
  const panels=salesWizardPanels();
  [1,2,3].forEach(n=>{
    const el=panels[n];if(!el)return;
    const show=n===salesWizardStep;
    el.classList.toggle('hidden',!show);
    el.classList.toggle('pos-step-visible',show);
    el.style.setProperty('display',show?(n===3?'flex':'block'):'none','important');
    el.setAttribute('aria-hidden',show?'false':'true');
  });
  q('#salesCenter')?.setAttribute('data-pos-step',String(salesWizardStep));
  const banner=q('#salesWizardBanner');
  if(banner){
    banner.textContent=salesWizardStep===1
      ?'ADIM 1/3 — Önce müşteri seçin, sonra Devam Et'
      :(salesWizardStep===2
        ?'ADIM 2/3 — Ürün ekleyin, sonra Devam Et → Ödeme'
        :'ADIM 3/3 — Ödeme planı · Senet/Sözleşme veya Önizle/Teklif');
  }
}
function salesSetWizardStep(step){
  salesWizardStep=Math.min(3,Math.max(1,Number(step)||1));
  salesApplyWizardVisibility();
  const step1=q('#posStep1'),step2=q('#posStep2'),step3=q('#posStep3');
  const hasCustomer=!!(q('#salesCustomerSelect')?.value);
  const hasCart=qa('.sales-row').length>0;
  [step1,step2,step3].forEach(el=>el?.classList.remove('active','done','locked'));
  if(hasCustomer && salesWizardStep>1)step1?.classList.add('done');
  if(hasCart && salesWizardStep>2)step2?.classList.add('done');
  if(salesWizardStep===1)step1?.classList.add('active');
  else if(salesWizardStep===2)step2?.classList.add('active');
  else step3?.classList.add('active');
  if(!hasCustomer)step2?.classList.add('locked');
  if(!hasCustomer||!hasCart)step3?.classList.add('locked');
  salesUpdateWizardChrome();
  try{window.scrollTo({top:0,behavior:'smooth'})}catch(_){}
}
function salesWizardCanGo(to){
  if(to<=1)return true;
  if(to>=2 && !(q('#salesCustomerSelect')?.value)){toast('Müşteri seçmeden ürün adımı açılmaz');return false}
  if(to>=3 && !qa('.sales-row').length){toast('Ürün eklemeden ödeme planı açılmaz');return false}
  return true;
}
function salesWizardNext(){
  if(salesWizardStep===1){
    if(!salesWizardCanGo(2))return;
    salesSetWizardStep(2);
    setTimeout(()=>q('#salesPosBarcode')?.focus(),80);
    return;
  }
  if(salesWizardStep===2){
    if(!salesWizardCanGo(3))return;
    salesSetWizardStep(3);
  }
}
function salesWizardBack(){
  if(salesWizardStep>1)salesSetWizardStep(salesWizardStep-1);
}
function salesUpdateWizardChrome(){
  const hasCustomer=!!(q('#salesCustomerSelect')?.value);
  const hasCart=qa('.sales-row').length>0;
  const next1=q('#salesWizardNext1');if(next1)next1.disabled=!hasCustomer;
  const next2=q('#salesWizardNext2');if(next2)next2.disabled=!hasCart;
  if(q('#salesWizardHint1'))q('#salesWizardHint1').textContent=hasCustomer?'Müşteri seçildi — devam edebilirsiniz':'Müşteri seçmeden ürün açılmaz';
  if(q('#salesWizardHint2'))q('#salesWizardHint2').textContent=hasCart?`${qa('.sales-row').length} kalem hazır`:'Ürün eklemeden ödeme açılmaz';
  if(q('#salesDockStep'))q('#salesDockStep').textContent=`${salesWizardStep} / 3`;
  const dockBtn=q('#salesDockPreviewBtn');
  if(dockBtn){
    if(salesWizardStep===1)dockBtn.textContent=hasCustomer?'DEVAM ET → ÜRÜN':'ÖNCE MÜŞTERİ SEÇ';
    else if(salesWizardStep===2)dockBtn.textContent=hasCart?'DEVAM ET → ÖDEME':'ÖNCE ÜRÜN EKLE';
    else dockBtn.textContent='ÖNİZLE / SATIŞI YAP';
  }
  salesApplyWizardVisibility();
}
function salesUpdatePosSteps(c){
  const step1=q('#posStep1'),step2=q('#posStep2'),step3=q('#posStep3');
  if(!step1||!step2||!step3)return;
  const hasCustomer=!!(q('#salesCustomerSelect')?.value);
  const hasCart=qa('.sales-row').length>0;
  const payReady=!!(c&&c.net>0&&Math.abs(c.remaining)<0.009);
  [step1,step2,step3].forEach(el=>el.classList.remove('active','done','locked'));
  if(hasCustomer && salesWizardStep>1)step1.classList.add('done');
  if(hasCart && salesWizardStep>2)step2.classList.add('done');
  if(payReady && salesWizardStep===3)step3.classList.add('done');
  if(salesWizardStep===1)step1.classList.add('active');
  else if(salesWizardStep===2)step2.classList.add('active');
  else step3.classList.add('active');
  if(!hasCustomer)step2.classList.add('locked');
  if(!hasCustomer||!hasCart)step3.classList.add('locked');
  // Chrome/visibility güncelle — sonsuz döngü olmasın diye sadece UI
  const next1=q('#salesWizardNext1');if(next1)next1.disabled=!hasCustomer;
  const next2=q('#salesWizardNext2');if(next2)next2.disabled=!hasCart;
  if(q('#salesWizardHint1'))q('#salesWizardHint1').textContent=hasCustomer?'Müşteri seçildi — devam edebilirsiniz':'Müşteri seçmeden ürün açılmaz';
  if(q('#salesWizardHint2'))q('#salesWizardHint2').textContent=hasCart?`${qa('.sales-row').length} kalem hazır`:'Ürün eklemeden ödeme açılmaz';
  if(q('#salesDockStep'))q('#salesDockStep').textContent=`${salesWizardStep} / 3`;
  const dockBtn=q('#salesDockPreviewBtn');
  if(dockBtn){
    if(salesWizardStep===1)dockBtn.textContent=hasCustomer?'DEVAM ET → ÜRÜN':'ÖNCE MÜŞTERİ SEÇ';
    else if(salesWizardStep===2)dockBtn.textContent=hasCart?'DEVAM ET → ÖDEME':'ÖNCE ÜRÜN EKLE';
    else dockBtn.textContent='ÖNİZLE / SATIŞI YAP';
  }
  salesApplyWizardVisibility();
}
function salesCalculate(){
  const c=salesCalcState();
  if(q('#salesDiscountAmount'))q('#salesDiscountAmount').value=c.discountAmount.toFixed(2);
  if(q('#salesGrossPreview'))q('#salesGrossPreview').textContent=salesMoney(c.gross);
  if(q('#salesDiscountPreview'))q('#salesDiscountPreview').textContent=`-${salesMoney(c.discountAmount)}`;
  if(q('#salesDiscountPctLabel'))q('#salesDiscountPctLabel').textContent=`(%${String(c.discountPct).replace('.',',')})`;
  if(q('#salesGrandTotal'))q('#salesGrandTotal').textContent=salesMoney(c.net);
  if(q('#salesCommissionAmountPreview'))q('#salesCommissionAmountPreview').textContent=salesMoney(c.commission);
  if(q('#salesCommissionPctLabel'))q('#salesCommissionPctLabel').textContent=`(%${String(c.commissionPct).replace('.',',')})`;
  if(q('#salesPaidPreview'))q('#salesPaidPreview').textContent=salesMoney(c.paid);
  if(q('#salesDuePreview'))q('#salesDuePreview').textContent=salesMoney(c.due);
  if(q('#payAllocated'))q('#payAllocated').textContent=salesMoney(c.allocated);
  if(q('#payRemaining'))q('#payRemaining').textContent=salesMoney(c.remaining);
  if(q('#payAllocatedSummary'))q('#payAllocatedSummary').textContent=salesMoney(c.allocated);
  if(q('#payRemainingSummary'))q('#payRemainingSummary').textContent=salesMoney(Math.max(0,c.remaining));
  if(q('#payMethodSummary'))q('#payMethodSummary').textContent=c.method&&c.allocated>0?c.method:'Henüz seçilmedi';
  if(q('#salesPayPlanBtnHint')){
    q('#salesPayPlanBtnHint').textContent=Math.abs(c.remaining)<0.009&&c.net>0
      ?`Ödeme tamam · ${c.method||'Karma'}`
      :(c.remaining>0?`Kalan ${salesMoney(c.remaining)} — planı açın`:'NAKİT · KART · HAVALE · VADELİ · SENET');
  }
  if(q('#salesCartCount'))q('#salesCartCount').textContent=`${qa('.sales-row').length} kalem`;
  const bal=q('#payBalanceHint');
  if(bal){
    if(c.net<=0){bal.className='sales-pay-balance ok';bal.textContent='Ödeme dağılımını net tutara eşitleyin.';}
    else if(Math.abs(c.remaining)<0.009){bal.className='sales-pay-balance ok';bal.textContent=c.splits.transfer>0?`✓ Dağılım tamam. Havale ${salesMoney(c.splits.transfer)} Ödemeler’e gider — banka gelince yönetici tahsil eder.`:`✓ Ödeme dağılımı net tutara eşit (${salesMoney(c.net)})`;}
    else if(c.remaining>0){bal.className='sales-pay-balance warn';bal.textContent=`⚠ Henüz ${salesMoney(c.remaining)} dağıtılmadı. Nakit/kart/havale/senet/vadeli girin.`;}
    else{bal.className='sales-pay-balance bad';bal.textContent=`⚠ Dağıtılan tutar netten ${salesMoney(Math.abs(c.remaining))} fazla.`;}
  }
  if(q('#salesDiscountLimit'))q('#salesDiscountLimit').textContent=c.dealer?`${c.dealer.name}${c.method?` · ${c.method}`:''}`:'Bayi seçin';
  if(q('#salesCommissionPreview'))q('#salesCommissionPreview').textContent=`Prim: ${salesMoney(c.commission)}`;
  const hint=q('#salesCalcHint');
  if(hint){
    hint.classList.add('hidden');
    if(!c.dealer)hint.textContent='Bayi seçilmeden prim hesaplanamaz.';
    else if(c.gross<=0)hint.textContent='Ürün tutarı girin.';
    else hint.textContent=`Brüt ${salesMoney(c.gross)} − iskonto ${salesMoney(c.discountAmount)} = net ${salesMoney(c.net)}`;
  }
  salesUpdateDock(c);
  salesUpdatePosSteps(c);
  salesPaymentChanged();
}
async function salesSearchCustomers(){
  const term=String(q('#salesCustomerSearch')?.value||'').trim();
  const btn=q('#salesCustomerSearchBtn');
  const hint=q('#salesCustomerSearchHint');
  const current=q('#salesCustomerSelect')?.value||'';
  if(btn)btn.disabled=true;
  if(hint)hint.textContent=term?'Aranıyor…':'Liste hazırlanıyor…';
  let rows=[],total=0;
  try{
    if(!salesCenterData._customerFallback?.length){
      await loadSalesCustomersFallback();
    }
    if(term){
      rows=filterCustomersLocal(salesCenterData._customerFallback,term);
      total=rows.length;
      if(!rows.length){
        try{
          const d=await api('/web-api/admin/customers/search?q='+encodeURIComponent(term)+'&limit=50');
          rows=d.rows||[];total=Number(d.total||rows.length||0);
        }catch(_){}
      }
    }else{
      rows=(salesCenterData._customerFallback||[]).slice(0,200);
      total=salesCenterData.customerTotal||rows.length;
    }
    const map=new Map((salesCenterData.customers||[]).map(c=>[String(c.id),c]));
    rows.forEach(c=>map.set(String(c.id),c));
    salesCenterData.customers=[...map.values()];
    q('#salesCustomerCount').textContent=`${rows.length} sonuç`;
    q('#salesCustomerSelect').innerHTML=(rows.length?'':'<option value="">Sonuç yok — farklı kelime deneyin</option>')+
      rows.map(c=>`<option value="${c.id}" ${String(c.id)===String(current)?'selected':''}>${customerOptionLabel(c)}${c.taxNo?' · '+c.taxNo:''}</option>`).join('');
    if(current && rows.some(c=>String(c.id)===String(current)))q('#salesCustomerSelect').value=current;
    else if(rows.length===1)q('#salesCustomerSelect').value=rows[0].id;
    if(hint)hint.textContent=rows.length
      ?`${rows.length} müşteri. Listeden seçin.`
      :'Eşleşen müşteri yok. Yeni müşteri ekleyebilirsiniz.';
    salesCustomerChanged();
  }finally{if(btn)btn.disabled=false}
}
function salesRenderCustomers(){ /* geriye uyum: ara butonuyla aynı */ return salesSearchCustomers(); }
function salesCustomerChanged(){
  const c=salesCenterData.customers.find(x=>String(x.id)===String(q('#salesCustomerSelect')?.value||'')),box=q('#salesCustomerInfo'),noteWrap=q('#salesCustomerNoteWrap');
  const billWrap=q('#salesBillingPartyWrap'),billSel=q('#salesBillingParty');
  if(!c){
    box.classList.add('hidden');box.innerHTML='';noteWrap?.classList.add('hidden');if(q('#salesCustomerNote'))q('#salesCustomerNote').value='';
    billWrap?.classList.add('hidden');
    if(q('#salesDockCustomer'))q('#salesDockCustomer').textContent='—';
    salesDetachKefil({silent:true});
    salesUpdatePosSteps(salesCalcState());
    return;
  }
  box.classList.remove('hidden');
  const addr=[c.district,c.city].filter(Boolean).join('/')||(c.address||'-');
  const hasCorp=customerHasCorporate(c);
  const corpLine=hasCorp?`<div><small>Fatura firması</small><b>${c.companyName||'-'}</b><span style="display:block;font-size:11px;color:#667890">VKN ${c.taxNo||'-'} · ${c.taxOffice||''}</span></div>`:'';
  box.innerHTML=`<div><small>Şahıs / Senet</small><b>${c.name}</b><span style="display:block;font-size:11px;color:#667890">Kod ${c.customerCode||c.rapidCustAccount||'—'} · TCKN ${c.tckn||'—'}</span></div><div><small>Telefon</small><b>${c.phone||'-'}</b>${sipBtn(c.phone,{className:'sip-call-sm',customerId:c.id})}</div><div><small>Adres</small><b>${addr}</b></div><div><small>Güncel Cari</small><b class="${Number(c.balance)>0?'debt':'credit'}">${salesMoney(c.balance)}</b></div>${corpLine}`;
  if(billWrap&&billSel){
    // Kurumsal bilgi varsa otomatik kurumsal; seçim gösterilmez
    billWrap.classList.add('hidden');
    billSel.value=hasCorp?'corporate':'individual';
  }
  noteWrap?.classList.remove('hidden');if(q('#salesCustomerNote'))q('#salesCustomerNote').value=c.note||'';
  if(q('#salesDockCustomer'))q('#salesDockCustomer').textContent=c.name.length>22?c.name.slice(0,21)+'…':c.name;
  salesDetachKefil({silent:true});
  salesRefreshKefilUI();
  salesUpdatePosSteps(salesCalcState());
}

let salesPromissorySettings={defaultInstallments:1,firstDueDays:30};
function addDaysISO(days){const d=new Date();d.setDate(d.getDate()+Number(days||0));return d.toISOString().slice(0,10)}
async function loadSalesPromissoryDefaults(){
  try{const d=await api('/web-api/admin/promissory-settings');salesPromissorySettings=d.settings||salesPromissorySettings}
  catch(_){}
  if(q('#salesPromissoryInstallments'))q('#salesPromissoryInstallments').value=salesPromissorySettings.defaultInstallments||1;
  if(q('#salesPromissoryInterval'))q('#salesPromissoryInterval').value=salesPromissorySettings.intervalMonths||1;
  if(q('#salesPromissoryFirstDue'))q('#salesPromissoryFirstDue').value=addDaysISO(salesPromissorySettings.firstDueDays??30);
}
function salesPaymentChanged(){
  const noteAmt=Math.max(0,salesNum(q('#payNote')?.value));
  const wrap=q('#salesPromissoryOptions');
  wrap?.classList.toggle('hidden',noteAmt<=0);
  if(noteAmt>0){
    if(!q('#salesPromissoryFirstDue')?.value)loadSalesPromissoryDefaults();
    if(q('#salesPromissoryWarn'))q('#salesPromissoryWarn').textContent=`⚠ ${salesMoney(noteAmt)} senet için vade tarihi ve taksit girin. Satış kaydında senet düzeneği oluşturulacak.`;
    salesRenderPromissorySchedule();
  }else{
    if(q('#salesPromissorySchedule'))q('#salesPromissorySchedule').innerHTML='';
    salesDetachKefil({silent:true});
  }
  salesRefreshKefilUI();
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
  const id=q('#salesCustomerSelect')?.value||'';
  return (salesCenterData.customers||[]).find(c=>String(c.id)===String(id))||null;
}
function salesKefilAttached(){return q('#salesKefilAttached')?.value==='1'}
function salesReadKefilForm(){
  const name=(q('#salesKefilName')?.value||'').trim();
  if(!name)return null;
  const tckn=(q('#salesKefilTckn')?.value||'').trim();
  if(tckn&&tckn.replace(/\D/g,'').length!==11)throw new Error('Kefil TCKN 11 hane olmalıdır');
  return {
    name,tckn,
    phone:(q('#salesKefilPhone')?.value||'').trim(),
    workPhone:(q('#salesKefilWorkPhone')?.value||'').trim(),
    homePhone:(q('#salesKefilHomePhone')?.value||'').trim(),
    homeAddress:(q('#salesKefilHomeAddress')?.value||'').trim(),
    workAddress:(q('#salesKefilWorkAddress')?.value||'').trim(),
    customerId:(q('#salesKefilCustomerId')?.value||'').trim()
  };
}
function salesFillKefilForm(g={}){
  if(q('#salesKefilName'))q('#salesKefilName').value=g.name||'';
  if(q('#salesKefilTckn'))q('#salesKefilTckn').value=g.tckn||'';
  if(q('#salesKefilPhone'))q('#salesKefilPhone').value=g.phone||'';
  if(q('#salesKefilWorkPhone'))q('#salesKefilWorkPhone').value=g.workPhone||'';
  if(q('#salesKefilHomePhone'))q('#salesKefilHomePhone').value=g.homePhone||'';
  if(q('#salesKefilHomeAddress'))q('#salesKefilHomeAddress').value=g.homeAddress||'';
  if(q('#salesKefilWorkAddress'))q('#salesKefilWorkAddress').value=g.workAddress||'';
  if(q('#salesKefilCustomerId'))q('#salesKefilCustomerId').value=g.customerId||'';
}
function salesClearKefilForm(){salesFillKefilForm({})}
function salesRefreshKefilUI(){
  const noteAmt=Math.max(0,salesNum(q('#payNote')?.value));
  const attached=salesKefilAttached();
  const hint=q('#salesKefilStatusHint');
  const preview=q('#salesKefilPreview');
  if(hint){
    if(noteAmt<=0)hint.textContent='Senet tutarı girilince kefil eklenebilir';
    else if(attached)hint.textContent='Kefil seçildi — sözleşmede KEFİL kutusu dolar';
    else hint.textContent='Kefil ekle → kayıtlı müşterilerden seçin';
  }
  q('#salesKefilAddBtn')?.classList.toggle('hidden',noteAmt<=0||attached);
  q('#salesKefilClearBtn')?.classList.toggle('hidden',!attached);
  q('#salesKefilEdit')?.classList.toggle('hidden',!attached);
  if(preview){
    if(attached){
      const g=normalizeSalesGuarantor(salesReadKefilFormSafe())||{};
      preview.classList.remove('hidden');
      preview.innerHTML=`<b>${salesEsc(g.name||'-')}</b><span>TCKN ${salesEsc(g.tckn||'—')} · GSM ${salesEsc(g.phone||'—')}</span>`;
    }else{preview.classList.add('hidden');preview.innerHTML=''}
  }
}
function salesReadKefilFormSafe(){
  try{return salesReadKefilForm()}catch(_){return null}
}
function salesDetachKefil({silent=false}={}){
  if(q('#salesKefilAttached'))q('#salesKefilAttached').value='0';
  salesClearKefilForm();
  salesRefreshKefilUI();
  if(!silent)toast('Kefil kaldırıldı');
}
function closeSalesKefilPicker(){
  const m=q('#salesKefilPickerModal');
  m?.classList.add('hidden');
  m?.setAttribute('aria-hidden','true');
}
async function searchSalesKefilCustomers(term=''){
  const st=q('#salesKefilPickerStatus'),list=q('#salesKefilPickerList');
  const debtorId=String(q('#salesCustomerSelect')?.value||'');
  const qTerm=String(term||'').trim();
  if(st){st.textContent='Aranıyor...';st.className='form-status'}
  try{
    let rows=[];
    if(qTerm.length>=1){
      const d=await api('/web-api/admin/customers/search?q='+encodeURIComponent(qTerm)+'&limit=60');
      rows=d.rows||[];
    }else{
      rows=(salesCenterData.customers||[]).filter(c=>c.active!==false&&!c.deletedAt).slice(0,80);
    }
    rows=rows.filter(c=>String(c.id)!==debtorId&&c.active!==false&&!c.deletedAt);
    if(list){
      if(!rows.length){
        list.innerHTML=`<div class="note">${qTerm?'Sonuç yok.':'Müşteri listesi boş — arama yazın.'}</div>`;
      }else{
        list.innerHTML=rows.map(c=>{
          const sub=[c.phone,c.tckn?('TCKN '+c.tckn):'',[c.district,c.city].filter(Boolean).join('/')].filter(Boolean).join(' · ');
          return `<button type="button" class="sales-kefil-pick-row" data-kefil-customer="${salesEsc(c.id)}"><b>${salesEsc(c.name||'-')}</b><span>${salesEsc(sub||'—')}</span></button>`;
        }).join('');
      }
    }
    if(st){st.textContent=`${rows.length} müşteri`;st.className='form-status success'}
  }catch(e){
    if(list)list.innerHTML='';
    if(st){st.textContent=e.message||'Arama başarısız';st.className='form-status error'}
  }
}
async function openSalesKefilPicker(){
  if(Math.max(0,salesNum(q('#payNote')?.value))<=0){toast('Önce senet tutarı girin');return}
  if(!salesSelectedCustomer()){toast('Önce satış müşterisini seçin');return}
  const m=q('#salesKefilPickerModal');
  if(!m){toast('Kefil seçim penceresi bulunamadı');return}
  if(q('#salesKefilPickerSearch'))q('#salesKefilPickerSearch').value='';
  m.classList.remove('hidden');
  m.setAttribute('aria-hidden','false');
  await searchSalesKefilCustomers('');
  q('#salesKefilPickerSearch')?.focus();
}
function salesPickKefilCustomer(c){
  const g=customerToGuarantor(c);
  if(!g){toast('Seçilen müşteri kefil olarak kullanılamaz');return}
  if(String(c.id)===String(q('#salesCustomerSelect')?.value||'')){
    toast('Borçlu müşteri kefil olarak seçilemez');
    return;
  }
  salesFillKefilForm(g);
  if(q('#salesKefilAttached'))q('#salesKefilAttached').value='1';
  salesRefreshKefilUI();
  closeSalesKefilPicker();
  toast(`Kefil seçildi: ${g.name}`);
}
q('#salesKefilAddBtn')?.addEventListener('click',()=>openSalesKefilPicker());
q('#salesKefilClearBtn')?.addEventListener('click',()=>salesDetachKefil());
q('#salesKefilPickerClose')?.addEventListener('click',closeSalesKefilPicker);
q('#salesKefilPickerModal')?.addEventListener('click',e=>{if(e.target===q('#salesKefilPickerModal'))closeSalesKefilPicker()});
q('#salesKefilPickerSearch')?.addEventListener('input',()=>{
  clearTimeout(window.__kefilSearchT);
  window.__kefilSearchT=setTimeout(()=>searchSalesKefilCustomers(q('#salesKefilPickerSearch')?.value||''),220);
});
q('#salesKefilPickerList')?.addEventListener('click',async e=>{
  const btn=e.target.closest('[data-kefil-customer]');if(!btn)return;
  const id=btn.getAttribute('data-kefil-customer');
  let c=(salesCenterData.customers||[]).find(x=>String(x.id)===String(id));
  if(!c){
    try{
      const d=await api('/web-api/admin/customers/search?id='+encodeURIComponent(id)+'&limit=1');
      c=(d.rows||[])[0];
    }catch(_){}
  }
  if(!c){toast('Müşteri bulunamadı');return}
  // Merge into cache
  const map=new Map((salesCenterData.customers||[]).map(x=>[String(x.id),x]));
  map.set(String(c.id),c);
  salesCenterData.customers=[...map.values()];
  salesPickKefilCustomer(c);
});
['salesKefilWorkPhone','salesKefilHomePhone','salesKefilHomeAddress','salesKefilWorkAddress'].forEach(id=>{
  q('#'+id)?.addEventListener('input',()=>{if(salesKefilAttached())salesRefreshKefilUI()});
});



function salesFilteredProducts(){
  const itemTerm=(q('#salesItemCodeFilter')?.value||'').trim().toLocaleLowerCase('tr-TR');
  const materialTerm=(q('#salesMaterialCodeFilter')?.value||'').trim().toLocaleLowerCase('tr-TR');
  const category=(q('#salesCategoryFilter')?.value||'').trim();
  return (salesCenterData.products||[]).filter(p=>{
    const item=String(p.itemCode||'').toLocaleLowerCase('tr-TR');
    const material=`${p.code||''} ${p.searchName||''} ${p.name||''}`.toLocaleLowerCase('tr-TR');
    if(itemTerm&&!item.includes(itemTerm))return false;
    if(materialTerm&&!material.includes(materialTerm))return false;
    if(category&&String(p.category||'')!==category)return false;
    return true;
  });
}
function renderSalesProductResults(){
  const box=q('#salesProductResults');if(!box)return;
  const rows=salesFilteredProducts();
  q('#salesProductSearchCount').textContent=`${rows.length} ürün`;
  if(!rows.length){
    box.innerHTML='<div class="sales-product-results-empty">Bu filtrelere uygun ürün bulunamadı.</div>';
    return;
  }
  box.innerHTML=rows.slice(0,600).map(p=>{
    const categoryName=(salesCenterData.categories||[]).find(c=>String(c.id)===String(p.category))?.name||'';
    const madde=salesItemCode(p)||'-';
    const malzeme=salesMaterialCode(p)||'-';
    return `<button type="button" class="sales-product-card" data-sales-product-add="${p.code}">
      <span><b>${madde}</b><small>${malzeme}${categoryName?` · ${categoryName}`:''}</small></span>
      <strong>${salesMoney(salesProductUnitPrice(p,salesPreferredPriceMethod()))}</strong>
      <em>+ EKLE</em>
    </button>`;
  }).join('');
  qa('[data-sales-product-add]').forEach(btn=>btn.onclick=()=>salesAddRow(btn.dataset.salesProductAdd));
}

function refreshSalesProductSelects(){
  renderSalesProductResults();
  qa('.sales-product').forEach(sel=>{
    const current=sel.value;
    sel.innerHTML=salesProductOptions(current);
    if(current && [...sel.options].some(o=>String(o.value)===String(current))){
      sel.value=current;
    }else if(current){
      const product=(salesCenterData.products||[]).find(p=>String(p.code)===String(current));
      if(product){
        const opt=document.createElement('option');
        opt.value=product.code;
        opt.textContent=salesProductLabel(product);
        opt.dataset.name=salesProductDisplayName(product);
        opt.dataset.itemCode=salesItemCode(product);
        opt.dataset.materialCode=salesMaterialCode(product);
        sel.appendChild(opt);
        sel.value=current;
      }
    }
  });
}
q('#salesProductSearchBtn')?.addEventListener('click',refreshSalesProductSelects);
['#salesItemCodeFilter','#salesMaterialCodeFilter'].forEach(id=>q(id)?.addEventListener('input',()=>{
  clearTimeout(window.__salesSearchTimer);
  window.__salesSearchTimer=setTimeout(refreshSalesProductSelects,180);
}));
q('#salesCategoryFilter')?.addEventListener('change',refreshSalesProductSelects);
q('#salesProductSearchClear')?.addEventListener('click',()=>{
  q('#salesItemCodeFilter').value='';
  q('#salesMaterialCodeFilter').value='';
  q('#salesCategoryFilter').value='';
  refreshSalesProductSelects();
});

function salesDeductStockChanged(){
  const mode=q('#salesDeductStock')?.value||'no';
  const needWh=mode==='yes'||mode==='reserve';
  q('#salesWarehouseWrap')?.classList.toggle('hidden',!needWh);
  if(!needWh&&q('#salesWarehouse'))q('#salesWarehouse').value='';
  salesRefreshRowStocks();
}
q('#salesDeductStock')?.addEventListener('change',salesDeductStockChanged);
q('#salesWarehouse')?.addEventListener('change',salesRefreshRowStocks);
q('#salesAddRowBtn')?.addEventListener('click',()=>salesAddRow());q('#salesResetBtn')?.addEventListener('click',salesReset);
q('#salesPosAddBtn')?.addEventListener('click',salesPosQuickAdd);
q('#salesPosBarcode')?.addEventListener('keydown',e=>{
  if(e.key==='Enter'){e.preventDefault();salesPosQuickAdd()}
});
['#payCash','#payCard','#payTransfer','#payCredit','#payNote'].forEach(id=>{
  q(id)?.addEventListener('input',salesCalculate);
  q(id)?.addEventListener('change',salesCalculate);
});
function salesPayPlanIsOpen(){
  const panel=q('#salesPayPlanPanel');
  return Boolean(panel && !panel.classList.contains('hidden'));
}
function setSalesPayPlanOpen(open){
  const panel=q('#salesPayPlanPanel');
  const btn=q('#salesPayPlanToggleBtn');
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
  const c=salesCalcState();
  const current=Math.max(0,salesNum(c.splits[key]));
  const others=Math.round((c.allocated-current)*100)/100;
  const fill=Math.max(0,Math.round((c.net-others)*100)/100);
  const el=q('#'+fieldId);if(!el)return;
  el.value=String(fill);
  salesCalculate();
  salesHighlightPayRow(fieldId);
  if(fieldId==='payCard'||fieldId==='payTransfer'){
    const acc=q(fieldId==='payCard'?'#payCardAccount':'#payTransferAccount');
    if(acc&&acc.value){try{acc.focus()}catch(_){}}
    else{el.focus();el.select?.()}
  }else{
    el.focus();el.select?.();
  }
}
qa('[data-pay-fill]').forEach(btn=>{
  btn.addEventListener('click',()=>salesFillRemainingTo(btn.getAttribute('data-pay-fill')));
});
q('#salesPayPlanToggleBtn')?.addEventListener('click',()=>setSalesPayPlanOpen(!salesPayPlanIsOpen()));
q('#salesPayPlanCloseBtn')?.addEventListener('click',()=>setSalesPayPlanOpen(false));
['#salesPromissoryInstallments','#salesPromissoryInterval','#salesPromissoryFirstDue'].forEach(id=>{
  q(id)?.addEventListener('input',salesRenderPromissorySchedule);
  q(id)?.addEventListener('change',salesRenderPromissorySchedule);
});
q('#salesDealer')?.addEventListener('change',salesCalculate);
q('#salesSalesperson')?.addEventListener('change',()=>{salesApplyBranchLock();salesCalculate()});
q('#salesDiscountPct')?.addEventListener('input',salesCalculate);q('#salesDiscountPct')?.addEventListener('change',salesCalculate);
q('#salesCustomerSearchBtn')?.addEventListener('click',salesSearchCustomers);
q('#salesCustomerSearch')?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();salesSearchCustomers()}});
q('#salesCustomerSearch')?.addEventListener('input',()=>{
  clearTimeout(window.__salesCustSearchT);
  const term=String(q('#salesCustomerSearch')?.value||'').trim();
  if(term.length<1)return;
  window.__salesCustSearchT=setTimeout(()=>salesSearchCustomers(),280);
});
q('#salesCustomerSelect')?.addEventListener('change',salesCustomerChanged);

q('#salesCustomerNoteSave')?.addEventListener('click',async()=>{
  const customerId=q('#salesCustomerSelect')?.value||'';if(!customerId){toast('Önce müşteri seçin');return}
  try{
    const r=await api('/web-api/admin/customer/'+encodeURIComponent(customerId)+'/note',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({note:q('#salesCustomerNote').value||''})});
    const i=salesCenterData.customers.findIndex(c=>String(c.id)===String(customerId));if(i>=0)salesCenterData.customers[i]=r.row;
    toast('Müşteri notu kaydedildi');
  }catch(e){toast(e.message)}
});

q('#salesNewCustomerBtn')?.addEventListener('click',()=>{
  q('#salesQuickCustomerForm')?.reset();
  q('#salesQuickCustomerStatus').textContent='';
  q('#salesQuickCustomerStatus').className='form-status';
  fillCustomerForm('salesQuickCustomer',{});
  if(q('#salesQuickCustomerDeliverySame'))q('#salesQuickCustomerDeliverySame').checked=true;
  document.querySelectorAll('input[name="salesQuickCustomerInvoiceType"]').forEach(r=>{r.checked=r.value==='individual'});
  syncCustomerFormUI('salesQuickCustomer');
  q('#salesQuickCustomerModal')?.classList.remove('hidden');
  fillNextCustomerCode('salesQuickCustomer');
  q('#salesQuickCustomerFirstName')?.focus();
});
q('#salesQuickCustomerClose')?.addEventListener('click',()=>q('#salesQuickCustomerModal')?.classList.add('hidden'));
q('#salesQuickCustomerDeliverySame')?.addEventListener('change',()=>syncCustomerFormUI('salesQuickCustomer'));
document.querySelectorAll('input[name="salesQuickCustomerInvoiceType"]').forEach(r=>r.addEventListener('change',()=>onCustomerInvoiceTypeChange('salesQuickCustomer')));
q('#salesQuickCustomerForm')?.addEventListener('submit',async e=>{
  e.preventDefault();const st=q('#salesQuickCustomerStatus');
  try{
    const payload=collectCustomerPayload('salesQuickCustomer');
    st.textContent='Kaydediliyor...';st.className='form-status';
    const r=await api('/web-api/admin/customer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const row=r.row||{};
    const map=new Map((salesCenterData.customers||[]).map(c=>[String(c.id),c]));
    map.set(String(row.id),row);
    salesCenterData.customers=[...map.values()];
    if(!r.reused)salesCenterData.customerTotal=Number(salesCenterData.customerTotal||0)+1;
    if(q('#salesCustomerSearch'))q('#salesCustomerSearch').value=payload.name||row.name||'';
    q('#salesCustomerSelect').innerHTML=`<option value="${row.id}">${customerOptionLabel(row)}</option>`;
    q('#salesCustomerSelect').value=row.id;
    if(q('#salesCustomerCount'))q('#salesCustomerCount').textContent='1 sonuç';
    if(q('#salesCustomerSearchHint'))q('#salesCustomerSearchHint').textContent=r.reused?'Bu ad soyad kayıtlıydı, mevcut müşteri seçildi.':'Yeni müşteri kaydedildi ve seçildi.';
    salesCustomerChanged();
    q('#salesQuickCustomerModal').classList.add('hidden');toast(r.reused?'Bu ad soyad zaten vardı, mevcut müşteri seçildi':'Müşteri kaydedildi ve satışa seçildi.');
  }catch(err){st.textContent=err.message;st.className='form-status error'}
});



function salesInvoiceChanged(){
  const issued=q('#salesInvoiceStatus')?.value==='issued';
  q('#salesInvoiceIssuedFields')?.classList.toggle('hidden',!issued);
  if(issued && !q('#salesInvoiceDate').value)q('#salesInvoiceDate').value=q('#salesDate').value||new Date().toISOString().slice(0,10);
}
q('#salesInvoiceStatus')?.addEventListener('change',salesInvoiceChanged);

function collectSalesDraft(){
  const status=q('#salesStatus'),customerId=q('#salesCustomerSelect').value,warehouseId=q('#salesWarehouse').value;
  const customer=salesCenterData.customers.find(c=>String(c.id)===String(customerId));
  const warehouse=salesCenterData.warehouses.find(w=>String(w.id)===String(warehouseId));
  const items=qa('.sales-row').map(row=>{
    const select=row.querySelector('.sales-product'),opt=select.selectedOptions[0];
    const product=(salesCenterData.products||[]).find(p=>String(p.code)===String(select.value));
    const itemCode=opt?.dataset.itemCode||salesItemCode(product)||'';
    const materialCode=opt?.dataset.materialCode||salesMaterialCode(product)||select.value;
    return{
      productCode:select.value,
      itemCode,
      materialCode,
      productName:materialCode||opt?.dataset.name||select.value,
      quantity:salesNum(row.querySelector('.sales-qty').value),
      unitPrice:salesNum(row.querySelector('.sales-price').value)
    };
  }).filter(i=>i.productCode&&i.quantity>0);
  const calc=salesCalcState();
  const splits=calc.splits;
  const payments=[];
  if(splits.cash>0)payments.push({method:'Nakit',amount:splits.cash,accountId:splits.cashAccountId});
  if(splits.card>0)payments.push({method:'Kredi Kartı',amount:splits.card,accountId:splits.cardAccountId});
  if(splits.transfer>0)payments.push({method:'Havale',amount:splits.transfer,accountId:splits.transferAccountId});
  if(splits.credit>0)payments.push({method:'Vadeli',amount:splits.credit,accountId:''});
  const promissory=splits.note>0?{
    amount:splits.note,
    installments:Math.min(36,Math.max(1,Math.round(salesNum(q('#salesPromissoryInstallments')?.value)||1))),
    intervalMonths:Math.min(12,Math.max(1,Math.round(salesNum(q('#salesPromissoryInterval')?.value)||1))),
    firstDueDate:q('#salesPromissoryFirstDue')?.value||'',
    description:q('#salesPromissoryDescription')?.value||'Ürün satışı senet planı',
    schedule:salesBuildPromissorySchedule(splits.note,q('#salesPromissoryInstallments')?.value,q('#salesPromissoryFirstDue')?.value,q('#salesPromissoryInterval')?.value)
  }:null;
  const dealerId=q('#salesDealer')?.value||'',dealer=calc.dealer,discountPct=calc.discountPct,grossTotal=calc.gross,total=calc.net;
  const stockModeRaw=q('#salesDeductStock')?.value||'no';
  const stockMode=stockModeRaw==='yes'?'deduct':(stockModeRaw==='reserve'?'reserve':'none');
  const deductStock=stockMode==='deduct';
  const reserveStock=stockMode==='reserve';
  const salespersonId=q('#salesSalesperson')?.value||'',salesperson=salesCenterData.salespeople.find(p=>String(p.id)===String(salespersonId));
  const billingParty=customerHasCorporate(customer||{})
    ?(q('#salesBillingParty')?.value==='corporate'?'corporate':'individual')
    :'individual';
  let guarantor=null;
  if(promissory&&salesKefilAttached()){
    try{guarantor=salesReadKefilForm()}
    catch(err){return{error:err.message||'Kefil bilgisi geçersiz.',status,customerId,customer}}
    if(!guarantor)return{error:'Kefil eklendi ancak ad soyad boş. Doldurun veya kefili kaldırın.',status,customerId,customer};
  }
  const draft={status,customerId,customer,billingParty,dealerId,dealer,salespersonId,salesperson,discountPct,discountAmount:calc.discountAmount,commissionPct:calc.commissionPct,commissionAmount:calc.commission,grossTotal,warehouseId,warehouse,deductStock,reserveStock,stockMode,items,total,paid:calc.paid,due:calc.due,method:calc.method,payments,promissory,guarantor,allocated:calc.allocated,remaining:calc.remaining,date:q('#salesDate').value,description:q('#salesDescription').value||'Mağaza satışı',invoiceStatus:q('#salesInvoiceStatus')?.value||'not_required',invoiceNumber:q('#salesInvoiceNumber')?.value||'',invoiceDate:q('#salesInvoiceDate')?.value||''};
  if(!customerId)return{error:'Müşteri seçmelisiniz.',...draft};
  if(billingParty==='corporate'&&!customerHasCorporate(customer))return{error:'Kurumsal fatura için müşteri kartına firma / VKN ekleyin.',...draft};
  if(!dealer)return{error:'Satış bayisini seçmelisiniz.',...draft};
  if(!salesperson)return{error:'Satış personelini seçmelisiniz.',...draft};
  if(!items.length)return{error:'En az bir ürün eklemelisiniz.',...draft};
  if((deductStock||reserveStock)&&!warehouseId)return{error:reserveStock?'Rezerve etmek için satış deposu seçmelisiniz.':'Stoktan düşmek için satış deposu seçmelisiniz.',...draft};
  if(total>0&&Math.abs(calc.remaining)>0.009)return{error:`Ödeme dağılımı net tutara eşit olmalı. Kalan: ${salesMoney(calc.remaining)}`,...draft};
  if(draft.payments.some(p=>['Nakit','Kredi Kartı','Havale'].includes(p.method)&&p.amount>0&&!p.accountId)){
    if(splits.card>0&&!splits.cardAccountId)return{error:'Kart ödemesi için banka / POS hesabı seçin. (Ayarlar → Tür: Banka)',...draft};
    if(splits.transfer>0&&!splits.transferAccountId)return{error:'Havale için banka hesabı seçin. (Ayarlar → Tür: Banka)',...draft};
    return{error:'Nakit / kart / havale için hesap seçmelisiniz.',...draft};
  }
  const accById=id=>(salesCenterData.accounts||[]).find(a=>String(a.id)===String(id));
  if(splits.card>0){
    const a=accById(splits.cardAccountId);
    if(!a||a.type!=='bank')return{error:'Kart için hesap Türü Banka olmalı. Ayarlar’da hesabı Banka yapın veya yeni banka ekleyin.',...draft};
  }
  if(splits.transfer>0){
    const a=accById(splits.transferAccountId);
    if(!a||a.type!=='bank')return{error:'Havale için hesap Türü Banka olmalı.',...draft};
  }
  if(splits.cash>0){
    const a=accById(splits.cashAccountId);
    if(a&&a.type==='bank'){/* bankaya nakit de yazılabilir — izin */ }
  }
  if(promissory){
    if(!promissory.firstDueDate)return{error:'Senet için ilk vade tarihini girin.',...draft};
    if(!promissory.schedule.length)return{error:'Senet takvimi oluşturulamadı. Vade tarihini kontrol edin.',...draft};
  }
  if(draft.invoiceStatus==='issued'&&!draft.invoiceNumber.trim())return{error:'Manuel faturalandı seçildiğinde fatura numarası zorunludur.',...draft};
  return draft;
}
function salesPreviewHtml(d){
  const rows=d.items.map(i=>`<tr><td>${i.itemCode||'-'}</td><td>${i.materialCode||i.productName||i.productCode}</td><td>${i.quantity}</td><td>${salesMoney(i.unitPrice)}</td><td>${salesMoney(i.quantity*i.unitPrice)}</td></tr>`).join('');
  const payRows=(d.payments||[]).map(p=>`<div class="sales-total-line"><span>${p.method}${p.method==='Havale'?' · Ödemeler’den tahsil':(p.accountId?' · hesap seçildi':'')}</span><b>${salesMoney(p.amount)}</b></div>`).join('');
  const havaleAmt=Math.round(((d.payments||[]).filter(p=>p.method==='Havale').reduce((a,p)=>a+Number(p.amount||0),0))*100)/100;
  const havaleNote=havaleAmt>0?`<div class="preview-note"><b>Havale:</b> ${salesMoney(havaleAmt)} kasa/bankaya yazılmaz. Yönetici Müşteri Ödemeleri’nden tahsil eder.</div>`:'';
  const note=d.promissory?`<div class="preview-note"><b>⚠ Senet düzenlemesi:</b> ${salesMoney(d.promissory.amount)} · ${d.promissory.installments} taksit · İlk vade ${d.promissory.firstDueDate}<br>${(d.promissory.schedule||[]).map(r=>`${r.no}) ${r.dueDate} → ${salesMoney(r.amount)}`).join(' · ')}</div>`:'';
  const kefilNote=d.guarantor?`<div class="preview-note"><b>Kefil:</b> ${salesEsc(d.guarantor.name||'')}${d.guarantor.tckn?' · TCKN '+salesEsc(d.guarantor.tckn):''}${d.guarantor.phone?' · '+salesEsc(d.guarantor.phone):''}</div>`:'';
  const invLabel=d.invoiceStatus==='issued'
    ?`Manuel kesildi · ${d.invoiceNumber} · ${d.invoiceDate||d.date}`
    :(d.invoiceStatus==='queue_qnb'?'QNB Solist ile kesilecek (e-Fatura / e-Arşiv kuyruğu)'
      :(d.invoiceStatus==='pending'?'Daha sonra kesilecek (e-Fatura Merkezi)':'Fatura gerekmiyor'));
  const billLabel=d.billingParty==='corporate'
    ?`Kurumsal · ${d.customer?.companyName||'-'} · VKN ${d.customer?.taxNo||'-'}`
    :`Bireysel · ${d.customer?.name||'-'} · TCKN ${d.customer?.tckn||'—'}`;
  const stockLabel=d.deductStock
    ?`Stoktan düşülecek · ${d.warehouse?.name||'-'}`
    :(d.reserveStock
      ?`Rezerve edilecek · ${d.warehouse?.name||'-'} (teslimde düşülür)`
      :'Stok değişmeyecek');
  return `<div class="preview-cards"><div><small>Şahıs / Senet</small><b>${d.customer?.name||'-'}</b><span>${d.customer?.phone||''}${d.customer?.tckn?' · TCKN '+d.customer.tckn:''}</span></div><div><small>Bayi / Satıcı</small><b>${d.dealer?.name||'-'}</b><span>${d.salesperson?.name||'-'}</span></div><div><small>Ödeme</small><b>${d.method}</b><span>Şimdi tahsil: ${salesMoney(d.paid)}</span></div></div><div class="table-wrap"><table><thead><tr><th>Madde Kodu</th><th>Malzeme</th><th>Adet</th><th>Birim</th><th>Toplam</th></tr></thead><tbody>${rows}</tbody></table></div><div class="preview-totals"><div><span>Brüt Toplam</span><b>${salesMoney(d.grossTotal)}</b></div><div><span>İskonto (%${String(d.discountPct||0).replace('.',',')})</span><b>-${salesMoney(d.discountAmount||0)}</b></div><div><span>Net Satış</span><b>${salesMoney(d.total)}</b></div>${payRows}<div><span>Personel Prim (%${String(d.commissionPct||0).replace('.',',')})</span><b>${salesMoney(d.commissionAmount||0)}</b></div><div><span>Cari / senet / havale</span><strong>${salesMoney(d.due)}</strong></div></div>${havaleNote}${note}${kefilNote}<div class="preview-note"><b>Fatura tarafı:</b> ${billLabel}<br><b>Fatura durumu:</b> ${invLabel}</div><div class="preview-stock-choice"><b>Stok işlemi:</b> ${stockLabel}<small>Rezerve: satışta tutulur, teslim edilince fiziksel düşülür.</small></div><div class="preview-description"><b>Açıklama:</b> ${d.description||'-'}</div>`;
}
let activeSalesDraft=null;
function openSalesPreview(){
  const d=collectSalesDraft();if(d.error){d.status.textContent=d.error;d.status.className='form-status error';return}
  activeSalesDraft=d;q('#salesPreviewBody').innerHTML=salesPreviewHtml(d);q('#salesPreviewModal').classList.remove('hidden');q('#salesPreviewModal').setAttribute('aria-hidden','false');document.body.classList.add('modal-open');
  const docsBtn=q('#salesPreviewDocsBtn');
  if(docsBtn){
    docsBtn.classList.toggle('has-senet',Boolean(d.promissory));
    docsBtn.textContent=d.promissory?'📄 Sözleşme + Senet (Tek A4)':'📄 Sözleşme (Tek A4)';
  }
}
function closeSalesPreview(){q('#salesPreviewModal').classList.add('hidden');q('#salesPreviewModal').setAttribute('aria-hidden','true');document.body.classList.remove('modal-open')}
function salesEsc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
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
function salesPrintCss(){
  return `@page{size:A4;margin:12mm}*{box-sizing:border-box}body{margin:0;background:#d9e2ec;color:#13233f;font:10pt/1.45 Arial,Helvetica,sans-serif}
.toolbar{position:sticky;top:0;z-index:5;display:flex;flex-wrap:wrap;gap:8px;justify-content:center;align-items:center;padding:12px;background:#0b2a55;color:#fff}
.toolbar button,.toolbar a.btn{border:0;border-radius:8px;padding:10px 14px;font-weight:800;cursor:pointer;background:#fff;color:#0b2a55;text-decoration:none;display:inline-block;font:inherit}
.toolbar button.primary,.toolbar a.btn.primary{background:#dda20c;color:#1a1300}
.toolbar a.btn.wa{background:#25D366;color:#063}
.toolbar span.hint{opacity:.9;font-size:12px}
.sheet{width:210mm;min-height:297mm;margin:16px auto;background:#fff;padding:14mm;box-shadow:0 10px 30px #0002;page-break-after:always}
.sheet:last-child{page-break-after:auto}
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
.senet .top{display:flex;justify-content:space-between;border-bottom:2px solid #0b2a55;padding-bottom:10px}.senet .top b{font-size:26px;color:#0b2a55}
.senet .amount{font-size:34px;font-weight:900;color:#0b2a55;margin:18px 0 8px}.senet .words{font-size:12px;color:#4b5b73;margin-bottom:14px}
.footer{font-size:11px;color:#66768d;margin-top:14px}.hint{font-size:11px;color:#8a96a8;margin-top:4px}
@media print{body{background:#fff}.toolbar{display:none!important}.sheet{margin:0;box-shadow:none;width:auto;min-height:297mm;height:297mm;padding:0}}`;
}
function salesCustomerPrintTotals(d){
  const pay=(d.payments||[]).map(p=>`<div><span>${salesEsc(p.method)}</span><b>${salesMoney(p.amount)}</b></div>`).join('');
  const note=d.promissory?`<div><span>Senet</span><b>${salesMoney(d.promissory.amount)}</b></div>`:'';
  return `<div class="totals">
    <div><span>Brüt Toplam</span><b>${salesMoney(d.grossTotal)}</b></div>
    <div><span>İskonto (%${String(d.discountPct||0).replace('.',',')})</span><b>-${salesMoney(d.discountAmount||0)}</b></div>
    <div class="net"><span>Net Satış</span><b>${salesMoney(d.total)}</b></div>
    ${pay}${note}
    <div><span>Ödeme şekli</span><b>${salesEsc(d.method||'-')}</b></div>
  </div>`;
}
function salesOfferSheetHtml(d){
  const rows=(d.items||[]).map(i=>`<tr><td>${salesEsc(i.itemCode||'-')}</td><td>${salesEsc(i.materialCode||i.productName||i.productCode)}</td><td class="num">${i.quantity}</td><td class="num">${salesMoney(i.unitPrice)}</td><td class="num">${salesMoney(i.quantity*i.unitPrice)}</td></tr>`).join('');
  const addr=[d.customer?.address,d.customer?.district,d.customer?.city].filter(Boolean).join(', ');
  return `<section class="sheet">
    <div class="doc-head"><div class="brand">ATAK PAZARLAMA<small>Satış Teklifi · Müşteri kopyası</small></div>
      <div class="doc-meta"><b>TEKLİF</b><div>Tarih: ${salesEsc(d.date||'')}</div><div>Bayi: ${salesEsc(d.dealer?.name||'')}</div><div>Satıcı: ${salesEsc(d.salesperson?.name||'')}</div></div></div>
    <h2>SATIŞ TEKLİFİ</h2>
    <div class="grid2">
      <div class="box"><small>Müşteri</small><b>${salesEsc(d.customer?.name||'-')}</b><div>${salesEsc(d.customer?.phone||'')}</div></div>
      <div class="box"><small>Geçerlilik</small><b>3 iş günü</b><div>Fiyatlar stok / kampanya durumuna göre değişebilir</div></div>
      <div class="box" style="grid-column:1/-1"><small>Adres</small><b>${salesEsc(addr||'-')}</b></div>
    </div>
    <table><thead><tr><th>Kod</th><th>Ürün / Malzeme</th><th class="num">Adet</th><th class="num">Birim</th><th class="num">Tutar</th></tr></thead><tbody>${rows}</tbody></table>
    ${salesCustomerPrintTotals(d)}
    ${d.promissory?`<div class="note-line"><b>Senet planı:</b> ${salesMoney(d.promissory.amount)} · ${d.promissory.installments} taksit · İlk vade ${salesEsc(d.promissory.firstDueDate)}<br>${(d.promissory.schedule||[]).map(r=>`${r.no}) ${r.dueDate} → ${salesMoney(r.amount)}`).join(' · ')}</div>`:''}
    ${d.description?`<div class="note-line"><b>Not:</b> ${salesEsc(d.description)}</div>`:''}
    <div class="terms"><b>Notlar</b><ol><li>Bu belge tekliftir; sipariş onayı / satış kaydı sonrası sözleşme ve senet basılır.</li><li>Mali fatura yerine geçmez.</li></ol></div>
    <div class="signs"><div class="sig"><small>Satış Temsilcisi</small>${salesEsc(d.salesperson?.name||'')}</div><div class="sig"><small>Müşteri</small>${salesEsc(d.customer?.name||'')}</div></div>
  </section>`;
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
  const atakLogoSrc='/web-admin-assets/atak-header-logo.png';
  const bekoLogoSrc='/web-admin-assets/beko-logo.png';
  const istikbalLogoSrc='/web-admin-assets/istikbal-logo.png';
  const partnersLogoSrc='/web-admin-assets/partners-beko-istikbal.png';
  const atakLogoWhiteSrc='/web-admin-assets/atak-header-logo-white.png';
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
  const dateTR=x=>{const s=String(x||'').slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return salesEsc(s||'');const[y,m,day]=s.split('-');return `${day}.${m}.${y}`};
  const maxProducts=6;
  const shownItems=items.slice(0,maxProducts);
  const moreProducts=Math.max(0,items.length-shownItems.length);
  const emptyRows=shownItems.length?0:1;
  const productRows=(shownItems.map(i=>{const qty=Number(i.quantity||1);const total=i.total!=null?i.total:qty*Number(i.unitPrice||0);const matName=i.productName||i.materialCode||i.searchName||i.name||i.productCode||i.itemCode||'-';return `<tr><td class="mat">${salesEsc(matName)}</td><td class="c">${qty}</td><td class="num">${salesMoney(i.unitPrice)}</td><td class="num">${salesMoney(total)}</td></tr>`;}).join('')||'')+Array.from({length:emptyRows},()=>'<tr><td>&nbsp;</td><td></td><td></td><td></td></tr>').join('')+(moreProducts?`<tr class="more"><td colspan="4">+${moreProducts} ürün daha (toplam ${items.length} kalem)</td></tr>`:'');
  const schedShow=noteList.slice(0,10);
  const scheduleRows=(schedShow.map(n=>`<tr><td class="c">${dateTR(n.dueDate)}</td><td class="num">${salesMoney(n.amount)}</td></tr>`).join('')||'<tr><td>&nbsp;</td><td></td></tr>')+`<tr class="tot"><td class="c">TOPLAM</td><td class="num">${salesMoney(balance||senetTotal)}</td></tr>`;
  const partyRows=who=>[['Adı Soyadı',who.name||'','nm'],['T.C. Kimlik No',who.tckn||who.taxNo||'',''],['GSM',who.phone||who.gsm||'',''],['Adres',who.homeAddress||who.address||'','']].map(([l,v,cls])=>`<tr><td class="lbl">${l}</td><td class="${cls}">${salesEsc(v)}</td></tr>`).join('');
  const corpLine=customerHasCorporate(d.customer||{})?`<div class="pay">Fatura firması: <b>${salesEsc(d.customer.companyName||'')}</b> · VKN ${salesEsc(d.customer.taxNo||'')} · ${salesEsc(d.customer.taxOffice||'')}</div>`:'';
  const denseClass=shownItems.length>=4?' dense':'';
  // Tek senet: tutar = yazılan toplam; taksitler sözleşmede
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
  const moreSenets=noteList.length>1?`<div class="note">Tek senet tutarı toplam bakiyedir (${salesMoney(senetAmount)}). ${noteList.length} taksitin vade planı yukarıdaki tablodadır.</div>`:'';
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
  <div class="top"><div class="head-left"><div class="logo-top"><img src="${atakLogoSrc}" alt="ATAK Pazarlama"/></div><div class="name">${salesEsc(companyLegal)}</div></div><div class="mid-head"><div class="title">SATIŞ SÖZLEŞMESİ</div></div><div class="meta-row"><div class="meta-texts"><div class="meta addr">${salesEsc(address)}</div><div class="meta">${salesEsc(phone)} · ${salesEsc(wa)} · ${salesEsc(email)} · ${salesEsc(companyTaxLine)}</div></div><div class="partners"><img src="${partnersLogoSrc}" alt="beko · istikbal" class="partners-strip"/></div></div></div>
  <div class="rule"></div>
  <div class="grid3">
    <table class="prods"><thead><tr><th class="mat" style="width:58%">Malzeme</th><th style="width:10%">Adet</th><th style="width:16%">Birim</th><th style="width:16%">Tutar</th></tr></thead><tbody>${productRows}</tbody></table>
    <table class="mmeta"><tr><td>Satış Tarihi</td><td>${dateTR(d.date)}</td></tr><tr><td>Satış No</td><td>${salesEsc(saleRef)}</td></tr><tr><td>Müşteri No</td><td>${salesEsc(d.customer?.code||d.customer?.id||'')}</td></tr><tr><td>Toplam</td><td>${salesMoney(net)}</td></tr><tr><td>Peşinat</td><td>${salesMoney(downPayment)}</td></tr><tr><td>Bakiye</td><td>${salesMoney(balance)}</td></tr></table>
    <table><thead><tr><th>Vade</th><th>Taksit</th></tr></thead><tbody>${scheduleRows}</tbody></table>
  </div>${corpLine}
  <div class="parties"><div class="box"><h3>KEFİL</h3><table>${partyRows(guarantor)}</table></div><div class="box"><h3>BORÇLU</h3><table>${partyRows({name:personName,tckn:personTax,phone:d.customer?.phone||'',address:addr})}</table></div></div>
  <div class="pay"><b>Ödeme:</b> ${salesEsc(d.method||'-')}${(d.payments||[]).length?` · ${(d.payments||[]).map(p=>`${salesEsc(p.method||'')}: ${salesMoney(p.amount)}`).join(' · ')}`:''}${d.salesperson?.name?` · Satıcı: ${salesEsc(d.salesperson.name)}`:''}</div>
  <div class="terms"><h4>ANLAŞMA ŞARTLARI</h4>
  <p><b>1)</b> Alıcı / borçlu, ${salesEsc(companyLegal)}’nden yukarıda cinsi, adedi, özellikleri ve bedeli yazılı ürünleri görüp beğenerek satın almıştır. Peşinat ve taksit tutarlarını vade tarihlerinde, satıcının şube adreslerine makbuz karşılığı ödemeyi kabul ve taahhüt eder. Senetler bu sözleşmenin eki ve ayrılmaz parçasıdır.</p>
  <p><b>2)</b> Taksitlerden herhangi birinin vadesinde ödenmemesi halinde aylık %4 gecikme faizi uygulanır. Ayrıca bakiye üzerinden %20 oranında cezai şart talep edilebilir. Bir taksitin ödenmemesi halinde kalan tüm taksitler muaccel olur; satıcı yasal takip ve tahsilat masraflarını borçludan / kefilden isteyebilir. 4077 sayılı Tüketicinin Korunması Hakkında Kanun hükümleri saklıdır.</p>
  <p><b>3)</b> Ürünlerin teslimi, satıcının alıcı hakkında yapacağı olumlu kredi / risk değerlendirmesine bağlıdır. Beyaz eşya, mobilya, mutfak ve benzeri ürünler üretici / ithalatçı garanti şartlarına tabidir. Montaj ve onarım yetkili servislerce yapılır; aksi halde garanti kapsamı dışına çıkılabilir.</p>
  <p><b>4)</b> Taraflar işbu sözleşmeyi okuyup müzakere ederek imzalamışlardır. Uyuşmazlıklarda İstanbul Mahkemeleri ve İcra Daireleri yetkilidir. Kefil, borçlu ile birlikte müteselsil sorumludur. Bu belge mali fatura yerine geçmez; 4077 sayılı Kanun ve ilgili mevzuat hükümleri uygulanır.</p></div>
  <div class="signs">
    <div class="sig"><b>SATICI</b><small>Kaşe / İmza</small><div class="nm">${salesEsc(companyLegal)}</div><div class="sigpad"><span>İmza / Kaşe</span></div></div>
    <div class="sig"><b>KEFİL</b><small>İşbu anlaşmadaki yazılı bütün şartları borçlu gibi okudum ve aynen kabul ettim.</small><div class="nm">${salesEsc(guarantor.name||'')}</div><div class="sigpad"><span>Kefil İmza</span></div></div>
    <div class="sig"><b>BORÇLU</b><small>İşbu anlaşmadaki yazılı bütün şartları okudum ve aynen kabul ettim.</small><div class="nm">${salesEsc(personName||'')}</div><div class="sigpad"><span>Borçlu İmza</span></div></div>
  </div>
  <div class="grow"><div class="senet"><div class="senet-side"><div class="senet-logo"><img src="${atakLogoWhiteSrc}" alt="ATAK Pazarlama"/></div><div>${salesEsc(address)}<br/>${salesEsc(phone)}<br/>${salesEsc(email)}<br/>${salesEsc(companyTaxLine)}</div></div>
  <div class="senet-main"><div class="senet-bar"><b>SENET</b></div>
  <div class="fields"><div><span>Vade</span><b>${dateTR(senetDue)}</b></div><div><span>Hululü Vade</span><b>${dateTR(senetDue)}</b></div><div><span>Türk Lirası</span><b>${senetAmtHash}</b></div><div><span>No.</span><b>${salesEsc(senetNo)}</b></div></div>
  <p class="sbody">İşbu emre muharrer bono mukabilinde <u>${dateTR(senetDue)||'........'}</u> tarihinde <b>${salesEsc(companyLegal)}</b> veyahut emruhavalesine yukarıda yazılı Yalnız <u>${salesEsc(senetWordsOnly||'....................')}</u> Türk Lirası ödeyeceğim. Bedeli nakden ahzolunmuştur. İşbu bono vadesinde ödenmediği takdirde müteakip bonoların da muacceliyet kesbedeceğini, ihtilaf vukuunda <b>İSTANBUL</b> Mahkemelerinin selahiyetini şimdiden kabul eylerim.</p>
  <div class="duo">
    <div><div class="lab">Ödeyecek / Borçlu</div>
      <div class="row"><span class="k">İsim</span><span class="v nm">${salesEsc(personName)||'—'}</span></div>
      <div class="row"><span class="k">T.C. Kimlik No</span><span class="v">${salesEsc(personTax||'')||'—'}</span></div>
      <div class="row"><span class="k">Adres</span><span class="v">${salesEsc(addr||'')||'—'}</span></div>
      <div class="row imza-row"><span class="k">Borçlu İmza</span><span class="v imza-line">&nbsp;</span></div></div>
    <div><div class="lab">Müteselsil Borçlu / Kefil</div>
      <div class="row"><span class="k">İsim</span><span class="v nm">${salesEsc(guarantor.name||'')||'—'}</span></div>
      <div class="row"><span class="k">T.C. Kimlik No</span><span class="v">${salesEsc(guarantor.tckn||guarantor.taxNo||'')||'—'}</span></div>
      <div class="row"><span class="k">Adres</span><span class="v">${salesEsc(guarantor.homeAddress||guarantor.address||'')||'—'}</span></div>
      <div class="row imza-row"><span class="k">Kefil İmza</span><span class="v imza-line">&nbsp;</span></div></div>
  </div>
  ${moreSenets}</div></div></div>
</section>`;
}
function salesContractSheetHtml(d){return salesCombinedContractSenetA4Html(d)}
function salesSenetSheetsHtml(){return ''}
function openSalesPrintWindow(title,bodyHtml,opts={}){
  const w=window.open('','_blank');
  if(!w){toast('Tarayıcı yeni sekmeyi engelledi. Açılır pencerelere izin verin.');return null}
  const wa=opts.whatsappUrl?`<a class="btn wa" href="${salesEsc(opts.whatsappUrl)}" target="_blank" rel="noopener">WhatsApp Gönder</a>`:'';
  w.document.open();
  w.document.write(`<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${salesEsc(title)}</title><style>${salesPrintCss()}</style></head><body>
    <div class="toolbar"><b>${salesEsc(title)}</b><button class="primary" onclick="window.print()">Yazdır / PDF Kaydet</button>${wa}<button onclick="window.close()">Kapat</button><span class="hint">Önce şablonu yazdırın; dilerseniz WhatsApp ile gönderin</span></div>
    ${bodyHtml}
  </body></html>`);
  w.document.close();
  try{w.focus()}catch(_){}
  return w;
}
function salesOfferText(d){
  const pay=(d.payments||[]).map(p=>`${p.method}: ${salesMoney(p.amount)}`).join('\n');
  const note=d.promissory?`\nSenet: ${salesMoney(d.promissory.amount)} / ${d.promissory.installments} taksit / ilk vade ${d.promissory.firstDueDate}`:'';
  return `ATAK PAZARLAMA TEKLİF\nMüşteri: ${d.customer?.name||''}\n${d.items.map(i=>`${i.quantity} x ${i.itemCode||'-'} / ${i.materialCode||i.productName} - ${salesMoney(i.quantity*i.unitPrice)}`).join('\n')}\n\nBrüt: ${salesMoney(d.grossTotal)}\nİskonto (%${String(d.discountPct||0).replace('.',',')}): -${salesMoney(d.discountAmount||0)}\nNet Toplam: ${salesMoney(d.total)}\nÖdeme:\n${pay}${note}\n${d.description||''}`;
}
function salesOfferWhatsAppUrl(d){
  const phone=String(d.customer?.phone||'').replace(/\D/g,'');
  if(!phone)return '';
  const trPhone=phone.startsWith('0')?'90'+phone.slice(1):(phone.startsWith('90')?phone:'90'+phone);
  return `https://wa.me/${trPhone}?text=${encodeURIComponent(salesOfferText(d))}`;
}
function sendSalesOfferWhatsAppOnly(){
  const d=activeSalesDraft||collectSalesDraft();if(d.error)return toast(d.error);
  const url=salesOfferWhatsAppUrl(d);
  if(!url){navigator.clipboard?.writeText(salesOfferText(d));toast('Müşterinin telefonu yok. Teklif metni panoya kopyalandı.');return}
  const win=window.open(url,'_blank');
  if(!win){navigator.clipboard?.writeText(salesOfferText(d));toast('Tarayıcı yeni pencereyi engelledi. Teklif panoya kopyalandı.')}
}
/** Teklif: yazdırılabilir şablon açılır (+ WhatsApp butonu) */
function sendSalesOffer(){
  const d=activeSalesDraft||collectSalesDraft();if(d.error)return toast(d.error);
  activeSalesDraft=d;
  const wa=salesOfferWhatsAppUrl(d);
  const w=openSalesPrintWindow('Atak Pazarlama · Satış Teklifi',salesOfferSheetHtml(d),{whatsappUrl:wa||undefined});
  if(!w)return;
  toast(wa?'Teklif şablonu açıldı — Yazdır / PDF veya WhatsApp':'Teklif şablonu açıldı — WhatsApp için müşteri telefonu girin');
}
function printSalesPreview(){
  const d=activeSalesDraft||collectSalesDraft();if(d.error)return toast(d.error);
  activeSalesDraft=d;
  openSalesPrintWindow('Atak Pazarlama · Satış Teklifi',salesOfferSheetHtml(d),{whatsappUrl:salesOfferWhatsAppUrl(d)||undefined});
}
async function printSalesContractAndNotes(){
  const d=activeSalesDraft||collectSalesDraft();if(d.error)return toast(d.error);
  try{await loadSalesPromissoryDefaults()}catch(_){}
  if(!d.promissory)toast('Senet yok — tek A4 sözleşme açılıyor. Senet için ödeme satırına Senet tutarı girin.');
  openSalesPrintWindow('Atak Pazarlama · Sözleşme + Senet (Tek A4)',salesCombinedContractSenetA4Html(d));
}
async function salesIssueInvoiceNow(){
  // Önce satışı kaydet / önizlemeden fatura niyeti
  if(q('#salesInvoiceStatus'))q('#salesInvoiceStatus').value='queue_qnb';
  const d=collectSalesDraft();
  if(d.error){toast(d.error);return}
  activeSalesDraft=d;
  openSalesPreview();
  toast('Fatura: Önizlemede “Satışı Yap” deyince QNB Solist kuyruğuna alınır');
  const hint=q('#salesStatus');
  if(hint){hint.textContent='Fatura Kes seçildi → satışı onaylayınca QNB kuyruğa düşer (e-Fatura / e-Arşiv).';hint.className='form-status success'}
}
async function confirmSalesDraft(){
  const d=activeSalesDraft||collectSalesDraft();if(d.error){toast(d.error);return}
  const stockMode=d.stockMode||(d.deductStock?'deduct':(d.reserveStock?'reserve':'none'));
  if((stockMode==='deduct'||stockMode==='reserve')&&!d.warehouseId){toast(stockMode==='reserve'?'Rezerve için depo seçin':'Stoktan düşmek için depo seçin');return}
  const status=d.status,btn=q('#salesPreviewConfirmBtn');btn.disabled=true;btn.textContent='Satış Yapılıyor...';status.textContent='';
  try{
    const invoiceStatus=d.invoiceStatus==='queue_qnb'?'pending':d.invoiceStatus;
    const result=await api('/web-api/admin/customer-sale',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      completeSaleId:completingSaleId||undefined,
      customerId:d.customerId,dealerId:d.dealerId,salespersonId:d.salespersonId,salespersonName:d.salesperson?.name||'',
      discountPct:d.discountPct,warehouseId:d.warehouseId,date:d.date,paymentMethod:d.method,
      payments:d.payments,promissory:d.promissory,guarantor:d.guarantor||null,billingParty:d.billingParty||'individual',
      description:d.description,items:d.items,invoiceStatus,invoiceNumber:d.invoiceNumber,invoiceDate:d.invoiceDate,
      stockMode,deductStock:stockMode==='deduct',reserveStock:stockMode==='reserve'
    })});
    let noteText='';
    (result.collections||[]).forEach(c=>{if(c?.id)window.open('/web-api/admin/receipt/'+c.id,'_blank')});
    if(result.docsUrl){
      noteText=result.promissory?.notes?.length?` · senet+sözleşme (tek A4)`:' · sözleşme (tek A4)';
      window.open(result.docsUrl,'_blank');
    }else if(result.promissory?.printUrl){
      noteText=` · ${result.promissory.notes?.length||0} senet oluşturuldu`;
      window.open(result.promissory.printUrl,'_blank');
    }
    const createdSaleId=result.sale?.id||result.saleId||result.id;
    if(d.invoiceStatus==='queue_qnb'&&createdSaleId){
      try{
        const inv=await api('/web-api/admin/sale/'+encodeURIComponent(createdSaleId)+'/issue-invoice',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({billingParty:d.billingParty||'individual'})});
        noteText+=` · fatura ${inv.result?.docType||''} (${inv.record?.status||'kuyruk'})`;
      }catch(invErr){noteText+=` · fatura uyarısı: ${invErr.message}`}
    }
    closeSalesPreview();status.textContent=`Satış kaydedildi. Yeni cari bakiye: ${salesMoney(result.balance)}${noteText}`;status.className='form-status success';
    salesReset();
    try{await check()}catch(_){}
    try{goTab('dashboard')}catch(_){}
    try{await renderDashboardRevenue()}catch(_){}
    try{await renderV4FinancePreview()}catch(_){}
    toast('Satış kaydedildi · Dashboard güncellendi');
  }catch(e){status.textContent=e.message;status.className='form-status error'}finally{btn.disabled=false;btn.textContent='✓ Kontrol Ettim, Satışı Yap'}
}
q('#salesSaveBtn')?.addEventListener('click',openSalesPreview);
q('#salesJumpPreviewBtn')?.addEventListener('click',openSalesPreview);
q('#salesFooterResetBtn')?.addEventListener('click',salesReset);
q('#salesWizardNext1')?.addEventListener('click',salesWizardNext);
q('#salesWizardNext2')?.addEventListener('click',salesWizardNext);
q('#salesWizardBack2')?.addEventListener('click',salesWizardBack);
q('#salesWizardBack3')?.addEventListener('click',salesWizardBack);
q('#salesWizardDocsBtn')?.addEventListener('click',()=>printSalesContractAndNotes());
q('#salesWizardOfferBtn')?.addEventListener('click',()=>{
  const d=collectSalesDraft();
  if(d.error){toast(d.error);return}
  activeSalesDraft=d;
  sendSalesOffer(); // şablon + yazdır + WhatsApp
});
q('#salesWizardInvoiceBtn')?.addEventListener('click',()=>salesIssueInvoiceNow());
q('#salesDockDocsHintBtn')?.addEventListener('click',()=>printSalesContractAndNotes());
q('#salesDockPreviewBtn')?.addEventListener('click',()=>{
  if(salesWizardStep<3){salesWizardNext();return}
  openSalesPreview();
});
q('#posStep1')?.addEventListener('click',()=>salesSetWizardStep(1));
q('#posStep2')?.addEventListener('click',()=>{if(salesWizardCanGo(2))salesSetWizardStep(2)});
q('#posStep3')?.addEventListener('click',()=>{if(salesWizardCanGo(3))salesSetWizardStep(3)});
try{salesSetWizardStep(1)}catch(_){q('#salesCenter')?.setAttribute('data-pos-step','1')}
q('#salesPreviewClose')?.addEventListener('click',closeSalesPreview);
q('#salesPreviewConfirmBtn')?.addEventListener('click',confirmSalesDraft);
q('#salesPreviewOfferBtn')?.addEventListener('click',sendSalesOfferWhatsAppOnly);
q('#salesPreviewPrintBtn')?.addEventListener('click',printSalesPreview);
q('#salesPreviewDocsBtn')?.addEventListener('click',printSalesContractAndNotes);
document.addEventListener('click',e=>{
  const offer=e.target.closest('#salesPreviewOfferBtn');
  if(offer && !offer.dataset.boundFallback){e.preventDefault();sendSalesOfferWhatsAppOnly()}
  const print=e.target.closest('#salesPreviewPrintBtn');
  if(print && !print.dataset.boundFallback){e.preventDefault();printSalesPreview()}
  const wizOffer=e.target.closest('#salesWizardOfferBtn');
  if(wizOffer && !wizOffer.dataset.boundFallback){e.preventDefault();sendSalesOffer()}
  const docs=e.target.closest('#salesPreviewDocsBtn');
  if(docs && !docs.dataset.boundFallback){e.preventDefault();printSalesContractAndNotes()}
});
q('#salesPreviewOfferBtn')?.setAttribute('data-bound-fallback','1');
q('#salesPreviewPrintBtn')?.setAttribute('data-bound-fallback','1');
q('#salesPreviewDocsBtn')?.setAttribute('data-bound-fallback','1');
q('#salesWizardOfferBtn')?.setAttribute('data-bound-fallback','1');
q('#salesPreviewModal')?.addEventListener('click',e=>{if(e.target===q('#salesPreviewModal'))closeSalesPreview()});



async function runSystemSelfTest(target='#settingsSelfTestResult'){
 const box=q(target);if(box)box.innerHTML='<p>Test çalışıyor…</p>';
 try{const r=await api('/web-api/admin/self-test');const html=(r.checks||[]).map(c=>`<div class="self-test-row ${c.ok?'ok':'bad'}"><b>${c.ok?'✓':'✕'} ${c.name}</b><small>${c.detail||''}</small></div>`).join('');if(box)box.innerHTML=html;toast(r.ok?'Sistem testi başarılı':'Sistem testinde hata bulundu')}catch(e){if(box)box.innerHTML=`<div class="self-test-row bad"><b>Test çalışmadı</b><small>${e.message}</small></div>`;toast(e.message)}
}
let settingsTabView='accounts';
function setSettingsTab(name){
  const allowed=['accounts','promissory','dealer','mail','sms','rapid','test'];
  settingsTabView=allowed.includes(name)?name:'accounts';
  qa('#settingsNav [data-settings-tab]').forEach(b=>b.classList.toggle('active',b.dataset.settingsTab===settingsTabView));
  qa('#settings [data-settings-panel]').forEach(p=>p.classList.toggle('hidden',p.dataset.settingsPanel!==settingsTabView));
  try{sessionStorage.setItem('atak-settings-tab',settingsTabView)}catch(_){}
  if(settingsTabView==='sms')loadSmsSettings().catch(()=>{});
  if(settingsTabView==='rapid')loadRapidSettings().catch(()=>{});
}
qa('#settingsNav [data-settings-tab]').forEach(b=>b.addEventListener('click',()=>setSettingsTab(b.dataset.settingsTab)));
try{
  const saved=sessionStorage.getItem('atak-settings-tab');
  if(saved)settingsTabView=saved;
}catch(_){}
setSettingsTab(settingsTabView);

async function loadRapidSettings(){
  const conn=q('#rapidSettingsConn');
  try{
    const d=await api('/web-api/admin/rapid360-okta-settings');
    if(q('#rapidSettingsOktaUser'))q('#rapidSettingsOktaUser').value=d.oktaUser||'';
    if(q('#rapidSettingsOktaPass'))q('#rapidSettingsOktaPass').value=d.oktaPasswordSet?'********':'';
  }catch(e){toast(e.message)}
  if(conn){
    conn.innerHTML='<span style="color:#64748b">Bağlantı kontrol ediliyor…</span>';
    try{
      const c=await api('/web-api/admin/rapid360-conn-status');
      let diag=null;
      try{diag=await api('/web-api/admin/rapid360-robot-diag')}catch(_){}
      let last=null;
      try{const r=await api('/web-api/admin/rapid360-robot-last');last=r&&r.job}catch(_){}
      const robotLine=diag
        ?(diag.launchOk
          ?'<div style="margin-top:6px;color:#15803d">🤖 Robot hazır — Chromium sunucuda açılıyor</div>'
          :`<div style="margin-top:6px;color:#b45309">🤖 Robot çalışmıyor: ${rapidOktaEsc(diag.launchError||(diag.playwright?'bilinmiyor':'playwright kurulu değil'))} · node ${rapidOktaEsc(diag.node||'')}${diag.playwrightVersion?` · playwright ${rapidOktaEsc(diag.playwrightVersion)}`:''}<br>Hostinger scriptini çalıştırın; terminaldeki "rapid robot" satırlarını kontrol edin.</div>`)
        :'';
      const lastLine=last
        ?`<div style="margin-top:6px;color:#475569">Son çalışma: ${rapidOktaEsc(last.error||last.status||'-')}${last.hasShot?' · <a href="/web-api/admin/rapid360-robot-shot" target="_blank"><b>Robotun gördüğü ekranı aç</b></a>':''}</div>`
        :'';
      conn.innerHTML=(c.canPull
        ?'<span style="color:#15803d;font-weight:800">🟢 Bağlı — aktarım hazır</span>'
        :'<span style="color:#b91c1c;font-weight:800">🔴 Bağlı değil</span><small style="margin-left:6px;color:#475569">Kaydedin, sonra Rapid Aktar → Satışları oku</small>')+robotLine+lastLine;
    }catch(_){conn.innerHTML='<span style="color:#b91c1c;font-weight:800">🔴 Bağlı değil</span>'}
  }
}
q('#rapidRobotTestBtn')?.addEventListener('click',async()=>{
  const st=q('#rapidSettingsStatus');
  if(st){st.textContent='Robot testi başladı — sunucu Rapid360’ı açıyor…';st.className='form-status'}
  try{
    const start=await api('/web-api/admin/rapid360-robot-test',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    const deadline=Date.now()+90000;
    while(Date.now()<deadline){
      await new Promise(r=>setTimeout(r,3000));
      try{
        const jr=await api('/web-api/admin/rapid360-robot-poll/'+encodeURIComponent(start.jobId));
        if(jr.pending){if(st)st.textContent=jr.message||'Robot çalışıyor…';continue}
        if(st){st.innerHTML=`${rapidOktaEsc(jr.message||'Test bitti')} — <a href="/web-api/admin/rapid360-robot-shot" target="_blank"><b>Robotun gördüğü ekranı aç</b></a>`;st.className='form-status success'}
        loadRapidSettings().catch(()=>{});
        return;
      }catch(e){
        if(st){st.innerHTML=`${rapidOktaEsc(e.message||'Robot hatası')} — <a href="/web-api/admin/rapid360-robot-shot" target="_blank"><b>Robotun gördüğü ekranı aç</b></a>`;st.className='form-status error'}
        return;
      }
    }
    if(st){st.textContent='Test zaman aşımı. Robotun gördüğü ekranı açmayı deneyin.';st.className='form-status error'}
  }catch(e){
    if(st){st.textContent=e.message;st.className='form-status error'}
  }
});
q('#rapidSettingsForm')?.addEventListener('submit',async e=>{
  e.preventDefault();
  const st=q('#rapidSettingsStatus');
  try{
    await api('/web-api/admin/rapid360-okta-settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      oktaUser:q('#rapidSettingsOktaUser')?.value||'',
      oktaPassword:q('#rapidSettingsOktaPass')?.value||''
    })});
    if(st){st.textContent='Kaydedildi. Rapid Aktar → Satışları oku ile deneyin.';st.className='form-status success'}
    toast('Rapid Aktar Okta girişi kaydedildi');
    loadRapidSettings().catch(()=>{});
  }catch(err){if(st){st.textContent=err.message;st.className='form-status error'}}
});
async function loadMailSettings(){
  const st=q('#mailSettingsStatus');
  try{
    const d=await api('/web-api/admin/mail-settings');
    const s=d.settings||{};
    if(q('#mailEnabled'))q('#mailEnabled').checked=s.enabled===true;
    if(q('#mailHost'))q('#mailHost').value=s.host||'smtp.gmail.com';
    if(q('#mailPort'))q('#mailPort').value=s.port||465;
    if(q('#mailSecure'))q('#mailSecure').checked=s.secure!==false;
    if(q('#mailUser'))q('#mailUser').value=s.user||'';
    if(q('#mailPass'))q('#mailPass').value=s.pass||'';
    if(q('#mailFrom'))q('#mailFrom').value=s.from||'';
    if(st){st.textContent=s.configured?'SMTP hazır — şifre sıfırlama mailleri gönderilebilir.':'SMTP henüz yapılandırılmadı.';st.className='form-status '+(s.configured?'success':'')}
  }catch(e){if(st){st.textContent=e.message;st.className='form-status error'}}
}
q('#mailSettingsForm')?.addEventListener('submit',async e=>{
  e.preventDefault();
  const st=q('#mailSettingsStatus');
  try{
    const r=await api('/web-api/admin/mail-settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      enabled:q('#mailEnabled')?.checked===true,
      host:q('#mailHost')?.value,
      port:q('#mailPort')?.value,
      secure:q('#mailSecure')?.checked!==false,
      user:q('#mailUser')?.value,
      pass:q('#mailPass')?.value,
      from:q('#mailFrom')?.value
    })});
    if(st){st.textContent=r.configured?'E-posta ayarları kaydedildi · SMTP hazır':'Kaydedildi — kullanıcı / şifre eksik olabilir';st.className='form-status success'}
    await loadMailSettings();
  }catch(err){if(st){st.textContent=err.message;st.className='form-status error'}}
});
q('#mailTestBtn')?.addEventListener('click',async()=>{
  const st=q('#mailSettingsStatus');
  try{
    // save first so test uses latest
    await api('/web-api/admin/mail-settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      enabled:true,
      host:q('#mailHost')?.value,
      port:q('#mailPort')?.value,
      secure:q('#mailSecure')?.checked!==false,
      user:q('#mailUser')?.value,
      pass:q('#mailPass')?.value,
      from:q('#mailFrom')?.value
    })});
    const to=q('#mailUser')?.value||'';
    const r=await api('/web-api/admin/mail-settings/test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({to})});
    if(st){st.textContent=`Test maili gönderildi → ${r.to}`;st.className='form-status success'}
    toast('Test maili gönderildi');
  }catch(err){if(st){st.textContent=err.message;st.className='form-status error'};toast(err.message||'Test başarısız')}
});

function renderSmsRecent(rows){
  const box=q('#smsRecentList');
  if(!box)return;
  if(!rows?.length){box.textContent='Henüz kayıt yok.';box.className='note';return}
  box.className='';
  box.innerHTML=`<div class="table-wrap"><table><thead><tr><th>Zaman</th><th>Tür</th><th>Alıcı</th><th>Durum</th><th>Metin</th></tr></thead><tbody>${rows.map(r=>{
    const ok=r.ok!==false;
    const when=String(r.at||'').replace('T',' ').slice(0,16);
    const typ=r.type==='overdue'||r.type==='overdue_bulk'?'Gecikme':(r.type==='test'?'Test':(r.type==='custom_bulk'?'Toplu':'Özel'));
    const who=salesEsc(r.customerName||r.phone||'-');
    const st=ok?`OK ${salesEsc(r.code||'')}${r.provider?' · '+salesEsc(r.provider):''}`:`Hata: ${salesEsc(r.error||'')}`;
    const msg=salesEsc(String(r.message||'').slice(0,80));
    return `<tr><td>${when}</td><td>${typ}</td><td><b>${who}</b><small>${salesEsc(r.phone||'')}</small></td><td>${st}</td><td>${msg}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}
let smsPresetsCache=[];
function smsPayloadFromForm(){
  return{
    enabled:q('#smsEnabled')?.checked===true,
    provider:q('#smsProvider')?.value||'generic',
    endpoint:q('#smsEndpoint')?.value,
    method:q('#smsMethod')?.value,
    contentType:q('#smsContentType')?.value,
    username:q('#smsUsername')?.value,
    password:q('#smsPassword')?.value,
    originator:q('#smsOriginator')?.value,
    phoneFormat:q('#smsPhoneFormat')?.value,
    successRule:q('#smsSuccessRule')?.value,
    fieldUsername:q('#smsFieldUsername')?.value,
    fieldPassword:q('#smsFieldPassword')?.value,
    fieldOriginator:q('#smsFieldOriginator')?.value,
    fieldNumbers:q('#smsFieldNumbers')?.value,
    fieldMessage:q('#smsFieldMessage')?.value,
    extraJson:q('#smsExtraJson')?.value,
    bodyTemplate:q('#smsBodyTemplate')?.value,
    overdueTemplate:q('#smsOverdueTemplate')?.value,
    missedTemplate:q('#smsMissedTemplate')?.value
  };
}
function applySmsPreset(id,{fillEmptyOnly=false}={}){
  const p=(smsPresetsCache||[]).find(x=>x.id===id);
  if(!p)return;
  const set=(sel,val)=>{
    const el=q(sel); if(!el)return;
    if(fillEmptyOnly&&String(el.value||'').trim())return;
    el.value=val==null?'':String(val);
  };
  set('#smsEndpoint',p.endpoint||'');
  set('#smsMethod',p.method||'POST');
  set('#smsContentType',p.contentType||'form');
  set('#smsPhoneFormat',p.phoneFormat||'national10');
  set('#smsSuccessRule',p.successRule||'auto');
  set('#smsFieldUsername',p.fields?.username||'username');
  set('#smsFieldPassword',p.fields?.password||'password');
  set('#smsFieldOriginator',p.fields?.originator||'originator');
  set('#smsFieldNumbers',p.fields?.numbers||'numbers');
  set('#smsFieldMessage',p.fields?.message||'message');
  set('#smsBodyTemplate',p.bodyTemplate||'');
  const extra=p.extra&&Object.keys(p.extra).length?JSON.stringify(p.extra):'';
  set('#smsExtraJson',extra);
  if(q('#smsProviderHint'))q('#smsProviderHint').textContent=p.hint||'Firmanın API dokümanındaki endpoint ve alan adlarını kullanın.';
}
async function loadSmsSettings(){
  const st=q('#smsSettingsStatus');
  try{
    const d=await api('/web-api/admin/sms-settings');
    const s=d.settings||{};
    smsPresetsCache=d.presets||[];
    const sel=q('#smsProvider');
    if(sel){
      sel.innerHTML=smsPresetsCache.map(p=>`<option value="${p.id}">${salesEsc(p.label)}</option>`).join('')
        ||'<option value="generic">Genel HTTP</option>';
      sel.value=s.provider||'generic';
    }
    if(q('#smsEnabled'))q('#smsEnabled').checked=s.enabled===true;
    if(q('#smsEndpoint'))q('#smsEndpoint').value=s.endpoint||'';
    if(q('#smsMethod'))q('#smsMethod').value=s.method||'POST';
    if(q('#smsContentType'))q('#smsContentType').value=s.contentType||'form';
    if(q('#smsUsername'))q('#smsUsername').value=s.username||'';
    if(q('#smsPassword'))q('#smsPassword').value=s.password||'';
    if(q('#smsOriginator'))q('#smsOriginator').value=s.originator||'';
    if(q('#smsPhoneFormat'))q('#smsPhoneFormat').value=s.phoneFormat||'national10';
    if(q('#smsSuccessRule'))q('#smsSuccessRule').value=s.successRule||'auto';
    if(q('#smsFieldUsername'))q('#smsFieldUsername').value=s.fieldUsername||'username';
    if(q('#smsFieldPassword'))q('#smsFieldPassword').value=s.fieldPassword||'password';
    if(q('#smsFieldOriginator'))q('#smsFieldOriginator').value=s.fieldOriginator||'originator';
    if(q('#smsFieldNumbers'))q('#smsFieldNumbers').value=s.fieldNumbers||'numbers';
    if(q('#smsFieldMessage'))q('#smsFieldMessage').value=s.fieldMessage||'message';
    if(q('#smsExtraJson'))q('#smsExtraJson').value=s.extraJson||'';
    if(q('#smsBodyTemplate'))q('#smsBodyTemplate').value=s.bodyTemplate||'';
    if(q('#smsOverdueTemplate'))q('#smsOverdueTemplate').value=s.overdueTemplate||'';
    if(q('#smsMissedTemplate'))q('#smsMissedTemplate').value=s.missedTemplate||'';
    const preset=(smsPresetsCache||[]).find(x=>x.id===(s.provider||'generic'));
    if(q('#smsProviderHint'))q('#smsProviderHint').textContent=preset?.hint||'Firmanın API dokümanındaki endpoint ve alan adlarını kullanın.';
    if(st){
      st.textContent=s.configured
        ?`SMS hazır (${s.providerLabel||s.provider||'gateway'}) — cari üzerinden gönderim yapılabilir.`
        :'SMS henüz yapılandırılmadı (endpoint + kullanıcı + şifre + gönderici).';
      st.className='form-status '+(s.configured?'success':'');
    }
    renderSmsRecent(d.recent||[]);
  }catch(e){if(st){st.textContent=e.message;st.className='form-status error'}}
}
q('#smsProvider')?.addEventListener('change',()=>{
  const id=q('#smsProvider')?.value||'generic';
  applySmsPreset(id,{fillEmptyOnly:false});
});
q('#smsSettingsForm')?.addEventListener('submit',async e=>{
  e.preventDefault();
  const st=q('#smsSettingsStatus');
  try{
    const r=await api('/web-api/admin/sms-settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(smsPayloadFromForm())});
    if(st){st.textContent=r.configured?`SMS ayarları kaydedildi · ${r.provider||'gateway'} hazır`:'Kaydedildi — endpoint / kullanıcı / şifre / gönderici eksik olabilir';st.className='form-status success'}
    await loadSmsSettings();
  }catch(err){if(st){st.textContent=err.message;st.className='form-status error'}}
});
q('#smsTestBtn')?.addEventListener('click',async()=>{
  const st=q('#smsSettingsStatus');
  try{
    await api('/web-api/admin/sms-settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...smsPayloadFromForm(),enabled:true})});
    const to=q('#smsTestPhone')?.value||'';
    const message=q('#smsTestMessage')?.value||'ATAK · SMS test';
    if(!to){toast('Test telefonu girin');return}
    const r=await api('/web-api/admin/sms-settings/test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({to,message})});
    if(st){st.textContent=`Test SMS gönderildi → ${r.to}${r.provider?' · '+r.provider:''}`;st.className='form-status success'}
    toast('Test SMS gönderildi');
    await loadSmsSettings();
  }catch(err){if(st){st.textContent=err.message;st.className='form-status error'};toast(err.message||'Test başarısız')}
});

async function loadPromissorySettings(){try{const d=await api('/web-api/admin/promissory-settings'),s=d.settings||{};q('#noteCreditor').value='ATAK EV GEREÇLERİ PAZ. TİC. LTD. ŞTİ.';q('#notePaymentPlace').value=s.paymentPlace||'';q('#noteIssuePlace').value=s.issuePlace||'';q('#notePrefix').value=s.prefix||'ATAK';q('#noteDefaultInstallments').value=s.defaultInstallments||1;q('#noteFirstDueDays').value=s.firstDueDays??30;q('#noteIntervalMonths').value=s.intervalMonths||1;q('#noteCopies').value=s.copies||1;q('#noteFooter').value=s.footer||''}catch(e){toast(e.message)}}
q('[data-tab="settings"]')?.addEventListener('click',()=>setTimeout(()=>{setSettingsTab(settingsTabView);loadPromissorySettings();loadDealerSettings().catch(()=>{});loadMailSettings().catch(()=>{});loadSmsSettings().catch(()=>{})},30));
q('#systemSelfTestBtn')?.addEventListener('click',()=>{goTab('settings');setSettingsTab('test');setTimeout(()=>runSystemSelfTest(),60)});q('#settingsSelfTestBtn')?.addEventListener('click',()=>runSystemSelfTest());
q('#promissorySettingsForm')?.addEventListener('submit',async e=>{e.preventDefault();const s=q('#promissorySettingsStatus');try{await api('/web-api/admin/promissory-settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({creditorName:q('#noteCreditor').value,paymentPlace:q('#notePaymentPlace').value,issuePlace:q('#noteIssuePlace').value,prefix:q('#notePrefix').value,defaultInstallments:q('#noteDefaultInstallments').value,firstDueDays:q('#noteFirstDueDays').value,intervalMonths:q('#noteIntervalMonths').value,copies:q('#noteCopies').value,footer:q('#noteFooter').value})});s.textContent='Senet ayarları kaydedildi';s.className='form-status success'}catch(err){s.textContent=err.message;s.className='form-status error'}});





function gibSeriesPreview(series,next){
  const ser=String(series||'').toUpperCase().replace(/[^A-Z]/g,'').slice(0,3)||'???';
  const seq=Math.max(1,Math.min(999999999,Math.round(Number(next)||1)));
  return `${ser}${new Date().getFullYear()}${String(seq).padStart(9,'0')}`;
}
function refreshInvoiceSeriesPreview(){
  if(q('#invoiceEfaturaPreview'))q('#invoiceEfaturaPreview').textContent='Önizleme: '+gibSeriesPreview(q('#invoiceEfaturaSeries')?.value||'ATK',q('#invoiceEfaturaNext')?.value||1);
  if(q('#invoiceEarsivPreview'))q('#invoiceEarsivPreview').textContent='Önizleme: '+gibSeriesPreview(q('#invoiceEarsivSeries')?.value||'ATA',q('#invoiceEarsivNext')?.value||1);
}
async function loadInvoiceIntegration(){
 try{
  const d=await api('/web-api/admin/invoice-integration'),s=d.settings||{};
  if(q('#invoiceProvider'))q('#invoiceProvider').value=s.provider||'qnb-solist';
  q('#invoiceEnvironment').value=s.environment||'test';
  q('#invoiceCompanyVkn').value=s.companyVkn||'';
  q('#invoiceCompanyTitle').value=s.companyTitle||'';
  if(q('#invoiceEfaturaSeries'))q('#invoiceEfaturaSeries').value=(s.efaturaSeries||'ATK').toUpperCase();
  if(q('#invoiceEarsivSeries'))q('#invoiceEarsivSeries').value=(s.earsivSeries||'ATA').toUpperCase();
  if(q('#invoiceEfaturaNext'))q('#invoiceEfaturaNext').value=s.efaturaNext||1;
  if(q('#invoiceEarsivNext'))q('#invoiceEarsivNext').value=s.earsivNext||1;
  q('#invoiceSenderAlias').value=s.senderAlias||s.gbAlias||'';
  if(q('#invoicePkAlias'))q('#invoicePkAlias').value=s.pkAlias||'';
  q('#invoiceServiceUrl').value=s.webServiceUrl||'';
  q('#invoiceUsername').value=s.username||'';
  q('#invoicePassword').value=s.password||'';
  q('#invoiceEnabled').checked=!!s.enabled;
  q('#invoiceDraftMode').checked=s.draftMode!==false;
  q('#invoiceAutoDetect').checked=s.autoDetectType!==false;
  const rz=s.rapid360||{};
  if(q('#rapid360Url'))q('#rapid360Url').value=rz.url||'';
  if(q('#rapid360ClientId'))q('#rapid360ClientId').value=rz.clientId||'';
  if(q('#rapid360Secret'))q('#rapid360Secret').value=rz.clientSecret||'';
  if(q('#rapid360DealerId'))q('#rapid360DealerId').value=rz.dealerId||'';
  if(q('#rapid360Code'))q('#rapid360Code').value=rz.eInvoiceCode||'';
  if(q('#rapid360SystemId'))q('#rapid360SystemId').value=rz.systemId||'1';
  if(q('#rapid360AddReturns'))q('#rapid360AddReturns').checked=rz.addReturns!==false;
  if(q('#rapid360SalesUrl'))q('#rapid360SalesUrl').value=rz.salesUrl||'';
  if(q('#rapid360SalesStore'))q('#rapid360SalesStore').value=rz.salesStore||'340334';
  if(q('#rapid360SalesCompany'))q('#rapid360SalesCompany').value=rz.salesCompany||'2521';
  const dms=s.atakDms||{};
  if(q('#atakDmsClientId'))q('#atakDmsClientId').value=dms.clientId||'';
  if(q('#atakDmsSecret'))q('#atakDmsSecret').value=dms.clientSecret||'';
  if(q('#atakDmsDealerId'))q('#atakDmsDealerId').value=dms.dealerId||'';
  if(q('#atakDmsCode'))q('#atakDmsCode').value=dms.eInvoiceCode||'';
  if(q('#atakDmsSystemId'))q('#atakDmsSystemId').value=dms.systemId||'1';
  if(q('#atakDmsEnabled'))q('#atakDmsEnabled').checked=dms.enabled!==false;
  if(q('#atakDmsIncludeInbox'))q('#atakDmsIncludeInbox').checked=false;
  if(q('#atakDmsAllowedIps'))q('#atakDmsAllowedIps').value=dms.allowedIps||'';
  if(q('#atakDmsCopyUrl'))q('#atakDmsCopyUrl').value=dms.copyUrl||'';
  refreshInvoiceSeriesPreview();
 }catch(e){toast(e.message)}
}
['invoiceEfaturaSeries','invoiceEarsivSeries','invoiceEfaturaNext','invoiceEarsivNext'].forEach(id=>{
  q('#'+id)?.addEventListener('input',refreshInvoiceSeriesPreview);
});
q('#invoiceIntegrationForm')?.addEventListener('submit',async e=>{
  e.preventDefault();
  const st=q('#invoiceIntegrationStatus');
  try{
    await api('/web-api/admin/invoice-integration',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      provider:q('#invoiceProvider')?.value||'qnb-solist',
      environment:q('#invoiceEnvironment').value,
      companyVkn:q('#invoiceCompanyVkn').value,
      companyTitle:q('#invoiceCompanyTitle').value,
      efaturaSeries:q('#invoiceEfaturaSeries')?.value||'ATK',
      earsivSeries:q('#invoiceEarsivSeries')?.value||'ATA',
      efaturaNext:q('#invoiceEfaturaNext')?.value||1,
      earsivNext:q('#invoiceEarsivNext')?.value||1,
      senderAlias:q('#invoiceSenderAlias').value,
      gbAlias:q('#invoiceSenderAlias').value,
      pkAlias:q('#invoicePkAlias')?.value||'',
      webServiceUrl:q('#invoiceServiceUrl').value,
      username:q('#invoiceUsername').value,
      password:q('#invoicePassword').value,
      enabled:q('#invoiceEnabled').checked,
      draftMode:q('#invoiceDraftMode').checked,
      autoDetectType:q('#invoiceAutoDetect').checked,
      rapid360Url:q('#rapid360Url')?.value||'',
      rapid360ClientId:q('#rapid360ClientId')?.value||'',
      rapid360Secret:q('#rapid360Secret')?.value||'',
      rapid360DealerId:q('#rapid360DealerId')?.value||'',
      rapid360Code:q('#rapid360Code')?.value||'',
      rapid360SystemId:q('#rapid360SystemId')?.value||'1',
      rapid360AddReturns:!!q('#rapid360AddReturns')?.checked,
      rapid360SalesUrl:q('#rapid360SalesUrl')?.value||'',
      rapid360SalesStore:q('#rapid360SalesStore')?.value||'',
      rapid360SalesCompany:q('#rapid360SalesCompany')?.value||'2521',
      atakDmsEnabled:!!q('#atakDmsEnabled')?.checked,
      atakDmsIncludeInbox:!!q('#atakDmsIncludeInbox')?.checked,
      atakDmsDealerId:q('#atakDmsDealerId')?.value||'',
      atakDmsCode:q('#atakDmsCode')?.value||'',
      atakDmsSystemId:q('#atakDmsSystemId')?.value||'1',
      atakDmsClientId:q('#atakDmsClientId')?.value||'',
      atakDmsSecret:q('#atakDmsSecret')?.value||'',
      atakDmsAllowedIps:q('#atakDmsAllowedIps')?.value||''
    })});
    st.textContent='QNB ayarları kaydedildi · e-Fatura ATK / e-Arşiv ATA.';
    st.className='form-status success';
    await loadInvoiceIntegration();
    invoiceConnectionTestForCenter();
  }catch(err){st.textContent=err.message;st.className='form-status error'}
});
q('#invoiceConnectionTestBtn')?.addEventListener('click',async()=>{const box=q('#invoiceConnectionTestResult');box.innerHTML='<p>Kontrol ediliyor…</p>';try{const r=await api('/web-api/admin/invoice-integration/test');box.innerHTML=(r.checks||[]).map(c=>`<div class="self-test-row ${c.ok?'ok':'bad'}"><b>${c.ok?'✓':'✕'} ${c.name}</b><small>${c.detail}</small></div>`).join('')+`<div class="self-test-row"><small>${r.note||''}</small></div>`}catch(e){box.innerHTML=`<div class="self-test-row bad"><b>Test çalışmadı</b><small>${e.message}</small></div>`}});
q('#atakDmsCopyBtn')?.addEventListener('click',async()=>{
  const url=String(q('#atakDmsCopyUrl')?.value||'').trim();
  if(!url || url.indexOf('client_id=')<0 || url.indexOf('client_secret=')<0)return toast('Hazır URL tam değil, sayfayı yenileyin');
  try{await navigator.clipboard.writeText(url);toast('Tam geteinvoices URL kopyalandı')}
  catch(_){q('#atakDmsCopyUrl')?.select();try{document.execCommand('copy');toast('Tam geteinvoices URL kopyalandı')}catch(e){toast('Kopyalanamadı, metni elle alın')}}
});
q('#atakDmsRotateBtn')?.addEventListener('click',async()=>{
  if(!confirm('Yeni client_id / client_secret üretilecek. E-fatura firmasına yeni URL vermeniz gerekir.'))return;
  const st=q('#invoiceIntegrationStatus');
  try{
    await api('/web-api/admin/invoice-integration/atak-dms-rotate',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    toast('Atak geteinvoices anahtarları yenilendi');
    if(st){st.textContent='Atak geteinvoices anahtarları yenilendi. Yeni URL’yi firmaya verin.';st.className='form-status success'}
    await loadInvoiceIntegration();
  }catch(e){toast(e.message);if(st){st.textContent=e.message;st.className='form-status error'}}
});

let dynamicsPreviewData=null;
let dynamicsCategories=[];

async function loadDynamicsImport(){
  const status=q('#dynamicsImportStatus');
  if(status){
    status.textContent='Exceldeki Arama adı ürün kodu olarak alınır. Sistem kategoriyi otomatik seçer; yanlışsa listeden değiştirebilirsiniz. Stok bu ekranda girilmez.';
    status.className='form-status';
  }
}

/* ===== Alış Faturaları (Arçelik Excel / manuel) ===== */
let purchasePreviewData=null;
let purchaseCategoryList=[];
let purchaseWarehouseList=[];
const PURCHASE_WH_LS_KEY='atak_purchase_last_warehouse';
function purchaseEsc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function purchaseRowKey(r){
  return String(r?.itemCode||r?.productCode||r?.searchName||r?.matchCode||r?.productName||'').trim();
}
function purchaseCategoryOptionsHtml(selected=''){
  const cats=purchaseCategoryList.length
    ?purchaseCategoryList
    :(store?.categories||[]).filter(c=>c&&c.id&&c.name&&c.active!==false);
  return '<option value="">Kategori seç…</option>'+cats.map(c=>
    `<option value="${purchaseEsc(c.id)}" ${String(c.id)===String(selected)?'selected':''}>${purchaseEsc(c.name)}</option>`
  ).join('');
}
function purchaseGuessWarehouseId(list,supplier=''){
  const rows=Array.isArray(list)?list:[];
  if(!rows.length)return '';
  if(rows.length===1)return rows[0].id;
  const last=String(localStorage.getItem(PURCHASE_WH_LS_KEY)||'').trim();
  if(last&&rows.some(w=>String(w.id)===last))return last;
  const blob=String(supplier||'').toLocaleUpperCase('tr-TR');
  const score=w=>{
    const t=`${w.name||''} ${w.code||''} ${w.storeName||''}`.toLocaleUpperCase('tr-TR');
    let s=0;
    if(/AR[CÇ]EL[Iİ]K|BEKO/.test(blob)){
      if(/BEKO/.test(t))s+=20;
      if(/MA[GĞ]AZA/.test(t))s+=5;
    }
    if(/ISTIKBAL|İSTİKBAL|DO[GĞ]TA[SŞ]/.test(blob)){
      if(/ISTIKBAL|İSTİKBAL|MOB[Iİ]LYA|DO[GĞ]TA[SŞ]/.test(t))s+=20;
    }
    if(/ANA\s*DEPO|^ANA$/.test(t))s-=2;
    return s;
  };
  const ranked=[...rows].sort((a,b)=>score(b)-score(a));
  return score(ranked[0])>0?ranked[0].id:rows[0].id;
}
function purchaseSetWarehouse(id,opts={}){
  const next=String(id||'');
  const hidden=q('#purchaseExcelWarehouse');
  if(hidden)hidden.value=next;
  qa('#purchaseExcelWarehouseChips .purchase-warehouse-chip').forEach(btn=>{
    btn.classList.toggle('active',String(btn.dataset.warehouseId)===next);
  });
  const man=q('#purchaseManualWarehouse');
  if(man&&opts.syncManual!==false&&[...man.options].some(o=>o.value===next))man.value=next;
  const hint=q('#purchaseWarehouseHint');
  const wh=purchaseWarehouseList.find(w=>String(w.id)===next);
  if(hint){
    hint.innerHTML=wh
      ?`Seçili: <b>${purchaseEsc(wh.name)}</b>${wh.storeName?` · ${purchaseEsc(wh.storeName)}`:''} — stok buraya yazılır`
      :'Sadece <b>Sadece Stok Aktar</b> için gerekli — bir karta tıkla';
  }
  q('#purchaseExcelWarehouseBox')?.classList.toggle('need-stock',Boolean(next));
}
function purchaseRenderWarehouseChips(list,preferId=''){
  purchaseWarehouseList=(Array.isArray(list)?list:[]).filter(w=>w&&w.id&&w.name);
  const box=q('#purchaseExcelWarehouseChips');
  const supplier=q('#purchaseExcelSupplier')?.value||'';
  const pick=preferId&&purchaseWarehouseList.some(w=>String(w.id)===String(preferId))
    ?preferId
    :purchaseGuessWarehouseId(purchaseWarehouseList,supplier);
  if(!box){
    const hidden=q('#purchaseExcelWarehouse');
    if(hidden)hidden.value=pick||'';
    return pick;
  }
  if(!purchaseWarehouseList.length){
    box.innerHTML='<div class="purchase-warehouse-empty">Aktif depo yok — Stok & Depo’dan ekleyin.</div>';
    purchaseSetWarehouse('');
    return '';
  }
  box.innerHTML=purchaseWarehouseList.map(w=>{
    const meta=[w.code,w.storeName].filter(Boolean).join(' · ')||'Depo';
    const tag=/BEKO/i.test(`${w.name} ${w.storeName}`)?`Beko`
      :(/ISTIKBAL|İSTİKBAL|MOB[Iİ]LYA/i.test(`${w.name} ${w.storeName}`)?`İstikbal`:'');
    return `<button type="button" class="purchase-warehouse-chip" data-warehouse-id="${purchaseEsc(w.id)}">
      ${tag?`<span class="purchase-wh-tag">${tag}</span>`:''}
      <strong>${purchaseEsc(w.name)}</strong>
      <small>${purchaseEsc(meta)}</small>
    </button>`;
  }).join('');
  box.querySelectorAll('.purchase-warehouse-chip').forEach(btn=>{
    btn.addEventListener('click',()=>{
      purchaseSetWarehouse(btn.dataset.warehouseId);
      try{localStorage.setItem(PURCHASE_WH_LS_KEY,btn.dataset.warehouseId||'')}catch{}
    });
  });
  purchaseSetWarehouse(pick);
  return pick;
}
function purchaseSuggestWarehouse(){
  const id=purchaseGuessWarehouseId(purchaseWarehouseList,q('#purchaseExcelSupplier')?.value||'');
  if(id)purchaseSetWarehouse(id);
}
function purchaseFillWarehouses(selIds=[]){
  return api('/web-api/admin/purchase-invoices').then(d=>{
    const list=d.warehouses||[];
    const opts=list.map(w=>{
      const label=[w.name,w.code?`(${w.code})`:'',w.storeName||''].filter(Boolean).join(' ');
      return `<option value="${purchaseEsc(w.id)}">${purchaseEsc(label||w.name)}</option>`;
    }).join('');
    selIds.forEach(id=>{
      if(id==='#purchaseExcelWarehouse')return; // chip picker
      const el=q(id);if(!el)return;
      const cur=el.value;el.innerHTML=opts||'<option value="">Depo yok</option>';
      if(cur&&list.some(w=>String(w.id)===String(cur)))el.value=cur;
    });
    const keep=q('#purchaseExcelWarehouse')?.value||'';
    purchaseRenderWarehouseChips(list,keep);
    purchaseFillCategories(d.categories||[]);
    return d;
  });
}
function purchaseFillCategories(list){
  const cats=(Array.isArray(list)&&list.length?list:(store?.categories||[]))
    .filter(c=>c&&c.id&&c.name&&c.active!==false)
    .slice()
    .sort((a,b)=>String(a.name).localeCompare(String(b.name),'tr'));
  purchaseCategoryList=cats;
  const el=q('#purchaseExcelCategory');if(!el)return;
  const cur=el.value;
  el.innerHTML='<option value="">Satır satır seç…</option>'+cats.map(c=>`<option value="${purchaseEsc(c.id)}">${purchaseEsc(c.name)}</option>`).join('');
  if(cur&&cats.some(c=>String(c.id)===String(cur)))el.value=cur;
  else purchaseSuggestCategory();
}
function purchaseSuggestCategory(){
  const el=q('#purchaseExcelCategory');if(!el)return;
  const supplier=String(q('#purchaseExcelSupplier')?.value||'');
  if(/ISTIKBAL|İSTİKBAL|DO[GĞ]TA[SŞ]/i.test(supplier)){
    const mob=[...el.options].find(o=>/mobilya/i.test(o.textContent||'')||o.value==='mobilya');
    if(mob){el.value=mob.value;return}
  }
}
function purchaseRefreshCategorySelects(preferId=''){
  const cats=purchaseCategoryList.slice();
  const def=q('#purchaseExcelCategory');
  if(def){
    const keep=preferId||def.value;
    def.innerHTML='<option value="">Satır satır seç…</option>'+cats.map(c=>`<option value="${purchaseEsc(c.id)}">${purchaseEsc(c.name)}</option>`).join('');
    if(keep&&cats.some(c=>String(c.id)===String(keep)))def.value=keep;
  }
  qa('#purchasePreviewTable select[data-purchase-row-cat]').forEach(sel=>{
    const keep=preferId&&!sel.value?preferId:sel.value;
    sel.innerHTML=purchaseCategoryOptionsHtml(keep);
    if(keep)sel.value=keep;
  });
}
async function purchaseCreateCategory(){
  const input=q('#purchaseNewCategoryName');
  const name=String(input?.value||'').trim();
  if(!name){toast('Kategori adını yazın');input?.focus();return}
  const btn=q('#purchaseNewCategoryBtn');
  if(btn)btn.disabled=true;
  try{
    const result=await api('/web-api/admin/category',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({name,active:true,sort:purchaseCategoryList.length})
    });
    const cat=result.category;
    if(cat?.id){
      if(!purchaseCategoryList.some(c=>String(c.id)===String(cat.id))){
        purchaseCategoryList.push({id:cat.id,name:cat.name,active:true});
        purchaseCategoryList.sort((a,b)=>String(a.name).localeCompare(String(b.name),'tr'));
      }
      if(Array.isArray(store?.categories)&&!store.categories.some(c=>String(c.id)===String(cat.id))){
        store.categories.push(cat);
      }
      try{renderCategoryOptions?.()}catch{}
      purchaseRefreshCategorySelects(cat.id);
      if(q('#purchaseExcelCategory'))q('#purchaseExcelCategory').value=cat.id;
    }
    if(input)input.value='';
    toast(`Kategori eklendi: ${cat?.name||name}`);
  }catch(e){
    toast('Kategori eklenemedi: '+e.message);
  }finally{
    if(btn)btn.disabled=false;
  }
}
function purchaseApplyDefaultCategoryToRows(){
  const def=String(q('#purchaseExcelCategory')?.value||'').trim();
  if(!def){toast('Önce üstten varsayılan kategori seçin');return}
  let n=0;
  qa('#purchasePreviewTable select[data-purchase-row-cat]').forEach(sel=>{
    sel.value=def;n++;
    const key=sel.dataset.purchaseRowCat;
    const row=(purchasePreviewData?.preview||[]).find(r=>purchaseRowKey(r)===key);
    if(row)row.categoryId=def;
  });
  toast(n?`${n} yeni ürüne kategori uygulandı`:'Uygulanacak yeni ürün yok');
}
function purchaseCollectCategoryMap(){
  const map={};
  qa('#purchasePreviewTable select[data-purchase-row-cat]').forEach(sel=>{
    const key=String(sel.dataset.purchaseRowCat||'').trim();
    const val=String(sel.value||'').trim();
    if(key&&val)map[key]=val;
  });
  (purchasePreviewData?.preview||[]).forEach(r=>{
    const st=r.status==='unmatched'?'will_create':r.status;
    if(st!=='will_create')return;
    const key=purchaseRowKey(r);
    if(key&&r.categoryId&&!map[key])map[key]=String(r.categoryId);
  });
  return map;
}
function purchaseMissingCategoryCount(){
  let miss=0;
  const def=String(q('#purchaseExcelCategory')?.value||'').trim();
  qa('#purchasePreviewTable select[data-purchase-row-cat]').forEach(sel=>{
    if(!String(sel.value||'').trim()&&!def)miss++;
  });
  // Önizleme kesilmişse (truncated) satır select'i olmayan yeniler için varsayılan şart
  const previewed=qa('#purchasePreviewTable select[data-purchase-row-cat]').length;
  const will=Number(purchasePreviewData?.willCreate||0);
  if(will>previewed&&!def)miss+=will-previewed;
  return miss;
}
function renderPurchaseInvoiceList(d){
  const box=q('#purchaseInvoiceList');if(!box)return;
  const rows=d.invoices||[];
  box.innerHTML=rows.length
    ?`<table><thead><tr><th>Tarih</th><th>Tedarikçi</th><th>Fatura No</th><th>Kalem</th><th>Toplam</th><th>Yeni ürün</th><th>Maliyet</th><th>Durum</th><th></th></tr></thead><tbody>${rows.map(r=>`<tr class="${r.reverted?'price-warning':''}">
      <td>${purchaseEsc(r.date||'')}</td>
      <td>${purchaseEsc(r.supplierName||'')}</td>
      <td><b>${purchaseEsc(r.invoiceNo||'-')}</b></td>
      <td>${Number(r.itemCount||0)}</td>
      <td><b>${money(r.total)}</b></td>
      <td>${Number(r.created||0)}</td>
      <td>${Number(r.priceUpdated||0)}</td>
      <td>${r.reverted?'Geri alındı':(r.source==='excel'?'Excel':'Manuel')}</td>
      <td>${r.reverted?'':`<button type="button" class="mini-btn danger" data-purchase-revert="${purchaseEsc(r.id)}">Geri Al / Sil</button>`}</td>
    </tr>`).join('')}</tbody></table>`
    :'<p class="note">Henüz alış faturası yok. Excel/CSV yükleyin veya manuel girin.</p>';
  box.querySelectorAll('[data-purchase-revert]').forEach(btn=>{
    btn.addEventListener('click',async()=>{
      if(!confirm('Bu aktarım geri alınsın mı?\n• Yeni eklenen ürünler silinir (satışı yoksa)\n• Güncellenen maliyetler eski haline döner'))return;
      try{
        const r=await api('/web-api/admin/purchase-invoice/'+btn.dataset.purchaseRevert+'/revert',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
        toast(`Geri alındı · ${r.productsRemoved||0} ürün silindi · ${r.pricesRestored||0} maliyet eskiye döndü`);
        await loadPurchaseInvoices();
      }catch(e){toast(e.message)}
    });
  });
}
async function loadPurchaseInvoices(){
  try{
    const d=await purchaseFillWarehouses(['#purchaseExcelWarehouse','#purchaseManualWarehouse']);
    renderPurchaseInvoiceList(d);
    if(!q('#purchaseManualDate')?.value)q('#purchaseManualDate').value=localDate();
    if(!q('#purchaseManualLines')?.children?.length)purchaseAddManualLine();
    const st=q('#purchaseExcelStatus');
    if(st&&!purchasePreviewData){st.textContent='Arçelik Excel’ini seçip önizleyin. Olmayan ürünler eklenir, olanların maliyeti yenisiyle yazılır.';st.className='form-status'}
  }catch(e){
    const st=q('#purchaseExcelStatus');
    if(st){st.textContent=e.message;st.className='form-status error'}
  }
}
function purchaseSetMode(mode){
  qa('.purchase-mode').forEach(b=>b.classList.toggle('active',b.dataset.purchaseMode===mode));
  q('#purchaseExcelPanel')?.classList.toggle('hidden',mode!=='excel');
  q('#purchaseManualPanel')?.classList.toggle('hidden',mode!=='manual');
}
qa('[data-purchase-mode]').forEach(b=>b.addEventListener('click',()=>purchaseSetMode(b.dataset.purchaseMode)));

function renderPurchasePreview(d){
  purchasePreviewData=d;
  const willCreate=Number(d.willCreate||d.unmatched||0);
  const withCost=Number(d.withCost||0);
  const stockRows=Number(d.matched||0)+willCreate;
  const defCat=String(q('#purchaseExcelCategory')?.value||'').trim();
  q('#purchaseExcelSummary').innerHTML=
    `<article><b>${d.total||0}</b><span>Toplam Satır</span></article>
     <article class="good"><b>${d.matched||0}</b><span>Eşleşen ürün</span></article>
     <article class="warn"><b>${willCreate}</b><span>Yeni eklenecek</span></article>
     <article class="bad"><b>${d.invalid||0}</b><span>Hatalı</span></article>`;
  const rows=d.preview||[];
  const label={matched:'Eşleşti',will_create:'Yeni eklenecek',unmatched:'Yeni eklenecek',invalid:'Hatalı'};
  q('#purchasePreviewTable').innerHTML=rows.map(r=>{
    const st=r.status==='unmatched'?'will_create':r.status;
    const why=r.reason?`<small class="warn-text">${purchaseEsc(r.reason)}</small>`:'';
    const key=purchaseRowKey(r);
    const selected=String(r.categoryId||defCat||'').trim();
    if(st==='will_create'&&selected)r.categoryId=selected;
    const catCell=st==='will_create'
      ?`<select class="purchase-row-cat" data-purchase-row-cat="${purchaseEsc(key)}">${purchaseCategoryOptionsHtml(selected)}</select>`
      :(st==='matched'?`<span class="muted">${purchaseEsc(r.categoryName||'—')}</span>`:'—');
    return `<tr class="dynamics-preview-row ${st==='matched'?'existing':st==='will_create'?'new':'invalid'}">
    <td><span class="dynamics-status ${st==='matched'?'existing':st==='will_create'?'new':'invalid'}">${label[st]||st}</span>${why}</td>
    <td><b>${purchaseEsc(r.productName||r.searchName||r.productCode||r.itemCode||'-')}</b><small>${purchaseEsc([r.itemCode||r.productCode||r.matchCode,r.matchCode&&r.productCode&&r.matchCode!==r.productCode?`sistem: ${r.matchCode}`:''].filter(Boolean).join(' · ')||'')}</small></td>
    <td>${catCell}</td>
    <td>${Number(r.quantity||0)}</td>
    <td><b>${money(r.unitCost)}</b></td>
    <td>${st==='matched'?money(r.currentPurchasePrice):'—'}</td>
    <td>${purchaseEsc(r.invoiceNo||'-')}<small>${purchaseEsc(r.date||'')}</small></td>
  </tr>`;
  }).join('');
  qa('#purchasePreviewTable select[data-purchase-row-cat]').forEach(sel=>{
    sel.addEventListener('change',()=>{
      const key=sel.dataset.purchaseRowCat;
      const row=(purchasePreviewData?.preview||[]).find(r=>purchaseRowKey(r)===key);
      if(row)row.categoryId=String(sel.value||'');
    });
  });
  q('#purchasePreviewEmpty').style.display=rows.length?'none':'block';
  q('#purchaseCostBtn')&&(q('#purchaseCostBtn').disabled=!withCost);
  q('#purchaseStockBtn')&&(q('#purchaseStockBtn').disabled=!stockRows);
}
q('#purchasePreviewBtn')?.addEventListener('click',async()=>{
  const status=q('#purchaseExcelStatus');
  const file=q('#purchaseExcelFile')?.files?.[0];
  if(!file){toast('Önce Excel seçin');return}
  try{
    status.textContent='Excel okunuyor…';status.className='form-status';
    const fd=new FormData();fd.append('file',file);
    const d=await api('/web-api/admin/purchase-invoice-preview',{method:'POST',body:fd});
    renderPurchasePreview(d);
    const will=Number(d.willCreate||d.unmatched||0);
    const withCost=Number(d.withCost||0);
    status.textContent=`${d.total} satır · ${withCost} maliyetli · ${will} yeni · “Sadece Maliyet” veya “Sadece Stok” seç`;
    status.className='form-status success';
  }catch(e){
    status.textContent=e.message;status.className='form-status error';
  }
});
async function runPurchaseImport(mode){
  const status=q('#purchaseExcelStatus');
  const file=q('#purchaseExcelFile')?.files?.[0];
  if(!file){toast('Önce Excel seçin');return}
  const will=Number(purchasePreviewData?.willCreate||purchasePreviewData?.unmatched||0);
  const matched=Number(purchasePreviewData?.matched||0);
  const withCost=Number(purchasePreviewData?.withCost||0);
  if(mode==='cost'&&!withCost){toast('Maliyet okunamadı — Excel’de “Maliyet tutarı” kolonunu kontrol edin');return}
  if(mode==='stock'&&!(matched+will)){toast('Aktarılacak satır yok — önce Önizle');return}
  if(mode==='stock'&&!q('#purchaseExcelWarehouse')?.value){
    toast('Stok için depo seçin — yukarıdaki depo kartına tıklayın');
    q('#purchaseExcelWarehouseBox')?.scrollIntoView({behavior:'smooth',block:'center'});
    q('#purchaseExcelWarehouseBox')?.classList.add('need-stock');
    return;
  }
  const categoryId=String(q('#purchaseExcelCategory')?.value||'').trim();
  const categoryMap=purchaseCollectCategoryMap();
  if(will>0){
    const miss=purchaseMissingCategoryCount();
    if(miss>0&&!categoryId){
      toast(`${miss} yeni ürünün kategorisi eksik — satırdan seç veya üstten uygula`);
      const emptySel=[...qa('#purchasePreviewTable select[data-purchase-row-cat]')].find(s=>!String(s.value||'').trim());
      emptySel?.focus();
      return;
    }
    // Varsayılan varsa boş satırlara yaz
    if(categoryId){
      qa('#purchasePreviewTable select[data-purchase-row-cat]').forEach(sel=>{
        if(!String(sel.value||'').trim()){
          sel.value=categoryId;
          const key=sel.dataset.purchaseRowCat;
          const row=(purchasePreviewData?.preview||[]).find(r=>purchaseRowKey(r)===key);
          if(row)row.categoryId=categoryId;
          if(key)categoryMap[key]=categoryId;
        }
      });
    }
  }
  const label=mode==='stock'?'Sadece stok':mode==='cost'?'Sadece maliyet':'Aktarım';
  if(!confirm(`${label} aktarılsın mı?\n${matched} eşleşen · ${will} yeni${mode==='cost'?` · ${withCost} maliyetli`:''}${will>0?`\nKategori: satır satır (${Object.keys(categoryMap).length} seçili)`:''}\nSonra Geri Al ile silebilirsin.`))return;
  try{
    status.textContent='Aktarılıyor…';status.className='form-status';
    const fd=new FormData();
    fd.append('file',file);
    fd.append('mode',mode);
    fd.append('supplierName',q('#purchaseExcelSupplier')?.value||'Arçelik A.Ş.');
    fd.append('warehouseId',q('#purchaseExcelWarehouse')?.value||'');
    fd.append('categoryId',categoryId);
    fd.append('categoryMap',JSON.stringify(categoryMap));
    fd.append('pricesIncludeVat',q('#purchaseExcelIncVat')?.checked?'1':'0');
    const d=await api('/web-api/admin/purchase-invoice-import',{method:'POST',body:fd});
    status.textContent=mode==='stock'
      ?`Stok tamam · ${d.invoice.stockUpdated||0} stok hareketi · ${d.invoice.created||0} yeni ürün`
      :`Maliyet tamam · ${d.invoice.priceUpdated||0} alış güncellendi · ${d.invoice.created||0} yeni ürün · ${money(d.invoice.total)}`;
    status.className='form-status success';
    toast(label+' aktarıldı');
    if(mode==='stock'){
      const wh=q('#purchaseExcelWarehouse')?.value||'';
      if(wh){try{localStorage.setItem(PURCHASE_WH_LS_KEY,wh)}catch{}}
    }
    purchasePreviewData=null;
    q('#purchaseCostBtn')&&(q('#purchaseCostBtn').disabled=true);
    q('#purchaseStockBtn')&&(q('#purchaseStockBtn').disabled=true);
    await loadPurchaseInvoices();
  }catch(e){
    status.textContent=e.message;status.className='form-status error';
  }
}
q('#purchaseCostBtn')?.addEventListener('click',()=>runPurchaseImport('cost'));
q('#purchaseStockBtn')?.addEventListener('click',()=>runPurchaseImport('stock'));
q('#purchaseExcelSupplier')?.addEventListener('change',()=>{
  purchaseSuggestCategory();
  purchaseSuggestWarehouse();
});
q('#purchaseApplyCategoryBtn')?.addEventListener('click',()=>purchaseApplyDefaultCategoryToRows());
q('#purchaseNewCategoryBtn')?.addEventListener('click',()=>purchaseCreateCategory());
q('#purchaseNewCategoryName')?.addEventListener('keydown',e=>{
  if(e.key==='Enter'){e.preventDefault();purchaseCreateCategory()}
});
q('#purchaseRefreshListBtn')?.addEventListener('click',()=>loadPurchaseInvoices());
q('#purchaseZeroIstikbalCostBtn')?.addEventListener('click',async()=>{
  if(!confirm('İstikbal / alış aktarımından gelen ürünlerde ALIŞ MALİYETİ sıfırlansın mı?\nÜrün kartları silinmez — sadece purchasePrice = 0 olur.'))return;
  try{
    const r=await api('/web-api/admin/products/zero-purchase-costs',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({scope:'istikbal'})
    });
    toast(`${r.cleared||0} ürünün alış maliyeti sıfırlandı`);
    await load();
    await loadPurchaseInvoices();
  }catch(e){toast(e.message)}
});
q('#purchaseZeroAllCostBtn')?.addEventListener('click',async()=>{
  if(!confirm('TÜM ürünlerde alış maliyeti sıfırlansın mı?\nBeko + İstikbal dahil. Ürünler silinmez — sadece ALIŞ = 0.\nStok değeri de ₺0 görünür.'))return;
  if(!confirm('Emin misin? Bu işlem geri alınamaz (eski alışlar silinir).'))return;
  try{
    const r=await api('/web-api/admin/products/zero-purchase-costs',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({scope:'all'})
    });
    toast(`${r.cleared||0} ürünün alış maliyeti sıfırlandı`);
    await load();
    await loadPurchaseInvoices();
  }catch(e){toast(e.message)}
});
q('#purchaseTemplateBtn')?.addEventListener('click',async e=>{
  e.preventDefault();
  try{
    const r=await fetch('/web-api/admin/purchase-invoice-template',{credentials:'same-origin'});
    if(!r.ok)throw new Error('Şablon indirilemedi');
    const blob=await r.blob();
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;a.download='atak-alis-fatura-sablonu.xlsx';
    document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(err){toast(err.message)}
});

function purchaseAddManualLine(data={}){
  const tb=q('#purchaseManualLines');if(!tb)return;
  const tr=document.createElement('tr');
  tr.innerHTML=`<td><input data-pi-code value="${purchaseEsc(data.productCode||'')}" placeholder="C9100 / BM..." required/></td>
    <td><input data-pi-name value="${purchaseEsc(data.productName||'')}" placeholder="Opsiyonel"/></td>
    <td><input data-pi-qty type="number" min="1" step="1" value="${Number(data.quantity||1)}" required/></td>
    <td><input data-pi-cost type="number" min="0" step="0.01" value="${Number(data.unitCost||0)||''}" placeholder="Alış fiyatı" required/></td>
    <td><button type="button" class="mini-btn danger" data-pi-remove>Sil</button></td>`;
  tr.querySelector('[data-pi-remove]')?.addEventListener('click',()=>{
    if(tb.children.length<=1){toast('En az bir satır kalmalı');return}
    tr.remove();
  });
  tb.appendChild(tr);
}
q('#purchaseAddLineBtn')?.addEventListener('click',()=>purchaseAddManualLine());
q('#purchaseManualForm')?.addEventListener('submit',async e=>{
  e.preventDefault();
  const status=q('#purchaseManualStatus');
  const items=[...qa('#purchaseManualLines tr')].map(tr=>({
    productCode:tr.querySelector('[data-pi-code]')?.value?.trim()||'',
    productName:tr.querySelector('[data-pi-name]')?.value?.trim()||'',
    quantity:Number(tr.querySelector('[data-pi-qty]')?.value||0),
    unitCost:Number(tr.querySelector('[data-pi-cost]')?.value||0)
  })).filter(x=>x.productCode&&x.quantity>0&&x.unitCost>0);
  if(!items.length){toast('Geçerli kalem girin');return}
  try{
    status.textContent='Kaydediliyor…';status.className='form-status';
    const d=await api('/web-api/admin/purchase-invoice',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        supplierName:q('#purchaseManualSupplier')?.value||'Arçelik A.Ş.',
        invoiceNo:q('#purchaseManualInvoiceNo')?.value||'',
        date:q('#purchaseManualDate')?.value||localDate(),
        warehouseId:q('#purchaseManualWarehouse')?.value||'',
        pricesIncludeVat:!!q('#purchaseManualIncVat')?.checked,
        updatePurchasePrice:!!q('#purchaseManualUpdatePrice')?.checked,
        addStock:!!q('#purchaseManualAddStock')?.checked,
        items
      })
    });
    status.textContent=`Kaydedildi · ${d.invoice.created||0} yeni · ${d.invoice.priceUpdated} maliyet · ${money(d.invoice.total)}`;
    status.className='form-status success';
    toast('Alış faturası kaydedildi');
    q('#purchaseManualLines').innerHTML='';
    purchaseAddManualLine();
    q('#purchaseManualInvoiceNo').value='';
    await loadPurchaseInvoices();
  }catch(err){
    status.textContent=err.message;status.className='form-status error';
  }
});

function dynamicsForm(includeCategories=false){
  const file=q('#dynamicsExcelFile')?.files?.[0];
  if(!file)throw new Error('Önce Dynamics Excel dosyasını seçin.');
  const fd=new FormData();
  fd.append('file',file);
  fd.append('warehouseId',q('#dynamicsWarehouse')?.value||'');
  if(includeCategories){
    const map={};
    qa('[data-dynamics-category]').forEach(sel=>{
      const key=sel.dataset.itemCode || sel.dataset.searchName;
      if(key && sel.value) map[key]=sel.value;
    });
    fd.append('categoryMap',JSON.stringify(map));
  }
  return fd;
}

function dynamicsCategoryOptions(selected=''){
  return '<option value="">Kategori seçin...</option>' +
    dynamicsCategories.map(c=>`<option value="${c.id}" ${String(c.id)===String(selected)?'selected':''}>${c.name}</option>`).join('');
}


async function dynamicsCreateCategory(){
  const input=q('#dynamicsNewCategoryName');
  const name=String(input?.value||'').trim();
  if(!name){toast('Kategori adını yazın');input?.focus();return}
  try{
    const result=await api('/web-api/admin/category',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({name,active:true,sort:dynamicsCategories.length})
    });
    const cat=result.category;
    if(cat && !dynamicsCategories.some(c=>String(c.id)===String(cat.id))){
      dynamicsCategories.push({id:cat.id,name:cat.name});
      dynamicsCategories.sort((a,b)=>String(a.name).localeCompare(String(b.name),'tr'));
    }
    const bulk=q('#dynamicsBulkCategory');
    const oldBulk=bulk?.value||'';
    if(bulk){bulk.innerHTML=dynamicsCategoryOptions(oldBulk||cat?.id||'');bulk.value=cat?.id||oldBulk}
    qa('[data-dynamics-category]').forEach(sel=>{
      const old=sel.value;
      sel.innerHTML=dynamicsCategoryOptions(old);
      sel.value=old;
    });
    if(input)input.value='';
    toast(`Kategori eklendi: ${cat?.name||name}`);
  }catch(e){
    toast('Kategori eklenemedi: '+e.message);
  }
}
q('#dynamicsNewCategoryBtn')?.addEventListener('click',dynamicsCreateCategory);
q('#dynamicsNewCategoryName')?.addEventListener('keydown',e=>{
  if(e.key==='Enter'){e.preventDefault();dynamicsCreateCategory()}
});

function renderDynamicsPreview(d){
  dynamicsPreviewData=d;
  dynamicsCategories=(d.categories||[]).filter(c=>c&&c.id&&c.name);

  const bulk=q('#dynamicsBulkCategory');
  if(bulk) bulk.innerHTML=dynamicsCategoryOptions('');

  const wh=q('#dynamicsWarehouse');
  if(wh&&(d.warehouses||[]).length){
    const cur=wh.value;
    wh.innerHTML=(d.warehouses||[]).map(w=>`<option value="${w.id}">${w.name}</option>`).join('');
    if(cur)wh.value=cur;
  }

  q('#dynamicsImportSummary').innerHTML=
    `<article><b>${d.total||0}</b><span>Toplam Satır</span></article>
     <article class="good"><b>${d.newCount||0}</b><span>Yeni Ürün</span></article>
     <article class="warn"><b>${d.existingCount||0}</b><span>Zaten Var</span></article>
     <article class="bad"><b>${d.invalidCount||0}</b><span>Hatalı</span></article>`;

  const hint=q('#dynamicsCostStockHint');
  if(hint){
    const costOk=d.costHeaderFound
      ? `Maliyet bulundu (${d.withCost||0} satır) — Aktar’da hepsi Excel’deki yenisiyle yazılır.`
      : 'Maliyet sütunu yok; ürün/stok yine aktarılır, alış için Alış Faturaları kullan.';
    const stockOk=d.stockHeaderFound?`Stok bulundu (${d.withStock||0}).`:'Stok sütunu yok.';
    hint.textContent=`${stockOk} ${costOk}`;
  }

  const rows=d.preview||[];
  q('#dynamicsPreviewTable').innerHTML=rows.map(r=>{
    const categoryCell = r.status==='new'
      ? `<select data-dynamics-category data-item-code="${r.itemCode||''}" data-search-name="${r.searchName||''}">
           ${dynamicsCategoryOptions(r.suggestedCategoryId||'')}
         </select>`
      : (r.status==='existing'
          ? '<span class="muted">Güncellenebilir</span>'
          : '<span class="muted">Aktarılmaz</span>');
    const costCell=Number(r.purchasePrice||0)>0
      ? `<b>${money(r.purchasePrice)}</b>${r.status==='existing'?`<small>şimdi: ${money(r.currentPurchasePrice)}</small>`:''}`
      : '<span class="muted">—</span>';
    return `<tr class="dynamics-preview-row ${r.status}">
      <td><span class="dynamics-status ${r.status}">${r.status==='new'?'Yeni':r.status==='existing'?'Zaten Var':'Hatalı'}</span></td>
      <td><b>${r.searchName||'-'}</b>${r.existingCode?`<small>Mevcut: ${r.existingCode}</small>`:''}</td>
      <td>${Number(r.stockQty||0)}</td>
      <td>${costCell}</td>
      <td>${categoryCell}</td>
    </tr>`;
  }).join('');

  q('#dynamicsPreviewEmpty').style.display=rows.length?'none':'block';
  const canRun=Boolean(d.newCount)||Boolean(d.existingCount);
  q('#dynamicsImportBtn').disabled=!canRun;

  if(!dynamicsCategories.length && d.newCount){
    q('#dynamicsImportStatus').textContent='Aktif kategori bulunamadı. Önce Kategoriler ekranından kategori oluşturun.';
    q('#dynamicsImportStatus').className='form-status error';
  }
}

q('#dynamicsApplyBulkCategory')?.addEventListener('click',()=>{
  const val=q('#dynamicsBulkCategory')?.value||'';
  if(!val){toast('Önce kategori seçin');return}
  qa('[data-dynamics-category]').forEach(sel=>{sel.value=val});
  toast('Kategori tüm yeni ürünlere uygulandı');
});

q('#dynamicsPreviewBtn')?.addEventListener('click',async()=>{
  const status=q('#dynamicsImportStatus');
  try{
    status.textContent='Excel okunuyor...';status.className='form-status';
    const d=await api('/web-api/admin/dynamics-excel-preview',{method:'POST',body:dynamicsForm(false)});
    renderDynamicsPreview(d);
    if(dynamicsCategories.length){
      status.textContent=`${d.total} satır okundu. ${d.newCount} yeni ürün, ${d.existingCount} zaten mevcut ürün bulundu. Kategoriler otomatik seçildi; yanlış olanları listeden düzeltebilirsiniz.`;
      status.className='form-status success';
    }
  }catch(e){
    status.textContent=e.message;status.className='form-status error';
  }
});

q('#dynamicsImportBtn')?.addEventListener('click',async()=>{
  const status=q('#dynamicsImportStatus'),btn=q('#dynamicsImportBtn');
  if(!dynamicsPreviewData){status.textContent='Önce Excel’i önizleyin.';status.className='form-status error';return}
  const newRows=(dynamicsPreviewData.preview||[]).filter(r=>r.status==='new');
  const costRows=(dynamicsPreviewData.preview||[]).filter(r=>Number(r.purchasePrice||0)>0).length;
  if(newRows.length){
    const selectors=qa('[data-dynamics-category]');
    const missing=selectors.filter(sel=>!sel.value);
    if(missing.length){
      status.textContent=`${missing.length} yeni ürünün kategorisi seçilmemiş. Hepsine kategori seçin.`;
      status.className='form-status error';
      missing[0]?.scrollIntoView({behavior:'smooth',block:'center'});
      missing[0]?.focus();
      return;
    }
  }
  if(!q('#dynamicsWarehouse')?.value){toast('Depo seçin');return}
  if(!confirm(`Tek aktarım:\n• ${newRows.length} yeni ürün\n• ${dynamicsPreviewData.existingCount||0} mevcut güncellenecek\n• ${costRows} maliyet Excel’deki yenisiyle yazılacak\nDevam?`))return;
  try{
    btn.disabled=true;btn.textContent='Aktarılıyor...';
    const r=await api('/web-api/admin/dynamics-excel-import',{method:'POST',body:dynamicsForm(true)});
    status.textContent=`Tamam: ${r.added||0} yeni ürün · ${r.priceUpdated||0} maliyet (yenisi yazıldı) · ${r.stockUpdated||0} stok`;
    status.className='form-status success';
    toast('Dynamics aktarımı tamam');
    dynamicsPreviewData=null;
    await check();
  }catch(e){
    status.textContent=e.message;status.className='form-status error';
  }finally{
    btn.disabled=false;btn.textContent='Tek Tıkla Aktar';
  }
});


/** e-Fatura Merkezi — modül: e-Fatura / e-Arşiv / Kurulum */
let invoiceCenterState={module:'efatura',view:'ef_out_pending',data:null,selected:new Set()};
const INV_VIEW_META={
  ef_out_pending:{title:'e-Fatura · Gönderilecek',hint:'Satıştan kuyruğa düşen giden e-Faturalar.'},
  ef_out_sent:{title:'e-Fatura · Gönderilen',hint:'Kuyruğa alınan / taslak / kesilmiş e-Faturalar.'},
  ef_out_error:{title:'e-Fatura · Hatalı',hint:'Gönderim veya doğrulama hatası. Tekrar deneyebilirsiniz.'},
  ef_out_archive:{title:'e-Fatura · Giden Arşiv',hint:'İptal / arşivlenmiş giden e-Faturalar.'},
  ef_in_incoming:{title:'e-Fatura · Gelen',hint:'Yalnız ATAKHOME gelen e-faturaları. Başkanın Rapid360 (BEA/GEA) buraya çekilmez.'},
  ef_in_responses:{title:'e-Fatura · Uygulama Yanıtları',hint:'Ticari fatura kabul/red yanıtları.'},
  ef_in_archive:{title:'e-Fatura · Gelen Arşiv',hint:'Arşivlenmiş gelen e-Faturalar.'},
  ea_out_pending:{title:'e-Arşiv · Gönderilecek',hint:'Giden e-Arşiv kuyruğu.'},
  ea_out_sent:{title:'e-Arşiv · Gönderilen',hint:'Gönderilmiş / kuyruğa alınmış e-Arşiv faturaları.'},
  ea_out_error:{title:'e-Arşiv · Hatalı',hint:'Hatalı e-Arşiv kayıtları.'},
  ea_out_archive:{title:'e-Arşiv · Giden Arşiv',hint:'Arşivlenmiş giden e-Arşiv.'},
  ea_in_incoming:{title:'e-Arşiv · Gelen',hint:'Gelen e-Arşiv (portal bağlanınca).'},
  ea_in_archive:{title:'e-Arşiv · Gelen Arşiv',hint:'Arşivlenmiş gelen e-Arşiv.'},
  pending_sales:{title:'Kesilmeyen Faturalar',hint:'Geç kesilen satışlar. Kuyruğa alın veya manuel işaretleyin.'},
  setup_ready:{title:'Kurulum / Hazırlık',hint:'Firma, Rapid360 ve Atak geteinvoices kontrolü.'},
  setup_settings:{title:'Firma ve servis',hint:'Atak fatura ayarları.'}
};
function invEsc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function invStatusBadge(st){
  const s=String(st||'pending');
  const label={pending:'Bekliyor',ready:'Hazır',queued:'Kuyruk',draft_sent:'Taslak',queued_remote:'Portal kuyruk',issued:'Kesildi',error:'Hatalı',cancelled:'İptal',archived:'Arşiv'}[s]||s;
  return `<span class="inv-badge ${invEsc(s)}">${invEsc(label)}</span>`;
}
function invIsEf(r){const t=String(r.docType||r.invoiceType||r.profile||'').toLowerCase();return t==='efatura'||t==='temelfatura'||t==='ticarifatura'||!t||t==='auto'}
function invIsEa(r){return String(r.docType||r.invoiceType||r.profile||'').toLowerCase()==='earsiv'}
function invStatusBucket(view){
  if(view.endsWith('_pending'))return 'pending';
  if(view.endsWith('_sent'))return 'sent';
  if(view.endsWith('_error'))return 'error';
  if(view.endsWith('_archive'))return 'archive';
  return '';
}
function invFilterQueue(rows,view){
  const list=rows||[];
  const type=view.startsWith('ea_')?'earsiv':'efatura';
  const typed=list.filter(r=>type==='earsiv'?invIsEa(r):invIsEf(r));
  const bucket=invStatusBucket(view);
  if(bucket==='pending')return typed.filter(r=>['pending','ready'].includes(String(r.status||'pending')));
  if(bucket==='sent')return typed.filter(r=>['issued','draft_sent','queued_remote','queued'].includes(String(r.status||'')));
  if(bucket==='error')return typed.filter(r=>String(r.status||'')==='error');
  if(bucket==='archive')return typed.filter(r=>['cancelled','archived'].includes(String(r.status||'')));
  return typed;
}
function invApplySearch(rows){
  const term=String(q('#invSearch')?.value||'').toLocaleLowerCase('tr-TR').trim();
  const unreadOnly=!!q('#invUnreadOnly')?.checked;
  return (rows||[]).filter(r=>{
    if(unreadOnly&&r.read===true)return false;
    if(!term)return true;
    const hay=`${r.invoiceNumber||''} ${r.reference||''} ${r.customer?.name||r.customerName||r.supplierName||''} ${r.uuid||''}`.toLocaleLowerCase('tr-TR');
    return hay.includes(term);
  });
}
function invSetCounts(c={}){
  const map={
    invCountEfOutPending:'ef_out_pending',invCountEfOutSent:'ef_out_sent',invCountEfOutError:'ef_out_error',invCountEfOutArchive:'ef_out_archive',
    invCountEfInIncoming:'ef_in_incoming',invCountEfInResponses:'ef_in_responses',invCountEfInArchive:'ef_in_archive',
    invCountEaOutPending:'ea_out_pending',invCountEaOutSent:'ea_out_sent',invCountEaOutError:'ea_out_error',invCountEaOutArchive:'ea_out_archive',
    invCountEaInIncoming:'ea_in_incoming',invCountEaInArchive:'ea_in_archive',
    invCountPendingSales:'sales_pending',invCountPendingMod:'sales_pending'
  };
  Object.entries(map).forEach(([id,key])=>{if(q('#'+id))q('#'+id).textContent=String(c[key]||0)});
}
function invUpdateEnvBadge(settings={}){
  const el=q('#invEnvBadge');if(!el)return;
  if(!settings.enabled){el.textContent='Bağlantı Kapalı';el.className='inv-env off';return}
  if(settings.environment==='live'){el.textContent='Canlı Ortam';el.className='inv-env';return}
  el.textContent='Test Ortamı';el.className='inv-env test';
}
function invRenderSetup(checks=[]){
  q('#invTableWrap')?.classList.add('hidden');
  q('#invToolbar')?.classList.add('hidden');
  q('#invSetupBox')?.classList.remove('hidden');
  loadInvoiceIntegration().catch(()=>{});
  if(q('#invReadyChecks')){
    q('#invReadyChecks').innerHTML=(checks||[]).map(c=>`<div class="inv-check ${c.ok?'ok':'bad'}"><b>${c.ok?'✓':'✕'} ${invEsc(c.name)}</b><span>${invEsc(c.detail||'')}</span></div>`).join('')||'<div class="inv-empty">Test çalıştırılmadı — “Altyapıyı Test Et”e basın</div>';
  }
  q('#invFootCount').textContent=(checks||[]).length?`${(checks||[]).filter(c=>c.ok).length}/${(checks||[]).length} hazır`:'QNB kurulum';
}
function invRenderTable(rows){
  q('#invSetupBox')?.classList.add('hidden');
  q('#invTableWrap')?.classList.remove('hidden');
  q('#invToolbar')?.classList.remove('hidden');
  const view=invoiceCenterState.view;
  const head=q('#invTableHead'),body=q('#invTableBody'),empty=q('#invEmpty');
  if(view==='pending_sales'){
    head.innerHTML=`<tr><th></th><th>Satış No</th><th>Tarih</th><th>Müşteri</th><th>Tutar</th><th>Ödeme</th><th>Durum</th><th>İşlem</th></tr>`;
    body.innerHTML=rows.map(r=>`<tr data-inv-id="${invEsc(r.id)}">
      <td><input type="checkbox" data-inv-check="${invEsc(r.id)}"/></td>
      <td><b>${invEsc(r.reference||'-')}</b></td>
      <td>${invEsc(r.date||'-')}</td>
      <td>${invEsc(r.customerName||'-')}</td>
      <td>${salesMoney(r.total)}</td>
      <td>${invEsc(r.paymentMethod||'-')}</td>
      <td>${invStatusBadge(r.invoiceStatus)}</td>
      <td style="display:flex;gap:6px;flex-wrap:wrap">
        <button type="button" class="inv-btn" data-inv-qnb="${invEsc(r.id)}">QNB’ye Al</button>
        <button type="button" class="inv-btn" data-mark-invoiced="${invEsc(r.id)}">Manuel Kes</button>
      </td>
    </tr>`).join('');
    empty?.classList.toggle('hidden',rows.length>0);
    q('#invFootCount').textContent=`${rows.length} kesilmeyen`;
    invoiceCenterState.selected=new Set();
    qa('[data-inv-check]').forEach(chk=>chk.onchange=()=>{
      const id=chk.dataset.invCheck;
      if(chk.checked)invoiceCenterState.selected.add(id);else invoiceCenterState.selected.delete(id);
      chk.closest('tr')?.classList.toggle('selected',chk.checked);
    });
    qa('[data-inv-qnb]').forEach(btn=>btn.onclick=async()=>{
      try{
        const out=await api('/web-api/admin/sale/'+encodeURIComponent(btn.dataset.invQnb)+'/issue-invoice',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
        toast(`QNB kuyruk: ${out.result?.docType||''}`);await loadInvoiceCenter();
      }catch(e){toast(e.message)}
    });
    qa('[data-mark-invoiced]').forEach(btn=>btn.onclick=async()=>{
      const row=(invoiceCenterState.data?.salesPending||[]).find(x=>String(x.id)===String(btn.dataset.markInvoiced));if(!row)return;
      const invoiceNumber=prompt(`${row.reference} için fatura numarası:`,'');if(!invoiceNumber)return;
      const invoiceDate=prompt('Fatura tarihi (YYYY-MM-DD):',new Date().toISOString().slice(0,10));if(!invoiceDate)return;
      try{
        await api('/web-api/admin/sale/'+encodeURIComponent(row.id)+'/mark-invoiced',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({invoiceNumber,invoiceDate})});
        toast('Manuel fatura işlendi');await loadInvoiceCenter();
      }catch(e){toast(e.message)}
    });
    return;
  }
  const isInbox=view.includes('_in_');
  if(isInbox){
    head.innerHTML=`<tr><th></th><th>Okundu</th><th>Fatura Tarihi</th><th>Fatura No</th><th>Müşteri / Tedarikçi</th><th>Profil</th><th>Tutar</th><th>ERP</th></tr>`;
    body.innerHTML=rows.map(r=>`<tr data-inv-id="${invEsc(r.id||r.uuid||'')}">
      <td><input type="checkbox" data-inv-check="${invEsc(r.id||r.uuid||'')}"/></td>
      <td>${r.read?'✓':'✉'}</td>
      <td>${invEsc(r.invoiceDate||r.date||'-')}</td>
      <td><b>${invEsc(r.invoiceNumber||'-')}</b></td>
      <td>${invEsc(r.supplierName||r.customerName||r.customer?.name||'-')}</td>
      <td>${invEsc(r.profile||r.docType||'-')}</td>
      <td>${salesMoney(r.total)}</td>
      <td>${r.erpImported?'EVET':'HAYIR'}</td>
    </tr>`).join('');
  }else{
    head.innerHTML=`<tr><th></th><th>Durum</th><th>Tarih</th><th>Fatura / Satış</th><th>Müşteri</th><th>Tip</th><th>Tutar</th><th>Mesaj</th><th>İşlem</th></tr>`;
    body.innerHTML=rows.map(r=>`<tr data-inv-id="${invEsc(r.id)}">
      <td><input type="checkbox" data-inv-check="${invEsc(r.id)}"/></td>
      <td>${invStatusBadge(r.status)}</td>
      <td>${invEsc(r.invoiceDate||(r.createdAt||'').slice(0,10)||'-')}</td>
      <td><b>${invEsc(r.invoiceNumber||r.reference||'-')}</b><div style="color:#667890;font-size:11px">${invEsc(r.uuid?String(r.uuid).slice(0,13)+'…':'')}</div></td>
      <td>${invEsc(r.customer?.name||r.customerName||'-')}</td>
      <td>${invEsc(r.docType||r.invoiceType||'auto')}</td>
      <td>${salesMoney(r.total)}</td>
      <td style="max-width:220px;white-space:normal;color:#667890">${invEsc(r.providerMessage||r.error||'')}</td>
      <td>
        <button type="button" class="inv-btn" data-inv-retry="${invEsc(r.id)}">Tekrar</button>
        ${r.ublXml?`<button type="button" class="inv-btn" data-inv-ubl="${invEsc(r.id)}">UBL</button>`:''}
      </td>
    </tr>`).join('');
  }
  empty?.classList.toggle('hidden',rows.length>0);
  q('#invFootCount').textContent=`${rows.length} kayıt`;
  invoiceCenterState.selected=new Set();
  qa('[data-inv-check]').forEach(chk=>chk.onchange=()=>{
    const id=chk.dataset.invCheck;
    if(chk.checked)invoiceCenterState.selected.add(id);else invoiceCenterState.selected.delete(id);
    chk.closest('tr')?.classList.toggle('selected',chk.checked);
  });
  qa('[data-inv-retry]').forEach(btn=>btn.onclick=async()=>{
    try{await api('/web-api/admin/invoice-queue/'+encodeURIComponent(btn.dataset.invRetry)+'/retry',{method:'POST',body:'{}'});toast('Tekrar denendi');await loadInvoiceCenter()}catch(e){toast(e.message)}
  });
  qa('[data-inv-ubl]').forEach(btn=>btn.onclick=()=>{
    const row=(invoiceCenterState.data?.queue||[]).find(x=>String(x.id)===String(btn.dataset.invUbl));
    if(!row?.ublXml)return toast('UBL yok');
    const w=window.open('','_blank');if(!w)return toast('Popup engellendi');
    w.document.write(`<pre style="white-space:pre-wrap;font:12px/1.4 monospace;padding:16px">${invEsc(row.ublXml)}</pre>`);
  });
}
function invSetModule(mod,{keepView=false}={}){
  invoiceCenterState.module=mod;
  qa('[data-inv-module]').forEach(b=>b.classList.toggle('active',b.dataset.invModule===mod));
  qa('[data-inv-pane]').forEach(p=>p.classList.toggle('active',p.dataset.invPane===mod));
  if(!keepView){
    if(mod==='efatura')invoiceCenterState.view='ef_out_pending';
    else if(mod==='earsiv')invoiceCenterState.view='ea_out_pending';
    else if(mod==='pending')invoiceCenterState.view='pending_sales';
    else invoiceCenterState.view='setup_settings';
  }
  invPaintCurrentView();
}
function invPaintCurrentView(){
  const view=invoiceCenterState.view;
  const meta=INV_VIEW_META[view]||{title:view,hint:''};
  if(q('#invViewTitle'))q('#invViewTitle').textContent=meta.title;
  if(q('#invViewHint'))q('#invViewHint').textContent=meta.hint;
  qa('[data-inv-view]').forEach(b=>b.classList.toggle('active',b.dataset.invView===view));
  if(q('#invDocTypeFilter')){
    q('#invDocTypeFilter').value=view.startsWith('ea_')?'earsiv':(view.startsWith('ef_')?'efatura':'all');
    q('#invDocTypeFilter').style.display='none';
  }
  if(view==='setup_settings'||view==='setup_ready'){
    invRenderSetup([]);
    q('#invFootStatus').textContent=view==='setup_ready'?'Hazırlık kontrolü':'QNB ayarları';
    if(view==='setup_ready')invoiceConnectionTestForCenter();
    else setTimeout(()=>q('#invoiceIntegrationForm')?.scrollIntoView({behavior:'smooth',block:'start'}),40);
    return;
  }
  const d=invoiceCenterState.data||{};
  let rows=[];
  if(view==='pending_sales')rows=d.salesPending||[];
  else if(view==='ef_in_incoming')rows=(d.inbox||[]).filter(r=>!invIsEa(r)&&r.status!=='archived');
  else if(view==='ef_in_responses')rows=d.responses||[];
  else if(view==='ef_in_archive')rows=(d.inbox||[]).filter(r=>!invIsEa(r)&&r.status==='archived');
  else if(view==='ea_in_incoming')rows=(d.inbox||[]).filter(r=>invIsEa(r)&&r.status!=='archived');
  else if(view==='ea_in_archive')rows=(d.inbox||[]).filter(r=>invIsEa(r)&&r.status==='archived');
  else rows=invFilterQueue(d.queue||[],view);
  rows=invApplySearch(rows);
  invRenderTable(rows);
  q('#invFootStatus').textContent=d.note||'Yerel kuyruk aktif · Kesilmeyen faturalar bu merkezde';
}
async function invoiceConnectionTestForCenter(){
  try{
    const r=await api('/web-api/admin/invoice-integration/test');
    invRenderSetup(r.checks||[]);
    q('#invFootStatus').textContent=r.note||'Altyapı testi tamam';
  }catch(e){invRenderSetup([{name:'Test',ok:false,detail:e.message}]);}
}
async function loadInvoiceCenter(){
  try{
    const d=await api('/web-api/admin/invoice-center');
    invoiceCenterState.data=d;
    invSetCounts(d.counts||{});
    invUpdateEnvBadge(d.settings||{});
    const rz=d.settings?.rapid360||{};
    q('#invPortalQueryBtn')?.classList.toggle('hidden',!rz.ready||!!rz.blocked);
    invPaintCurrentView();
  }catch(e){
    if(q('#invFootStatus'))q('#invFootStatus').textContent=e.message;
    toast(e.message);
  }
}
function invSetView(view){
  invoiceCenterState.view=view;
  if(view.startsWith('ef_'))invoiceCenterState.module='efatura';
  else if(view.startsWith('ea_'))invoiceCenterState.module='earsiv';
  else if(view==='pending_sales')invoiceCenterState.module='pending';
  else if(view.startsWith('setup'))invoiceCenterState.module='setup';
  qa('[data-inv-module]').forEach(b=>b.classList.toggle('active',b.dataset.invModule===invoiceCenterState.module));
  qa('[data-inv-pane]').forEach(p=>p.classList.toggle('active',p.dataset.invPane===invoiceCenterState.module));
  const folderKey=view.startsWith('ef_out')?'ef_out':view.startsWith('ef_in')?'ef_in':view.startsWith('ea_out')?'ea_out':view.startsWith('ea_in')?'ea_in':view==='pending_sales'?'pending':view.startsWith('setup')?'setup':'';
  if(folderKey){const f=q(`[data-inv-folder="${folderKey}"]`);f?.classList.add('open');const t=f?.querySelector('[data-inv-toggle] span:last-child');if(t)t.textContent='▾'}
  invPaintCurrentView();
}
qa('[data-inv-module]').forEach(btn=>btn.addEventListener('click',()=>invSetModule(btn.dataset.invModule)));
qa('[data-inv-toggle]').forEach(btn=>btn.addEventListener('click',()=>{
  const folder=btn.closest('.inv-folder');
  folder?.classList.toggle('open');
  const mark=btn.querySelector('span:last-child');
  if(mark)mark.textContent=folder?.classList.contains('open')?'▾':'▸';
}));
qa('[data-inv-view]').forEach(btn=>btn.addEventListener('click',()=>invSetView(btn.dataset.invView)));
q('#invRefreshBtn')?.addEventListener('click',()=>loadInvoiceCenter());
q('#invSearch')?.addEventListener('input',()=>invPaintCurrentView());
q('#invUnreadOnly')?.addEventListener('change',()=>invPaintCurrentView());
q('#invPortalQueryBtn')?.addEventListener('click',async()=>{
  q('#invFootStatus').textContent='Portal sorgulanıyor…';
  try{
    const r=await api('/web-api/admin/invoice-center/portal-query',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({days:14})});
    toast(r.message||'Portal sorgu tamam');
    q('#invFootStatus').textContent=r.message||'Tamam';
    await loadInvoiceCenter();
  }catch(e){toast(e.message);q('#invFootStatus').textContent=e.message}
});
q('#invRetrySelectedBtn')?.addEventListener('click',async()=>{
  const ids=[...invoiceCenterState.selected];
  if(!ids.length)return toast('Önce satır seçin');
  for(const id of ids){
    try{await api('/web-api/admin/invoice-queue/'+encodeURIComponent(id)+'/retry',{method:'POST',body:'{}'})}catch(_){}
  }
  toast(`${ids.length} kayıt tekrar denendi`);
  await loadInvoiceCenter();
});
q('#invIssueSelectedBtn')?.addEventListener('click',async()=>{
  const ids=[...invoiceCenterState.selected];
  if(!ids.length)return toast('Önce satır seçin');
  if(invoiceCenterState.view==='pending_sales'){
    for(const id of ids){
      try{await api('/web-api/admin/sale/'+encodeURIComponent(id)+'/issue-invoice',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})}catch(_){}
    }
    toast(`${ids.length} satış QNB kuyruğuna alındı`);
  }else{
    for(const id of ids){
      try{await api('/web-api/admin/invoice-queue/'+encodeURIComponent(id)+'/retry',{method:'POST',body:'{}'})}catch(_){}
    }
    toast(`${ids.length} fatura işlendi`);
  }
  await loadInvoiceCenter();
});
q('#invRunReadyTestBtn')?.addEventListener('click',()=>invoiceConnectionTestForCenter());
q('[data-tab="invoiceCenter"]')?.addEventListener('click',()=>setTimeout(()=>loadInvoiceCenter().catch(e=>toast(e.message)),20));
// Geriye uyumluluk
async function loadUninvoicedSales(){await loadInvoiceCenter()}

loadDealerSettings();

function reportKpis(s={}){return `<article><small>Satış Adedi</small><b>${Number(s.count||0)}</b></article><article><small>Brüt Ciro</small><b>${salesMoney(s.gross||0)}</b></article><article class="net-kpi"><small>NET Satış</small><b>${salesMoney(s.net||0)}</b></article><article class="deduct-kpi"><small>İptal / İade</small><b>- ${salesMoney(s.cancelled||0)}</b></article><article class="commission"><small>Hak Edilen Prim</small><b>${salesMoney(s.commission||0)}</b></article>`}
function isoToday(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
function isoMonth(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`}
let mySalesBoard=null,staffSalesBoard=null;
function primBoardQuery(prefix){
  const period=(q(`#${prefix}PeriodToggle .period-btn.active`)?.dataset.period)||'day';
  const params=new URLSearchParams();
  params.set('period',period);
  if(period==='month'){
    const m=q(`#${prefix}Month`)?.value||isoMonth();
    params.set('month',m);
  }else{
    const d=q(`#${prefix}Date`)?.value||isoToday();
    params.set('date',d);
  }
  if(prefix==='staffSales'){
    const person=q('#staffSalesPersonFilter')?.value||'';
    const dealer=q('#staffSalesDealerFilter')?.value||'';
    if(person)params.set('salespersonId',person);
    if(dealer)params.set('dealerId',dealer);
  }
  return params;
}
function setPeriodUi(prefix,period){
  qa(`#${prefix}PeriodToggle .period-btn`).forEach(b=>b.classList.toggle('active',b.dataset.period===period));
  q(`#${prefix}DateWrap`)?.classList.toggle('hidden',period!=='day');
  q(`#${prefix}MonthWrap`)?.classList.toggle('hidden',period!=='month');
}
function buildPrimWhatsAppText(board,title='ATAK PAZARLAMA'){
  const s=board?.summary||{},rank=board?.ranking||[];
  const periodLabel=board?.period==='month'?'AYLIK':'GÜNLÜK';
  const lines=[
    `*${title}*`,
    `${periodLabel} SATIŞ & PRİM`,
    `Dönem: ${board?.label||'-'}`,
    ``,
    `NET: ${salesMoney(s.net||0)}`,
    `Brüt: ${salesMoney(s.gross||0)}`,
    `İptal/İade: ${salesMoney(s.cancelled||0)}`,
    `Prim: ${salesMoney(s.commission||0)}`,
    `Adet: ${Number(s.count||0)}`,
    ``,
    `*Personel Sıralaması (Net)*`
  ];
  rank.forEach((r,i)=>{
    lines.push(`${i+1}) ${r.name} — Net ${salesMoney(r.net)} · ${r.count} adet · Prim ${salesMoney(r.commission)}`);
  });
  if(!rank.length)lines.push('Kayıt yok.');
  lines.push('','Atak Pazarlama');
  return lines.join('\n');
}
function openWhatsAppShare(text){
  const url='https://wa.me/?text='+encodeURIComponent(text);
  window.open(url,'_blank','noopener');
}
function openPrimPdf(board,title){
  const s=board?.summary||{},rank=board?.ranking||[],rows=board?.rows||[];
  const periodLabel=board?.period==='month'?'Aylık':'Günlük';
  const rankHtml=rank.map((r,i)=>`<tr class="r${i+1}"><td>${i+1}</td><td><b>${salesEsc(r.name)}</b></td><td>${r.count}</td><td>${salesMoney(r.gross)}</td><td><b>${salesMoney(r.net)}</b></td><td>${salesMoney(r.commission)}</td></tr>`).join('')||'<tr><td colspan="6">Kayıt yok</td></tr>';
  const detailHtml=rows.slice(0,200).map(r=>`<tr><td>${salesEsc(r.date||'')}</td><td>${salesEsc(r.customerName||r.dealerName||'-')}</td><td>${salesEsc(r.salespersonName||'')}</td><td>${salesMoney(r.total)}</td><td>${salesMoney(r.commissionAmount||0)}</td></tr>`).join('');
  const html=`<!doctype html><html><head><meta charset="utf-8"><title>${salesEsc(title)}</title>
  <style>
    body{font-family:Arial,sans-serif;color:#0b2a4a;padding:24px}
    h1{margin:0 0 4px;font-size:22px} .sub{color:#667;margin:0 0 16px}
    .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:18px}
    .kpis div{border:1px solid #dce4ef;border-radius:10px;padding:10px}
    .kpis small{display:block;color:#667;font-size:11px;font-weight:700}
    .kpis b{font-size:18px}.net b{color:#0b4f96}
    table{width:100%;border-collapse:collapse;margin-top:8px;font-size:12px}
    th,td{border-bottom:1px solid #e7edf4;padding:8px;text-align:left}
    th{background:#f7f9fc;font-size:11px;text-transform:uppercase;color:#667}
    .r1 td{background:#fff8df}.r2 td{background:#f3f7ff}.r3 td{background:#f6fbf4}
    @media print{button{display:none}}
  </style></head><body>
  <button onclick="window.print()">Yazdır / PDF</button>
  <h1>${salesEsc(title)}</h1>
  <p class="sub">${periodLabel} rapor · Dönem: ${salesEsc(board?.label||'-')} · ${salesEsc(board?.from||'')} → ${salesEsc(board?.to||'')}</p>
  <div class="kpis">
    <div class="net"><small>NET Satış</small><b>${salesMoney(s.net||0)}</b></div>
    <div><small>Brüt</small><b>${salesMoney(s.gross||0)}</b></div>
    <div><small>İptal/İade</small><b>${salesMoney(s.cancelled||0)}</b></div>
    <div><small>Prim</small><b>${salesMoney(s.commission||0)}</b></div>
  </div>
  <h2>Personel Sıralaması</h2>
  <table><thead><tr><th>#</th><th>Personel</th><th>Adet</th><th>Brüt</th><th>Net</th><th>Prim</th></tr></thead><tbody>${rankHtml}</tbody></table>
  <h2>Satış Detayı</h2>
  <table><thead><tr><th>Tarih</th><th>Müşteri/Bayi</th><th>Satıcı</th><th>Net</th><th>Prim</th></tr></thead><tbody>${detailHtml||'<tr><td colspan="5">Satış yok</td></tr>'}</tbody></table>
  <script>window.onload=()=>setTimeout(()=>window.print(),300)<\/script>
  </body></html>`;
  const w=window.open('','_blank','noopener,width=900,height=700');
  if(!w){toast('Popup engellendi');return}
  w.document.write(html);w.document.close();
}
function renderRankTable(targetSel,ranking=[],opts={}){
  const el=q(targetSel); if(!el)return;
  el.innerHTML=(ranking||[]).map((r,i)=>`<tr class="rank-${Math.min(i+1,3)}">
    <td><b>${i+1}</b></td>
    <td><b>${salesEsc(r.name)}</b></td>
    <td>${r.count||0}</td>
    <td>${salesMoney(r.gross)}</td>
    <td><b>${salesMoney(r.net)}</b></td>
    <td>${salesMoney(r.commission)}</td>
    <td><button type="button" class="wa-mini" data-wa-person="${salesEsc(r.name)}" data-wa-net="${r.net}" data-wa-prim="${r.commission}" data-wa-count="${r.count||0}">Gönder</button></td>
  </tr>`).join('')||'<tr><td colspan="7">Bu dönemde satış yok.</td></tr>';
  qa(`${targetSel} [data-wa-person]`).forEach(b=>{
    b.onclick=()=>{
      const text=[
        '*ATAK PAZARLAMA*',
        `Personel: ${b.dataset.waPerson}`,
        `Dönem: ${opts.label||'-'}`,
        `Net satış: ${salesMoney(b.dataset.waNet)}`,
        `Satış adedi: ${b.dataset.waCount}`,
        `Prim: ${salesMoney(b.dataset.waPrim)}`,
        '',
        'Kolay gelsin.'
      ].join('\n');
      openWhatsAppShare(text);
    };
  });
}
let reasonModalState=null;
function openReasonModal({title,hint,onSubmit}){
  reasonModalState={onSubmit};
  if(q('#reasonModalTitle'))q('#reasonModalTitle').textContent=title||'Sebep';
  if(q('#reasonModalHint'))q('#reasonModalHint').textContent=hint||'Sebep yazın; talep Yönetici Onayları’na düşer.';
  if(q('#reasonModalText'))q('#reasonModalText').value='';
  q('#reasonModal')?.classList.remove('hidden');
  q('#reasonModal')?.setAttribute('aria-hidden','false');
  document.body.classList.add('modal-open');
  q('#reasonModalText')?.focus();
}
function closeReasonModal(){
  reasonModalState=null;
  q('#reasonModal')?.classList.add('hidden');
  q('#reasonModal')?.setAttribute('aria-hidden','true');
  if(q('#saleEditModal')?.classList.contains('hidden')&&q('#salesPreviewModal')?.classList.contains('hidden'))document.body.classList.remove('modal-open');
}
q('#reasonModalClose')?.addEventListener('click',closeReasonModal);
q('#reasonModalCancel')?.addEventListener('click',closeReasonModal);
q('#reasonModalSubmit')?.addEventListener('click',async()=>{
  const reason=(q('#reasonModalText')?.value||'').trim();
  if(!reason){toast('Sebep zorunludur');return}
  const cb=reasonModalState?.onSubmit;
  closeReasonModal();
  if(cb)await cb(reason);
});
async function requestCancellation(targetType,targetId,ref='',opts={}){
  const requestKind=String(opts.requestKind||'').toLowerCase()==='return'?'return':'cancel';
  const isReturn=requestKind==='return'&&targetType==='sale';
  openReasonModal({
    title:targetType==='collection'?'Tahsilat İptal Sebebi':(isReturn?'Satış İade Sebebi':'Satış İptal Sebebi'),
    hint:isReturn
      ?`${ref||'Satış'} için tam iade sebebi yazın. Tüm satış geri alınır; kısmi iade için Düzenle’yi kullanın. Talep Yönetici Onayları’na gider.`
      :`${ref||'İşlem'} için iptal sebebi yazın. Talep Yönetici Onayları’na gider; onaylanınca cari, kasa/banka, stok ve prim düzeltilir.`,
    onSubmit:async(reason)=>{
      try{
        const d=await api('/web-api/admin/cancellation-request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({targetType,targetId,reason,requestKind})});
        toast(d.message||(d.direct?'Rapid taslak silindi':(isReturn?'İade talebi yönetici onayına gönderildi':'İptal talebi yönetici onayına gönderildi')));
        await loadMySalesReport();await loadStaffSalesReport();await loadApprovals();await loadSalesTracking().catch(()=>{});
        if(customersPageData.selectedId)await selectCustomerPage(customersPageData.selectedId).catch(()=>{});
      }catch(e){toast(e.message)}
    }
  });
}
let saleEditState={sale:null,products:[],accounts:[]};
function saleEditPaySum(){
  return ['#saleEditPayCash','#saleEditPayCard','#saleEditPayTransfer','#saleEditPayCredit','#saleEditPayNote']
    .reduce((a,id)=>a+salesNum(q(id)?.value),0);
}
function saleEditGross(){
  return qa('#saleEditItems tr').reduce((a,row)=>{
    const qty=salesNum(row.querySelector('.se-qty')?.value);
    const price=salesNum(row.querySelector('.se-price')?.value);
    return a+qty*price;
  },0);
}
function refreshSaleEditTotals(){
  const gross=Math.round(saleEditGross()*100)/100;
  const disc=Math.min(100,Math.max(0,salesNum(q('#saleEditDiscount')?.value)));
  const net=Math.round(gross*(1-disc/100)*100)/100;
  const allocated=Math.round(saleEditPaySum()*100)/100;
  const rem=Math.round((net-allocated)*100)/100;
  if(q('#saleEditTotals'))q('#saleEditTotals').innerHTML=`<div><span>Brüt</span><b>${salesMoney(gross)}</b></div><div><span>İskonto</span><b>-${salesMoney(gross-net)}</b></div><div><span>Net</span><strong>${salesMoney(net)}</strong></div><div><span>Ödeme dağılımı</span><b>${salesMoney(allocated)}</b></div><div><span>Kalan</span><b class="${Math.abs(rem)>0.009?'debt':'credit'}">${salesMoney(rem)}</b></div>`;
  return{gross,disc,net,allocated,rem};
}
function saleEditAddRow(item={}){
  const tr=document.createElement('tr');
  const code=item.productCode||'';
  const name=item.productName||item.materialCode||'';
  tr.innerHTML=`<td><input class="se-code" list="saleEditProductList" value="${salesEsc(code)}" placeholder="Ürün kodu"/></td>
    <td><input class="se-name" value="${salesEsc(name)}" placeholder="Ürün adı"/></td>
    <td><input class="se-qty" type="number" min="1" step="1" value="${Number(item.quantity||1)}"/></td>
    <td><input class="se-price" type="number" min="0" step="0.01" value="${Number(item.unitPrice||0)}"/></td>
    <td><button type="button" class="secondary-btn se-del">Sil</button></td>`;
  q('#saleEditItems')?.appendChild(tr);
  tr.querySelector('.se-del')?.addEventListener('click',()=>{tr.remove();refreshSaleEditTotals()});
  tr.querySelector('.se-code')?.addEventListener('change',e=>{
    const p=saleEditState.products.find(x=>String(x.code)===String(e.target.value));
    if(p){tr.querySelector('.se-name').value=p.searchName||p.name||'';if(!salesNum(tr.querySelector('.se-price').value))tr.querySelector('.se-price').value=p.cashPrice||0}
    refreshSaleEditTotals();
  });
  ['se-qty','se-price'].forEach(cls=>tr.querySelector('.'+cls)?.addEventListener('input',refreshSaleEditTotals));
}
async function openSaleEditModal(saleId){
  const st=q('#saleEditStatus');if(st){st.textContent='';st.className='form-status'}
  try{
    const d=await api('/web-api/admin/sale/'+encodeURIComponent(saleId));
    if(d.pending?.length){toast('Bu satış için bekleyen onay talebi var');return}
    saleEditState={sale:d.sale,products:d.products||[],accounts:d.accounts||[]};
    if(q('#saleEditTitle'))q('#saleEditTitle').textContent=`Düzenle · ${d.sale.reference||''}`;
    if(q('#saleEditMeta'))q('#saleEditMeta').innerHTML=`<div><small>Müşteri</small><b>${salesEsc(d.customer?.name||'-')}</b><span>${salesEsc(d.customer?.email||d.customer?.phone||'')}</span></div><div><small>Satıcı</small><b>${salesEsc(d.sale.salespersonName||'-')}</b><span>${salesEsc(d.sale.dealerName||'')}</span></div><div><small>Mevcut net</small><b>${salesMoney(d.sale.total)}</b><span>${salesEsc(d.sale.paymentMethod||'')}</span></div>`;
    let list=q('#saleEditProductList');
    if(!list){list=document.createElement('datalist');list.id='saleEditProductList';document.body.appendChild(list)}
    list.innerHTML=(d.products||[]).slice(0,800).map(p=>`<option value="${salesEsc(p.code)}">${salesEsc(p.searchName||p.name||'')}</option>`).join('');
    const cashAcc=(d.accounts||[]).filter(a=>a.type==='cash');
    const bankAcc=(d.accounts||[]).filter(a=>a.type==='bank'||a.type==='cash');
    if(q('#saleEditCashAccount'))q('#saleEditCashAccount').innerHTML=cashAcc.concat(d.accounts||[]).filter((a,i,arr)=>arr.findIndex(x=>x.id===a.id)===i).map(a=>`<option value="${a.id}">${a.name}</option>`).join('');
    if(q('#saleEditBankAccount'))q('#saleEditBankAccount').innerHTML=(d.accounts||[]).map(a=>`<option value="${a.id}">${a.name}</option>`).join('');
    q('#saleEditItems').innerHTML='';
    (d.sale.items||[]).forEach(i=>saleEditAddRow(i));
    if(!(d.sale.items||[]).length)saleEditAddRow({});
    if(q('#saleEditDiscount'))q('#saleEditDiscount').value=Number(d.sale.discountPct||0);
    const pays=d.sale.payments||[];
    const sumBy=m=>pays.filter(p=>String(p.method).toLocaleLowerCase('tr-TR').includes(m)).reduce((a,p)=>a+Number(p.amount||0),0);
    if(q('#saleEditPayCash'))q('#saleEditPayCash').value=sumBy('nakit')||0;
    if(q('#saleEditPayCard'))q('#saleEditPayCard').value=sumBy('kart')||0;
    if(q('#saleEditPayTransfer'))q('#saleEditPayTransfer').value=sumBy('havale')||0;
    if(q('#saleEditPayCredit'))q('#saleEditPayCredit').value=sumBy('vadeli')||0;
    if(q('#saleEditPayNote'))q('#saleEditPayNote').value=sumBy('senet')||0;
    const firstCash=pays.find(p=>/nakit/i.test(p.method)&&p.accountId);
    const firstBank=pays.find(p=>/(kart|havale)/i.test(p.method)&&p.accountId);
    if(firstCash&&q('#saleEditCashAccount'))q('#saleEditCashAccount').value=firstCash.accountId;
    if(firstBank&&q('#saleEditBankAccount'))q('#saleEditBankAccount').value=firstBank.accountId;
    if(q('#saleEditReason'))q('#saleEditReason').value='';
    refreshSaleEditTotals();
    q('#saleEditModal')?.classList.remove('hidden');
    q('#saleEditModal')?.setAttribute('aria-hidden','false');
    document.body.classList.add('modal-open');
  }catch(e){toast(e.message)}
}
function closeSaleEditModal(){
  q('#saleEditModal')?.classList.add('hidden');
  q('#saleEditModal')?.setAttribute('aria-hidden','true');
  if(q('#reasonModal')?.classList.contains('hidden')&&q('#salesPreviewModal')?.classList.contains('hidden'))document.body.classList.remove('modal-open');
}
q('#saleEditClose')?.addEventListener('click',closeSaleEditModal);
q('#saleEditCancel')?.addEventListener('click',closeSaleEditModal);
q('#saleEditAddItem')?.addEventListener('click',()=>{saleEditAddRow({});refreshSaleEditTotals()});
['#saleEditDiscount','#saleEditPayCash','#saleEditPayCard','#saleEditPayTransfer','#saleEditPayCredit','#saleEditPayNote'].forEach(id=>q(id)?.addEventListener('input',refreshSaleEditTotals));
q('#saleEditSubmit')?.addEventListener('click',async()=>{
  const st=q('#saleEditStatus');
  const sale=saleEditState.sale;if(!sale)return;
  const reason=(q('#saleEditReason')?.value||'').trim();
  if(!reason){st.textContent='Düzenleme sebebi zorunlu';st.className='form-status error';return}
  const totals=refreshSaleEditTotals();
  if(Math.abs(totals.rem)>0.009){st.textContent=`Ödeme dağılımı nete eşit olmalı. Kalan: ${salesMoney(totals.rem)}`;st.className='form-status error';return}
  const items=qa('#saleEditItems tr').map(row=>({
    productCode:(row.querySelector('.se-code')?.value||'').trim(),
    productName:(row.querySelector('.se-name')?.value||'').trim(),
    materialCode:(row.querySelector('.se-name')?.value||'').trim(),
    quantity:salesNum(row.querySelector('.se-qty')?.value),
    unitPrice:salesNum(row.querySelector('.se-price')?.value)
  })).filter(i=>i.productCode&&i.quantity>0);
  if(!items.length){st.textContent='En az bir ürün gerekli';st.className='form-status error';return}
  const cash=salesNum(q('#saleEditPayCash')?.value),card=salesNum(q('#saleEditPayCard')?.value),transfer=salesNum(q('#saleEditPayTransfer')?.value),credit=salesNum(q('#saleEditPayCredit')?.value),note=salesNum(q('#saleEditPayNote')?.value);
  const payments=[];
  if(cash>0)payments.push({method:'Nakit',amount:cash,accountId:q('#saleEditCashAccount')?.value||''});
  if(card>0)payments.push({method:'Kredi Kartı',amount:card,accountId:q('#saleEditBankAccount')?.value||''});
  if(transfer>0)payments.push({method:'Havale',amount:transfer,accountId:q('#saleEditBankAccount')?.value||''});
  if(credit>0)payments.push({method:'Vadeli',amount:credit,accountId:''});
  if(note>0)payments.push({method:'Senet',amount:note,accountId:''});
  try{
    st.textContent='Onaya gönderiliyor...';st.className='form-status';
    await api('/web-api/admin/cancellation-request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      targetType:'sale_edit',targetId:sale.id,reason,
      payload:{items,discountPct:totals.disc,payments,description:sale.description||''}
    })});
    toast('Satış düzenlemesi yönetici onayına gönderildi');
    closeSaleEditModal();
    await loadStaffSalesReport();await loadMySalesReport();await loadApprovals();
    if(customersPageData.selectedId)await selectCustomerPage(customersPageData.selectedId).catch(()=>{});
  }catch(e){st.textContent=e.message;st.className='form-status error'}
});
function reportSaleActions(r){
  if(r.pendingCancel)return `<span class="approval-status pending" title="${salesEsc(r.pendingReason||'')}">İptal onayı bekliyor</span>`;
  if(r.pendingEdit)return `<span class="approval-status pending" title="${salesEsc(r.pendingReason||'')}">Düzenleme onayı bekliyor</span>`;
  return `<button type="button" class="secondary-btn" data-sale-edit="${r.id}">Düzenle</button> <button type="button" class="secondary-btn" data-report-return="${r.id}" data-ref="${salesEsc(r.reference||'')}">İade</button> <button type="button" data-report-cancel="${r.id}" data-ref="${salesEsc(r.reference||'')}">İptal</button>`;
}
async function loadMySalesReport(){
  const st=q('#mySalesStatus');
  if(q('#mySalesDate') && !q('#mySalesDate').value)q('#mySalesDate').value=isoToday();
  if(q('#mySalesMonth') && !q('#mySalesMonth').value)q('#mySalesMonth').value=isoMonth();
  const period=(q('#mySalesPeriodToggle .period-btn.active')?.dataset.period)||'day';
  setPeriodUi('mySales',period);
  try{
    const d=await api('/web-api/admin/sales-prim-board?'+primBoardQuery('mySales').toString());
    mySalesBoard=d;
    q('#mySalesSummary').innerHTML=reportKpis(d.summary);
    renderRankTable('#mySalesRankTable',d.ranking,{label:d.label});
    q('#mySalesRankHint').textContent=`${d.period==='month'?'Aylık':'Günlük'} · ${d.label||''} · çok satan üstte`;
    q('#mySalesTable').innerHTML=(d.rows||[]).map(r=>`<tr><td>${r.date||'-'}</td><td>${r.dealerName||'-'}</td><td>${r.salespersonName||'-'}</td><td><b>${salesMoney(r.total)}</b></td><td>%${Number(r.discountPct||0)}</td><td><b>${salesMoney(r.commissionAmount||0)}</b></td><td>${reportSaleActions(r)}</td></tr>`).join('')||'<tr><td colspan="7">Satış yok.</td></tr>';
    qa('#mySalesTable [data-report-cancel]').forEach(b=>b.onclick=()=>requestCancellation('sale',b.dataset.reportCancel,b.dataset.ref));
    qa('#mySalesTable [data-report-return]').forEach(b=>b.onclick=()=>requestCancellation('sale',b.dataset.reportReturn,b.dataset.ref,{requestKind:'return'}));
    qa('#mySalesTable [data-sale-edit]').forEach(b=>b.onclick=()=>openSaleEditModal(b.dataset.saleEdit));
    st.textContent=`NET ${salesMoney(d.summary?.net||0)} · ${d.ranking?.length||0} personel · ${d.rows?.length||0} satış`;
    st.className='form-status success';
  }catch(e){st.textContent=e.message;st.className='form-status error'}
}
async function loadStaffSalesReport(){
  const st=q('#staffSalesStatus');
  if(q('#staffSalesDate') && !q('#staffSalesDate').value)q('#staffSalesDate').value=isoToday();
  if(q('#staffSalesMonth') && !q('#staffSalesMonth').value)q('#staffSalesMonth').value=isoMonth();
  const period=(q('#staffSalesPeriodToggle .period-btn.active')?.dataset.period)||'day';
  setPeriodUi('staffSales',period);
  try{
    const params=primBoardQuery('staffSales');
    const d=await api('/web-api/admin/sales-prim-board?'+params.toString());
    staffSalesBoard=d;
    const current=q('#staffSalesPersonFilter')?.value||'';
    q('#staffSalesPersonFilter').innerHTML='<option value="">Tüm personel</option>'+(d.people||[]).map(p=>`<option value="${p.id}">${p.name}</option>`).join('');
    if(current)q('#staffSalesPersonFilter').value=current;
    q('#staffSalesSummary').innerHTML=reportKpis(d.summary);
    renderRankTable('#staffSalesRankTable',d.ranking,{label:d.label});
    q('#staffSalesTable').innerHTML=(d.rows||[]).map(r=>`<tr><td>${r.date||'-'}</td><td><b>${r.customerName||'-'}</b><small>${r.reference||''}</small></td><td><b>${r.salespersonName||'-'}</b></td><td>${r.dealerName||'-'}</td><td>${salesMoney(r.grossTotal||r.total)}</td><td><b>${salesMoney(r.total)}</b></td><td>${salesMoney(r.commissionAmount||0)}</td><td>${reportSaleActions(r)}</td></tr>`).join('')||'<tr><td colspan="8">Satış yok.</td></tr>';
    // tahsilatlar: kısa dönem için performance'dan çek
    try{
      const p2=new URLSearchParams();
      if(d.from)p2.set('from',d.from); if(d.to)p2.set('to',d.to);
      const person=q('#staffSalesPersonFilter')?.value||''; const dealer=q('#staffSalesDealerFilter')?.value||'';
      if(person)p2.set('salespersonId',person); if(dealer)p2.set('dealerId',dealer);
      const perf=await api('/web-api/admin/sales-performance?'+p2.toString());
      const cols=(perf.collections||[]).filter(c=>!d.from|| (String(c.date||'')>=d.from && String(c.date||'')<=d.to));
      q('#staffCollectionsTable').innerHTML=cols.map(c=>`<tr><td>${c.date||'-'}</td><td>${c.customerName||'-'}</td><td><b>${salesMoney(c.amount)}</b></td><td>${c.accountName||c.category||'-'}</td><td>${c.reference||'-'}</td><td>${c.pendingCancel?'<span class="approval-status pending">Onay bekliyor</span>':`<button type="button" data-col-cancel="${c.id}" data-ref="${c.reference||''}">İptal</button>`}</td></tr>`).join('')||'<tr><td colspan="6">Tahsilat yok.</td></tr>';
    }catch(_){q('#staffCollectionsTable').innerHTML='<tr><td colspan="6">Tahsilat yüklenemedi.</td></tr>'}
    qa('#staffSalesTable [data-report-cancel]').forEach(b=>b.onclick=()=>requestCancellation('sale',b.dataset.reportCancel,b.dataset.ref));
    qa('#staffSalesTable [data-report-return]').forEach(b=>b.onclick=()=>requestCancellation('sale',b.dataset.reportReturn,b.dataset.ref,{requestKind:'return'}));
    qa('[data-col-cancel]').forEach(b=>b.onclick=()=>requestCancellation('collection',b.dataset.colCancel,b.dataset.ref));
    qa('#staffSalesTable [data-sale-edit]').forEach(b=>b.onclick=()=>openSaleEditModal(b.dataset.saleEdit));
    if(!d.canManage){q('[data-tab="staffSalesReport"]')?.classList.add('hidden');q('[data-tab="managerApprovals"]')?.classList.add('hidden')}
    st.textContent=`NET ${salesMoney(d.summary?.net||0)} · sıralama net satışa göre`;
    st.className='form-status success';
  }catch(e){st.textContent=e.message;st.className='form-status error'}
}
function approvalTypeLabel(type=''){
  return({sale:'Satış iptali',sale_return:'Satış iadesi',collection:'Tahsilat iptali',customer_edit:'Müşteri düzenleme',customer_delete:'Müşteri silme',sale_edit:'Satış düzenleme'}[type]||type||'-');
}
function approvalDetailHtml(r){
  if(r.targetType==='sale_edit'){
    const p=r.payload?.preview||{};
    return `<div class="approval-edit-detail"><div>${salesEsc(r.reason||'Satış düzenleme')}</div><small>Net: ${salesMoney(p.beforeTotal)} → <b>${salesMoney(p.afterTotal)}</b> · ${p.itemCount||0} kalem</small></div>`;
  }
  if(r.targetType==='customer_delete'){
    const p=r.payload||{},b=p.before||{};
    return `<div class="approval-edit-detail"><div>${salesEsc(r.reason||'Müşteri silme')}</div><small>${salesEsc(b.name||r.targetReference||'-')}${b.phone?' · '+salesEsc(b.phone):''}${p.balance!=null?` · Cari ${salesMoney(p.balance)}`:''}</small><small>Onaylanınca müşteri pasife alınır (silinmiş).</small></div>`;
  }
  if(r.targetType!=='customer_edit'||!r.payload?.after)return salesEsc(r.reason||'-');
  const b=r.payload.before||{},a=r.payload.after||{};
  const keys=['name','phone','email','city','district','address','invoiceType','companyName','taxOffice','taxNo','tckn','note','active'];
  const changes=keys.filter(k=>String(b[k]??'')!==String(a[k]??'')).map(k=>`<div><small>${k}</small>: <s>${salesEsc(b[k]??'-')}</s> → <b>${salesEsc(a[k]??'-')}</b></div>`).join('');
  return `<div class="approval-edit-detail"><div>${salesEsc(r.reason||'Müşteri düzenleme')}</div>${changes||'<small>Alan farkı yok</small>'}</div>`;
}
async function loadApprovals(){
  const info=q('#approvalInfo');
  try{const d=await api('/web-api/admin/cancellation-requests');if(!d.canManage){q('[data-tab="managerApprovals"]')?.classList.add('hidden');info.textContent='Yalnız yönetici.';return}
    q('#approvalTable').innerHTML=(d.rows||[]).map(r=>`<tr><td><span class="approval-status ${r.status}">${r.status==='pending'?'Bekliyor':r.status==='approved'?'Onaylandı':'Reddedildi'}</span></td><td>${approvalTypeLabel(r.targetType)}</td><td>${r.targetReference||'-'}</td><td>${r.requestedByName||'-'}</td><td>${approvalDetailHtml(r)}</td><td>${String(r.requestedAt||'').replace('T',' ').slice(0,16)}</td><td>${r.status==='pending'?`<button type="button" data-appr="${r.id}" data-type="${r.targetType||''}">Onayla</button> <button type="button" data-rej="${r.id}">Reddet</button>`:(r.reviewedBy||'-')}</td></tr>`).join('');
    qa('[data-appr]').forEach(b=>b.onclick=async()=>{
      const msg=b.dataset.type==='customer_edit'?'Müşteri düzenlemesi uygulansın mı?'
        :b.dataset.type==='customer_delete'?'Müşteri silme onaylansın mı? Kayıt pasife alınır (listeden düşer). Cari geçmişi korunur.'
        :b.dataset.type==='sale_edit'?'Satış düzenlemesi uygulansın mı? Cari, kasa, stok ve prim güncellenecek.'
        :'İptal onaylansın mı? Satış ise tahsilat, cari, stok ve prim ters kayıtla düzeltilir.';
      if(!confirm(msg))return;
      try{
        await api('/web-api/admin/cancellation-request/'+b.dataset.appr+'/review',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'approve'})});
        toast('Onaylandı');
        await loadApprovals();
        await loadStaffSalesReport();
        await loadMySalesReport();
        if(b.dataset.type==='customer_delete'){
          customersPageData.selectedId='';
          await loadCustomersPage().catch(()=>{});
        }else if(customersPageData.selectedId)await selectCustomerPage(customersPageData.selectedId);
      }catch(e){toast(e.message)}
    });
    qa('[data-rej]').forEach(b=>b.onclick=async()=>{const note=prompt('Red açıklaması:','')||'';try{await api('/web-api/admin/cancellation-request/'+b.dataset.rej+'/review',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'reject',note})});toast('Reddedildi');await loadApprovals();if(customersPageData.selectedId)await selectCustomerPage(customersPageData.selectedId).catch(()=>{})}catch(e){toast(e.message)}});
    info.textContent='İptal, satış düzenleme, müşteri düzenleme/silme talepleri burada onaylanır. Onaylanmadan işlem uygulanmaz.';info.className='form-status success';
  }catch(e){info.textContent=e.message;info.className='form-status error'}
}
q('#mySalesRefresh')?.addEventListener('click',loadMySalesReport);
q('#staffSalesRefresh')?.addEventListener('click',loadStaffSalesReport);
q('#approvalRefresh')?.addEventListener('click',loadApprovals);
q('#mySalesPdfBtn')?.addEventListener('click',()=>mySalesBoard?openPrimPdf(mySalesBoard,'Satışlarım & Prim'):toast('Önce raporu yükleyin'));
q('#mySalesWaBtn')?.addEventListener('click',()=>mySalesBoard?openWhatsAppShare(buildPrimWhatsAppText(mySalesBoard,'ATAK PAZARLAMA — Satış & Prim')):toast('Önce raporu yükleyin'));
q('#staffSalesPdfBtn')?.addEventListener('click',()=>staffSalesBoard?openPrimPdf(staffSalesBoard,'Personel Satış Raporu'):toast('Önce raporu yükleyin'));
q('#staffSalesWaBtn')?.addEventListener('click',()=>staffSalesBoard?openWhatsAppShare(buildPrimWhatsAppText(staffSalesBoard,'ATAK PAZARLAMA — Personel Raporu')):toast('Önce raporu yükleyin'));
qa('#mySalesPeriodToggle .period-btn').forEach(b=>b.onclick=()=>{setPeriodUi('mySales',b.dataset.period);loadMySalesReport()});
qa('#staffSalesPeriodToggle .period-btn').forEach(b=>b.onclick=()=>{setPeriodUi('staffSales',b.dataset.period);loadStaffSalesReport()});
['#mySalesDate','#mySalesMonth'].forEach(id=>q(id)?.addEventListener('change',loadMySalesReport));
['#staffSalesPersonFilter','#staffSalesDealerFilter','#staffSalesDate','#staffSalesMonth'].forEach(id=>q(id)?.addEventListener('change',loadStaffSalesReport));


let salesTrackingRows=[];
const deliveryStatusNames={order_received:'Sipariş Alındı',preparing:'Hazırlanıyor',ready:'Teslimata Hazır',shipped:'Sevkte',delivered:'Teslim Edildi'};
async function discardRapidDraft(saleId, ref){
  const id=String(saleId||'').trim();
  if(!id)return;
  if(!confirm(`${ref||'Bu Rapid taslağı'} silinsin mi?\n\nKasa ve stok işlemedi. Aynı Rapid satış bir daha Satış Takibi’ne düşmez.`))return;
  try{
    await api('/web-api/admin/sale/'+encodeURIComponent(id)+'/discard-rapid-draft',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reason:'Rapid taslak silindi'})});
    toast('Rapid taslak silindi');
    await loadSalesTracking().catch(()=>{});
    if(customersPageData.selectedId)await selectCustomerPage(customersPageData.selectedId).catch(()=>{});
  }catch(e){toast(e.message||'Silinemedi')}
}
function renderSalesTracking(){
  const term=(q('#salesTrackingSearch')?.value||'').trim().toLocaleLowerCase('tr-TR'),status=q('#salesTrackingStatusFilter')?.value||'';
  const rows=salesTrackingRows.filter(r=>{
    if(status==='needs_completion' && !r.needsCompletion)return false;
    if(status && status!=='needs_completion' && r.deliveryStatus!==status)return false;
    if(term){
      const hay=`${r.reference} ${r.rapidSalesId||''} ${r.customerName} ${r.customerPhone} ${r.salespersonName} ${r.dealerName} ${(r.items||[]).map(i=>`${i.productCode} ${i.productName}`).join(' ')}`.toLocaleLowerCase('tr-TR');
      if(!hay.includes(term))return false;
    }
    return true;
  });
  const open=rows.filter(r=>r.deliveryStatus!=='delivered').length,delivered=rows.filter(r=>r.deliveryStatus==='delivered').length,pending=rows.filter(r=>r.needsCompletion).length,total=rows.reduce((a,r)=>a+Number(r.total||0),0);
  q('#salesTrackingSummary').innerHTML=`<article><small>Gösterilen</small><b>${rows.length}</b></article><article><small>Açık Satış</small><b>${open}</b></article><article><small>Tamamlanacak Rapid</small><b>${pending}</b></article><article><small>Teslim Edildi</small><b>${delivered}</b></article><article><small>Toplam Tutar</small><b>${salesMoney(total)}</b></article>`;
  q('#salesTrackingTable').innerHTML=rows.map(r=>{
    const complete=r.needsCompletion?`<button type="button" class="primary" data-sale-complete="${r.id}">Satışa git</button>`:'';
    const discard=r.needsCompletion?`<button type="button" data-sale-discard="${r.id}" data-ref="${salesEsc(r.reference||r.rapidSalesId||'')}">Taslağı sil</button>`:'';
    return `<tr${r.needsCompletion?' style="background:#fff7ed"':''}>
    <td><b>${r.reference||'-'}</b><small>${r.date||''}${r.needsCompletion?' · Rapid — tamamla':''}</small></td>
    <td><b>${r.customerName||'-'}</b><small>${r.customerPhone||''}</small> ${sipBtn(r.customerPhone,{className:'sip-call-sm',customerId:r.customerId})}</td>
    <td>${r.dealerName||'-'}<small>${r.salespersonName||'-'}</small></td>
    <td><b>${salesMoney(r.total)}</b></td>
    <td><select data-track-status="${r.id}">${Object.entries(deliveryStatusNames).map(([k,v])=>`<option value="${k}" ${k===r.deliveryStatus?'selected':''}>${v}</option>`).join('')}</select></td>
    <td><textarea data-track-note="${r.customerId}" rows="2">${r.customerNote||''}</textarea></td>
    <td style="display:flex;gap:6px;flex-wrap:wrap">${complete}${discard}<button type="button" data-track-save="${r.id}" data-customer="${r.customerId}">Kaydet</button></td>
  </tr>`;
  }).join('');
  qa('[data-sale-complete]').forEach(btn=>btn.onclick=()=>openRapidSaleInSalesCenter(btn.dataset.saleComplete));
  qa('[data-sale-discard]').forEach(btn=>btn.onclick=()=>discardRapidDraft(btn.dataset.saleDiscard,btn.dataset.ref||''));
  qa('[data-track-save]').forEach(btn=>btn.onclick=async()=>{
    const saleId=btn.dataset.trackSave,customerId=btn.dataset.customer,status=q(`[data-track-status="${saleId}"]`)?.value||'order_received',note=q(`[data-track-note="${customerId}"]`)?.value||'';
    try{
      await api('/web-api/admin/sale/'+encodeURIComponent(saleId)+'/delivery-status',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({status})});
      if(customerId)await api('/web-api/admin/customer/'+encodeURIComponent(customerId)+'/note',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({note})});
      toast('Satış takibi güncellendi');await loadSalesTracking();
    }catch(e){toast(e.message)}
  });
  q('#salesTrackingStatus').textContent=`${rows.length} satış gösteriliyor.`;q('#salesTrackingStatus').className='form-status success';
}
async function loadSalesTracking(){
  const st=q('#salesTrackingStatus');
  try{const d=await api('/web-api/admin/sales-tracking');salesTrackingRows=d.rows||[];renderSalesTracking()}
  catch(e){st.textContent=e.message;st.className='form-status error'}
}
q('#salesTrackingShortcut')?.addEventListener('click',()=>goTab('salesTracking'));
q('#salesTrackingRefresh')?.addEventListener('click',loadSalesTracking);
q('#salesTrackingStatusFilter')?.addEventListener('change',renderSalesTracking);
q('#salesTrackingSearch')?.addEventListener('input',renderSalesTracking);

function isoDaysAgo(n){
  const d=new Date();
  d.setDate(d.getDate()-n);
  return d.toISOString().slice(0,10);
}
function rapid360XmlSourceFile(){
  const file=q('#rapid360SalesXmlFile')?.files?.[0];
  if(file) return file;
  const paste=String(q('#rapid360SalesXmlPaste')?.value||'').trim();
  if(paste && /<Satis/i.test(paste)) return new File([paste],'satislar.xml',{type:'application/xml'});
  return null;
}
function rapid360SalesXmlForm(){
  const file=rapid360XmlSourceFile();
  if(!file)return null;
  const fd=new FormData();
  fd.append('file',file);
  fd.append('dealerId',q('#rapid360SalesXmlDealer')?.value||'atak-beko');
  fd.append('categoryId',q('#rapid360NewProductCategory')?.value||'');
  fd.append('categoryMap',JSON.stringify(rapid360CollectCategoryMap()));
  fd.append('salesIds',JSON.stringify(rapid360SelectedSalesIds()));
  return fd;
}
let rapid360PullToken='';
let rapid360PreviewData=null;
function rapid360PullBody(extra={}){
  return{
    startDate:q('#rapid360SalesStart')?.value||isoDaysAgo(7),
    endDate:q('#rapid360SalesEnd')?.value||isoDaysAgo(0),
    store:'340334',
    company:q('#rapid360SalesCompanyFilter')?.value||'2521',
    dealerId:q('#rapid360SalesXmlDealer')?.value||'atak-beko',
    pullToken:rapid360PullToken||undefined,
    loginHint:'W340334.1@rapid360.arcelikpazarlama.com.tr',
    salesIds:rapid360SelectedSalesIds(),
    categoryId:q('#rapid360NewProductCategory')?.value||undefined,
    categoryMap:rapid360CollectCategoryMap(),
    ...extra
  };
}
function fillRapidAktarDefaults(){
  if(q('#rapid360SalesStart') && !q('#rapid360SalesStart').value) q('#rapid360SalesStart').value=isoDaysAgo(7);
  if(q('#rapid360SalesEnd') && !q('#rapid360SalesEnd').value) q('#rapid360SalesEnd').value=isoDaysAgo(0);
  if(q('#rapid360SalesStoreFilter')) q('#rapid360SalesStoreFilter').value='340334';
  if(q('#rapid360SalesCompanyFilter') && !q('#rapid360SalesCompanyFilter').value) q('#rapid360SalesCompanyFilter').value='2521';
}
function hideRapidOktaBox(){q('#rapid360OktaBox')?.classList.add('hidden')}
function rapidOktaEsc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function rapid360ReportUrl(){
  const company=q('#rapid360SalesCompanyFilter')?.value||'2521';
  return `https://liverapid360.operations.dynamics.com/?cmp=${encodeURIComponent(company)}&mi=DmrDetailedSalesReport&prt=initial`;
}
function rapid360MagazaConsoleScript(){
  return `(()=>{const w='340334';const names=['InventLocationId','inventLocationId','parmInventLocationId','Magaza','parmMagaza','RetailStoreId','Store'];const all=[...document.querySelectorAll('[data-dyn-controlname]')];let host=all.find(el=>names.includes(el.getAttribute('data-dyn-controlname')))||all.find(el=>/inventlocation|magaza|store|warehouse/i.test(el.getAttribute('data-dyn-controlname')||''));const input=(host&&host.querySelector('input:not([type=hidden])'))||[...document.querySelectorAll('input')].find(i=>/ma[gğ]aza|inventlocation|depo/i.test((i.getAttribute('aria-label')||'')+(i.id||'')));if(input){input.focus();input.click();const d=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value');if(d&&d.set)d.set.call(input,w);else input.value=w;['input','change'].forEach(t=>input.dispatchEvent(new Event(t,{bubbles:true})));input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));}const hit=[...document.querySelectorAll('button,a,span,div,li,input')].find(el=>{const t=String(el.innerText||el.value||el.getAttribute('title')||el.getAttribute('aria-label')||'').replace(/\\s+/g,' ').trim();const n=String(el.getAttribute('data-dyn-controlname')||el.id||'');return /^(XML|Xml)$/.test(t)||/XML\\s*(indir|oluştur|olustur)?$/i.test(t)||(/xml/i.test(n)&&/(export|download|indir)/i.test(n+t));});if(hit){hit.click();alert('XML komutu tıklandı. İndirilen dosyayı Atak’ta seçin.');}else if(input)alert('Mağaza 340334 yazıldı. Rapid’te XML / İndir’e basın, dosyayı Atak’ta seçin.');else alert('Mağaza kutusu bulunamadı. Rapid’te Mağaza 340334 ATAK seçip XML indirin, dosyayı Atak’ta seçin.');})();`;
}
function showRapidOktaBox(d){
  const box=q('#rapid360OktaBox');
  if(!box) return;
  box.classList.remove('hidden');
  box.innerHTML=`<div style="font-weight:700;color:#1e3a8a;margin-bottom:6px">Okta bekleniyor</div>
    <p style="margin:6px 0 0;font-size:13px;color:#334155">${rapidOktaEsc(d.message||'Telefonda Okta bildirimine basın. Onaydan sonra satışlar otomatik çekilir. Kod yazılmaz.')}</p>`;
}
function rapidBlockedMicrosoftHref(href){
  const s=String(href||'');
  const blocked='login.microsoftonline.com';
  if(!s) return true;
  if(s.toLowerCase().includes(blocked)) return true;
  return /nativeclient|wrongplace|deviceauth|devicelogin|rapid360-okta-callback|oauth2\/v2\.0\/authorize/i.test(s);
}
function openRapidOktaPopup(url, popup, name){
  let href=String(url||'');
  if(rapidBlockedMicrosoftHref(href)) href=rapid360ReportUrl();
  try{
    if(popup && !popup.closed && !name) popup.location.href=href;
    else popup=window.open(href,name||'rapid360okta','popup=yes,width=1080,height=780');
  }catch(_){ window.open(href,'_blank','noopener'); }
  return popup;
}
function continueRapidDeviceLogin(popup){
  return openRapidOktaPopup(rapid360ReportUrl(), popup);
}
async function loadRapidOktaStatus(){
  const el=q('#rapid360OktaStatus');
  if(!el) return;
  el.innerHTML='<span style="color:#64748b">Bağlantı kontrol ediliyor…</span>';
  try{
    const d=await api('/web-api/admin/rapid360-conn-status');
    const robot=d.robotReady
      ?'<small style="margin-left:6px;color:#15803d">robot hazır</small>'
      :`<small style="margin-left:6px;color:#b45309">robot yok${d.robotError?': '+rapidOktaEsc(d.robotError):''}</small>`;
    const pass=d.oktaPasswordSet?'':'<small style="margin-left:6px;color:#b45309">Okta şifresi kayıtlı değil — Ayarlar → Rapid Aktar</small>';
    if(d.canPull){
      el.innerHTML=`<span style="color:#15803d;font-weight:800">🟢 Bağlı — aktarım hazır</span>${d.account?`<small style="margin-left:6px;color:#475569">${rapidOktaEsc(d.account)}</small>`:''}${robot}${pass}`;
    }else{
      el.innerHTML=`<span style="color:#b91c1c;font-weight:800">🔴 Bağlı değil</span>${robot}${pass}`;
    }
  }catch(_){
    el.innerHTML='<span style="color:#b91c1c;font-weight:800">🔴 Bağlı değil</span>';
  }
}
function sleep(ms){return new Promise(r=>setTimeout(r,ms))}
async function pollRapidOktaOnce(pollId){
  if(!pollId) return {pending:true};
  try{
    return await api('/web-api/admin/rapid360-okta-poll',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pollId})});
  }catch(e){
    if(e.status===400) return {pending:true};
    throw e;
  }
}
async function startRapidOktaLogin(popup){
  const d=await api('/web-api/admin/rapid360-okta-start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(rapid360PullBody({webOnly:true}))});
  showRapidOktaBox(d);
  openRapidOktaPopup(rapid360ReportUrl(), popup);
  return d;
}
async function applyRapidPullResult(d, st){
  rapid360PullToken=d.pullToken||'';
  renderRapid360SalesXmlPreview(d);
  hideRapidOktaBox();
  loadRapidOktaStatus();
  const n=Number(d.count||(d.rows||[]).length||0);
  const msg=`${n} satış okundu · ${d.importable||0} aktarılabilir. İstediklerinizi işaretleyip Seçilenleri aktar deyin.`;
  if(st){st.textContent=msg;st.className='form-status success'}
  toast(msg);
  if(d.needsProductCategories) q('#rapid360NewProductsBox')?.scrollIntoView({behavior:'smooth',block:'center'});
  return d;
}
function showRapidBridgeBox(br){
  const box=q('#rapid360OktaBox');
  if(!box) return;
  box.classList.remove('hidden');
  const head=br&&br.reason?`<p style="margin:0 0 6px;font-size:13px;color:#b45309"><b>${rapidOktaEsc(br.reason)}</b> — <a href="/web-api/admin/rapid360-robot-shot" target="_blank">robotun gördüğü ekranı aç</a></p>`:'';
  box.innerHTML=`${head}<p style="margin:0 0 8px;font-size:13px;color:#334155">Robot Hostinger’da çalışır. Kendi Chrome’unuzda açılan Rapid360 <b>robot değildir</b>. Kullanıcı <b>W340334.1</b> (nokta var). “Oturum açılamıyor” görürseniz Doğrula’ya tekrar basmayın.</p><p style="margin:0;font-size:13px;color:#334155">Yedek: <a id="rapid360BridgeLink" style="display:inline-block;padding:6px 10px;border-radius:8px;background:#15803d;color:#fff;text-decoration:none;font-weight:700">Rapid360’dan Atak’a gönder</a> yer imine, veya <button type="button" id="rapidOpenBrowserBtn" class="secondary-btn" style="margin-left:6px">Tarayıcıda Rapid360 aç</button></p>`;
  const a=q('#rapid360BridgeLink');
  if(a && br.bookmarklet) a.setAttribute('href',br.bookmarklet);
  q('#rapidOpenBrowserBtn')?.addEventListener('click',()=>openRapidOktaPopup((br&&br.loginUrl)||rapid360ReportUrl()));
}
async function autoPullRapid360Sales(){
  const st=q('#rapid360SalesXmlStatus');
  fillRapidAktarDefaults();
  rapid360PullToken='';
  if(st){st.textContent='Satışlar arka planda okunuyor…';st.className='form-status'}
  q('#rapid360SalesXmlImportBtn')&&(q('#rapid360SalesXmlImportBtn').disabled=true);
  q('#rapid360SalesPullBtn')&&(q('#rapid360SalesPullBtn').disabled=true);
  try{
    try{
      const d=await pullRapid360Live();
      return applyRapidPullResult(d, st);
    }catch(e){
      if(!(e.status===409 && e.payload && e.payload.needsOkta) && e.status!==400) throw e;
    }
    let robot=null;
    let robotErr='';
    try{
      robot=await api('/web-api/admin/rapid360-robot-start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(rapid360PullBody())});
    }catch(e){
      robot=null;
      robotErr=e.message||'';
      if(st&&robotErr){st.textContent='Robot çalışmadı: '+robotErr;st.className='form-status'}
    }
    if(robotErr&&/Okta şifresi/i.test(robotErr)){
      if(st){st.textContent=robotErr;st.className='form-status error'}
      return;
    }
    let lastErr='';
    if(robot&&robot.jobId){
      if(st){st.textContent=robot.message||'Robot Rapid360’a bağlanıyor…';st.className='form-status'}
      const rDeadline=Date.now()+240000;
      while(Date.now()<rDeadline){
        await sleep(3000);
        try{
          const jr=await api('/web-api/admin/rapid360-robot-poll/'+encodeURIComponent(robot.jobId));
          if(jr.pending){if(st){st.textContent=jr.message||'Robot çalışıyor…';st.className='form-status'}continue}
          return applyRapidPullResult(jr, st);
        }catch(e){lastErr=e.message||'Robot hatası';break}
      }
      if(st&&lastErr){st.textContent=lastErr;st.className='form-status'}
    }
    let bridge=null;
    try{
      bridge=await api('/web-api/admin/rapid360-bridge-start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(rapid360PullBody())});
    }catch(_){}
    const boxInfo=bridge||{};
    if(robotErr||lastErr)boxInfo.reason=`Robot çalışmadı: ${robotErr||lastErr}`;
    showRapidBridgeBox(boxInfo);
    const deadline=Date.now()+180000;
    while(Date.now()<deadline){
      try{
        const d=await pullRapid360Live();
        return applyRapidPullResult(d, st);
      }catch(e){
        lastErr=e.message||'okunamadı';
        if(!(e.status===409 && e.payload && e.payload.needsOkta) && e.status!==400) throw e;
      }
      if(bridge&&bridge.bridgeId){
        try{
          const b=await api('/web-api/admin/rapid360-bridge-poll/'+encodeURIComponent(bridge.bridgeId));
          if(b && b.ok && ((b.rows||[]).length||b.count)) return applyRapidPullResult(b, st);
          if(b && b.error) lastErr=b.error;
        }catch(_){}
      }
      if(st){st.textContent='Rapid360’ta Okta’yı onaylayın. Satışlar Atak’a geliyor…';st.className='form-status'}
      await sleep(2500);
    }
    if(st){st.textContent=lastErr||'Satış okunamadı. Rapid360 açıkken yeşil “Atak’a gönder”e basın veya XML yükleyin.';st.className='form-status error'}
  }catch(e){
    if(st){st.textContent=e.message;st.className='form-status error'}
  }finally{
    q('#rapid360SalesPullBtn')&&(q('#rapid360SalesPullBtn').disabled=false);
  }
}
window.addEventListener('message',e=>{
  if(e.origin!==location.origin) return;
  if(e.data && e.data.type==='atak-rapid360-okta' && e.data.ok){
    pullRapid360Live().then(d=>applyRapidPullResult(d, q('#rapid360SalesXmlStatus'))).catch(()=>{});
  }
});
async function waitRapidOkta(st, payload, popup){
  showRapidOktaBox(payload||{});
  if(st){
    st.textContent=payload.message||payload.error||'Telefonda Okta’yı onaylayın. Satışlar otomatik çekilir.';
    st.className='form-status';
  }
  openRapidOktaPopup(payload.loginUrl||rapid360ReportUrl(), popup);
  return {ok:false, needsOkta:true};
}
async function pullRapid360Live(){
  return api('/web-api/admin/rapid360-sales-pull',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(rapid360PullBody({autoImport:false}))});
}
function bindRapid360XmlDrop(){
  const drop=q('#rapid360SalesXmlDrop');
  const input=q('#rapid360SalesXmlFile');
  if(!drop||drop.dataset.bound) return;
  drop.dataset.bound='1';
  drop.addEventListener('dragover',e=>{e.preventDefault();drop.style.borderColor='#1d4ed8'});
  drop.addEventListener('dragleave',()=>{drop.style.borderColor='#94a3b8'});
  drop.addEventListener('drop',e=>{
    e.preventDefault();
    drop.style.borderColor='#94a3b8';
    const f=e.dataTransfer?.files?.[0];
    if(!f||!input) return;
    const dt=new DataTransfer();
    dt.items.add(f);
    input.files=dt.files;
    previewRapid360Xml();
  });
  input?.addEventListener('change',()=>previewRapid360Xml());
  q('#rapid360SalesXmlPaste')?.addEventListener('paste',()=>setTimeout(()=>previewRapid360Xml(),40));
}
function openRapid360SalesXmlModal(){
  q('#rapid360SalesXmlModal')?.classList.remove('hidden');
  q('#rapid360SalesXmlImportBtn')&&(q('#rapid360SalesXmlImportBtn').disabled=true);
  rapid360PullToken='';
  rapid360PreviewData=null;
  q('#rapid360NewProductsBox')?.classList.add('hidden');
  q('#rapid360ImportedBox')?.classList.add('hidden');
  q('#rapid360ImportedList')&&(q('#rapid360ImportedList').innerHTML='');
  q('#rapid360NewProductsTable')&&(q('#rapid360NewProductsTable').innerHTML='');
  fillRapidAktarDefaults();
  hideRapidOktaBox();
  bindRapid360XmlDrop();
  loadRapidOktaStatus();
}
function closeRapid360SalesXmlModal(){hideRapidOktaBox();q('#rapid360SalesXmlModal')?.classList.add('hidden')}
function rapid360CategoryOptionsHtml(selected){
  const cats=rapid360PreviewData?.categories||[];
  const sel=String(selected||'');
  return `<option value="">Kategori seçin</option>`+cats.map(c=>`<option value="${rapidOktaEsc(c.id)}"${c.id===sel?' selected':''}>${rapidOktaEsc(c.name)}</option>`).join('');
}
function rapid360CollectCategoryMap(){
  const map={};
  qa('#rapid360NewProductsTable select[data-rapid-cat]').forEach(sel=>{
    const key=sel.dataset.rapidCat;
    const val=String(sel.value||'').trim();
    if(key&&val) map[key]=val;
  });
  return map;
}
function rapid360MissingForSelected(){
  const ids=new Set(rapid360SelectedSalesIds());
  return (rapid360PreviewData?.missingProducts||[]).filter(p=>{
    const sids=(p.salesIds||[]).map(String);
    if(!ids.size) return false;
    if(!sids.length) return true;
    return sids.some(id=>ids.has(id));
  });
}
function rapid360MissingCategoryCount(){
  const def=String(q('#rapid360NewProductCategory')?.value||'').trim();
  return rapid360MissingForSelected().filter(p=>!String(p.categoryId||p.suggestedCategoryId||def||'').trim()).length;
}
function renderRapid360NewProducts(d){
  const box=q('#rapid360NewProductsBox');
  const picked=rapid360SelectedSalesIds();
  const list=picked.length?rapid360MissingForSelected():(d&&d.missingProducts)||[];
  const catSel=q('#rapid360NewProductCategory');
  if(catSel){
    const cur=String(catSel.value||'');
    catSel.innerHTML='<option value="">Satır satır seç…</option>'+(d.categories||[]).map(c=>`<option value="${rapidOktaEsc(c.id)}">${rapidOktaEsc(c.name)}</option>`).join('');
    if(cur && [...catSel.options].some(o=>o.value===cur)) catSel.value=cur;
  }
  if(!box) return;
  if(!list.length){box.classList.add('hidden');q('#rapid360NewProductsTable')&&(q('#rapid360NewProductsTable').innerHTML='');return}
  box.classList.remove('hidden');
  const def=String(catSel?.value||'');
  q('#rapid360NewProductsTable').innerHTML=list.map(p=>{
    const selected=String(p.categoryId||p.suggestedCategoryId||def||'');
    p.categoryId=selected;
    return `<tr>
      <td><b>${rapidOktaEsc(p.name||p.key)}</b></td>
      <td>${rapidOktaEsc(p.itemCode||'-')}</td>
      <td><select data-rapid-cat="${rapidOktaEsc(p.key)}">${rapid360CategoryOptionsHtml(selected)}</select></td>
    </tr>`;
  }).join('');
  qa('#rapid360NewProductsTable select[data-rapid-cat]').forEach(sel=>{
    sel.addEventListener('change',()=>{
      const row=(rapid360PreviewData?.missingProducts||[]).find(p=>p.key===sel.dataset.rapidCat);
      if(row) row.categoryId=String(sel.value||'');
    });
  });
}
function rapid360SelectedSalesIds(){
  return [...qa('#rapid360SalesXmlTable input[data-rapid-sale]:checked')].map(x=>String(x.value||'').trim()).filter(Boolean);
}
function rapid360SyncSaleSelect(){
  const ids=rapid360SelectedSalesIds();
  const rows=rapid360PreviewData?.rows||[];
  const picked=rows.filter(r=>ids.includes(String(r.salesId||''))&&!r.skip);
  const hint=q('#rapid360SalesSelectHint');
  if(hint) hint.textContent=`${rows.length} satış bulundu · ${picked.length} seçili (kayıtlılar aktarılmaz)`;
  const imported=Number(rapid360PreviewData?.imported||0)>0 && rapid360PreviewData?.autoImported===true;
  q('#rapid360SalesXmlImportBtn')&&(q('#rapid360SalesXmlImportBtn').disabled=imported||!picked.length);
  const all=q('#rapid360SalesSelectAll');
  if(all){
    const boxes=qa('#rapid360SalesXmlTable input[data-rapid-sale]:not([disabled])');
    all.checked=boxes.length>0 && boxes.every(b=>b.checked);
  }
  if(rapid360PreviewData) renderRapid360NewProducts(rapid360PreviewData);
}
function renderRapid360SalesXmlPreview(d){
  const money=n=>new Intl.NumberFormat('tr-TR',{style:'currency',currency:'TRY'}).format(Number(n||0));
  rapid360PreviewData=d;
  const missing=Number(d.missingProductCount||(d.missingProducts||[]).length||0);
  q('#rapid360SalesXmlSummary').innerHTML=`<article><b>${d.count||0}</b><span>Sipariş</span></article><article><b>${d.importable||0}</b><span>Aktarılabilir</span></article><article><b>${d.duplicate||0}</b><span>Zaten var</span></article><article><b>${d.cancelled||0}</b><span>İptal atlandı</span></article><article><b>${d.customersNew||0}</b><span>Yeni müşteri</span></article><article class="warn"><b>${missing}</b><span>Yeni ürün</span></article>`;
  q('#rapid360SalesXmlTable').innerHTML=(d.rows||[]).map(r=>{
    const extra=r.unmatchedItems?` · ${r.unmatchedItems} yeni ürün`:'';
    const st=r.cancelledInAtak?'İptal edildi':(r.duplicate?'Kayıtlı':(!r.itemCount?'Kalem yok':(r.customerStatus==='new'?'Yeni müşteri':'Hazır'))+extra);
    const disable=r.skip||r.duplicate||!r.itemCount;
    const check=disable?'':' checked';
    return `<tr>
      <td><input type="checkbox" data-rapid-sale="${rapidOktaEsc(r.salesId||'')}" value="${rapidOktaEsc(r.salesId||'')}"${disable?' disabled':check}/></td>
      <td><b>${rapidOktaEsc(r.salesId||'')}</b></td>
      <td>${rapidOktaEsc(r.date||'-')}</td>
      <td>${rapidOktaEsc(r.customerName||r.custAccount||'-')}<div style="font-size:11px;color:#667890">${rapidOktaEsc(r.custAccount||'')}</div></td>
      <td>${r.itemCount||0}</td>
      <td>${money(r.total)}</td>
      <td>${rapidOktaEsc(st)}</td>
    </tr>`;
  }).join('')||'<tr><td colspan="7">Satış yok</td></tr>';
  qa('#rapid360SalesXmlTable input[data-rapid-sale]').forEach(cb=>cb.addEventListener('change',rapid360SyncSaleSelect));
  renderRapid360NewProducts(d);
  rapid360SyncSaleSelect();
}
q('#rapid360ApplyCategoryBtn')?.addEventListener('click',()=>{
  const def=String(q('#rapid360NewProductCategory')?.value||'').trim();
  if(!def){toast('Önce varsayılan kategori seçin');return}
  qa('#rapid360NewProductsTable select[data-rapid-cat]').forEach(sel=>{sel.value=def;sel.dispatchEvent(new Event('change'))});
  toast('Kategori yeni ürünlere uygulandı');
});
q('#rapid360SalesXmlBtn')?.addEventListener('click',openRapid360SalesXmlModal);
q('#rapid360SalesXmlBtn2')?.addEventListener('click',openRapid360SalesXmlModal);
q('#rapid360SalesXmlClose')?.addEventListener('click',closeRapid360SalesXmlModal);
q('#rapid360SalesSelectAll')?.addEventListener('change',()=>{
  const on=!!q('#rapid360SalesSelectAll')?.checked;
  qa('#rapid360SalesXmlTable input[data-rapid-sale]:not([disabled])').forEach(cb=>{cb.checked=on});
  rapid360SyncSaleSelect();
});
q('#rapid360OktaConnectBtn')?.addEventListener('click',async()=>{
  const st=q('#rapid360SalesXmlStatus');
  fillRapidAktarDefaults();
  st.textContent='Rapid360 açılıyor. Telefonda Okta bildirimine basın. Kod yazılmaz.';st.className='form-status';
  openRapidOktaPopup(rapid360ReportUrl());
  try{
    const d=await api('/web-api/admin/rapid360-okta-start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(rapid360PullBody({webOnly:true}))});
    showRapidOktaBox(d);
    st.textContent=d.message||'Okta bildirimi telefona gitti. Rapid360’ta onaylayın, Satışları oku satışları getirir.';st.className='form-status success';
  }catch(e){st.textContent=e.message;st.className='form-status error'}
});
q('#rapid360SalesPullBtn')?.addEventListener('click',()=>autoPullRapid360Sales());
async function previewRapid360Xml(){
  const st=q('#rapid360SalesXmlStatus');
  const fd=rapid360SalesXmlForm();
  if(!fd){if(st){st.textContent='XML dosyası seçin veya yapıştırın';st.className='form-status error';}return}
  rapid360PullToken='';
  if(st){st.textContent='XML okunuyor…';st.className='form-status';}
  try{
    const d=await api('/web-api/admin/rapid360-sales-preview',{method:'POST',body:fd});
    renderRapid360SalesXmlPreview(d);
    if(st){
      st.textContent=`${d.importable||0} satış aktarılabilir${d.cancelled?` · ${d.cancelled} iptal atlandı`:''}${d.missingProductCount?` · ${d.missingProductCount} yeni ürün — kategori seçin`:''}.`;
      st.className='form-status success';
    }
  }catch(e){if(st){st.textContent=e.message;st.className='form-status error'}}
}
q('#rapid360SalesXmlPreviewBtn')?.addEventListener('click',()=>previewRapid360Xml());
q('#rapid360SalesXmlImportBtn')?.addEventListener('click',async()=>{
  const st=q('#rapid360SalesXmlStatus');
  if(!confirm('İşaretli Rapid360 satışları Atak satış listesine eklensin mi?\nSatışa düşer; içeri girip bilgileri düzeltip Satışı Yap ile tamamlarsınız. Kasa ve stok o zaman işler.'))return;
  if(!rapid360SelectedSalesIds().length){toast('Aktarılacak satış seçin');return}
  if(rapid360MissingCategoryCount()>0){
    toast(`${rapid360MissingCategoryCount()} yeni ürünün kategorisi eksik — satırdan seçin`);
    q('#rapid360SalesXmlImportBtn').disabled=false;
    return;
  }
  st.textContent='Aktarılıyor…';st.className='form-status';
  q('#rapid360SalesXmlImportBtn').disabled=true;
  try{
    let r;
    if(rapid360PullToken){
      r=await api('/web-api/admin/rapid360-sales-pull-import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(rapid360PullBody())});
    }else{
      const fd=rapid360SalesXmlForm();
      if(!fd){st.textContent='Önce Rapid’te XML indirip dosyayı seçin';st.className='form-status error';q('#rapid360SalesXmlImportBtn').disabled=false;return}
      r=await api('/web-api/admin/rapid360-sales-import',{method:'POST',body:fd});
    }
    st.textContent=`${r.imported||0} satış Satış Takibi’ne düştü · ${r.skippedDuplicate||0} zaten vardı · ${r.customersCreated||0} yeni müşteri${r.productsCreated?` · ${r.productsCreated} ürün eklendi`:''}${r.customersUpdated?` · ${r.customersUpdated} müşteri adı güncellendi`:''}. İçeri girip Satışı Yap ile tamamlayın.`;
    st.className='form-status success';
    toast(st.textContent);
    q('#rapid360NewProductsBox')?.classList.add('hidden');
    q('#rapid360SalesXmlImportBtn').disabled=true;
    const imported=(r.importedSales||[]).filter(x=>x&&x.id);
    const box=q('#rapid360ImportedBox');
    const list=q('#rapid360ImportedList');
    if(box&&list&&imported.length){
      box.classList.remove('hidden');
      list.innerHTML=imported.map(x=>`<button type="button" class="primary" data-sale-complete="${x.id}" style="margin:4px 6px 0 0">${rapidOktaEsc(x.rapidSalesId||x.customerName||'Satışa git')}</button>`).join('');
      list.querySelectorAll('[data-sale-complete]').forEach(btn=>btn.onclick=()=>openRapidSaleInSalesCenter(btn.dataset.saleComplete));
    }
    await loadSalesTracking();
    if(imported.length===1){
      await openRapidSaleInSalesCenter(imported[0].id);
    }
  }catch(e){st.textContent=e.message;st.className='form-status error';q('#rapid360SalesXmlImportBtn').disabled=false}
});

/* ——— Müşteri Ödemeleri (taksit / senet takip + A5 makbuz) ——— */
let custPayState={filter:'overdue',q:'',rows:[],recentPaid:[],accounts:[],summary:null,selectedId:''};
function custPayBucketLabel(b){
  return({overdue:'Geciken',due:'Bu Ay',havale:'Havale',open:'Açık',paid:'Kapalı'}[b]||b||'—');
}
function custPaySelectedIds(){
  return [...qa('#custPayRows .cust-pay-sms-cb:checked')].map(x=>String(x.value||'')).filter(Boolean);
}
function syncCustPaySmsHint(){
  const n=custPaySelectedIds().length;
  const hint=q('#custPaySmsHint');
  if(hint)hint.textContent=n?`${n} müşteri seçili · en fazla 150`:'Listeden işaretleyin · en fazla 150';
}
function renderCustomerPayments(){
  const sum=custPayState.summary||{};
  const box=q('#custPaySummary');
  if(box){
    box.innerHTML=`
      <article class="deduct-kpi"><small>Geciken Müşteri</small><b>${sum.overdueCustomers||0}</b><small>${money2(sum.overdueAmount||0)}</small></article>
      <article class="commission"><small>Bu Ay Vadesi</small><b>${sum.dueMonthCustomers||0}</b><small>${money2(sum.dueMonthAmount||0)}</small></article>
      <article class="net-kpi"><small>Açık Cari</small><b>${sum.openCustomers||0}</b><small>${money2(sum.openBalance||0)}</small></article>
      <article><small>Bekleyen Havale</small><b>${sum.havaleCustomers||0}</b><small>${money2(sum.havaleAmount||0)}</small></article>
      <article><small>Liste</small><b>${(custPayState.rows||[]).length}</b><small>${custPayBucketLabel(custPayState.filter)}</small></article>
      <article><small>Son Tahsilat</small><b>${(custPayState.recentPaid||[]).length}</b><small>A5 makbuz</small></article>`;
  }
  const prevSelected=new Set(custPaySelectedIds());
  const tbody=q('#custPayRows');
  if(tbody){
    tbody.innerHTML=(custPayState.rows||[]).length
      ?(custPayState.rows||[]).map(r=>`<tr data-cust-pay="${r.customerId}" class="${r.customerId===custPayState.selectedId?'active':''}">
          <td><input type="checkbox" class="cust-pay-sms-cb" value="${r.customerId}" ${prevSelected.has(String(r.customerId))?'checked':''}></td>
          <td><b>${r.customerName||'—'}</b><br><small>${r.customerPhone||''}</small> ${sipBtn(r.customerPhone,{className:'sip-call-sm',customerId:r.customerId})}</td>
          <td><span class="pay-bucket ${r.bucket}">${custPayBucketLabel(r.bucket)}</span></td>
          <td>${money2(r.balance)}${Number(r.pendingHavaleAmount||0)>0.009?`<br><small style="color:#0b4f96;font-weight:750">Havale ${money2(r.pendingHavaleAmount)}</small>`:''}</td>
          <td>${money2(r.overdueAmount)}</td>
          <td>${money2(r.dueMonthAmount)}</td>
          <td>${r.nextDue||'—'}</td>
        </tr>`).join('')
      :'<tr><td colspan="7">Bu filtrede kayıt yok.</td></tr>';
    qa('#custPayRows [data-cust-pay]').forEach(tr=>{
      tr.addEventListener('click',e=>{
        if(e.target.closest('input,button,a,label'))return;
        selectCustomerPayment(tr.dataset.custPay);
      });
    });
    qa('#custPayRows .cust-pay-sms-cb').forEach(cb=>cb.addEventListener('change',syncCustPaySmsHint));
  }
  if(q('#custPaySelectAll'))q('#custPaySelectAll').checked=false;
  syncCustPaySmsHint();
  const recent=q('#custPayRecent');
  if(recent){
    recent.innerHTML=(custPayState.recentPaid||[]).length
      ?(custPayState.recentPaid||[]).map(t=>`<tr>
          <td>${t.date||''}</td>
          <td>${t.customerName||'—'}</td>
          <td>${money2(t.amount)}</td>
          <td>${t.method||'—'}</td>
          <td>${t.reference||''}</td>
          <td><button type="button" class="secondary-btn" data-receipt="${t.receiptUrl||''}">A5 Yazdır</button></td>
        </tr>`).join('')
      :'<tr><td colspan="6">Henüz tahsilat yok.</td></tr>';
    qa('#custPayRecent [data-receipt]').forEach(btn=>{
      btn.onclick=()=>{if(btn.dataset.receipt)window.open(btn.dataset.receipt+(btn.dataset.receipt.includes('?')?'&':'?')+'autoprint=1','_blank')};
    });
  }
  if(custPayState.selectedId)selectCustomerPayment(custPayState.selectedId,true);
}
async function sendCustPayBulkSms(type){
  const st=q('#custPaySmsStatus');
  const ids=custPaySelectedIds();
  if(!ids.length){
    if(st){st.textContent='Önce listeden müşteri işaretleyin (veya Tümünü seç).';st.className='form-status error'}
    toast('Müşteri seçin');
    return;
  }
  if(ids.length>150){
    if(st){st.textContent='En fazla 150 müşteri seçilebilir.';st.className='form-status error'}
    return;
  }
  const payload={type,customerIds:ids};
  if(type==='custom'){
    const message=String(q('#custPaySmsCustomText')?.value||'').trim();
    if(!message){
      if(st){st.textContent='Özel SMS metni yazın.';st.className='form-status error'}
      return;
    }
    payload.message=message;
  }
  const label=type==='overdue'?'gecikme':'özel';
  if(!confirm(`${ids.length} müşteriye toplu ${label} SMS gönderilsin mi?`))return;
  if(st){st.textContent='Toplu SMS gönderiliyor...';st.className='form-status'}
  try{
    const r=await api('/web-api/admin/sms-bulk',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const msg=`Toplu SMS: ${r.sent||0} gitti · ${r.failed||0} hata · ${r.skipped||0} atlandı (toplam ${r.total||ids.length})`;
    if(st){st.textContent=msg;st.className='form-status '+(r.failed?'error':'success')}
    toast(msg);
    if(type==='custom')q('#custPaySmsCustomPanel')?.classList.add('hidden');
  }catch(err){
    if(st){st.textContent=err.message;st.className='form-status error'}
    toast(err.message||'Toplu SMS başarısız');
  }
}
function selectCustomerPayment(customerId,keepAmount=false){
  custPayState.selectedId=String(customerId||'');
  const row=(custPayState.rows||[]).find(r=>String(r.customerId)===custPayState.selectedId);
  qa('#custPayRows tr').forEach(tr=>tr.classList.toggle('active',tr.dataset.custPay===custPayState.selectedId));
  const hint=q('#custPayDetailHint'),body=q('#custPayDetailBody');
  if(!row){
    if(hint)hint.textContent='Soldan müşteri seçin.';
    body?.classList.add('hidden');
    return;
  }
  hint?.classList.add('hidden');
  body?.classList.remove('hidden');
  const havaleAmt=Number(row.pendingHavaleAmount||0);
  const suggest=havaleAmt>0.009?havaleAmt:(row.overdueAmount>0.009?row.overdueAmount:(row.dueMonthAmount>0.009?row.dueMonthAmount:Math.max(row.balance,0)));
  q('#custPayCustomerBox').innerHTML=`<b>${row.customerName||''}</b> ${sipBtn(row.customerPhone,{className:'sip-call-sm',customerId:row.customerId})}<br><small>${row.customerPhone||''}</small><br>
    Cari: <b>${money2(row.balance)}</b> · Havale: <b>${money2(havaleAmt)}</b> · Geciken: <b>${money2(row.overdueAmount)}</b> · Bu ay: <b>${money2(row.dueMonthAmount)}</b>`;
  const havaleBox=q('#custPayHavale');
  if(havaleBox){
    havaleBox.innerHTML=(row.pendingHavale||[]).length
      ?(row.pendingHavale||[]).map(h=>`<tr>
          <td>${h.saleReference||h.saleId||'—'}</td>
          <td>${h.date||'—'}</td>
          <td>${h.accountName||'Banka'}</td>
          <td>${money2(h.remain)}</td>
        </tr>`).join('')
      :'<tr><td colspan="4">Bekleyen havale yok.</td></tr>';
  }
  const hasHavale=!!(row.pendingHavale||[]).length;
  q('#custPayHavaleWrap')?.classList.toggle('hidden',!hasHavale);
  q('#custPayHavaleTable')?.classList.toggle('hidden',!hasHavale);
  q('#custPayNotes').innerHTML=(row.notes||[]).map(n=>{
    const open=!['paid','cancelled'].includes(String(n.status||'open'));
    return `<tr class="${n.overdue?'pay-note-overdue':''} ${n.status==='paid'?'pay-note-paid':''}">
      <td>${open?`<input type="checkbox" class="cust-pay-note" value="${n.id}">`:''}</td>
      <td>${n.serial||n.id.slice(0,8)}</td>
      <td>${n.dueDate||'—'}</td>
      <td>${money2(n.amount)}</td>
      <td>${money2(n.remain)}</td>
      <td>${n.status==='paid'?'Ödendi':(n.overdue?'Gecikmiş':(n.status==='partial'?'Kısmi':'Açık'))}</td>
    </tr>`;
  }).join('')||'<tr><td colspan="6">Senet / taksit kaydı yok. Ödeme cari bakiyeden düşer.</td></tr>';
  const acc=q('#custPayAccount');
  const preferBank=havaleAmt>0.009;
  if(acc){
    const list=preferBank?(custPayState.accounts||[]).filter(a=>a.type==='bank'):(custPayState.accounts||[]);
    const rows=list.length?list:(custPayState.accounts||[]);
    const suggested=(row.pendingHavale||[])[0]?.accountId||'';
    const cur=suggested||acc.value;
    acc.innerHTML=rows.map(a=>`<option value="${a.id}">${a.name}</option>`).join('')||'<option value="">Kasa yok</option>';
    if(cur && [...acc.options].some(o=>o.value===cur))acc.value=cur;
  }
  if(preferBank && q('#custPayMethod'))q('#custPayMethod').value='Havale';
  if(!keepAmount || !Number(q('#custPayAmount')?.value||0)){
    if(q('#custPayAmount'))q('#custPayAmount').value=suggest>0?suggest.toFixed(2):'';
  }
  if(q('#custPayDate') && !q('#custPayDate').value)q('#custPayDate').value=localDate();
  qa('.cust-pay-note').forEach(cb=>{
    cb.onchange=()=>{
      const ids=[...qa('.cust-pay-note:checked')].map(x=>x.value);
      if(!ids.length)return;
      const total=(row.notes||[]).filter(n=>ids.includes(n.id)).reduce((a,n)=>a+Number(n.remain||0),0);
      if(q('#custPayAmount'))q('#custPayAmount').value=total.toFixed(2);
    };
  });
}
async function loadCustomerPayments(){
  const filter=custPayState.filter||'overdue';
  const qv=custPayState.q||'';
  const d=await api(`/web-api/admin/customer-payments-board?filter=${encodeURIComponent(filter)}&q=${encodeURIComponent(qv)}`);
  custPayState.rows=d.rows||[];
  custPayState.recentPaid=d.recentPaid||[];
  custPayState.accounts=d.accounts||[];
  custPayState.summary=d.summary||null;
  if(custPayState.selectedId && !(custPayState.rows||[]).some(r=>String(r.customerId)===String(custPayState.selectedId))){
    // seçili müşteri bu filtrede yoksa detayı korumak için tüm listeden yeniden çekmeye gerek yok; temizle
  }
  renderCustomerPayments();
}
q('#custPayRefresh')?.addEventListener('click',()=>loadCustomerPayments().catch(e=>toast(e.message)));
q('#custPaySelectAll')?.addEventListener('change',()=>{
  const on=q('#custPaySelectAll')?.checked===true;
  qa('#custPayRows .cust-pay-sms-cb').forEach(cb=>{cb.checked=on});
  syncCustPaySmsHint();
});
q('#custPaySmsOverdueBtn')?.addEventListener('click',()=>sendCustPayBulkSms('overdue'));
q('#custPaySmsCustomBtn')?.addEventListener('click',()=>{
  q('#custPaySmsCustomPanel')?.classList.remove('hidden');
  q('#custPaySmsCustomText')?.focus();
});
q('#custPaySmsCustomCancel')?.addEventListener('click',()=>q('#custPaySmsCustomPanel')?.classList.add('hidden'));
q('#custPaySmsCustomSend')?.addEventListener('click',()=>sendCustPayBulkSms('custom'));
q('#custPayFilterToggle')?.addEventListener('click',e=>{
  const btn=e.target.closest('[data-pay-filter]'); if(!btn)return;
  custPayState.filter=btn.dataset.payFilter||'open';
  qa('#custPayFilterToggle .period-btn').forEach(b=>b.classList.toggle('active',b===btn));
  loadCustomerPayments().catch(err=>toast(err.message));
});
let custPaySearchTimer=null;
q('#custPaySearch')?.addEventListener('input',()=>{
  clearTimeout(custPaySearchTimer);
  custPaySearchTimer=setTimeout(()=>{
    custPayState.q=q('#custPaySearch').value.trim();
    loadCustomerPayments().catch(e=>toast(e.message));
  },280);
});
q('#custPayForm')?.addEventListener('submit',async e=>{
  e.preventDefault();
  const st=q('#custPayStatus');
  if(!custPayState.selectedId){st.textContent='Önce müşteri seçin.';st.className='form-status error';return}
  const amount=Number(q('#custPayAmount').value||0);
  const accountId=q('#custPayAccount').value;
  if(!(amount>0)||!accountId){st.textContent='Tutar ve kasa zorunlu.';st.className='form-status error';return}
  const noteIds=[...qa('.cust-pay-note:checked')].map(x=>x.value);
  st.textContent='Kaydediliyor...';st.className='form-status';
  try{
    const d=await api('/web-api/admin/customer-collection',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        customerId:custPayState.selectedId,
        amount,
        accountId,
        paymentMethod:q('#custPayMethod').value,
        date:q('#custPayDate').value||localDate(),
        description:q('#custPayDesc').value.trim()||'Aylık ödeme tahsilatı',
        noteIds
      })
    });
    st.textContent=`Ödeme alındı. Kalan cari: ${money2(d.balance)}`;
    st.className='form-status success';
    toast('Tahsilat kaydedildi');
    if(d.receiptUrl)window.open(d.receiptUrl+(d.receiptUrl.includes('?')?'&':'?')+'autoprint=1','_blank');
    await loadCustomerPayments();
    if(custPayState.selectedId)selectCustomerPayment(custPayState.selectedId);
  }catch(err){st.textContent=err.message;st.className='form-status error'}
});

loadPermissionDefinitions();loadCurrentAdminPermissions();
check().catch(()=>{});

/* ——— Eğitim Merkezi ——— */
let trainingState={videos:[],categories:[],filter:'all',selectedId:'',canManage:false};
function trainingCatLabel(id){
  return (trainingState.categories||[]).find(c=>c.id===id)?.label||id||'Diğer';
}
function playTrainingVideo(id){
  const v=(trainingState.videos||[]).find(x=>String(x.id)===String(id));
  trainingState.selectedId=v?.id||'';
  qa('.training-card').forEach(c=>c.classList.toggle('active',c.dataset.trainingId===String(trainingState.selectedId)));
  const player=q('#trainingPlayer');
  const wrap=q('.training-player-wrap');
  const empty=q('#trainingPlayerEmpty');
  if(!v){
    if(q('#trainingPlayerTitle'))q('#trainingPlayerTitle').textContent='Video seçin';
    if(q('#trainingPlayerMeta'))q('#trainingPlayerMeta').textContent='Soldan bir eğitim seçin.';
    if(q('#trainingPlayerDesc'))q('#trainingPlayerDesc').textContent='';
    if(q('#trainingPlayerActions'))q('#trainingPlayerActions').innerHTML='';
    if(player){player.removeAttribute('src');player.load()}
    wrap?.classList.remove('has-video');
    return;
  }
  if(q('#trainingPlayerTitle'))q('#trainingPlayerTitle').textContent=v.title||'Eğitim';
  if(q('#trainingPlayerMeta'))q('#trainingPlayerMeta').textContent=[trainingCatLabel(v.category),v.screenLabel,v.duration].filter(Boolean).join(' · ');
  if(q('#trainingPlayerDesc'))q('#trainingPlayerDesc').textContent=v.description||'';
  const actions=[];
  if(v.screen)actions.push(`<button type="button" class="secondary-btn" data-go="${salesEsc(v.screen)}">İlgili ekrana git</button>`);
  if(trainingState.canManage){
    actions.push(`<button type="button" class="secondary-btn" id="trainingEditSelected">Düzenle</button>`);
    if(!v.builtin||v.uploaded)actions.push(`<button type="button" class="secondary-btn" id="trainingDeleteSelected">Sil / Gizle</button>`);
  }
  if(q('#trainingPlayerActions'))q('#trainingPlayerActions').innerHTML=actions.join('');
  q('#trainingEditSelected')?.addEventListener('click',()=>fillTrainingForm(v));
  q('#trainingDeleteSelected')?.addEventListener('click',async()=>{
    if(!confirm('Bu eğitim kaydı silinsin / gizlensin mi?'))return;
    try{
      await api('/web-api/admin/training/'+encodeURIComponent(v.id),{method:'DELETE'});
      toast('Eğitim kaydı güncellendi');
      await loadTrainingCenter();
    }catch(e){toast(e.message)}
  });
  if(v.status==='ready'&&v.url){
    if(player){player.src=v.url;player.load()}
    wrap?.classList.add('has-video');
    empty&&(empty.textContent='');
  }else{
    if(player){player.removeAttribute('src');player.load()}
    wrap?.classList.remove('has-video');
    if(empty)empty.textContent='Bu modül için video henüz hazır değil. Yönetici Eğitim → Video Yönet ile yükleyebilir.';
  }
}
function renderTrainingCenter(){
  const vids=(trainingState.videos||[]).filter(v=>trainingState.filter==='all'||v.category===trainingState.filter);
  const ready=(trainingState.videos||[]).filter(v=>v.status==='ready'&&v.url).length;
  const planned=(trainingState.videos||[]).length-ready;
  if(q('#trainingStats')){
    q('#trainingStats').innerHTML=`
      <article><small>Toplam konu</small><b>${(trainingState.videos||[]).length}</b></article>
      <article><small>Hazır video</small><b>${ready}</b></article>
      <article><small>Yakında</small><b>${planned}</b></article>`;
  }
  if(q('#trainingCats')){
    q('#trainingCats').innerHTML=(trainingState.categories||[]).map(c=>`
      <button type="button" class="${trainingState.filter===c.id?'active':''}" data-training-cat="${c.id}">${salesEsc(c.label)}</button>`).join('');
    qa('#trainingCats [data-training-cat]').forEach(btn=>btn.addEventListener('click',()=>{
      trainingState.filter=btn.dataset.trainingCat||'all';
      renderTrainingCenter();
    }));
  }
  if(q('#trainingList')){
    q('#trainingList').innerHTML=vids.length?vids.map(v=>`
      <button type="button" class="training-card ${v.id===trainingState.selectedId?'active':''}" data-training-id="${v.id}">
        <b>${salesEsc(v.title||'Eğitim')}</b>
        <small>${salesEsc(v.screenLabel||trainingCatLabel(v.category))}${v.duration?' · '+salesEsc(v.duration):''}</small>
        <small>${salesEsc((v.description||'').slice(0,120))}</small>
        <span class="training-badge ${v.status==='ready'&&v.url?'ready':'planned'}">${v.status==='ready'&&v.url?'Hazır · İzle':'Yakında'}</span>
      </button>`).join(''):'<div class="note">Bu kategoride kayıt yok.</div>';
    qa('#trainingList [data-training-id]').forEach(btn=>btn.addEventListener('click',()=>playTrainingVideo(btn.dataset.trainingId)));
  }
  if(trainingState.selectedId)playTrainingVideo(trainingState.selectedId);
  else playTrainingVideo('');
}
function fillTrainingForm(v){
  q('#trainingManagePanel')?.classList.remove('hidden');
  if(q('#trainingEditId'))q('#trainingEditId').value=v?.id||'';
  if(q('#trainingTitle'))q('#trainingTitle').value=v?.title||'';
  if(q('#trainingCategory'))q('#trainingCategory').value=v?.category||'diger';
  if(q('#trainingScreen'))q('#trainingScreen').value=v?.screen||'';
  if(q('#trainingScreenLabel'))q('#trainingScreenLabel').value=v?.screenLabel||'';
  if(q('#trainingDescription'))q('#trainingDescription').value=v?.description||'';
  if(q('#trainingDuration'))q('#trainingDuration').value=v?.duration||'';
  if(q('#trainingSort'))q('#trainingSort').value=v?.sort||200;
  if(q('#trainingUrl'))q('#trainingUrl').value=v?.url||'';
  if(q('#trainingFile'))q('#trainingFile').value='';
  q('#trainingManagePanel')?.scrollIntoView({behavior:'smooth',block:'start'});
}
async function loadTrainingCenter(){
  const d=await api('/web-api/admin/training');
  trainingState.videos=d.videos||[];
  trainingState.categories=d.categories||[];
  trainingState.canManage=Boolean(d.canManage);
  q('#trainingManageToggle')?.classList.toggle('hidden',!trainingState.canManage);
  renderTrainingCenter();
}
q('#trainingRefreshBtn')?.addEventListener('click',()=>loadTrainingCenter().catch(e=>toast(e.message)));
q('#trainingManageToggle')?.addEventListener('click',()=>{
  q('#trainingManagePanel')?.classList.toggle('hidden');
});
q('#trainingManageClear')?.addEventListener('click',()=>{
  fillTrainingForm(null);
  if(q('#trainingEditId'))q('#trainingEditId').value='';
});
q('#trainingUploadForm')?.addEventListener('submit',async e=>{
  e.preventDefault();
  const st=q('#trainingManageStatus');
  const file=q('#trainingFile')?.files?.[0];
  const id=q('#trainingEditId')?.value||'';
  try{
    if(file){
      if(st){st.textContent='Video yükleniyor...';st.className='form-status'}
      const fd=new FormData();
      fd.append('file',file);
      if(id)fd.append('id',id);
      fd.append('title',q('#trainingTitle')?.value||file.name);
      fd.append('category',q('#trainingCategory')?.value||'diger');
      fd.append('screen',q('#trainingScreen')?.value||'');
      fd.append('screenLabel',q('#trainingScreenLabel')?.value||'');
      fd.append('description',q('#trainingDescription')?.value||'');
      fd.append('duration',q('#trainingDuration')?.value||'');
      fd.append('sort',q('#trainingSort')?.value||'200');
      const token=localStorage.getItem('atakAdminToken')||'';
      // api() helper may not support FormData — use fetch with credentials
      const r=await fetch('/web-api/admin/training/upload',{method:'POST',body:fd,credentials:'same-origin'});
      const j=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(j.error||'Yükleme başarısız');
      if(st){st.textContent='Video yüklendi: '+(j.url||'');st.className='form-status success'}
      toast('Eğitim videosu yüklendi');
    }else{
      await api('/web-api/admin/training',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
        id:id||undefined,
        title:q('#trainingTitle')?.value,
        category:q('#trainingCategory')?.value,
        screen:q('#trainingScreen')?.value,
        screenLabel:q('#trainingScreenLabel')?.value,
        description:q('#trainingDescription')?.value,
        duration:q('#trainingDuration')?.value,
        sort:q('#trainingSort')?.value,
        url:q('#trainingUrl')?.value,
        status:q('#trainingUrl')?.value?'ready':'planned'
      })});
      if(st){st.textContent='Kayıt kaydedildi';st.className='form-status success'}
      toast('Eğitim kaydı kaydedildi');
    }
    await loadTrainingCenter();
  }catch(err){
    if(st){st.textContent=err.message;st.className='form-status error'}
    toast(err.message||'Kayıt başarısız');
  }
});

/* ——— Para & Maaş (tek ekran) ——— */
let moneyState={month:'',summary:null,accounts:[],people:[],recent:[],expenseCategories:[],selectedStaffId:''};
function moneyMonthDefault(){
  const d=new Date();
  const day=d.getDate();
  // Maaş ayın 1'inde ödenir → ayın ilk haftasında önceki ayın bordrosu
  if(day<=7){
    const p=new Date(d.getFullYear(),d.getMonth()-1,1);
    return `${p.getFullYear()}-${String(p.getMonth()+1).padStart(2,'0')}`;
  }
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}
function moneyStatusLabel(s){return({due:'Ödenecek',partial:'Kısmi / Avanslı',paid:'Kapandı',unset:'Maaş yok',none:'—'}[s]||s||'—')}
function fillMoneyAccounts(selId,preferCash=true){
  const el=q(selId); if(!el)return;
  const acc=moneyState.accounts||[];
  const cur=el.value;
  el.innerHTML=acc.map(a=>{
    const bal=Number(a.balance||0);
    const tag=bal<-0.009?`${money2(bal)} borç`:money2(bal);
    return `<option value="${a.id}">${a.name} (${tag})</option>`;
  }).join('')||'<option value="">Hesap yok</option>';
  if(cur && [...el.options].some(o=>o.value===cur))el.value=cur;
  else if(preferCash){
    const cash=acc.find(a=>a.type==='cash'); if(cash)el.value=cash.id;
  }
}
function moneyAmountForType(p,type){
  if(!p)return 0;
  if(type==='advance')return 0;
  if(type==='commission')return Number(p.commissionDue||0);
  if(type==='salary')return Number(p.salaryDue||0);
  return Number(p.netDue||p.dueTotal||0);
}
function renderMoneySalaryBreakdown(p,type){
  const box=q('#moneySalaryBreakdown');
  if(!box)return;
  if(!p){box.innerHTML='';return}
  if(type==='advance'){
    box.innerHTML=`<div><b>${p.name}</b> için avans vereceksiniz. Avans, ay sonu ödenecekten düşülür. Kasada para olmasa da seçilen hesap eksi bakiyeye (borç) yazılır.</div>
      <span class="net">Şu an ödenecek kalan: ${money2(p.netDue)}</span>`;
    return;
  }
  box.innerHTML=`
    <div><b>${p.name}</b> · ${moneyState.month||''}</div>
    ${p.prorated
      ? `<div class="money-prorate">Kısmi ay: ${p.rangeLabel||''} (${p.ratioLabel||''} gün) · hak edilen maaş ${money2(p.salaryEarned)} (sözleşme ${money2(p.salaryMonthly)})</div>
         <div>Prim (satıştan): <b>${money2(p.monthCommission)}</b>${p.saleCount?` <small>(${p.saleCount} satış)</small>`:''}</div>`
      : `<div>Maaş: <b>${money2(p.salaryMonthly)}</b> + Prim (satıştan): <b>${money2(p.monthCommission)}</b>${p.saleCount?` <small>(${p.saleCount} satış)</small>`:''}</div>`}
    <div>Hak edilen: <b>${money2(p.grossEarned)}</b> − Avans: <b>${money2(p.advances)}</b> − Ödenen: <b>${money2(p.paidTotal)}</b></div>
    <span class="net">Ödenecek: ${money2(p.netDue)}</span>
    <small class="formula">${p.formula||''}</small>`;
}
function renderMoneyCenter(){
  const sum=moneyState.summary||{};
  const box=q('#moneySummary');
  if(box){
    box.innerHTML=`
      <article class="net-kpi"><small>Toplam Kasa</small><b>${money2(sum.cash)}</b></article>
      <article><small>Toplam Banka</small><b>${money2(sum.bank)}</b></article>
      <article class="commission"><small>Bu Ay Prim (otomatik)</small><b>${money2(sum.monthCommissionEarned)}</b></article>
      <article class="deduct-kpi"><small>Bu Ay Avans</small><b>${money2(sum.monthAdvancePaid)}</b></article>
      <article><small>Ödenecek Kalan</small><b>${money2(sum.salaryDueTotal)}</b><small>${sum.unpaidPeople||0} kişi</small></article>`;
  }
  if(q('#moneyPeopleCount'))q('#moneyPeopleCount').textContent=`${(moneyState.people||[]).length} personel · ${moneyState.month||''}`;
  const tbody=q('#moneyPeopleRows');
  if(tbody){
    tbody.innerHTML=(moneyState.people||[]).length
      ?(moneyState.people||[]).map(p=>`<tr class="${p.status==='due'||p.status==='partial'?'due':''}">
          <td>
            <b>${p.name||'—'}</b><br><small>${p.storeName||''}</small>
            <span class="money-status ${p.status}">${moneyStatusLabel(p.status)}</span>
          </td>
          <td>
            ${money2(p.salaryMonthly)}
            ${p.prorated?`<small class="money-prorate">Kısmi ${p.rangeLabel||''} (${p.ratioLabel||''}) · ${money2(p.salaryEarned)}</small>`:''}
            <button type="button" class="secondary-btn" data-set-salary="${p.id}" data-name="${(p.name||'').replace(/"/g,'&quot;')}" data-sal="${p.salaryMonthly}" data-hire="${(p.hireDate||'').replace(/"/g,'&quot;')}">Ayarla</button>
          </td>
          <td><b>${money2(p.monthCommission)}</b>${p.saleCount?`<br><small>${p.saleCount} satış · ${money2(p.monthSales)}</small>`:''}</td>
          <td>${p.advances>0.009?`<b style="color:#a52222">${money2(p.advances)}</b>`:money2(0)}</td>
          <td>${money2(p.grossEarned)}<br><small>ödenecekten avans düşülür</small></td>
          <td><b style="font-size:16px">${money2(p.netDue)}</b><small class="formula">${p.formula||''}</small></td>
          <td>
            ${p.netDue>0.009?`<button type="button" class="primary" data-pay-payroll="${p.id}" data-amt="${p.netDue}">Ay Sonu Öde</button>`:''}
            <button type="button" class="secondary-btn" data-pay-advance="${p.id}">Avans</button>
          </td>
        </tr>`).join('')
      :'<tr><td colspan="7">Aktif personel yok. Foundation → Personel ekleyin.</td></tr>';
    qa('[data-set-salary]').forEach(b=>b.onclick=()=>{
      q('#moneySetStaffId').value=b.dataset.setSalary;
      q('#moneySetStaffName').textContent=b.dataset.name||'';
      q('#moneySetAmount').value=Number(b.dataset.sal||0)||'';
      if(q('#moneySetHireDate'))q('#moneySetHireDate').value=b.dataset.hire||'';
      q('#moneySetSalaryModal')?.classList.remove('hidden');
    });
    qa('[data-pay-payroll]').forEach(b=>b.onclick=()=>openMoneySalaryModal(b.dataset.payPayroll,'payroll',Number(b.dataset.amt||0)));
    qa('[data-pay-advance]').forEach(b=>b.onclick=()=>openMoneySalaryModal(b.dataset.payAdvance,'advance',0));
  }
  const recent=q('#moneyRecentRows');
  if(recent){
    recent.innerHTML=(moneyState.recent||[]).length
      ?(moneyState.recent||[]).map(t=>{
        const kind=t.paymentFor==='advance'||/avans/i.test(t.category||'')?'Avans'
          :(t.paymentFor==='payroll'||/ay sonu|bordro/i.test(t.category||'')?'Ay Sonu'
          :(isMoneySalaryLike(t)?'Maaş/Prim':(t.kind==='expense'?'Masraf':(t.kind==='transfer'?'Transfer':(t.category||t.kind)))));
        const who=t.staffName||t.description||'—';
        return `<tr><td>${t.date||''}</td><td>${kind}</td><td>${who}<br><small>${t.category||''}</small></td><td>${money2(Math.abs(t.amount||0))}</td><td>${t.accountName||'—'}</td></tr>`;
      }).join('')
      :'<tr><td colspan="5">Henüz para çıkışı yok.</td></tr>';
  }
}
function isMoneySalaryLike(t){
  return ['salary','commission_pay','payroll','advance'].includes(t.paymentFor)||/maaş|maas|prim|avans|bordro|ay sonu/i.test(String(t.category||''));
}
function openMoneySalaryModal(staffId,type,amount){
  moneyState.selectedStaffId=String(staffId||'');
  const people=moneyState.people||[];
  q('#moneySalaryStaff').innerHTML=people.map(p=>`<option value="${p.id}">${p.name}</option>`).join('');
  if(staffId)q('#moneySalaryStaff').value=staffId;
  const t=type||'payroll';
  q('#moneySalaryType').value=['payroll','advance','salary','commission'].includes(t)?t:'payroll';
  const p=people.find(x=>String(x.id)===String(q('#moneySalaryStaff').value));
  const amt=amount>0?amount:moneyAmountForType(p,q('#moneySalaryType').value);
  q('#moneySalaryAmount').value=amt>0?Number(amt).toFixed(2):(t==='advance'?'':'');
  q('#moneySalaryDate').value=localDate();
  q('#moneySalaryDesc').value='';
  q('#moneySalaryStatus').textContent='';
  fillMoneyAccounts('#moneySalaryAccount',true);
  const titles={payroll:'💵 Ay Sonu Öde',advance:'💸 Avans Ver',salary:'💵 Maaş Öde',commission:'💵 Prim Öde'};
  q('#moneySalaryTitle').textContent=titles[q('#moneySalaryType').value]||'Ödeme';
  q('#moneySalaryHint').textContent=p?`${p.name} · ${moneyState.month}`:'Personel seçin';
  renderMoneySalaryBreakdown(p,q('#moneySalaryType').value);
  q('#moneySalaryModal')?.classList.remove('hidden');
}
function syncMoneySalaryForm(){
  const p=(moneyState.people||[]).find(x=>String(x.id)===String(q('#moneySalaryStaff').value));
  const type=q('#moneySalaryType').value;
  const titles={payroll:'💵 Ay Sonu Öde',advance:'💸 Avans Ver',salary:'💵 Maaş Öde',commission:'💵 Prim Öde'};
  q('#moneySalaryTitle').textContent=titles[type]||'Ödeme';
  renderMoneySalaryBreakdown(p,type);
  if(type!=='advance'){
    const amt=moneyAmountForType(p,type);
    q('#moneySalaryAmount').value=amt>0?amt.toFixed(2):'';
  }
}
function openMoneyExpenseModal(){
  const cats=moneyState.expenseCategories||['Diğer'];
  q('#moneyExpenseCategory').innerHTML=cats.map(c=>`<option>${c}</option>`).join('');
  q('#moneyExpenseAmount').value='';
  q('#moneyExpenseDate').value=localDate();
  q('#moneyExpenseDesc').value='';
  q('#moneyExpenseStatus').textContent='';
  fillMoneyAccounts('#moneyExpenseAccount',true);
  q('#moneyExpenseModal')?.classList.remove('hidden');
}
async function loadMoneyCenter(){
  if(q('#moneyMonth') && !q('#moneyMonth').value)q('#moneyMonth').value=moneyMonthDefault();
  moneyState.month=q('#moneyMonth')?.value||moneyMonthDefault();
  const d=await api('/web-api/admin/money-center?month='+encodeURIComponent(moneyState.month));
  moneyState.summary=d.summary||null;
  moneyState.accounts=d.accounts||[];
  moneyState.people=d.people||[];
  moneyState.recent=d.recent||[];
  moneyState.expenseCategories=d.expenseCategories||[];
  renderMoneyCenter();
}
q('#moneyRefresh')?.addEventListener('click',()=>loadMoneyCenter().catch(e=>toast(e.message)));
q('#moneyMonth')?.addEventListener('change',()=>loadMoneyCenter().catch(e=>toast(e.message)));
q('#moneyOpenExpense')?.addEventListener('click',openMoneyExpenseModal);
q('#moneyOpenSalary')?.addEventListener('click',()=>{
  const first=(moneyState.people||[]).find(p=>p.netDue>0.009)||(moneyState.people||[])[0];
  openMoneySalaryModal(first?.id||'','payroll',first?.netDue||0);
});
q('#moneyOpenAdvance')?.addEventListener('click',()=>{
  const first=(moneyState.people||[])[0];
  openMoneySalaryModal(first?.id||'','advance',0);
});
q('#moneyOpenTransfer')?.addEventListener('click',()=>{
  if(typeof openFinanceTransfer==='function')openFinanceTransfer();
  else q('#financeTransferOpenBtn')?.click();
});
q('#moneyExpenseClose')?.addEventListener('click',()=>q('#moneyExpenseModal')?.classList.add('hidden'));
q('#moneySalaryClose')?.addEventListener('click',()=>q('#moneySalaryModal')?.classList.add('hidden'));
q('#moneySetSalaryClose')?.addEventListener('click',()=>q('#moneySetSalaryModal')?.classList.add('hidden'));
q('#moneyExpenseForm')?.addEventListener('submit',async e=>{
  e.preventDefault();
  const st=q('#moneyExpenseStatus');
  st.textContent='Kaydediliyor...';st.className='form-status';
  try{
    const r=await api('/web-api/admin/money-expense',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      amount:q('#moneyExpenseAmount').value,accountId:q('#moneyExpenseAccount').value,
      category:q('#moneyExpenseCategory').value,date:q('#moneyExpenseDate').value||localDate(),
      description:q('#moneyExpenseDesc').value.trim()
    })});
    st.textContent='Masraf kaydedildi';st.className='form-status success';
    toast(Number(r.balance)<-0.009?`Masraf kaydedildi · hesap ${money2(r.balance)} (borç)`:'Masraf kaydedildi');
    q('#moneyExpenseModal')?.classList.add('hidden');
    await loadMoneyCenter();
  }catch(err){st.textContent=err.message;st.className='form-status error'}
});
q('#moneySalaryForm')?.addEventListener('submit',async e=>{
  e.preventDefault();
  const st=q('#moneySalaryStatus');
  st.textContent='Ödeniyor...';st.className='form-status';
  try{
    const r=await api('/web-api/admin/salary-pay',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      staffId:q('#moneySalaryStaff').value,amount:q('#moneySalaryAmount').value,
      accountId:q('#moneySalaryAccount').value,payType:q('#moneySalaryType').value,
      date:q('#moneySalaryDate').value||localDate(),month:moneyState.month,
      description:q('#moneySalaryDesc').value.trim()
    })});
    st.textContent='Ödeme kaydedildi';st.className='form-status success';
    toast(Number(r.balance)<-0.009?`Ödeme kaydedildi · hesap ${money2(r.balance)} (borç)`:'Ödeme kaydedildi');
    q('#moneySalaryModal')?.classList.add('hidden');
    await loadMoneyCenter();
  }catch(err){st.textContent=err.message;st.className='form-status error'}
});
q('#moneySetSalaryForm')?.addEventListener('submit',async e=>{
  e.preventDefault();
  try{
    await api('/web-api/admin/staff-salary',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      staffId:q('#moneySetStaffId').value,salaryMonthly:q('#moneySetAmount').value,
      hireDate:q('#moneySetHireDate')?q('#moneySetHireDate').value:undefined
    })});
    toast('Maaş kaydedildi');
    q('#moneySetSalaryModal')?.classList.add('hidden');
    await loadMoneyCenter();
  }catch(err){toast(err.message)}
});
q('#moneySalaryStaff')?.addEventListener('change',syncMoneySalaryForm);
q('#moneySalaryType')?.addEventListener('change',syncMoneySalaryForm);

qa('a[href="#"]').forEach(a=>a.addEventListener('click',e=>e.preventDefault()));
