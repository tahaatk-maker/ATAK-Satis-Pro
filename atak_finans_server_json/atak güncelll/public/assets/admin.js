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
async function api(url,opt={}){const r=await fetch(url,{credentials:'same-origin',...opt});const d=await r.json().catch(()=>({}));if(!r.ok){if(r.status===401)throw new Error('Oturum süresi dolmuş. Lütfen tekrar giriş yapın.');throw new Error(d.error||'İşlem başarısız')}return d}
async function check(){const m=await api('/web-api/me');if(m.authenticated){showApp();await load()}else q('#loginView').classList.remove('hidden')}
q('#loginForm').onsubmit=async e=>{e.preventDefault();try{await api('/web-api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:q('#username').value.trim(),password:q('#password').value})});await loadCurrentAdminPermissions();showApp();await load()}catch(e){toast(e.message)}};
function applyUiScale(v){
  const scale=String(v||'0.85');
  document.documentElement.style.zoom=scale;
  document.documentElement.setAttribute('data-ui-scale',scale);
  try{localStorage.setItem('atak-ui-scale-v4',scale)}catch(_){}
  const sel=q('#uiScaleSelect');if(sel&&sel.value!==scale)sel.value=scale;
}
function initUiScale(){
  // Pro POS görünüm; tarayıcı %100, yazılım varsayılan Normal (0.85)
  let scale='0.85';
  try{scale=localStorage.getItem('atak-ui-scale-v4')||'0.85'}catch(_){}
  if(!['0.75','0.85','0.95','1'].includes(scale))scale='0.85';
  applyUiScale(scale);
  q('#uiScaleSelect')?.addEventListener('change',e=>applyUiScale(e.target.value));
}
initUiScale();
function showApp(){q('#loginView').classList.add('hidden');q('#appView').classList.remove('hidden');const saved=sessionStorage.getItem('atakAdminTab');if(saved&&q('#'+saved))setTimeout(()=>goTab(saved,{remember:false}),0)}
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
  const needed=TAB_PERMISSION_MAP[id];if(needed&&!can(needed)){toast('Bu ekran için yetkiniz yok.');return false}
  const target=q('#'+id);
  if(!target){toast('Bu ekran henüz bağlı değil: '+id);return false}
  qa('[data-tab]').forEach(x=>x.classList.toggle('active',x.dataset.tab===id));
  qa('.tab').forEach(x=>x.classList.toggle('active',x.id===id));
  const btn=q(`[data-tab="${id}"]`);
  q('#pageTitle').textContent=btn?btn.textContent.replace(/^[^A-Za-zÇĞİÖŞÜ]+/,'').trim():id;
  if(remember)sessionStorage.setItem('atakAdminTab',id);
  q('#productsNavGroup')?.classList.toggle('active-group',productTabs.has(id));q('#financeNavGroup')?.classList.toggle('active-group',id==='financeDashboard');
  if(productTabs.has(id))setProductsMenu(true);
  if(id==='foundation')setTimeout(()=>loadFoundation().catch(e=>toast(e.message)),20);
  if(id==='stockCenter')setTimeout(()=>loadStockCenter().catch(e=>toast(e.message)),20);
  if(id==='financeCenter')setTimeout(()=>loadFinanceCenter().catch(e=>toast(e.message)),20);
  if(id==='customersPage')setTimeout(()=>loadCustomersPage?.(),20);
  if(id==='salesCenter')setTimeout(()=>loadSalesCenter(),20);
  if(id==='webOrders')setTimeout(()=>loadWebOrders(),20);
  if(id==='settings')setTimeout(()=>loadPromissorySettings(),20);
  if(id==='mySalesReport')setTimeout(loadMySalesReport,20);
  if(id==='staffSalesReport')setTimeout(loadStaffSalesReport,20);
  if(id==='managerApprovals')setTimeout(loadApprovals,20);
  if(id==='salesTracking')setTimeout(loadSalesTracking,20);
  if(id==='dynamicsExcelImport')setTimeout(()=>loadDynamicsImport(),20);
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
function renderAll(){renderDashboard();renderCategoryOptions();renderBrandOptions();renderProducts();renderBrands();renderCategories();renderCampaigns();renderBanners();renderRevenue();renderUsers()}
function localDate(d=new Date()){const z=new Date(d.getTime()-d.getTimezoneOffset()*60000);return z.toISOString().slice(0,10)}
function weekStart(d=new Date()){const x=new Date(d),day=(x.getDay()+6)%7;x.setDate(x.getDate()-day);return localDate(x)}
async function fetchRevenueSummary(startDate,endDate){return api(`/web-api/admin/revenue-summary?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`)}
let dashboardRevenue=null;
async function renderDashboardRevenue(){try{const d=localDate();dashboardRevenue=await fetchRevenueSummary(d,d);const c=dashboardRevenue.channels,total=Object.values(c).reduce((a,b)=>a+Number(b.amount||0),0);q('#stats').innerHTML=`<div class="stat channel beko"><small>Beko Mağaza bugün</small><strong>${money(c.beko.amount)}</strong><em>${c.beko.orderCount} satış</em></div><div class="stat channel istikbal"><small>İstikbal bugün</small><strong>${money(c.istikbal.amount)}</strong><em>${c.istikbal.orderCount} satış</em></div><div class="stat channel atakhome"><small>AtakHome bugün</small><strong>${money(c.atakhome.amount)}</strong><em>${c.atakhome.orderCount} otomatik sipariş</em></div><div class="stat channel hb"><small>Hepsiburada bugün</small><strong>${money(c.hepsiburada.amount)}</strong><em>${c.hepsiburada.orderCount} sipariş</em></div><div class="stat total"><small>Toplam ciro</small><strong>${money(total)}</strong><em>KDV dahil</em></div>`}catch(e){console.error(e)}}
function renderDashboard(){const ps=store.products,active=ps.filter(p=>p.active),campaigns=store.campaigns.filter(c=>c.active),missingImage=ps.filter(p=>!p.image),zeroStock=ps.filter(p=>!p.stock);renderDashboardRevenue();q('#healthCards').innerHTML=`<div class="health"><b>${missingImage.length}</b><span>Görseli eksik ürün</span></div><div class="health"><b>${zeroStock.length}</b><span>Stok 0 / sorunuz</span></div><div class="health"><b>${campaigns.length}</b><span>Aktif kampanya</span></div><div class="health"><b>${ps.filter(p=>Number(p.cashPrice||0)<Number(p.minimumSalePrice||0)&&Number(p.minimumSalePrice||0)>0).length}</b><span>Minimum fiyat altı</span></div>`;q('#auditList').innerHTML=(store.auditLogs||[]).slice(0,12).map(a=>`<div class="activity"><i></i><div><b>${a.action}</b><br><small>${a.entity} · ${new Date(a.date).toLocaleString('tr-TR')}</small></div></div>`).join('')||'<p>Henüz işlem kaydı yok.</p>'}
function renderCategoryOptions(){const opts=store.categories.sort((a,b)=>a.sort-b.sort).map(c=>`<option value="${c.id}">${c.name}</option>`).join('');q('#filterCategory').innerHTML='<option value="all">Tüm kategoriler</option>'+opts;q('#bulkCategory').innerHTML='<option value="all">Tüm ürünler</option>'+opts;q('#pCategory').innerHTML=opts}
function renderBrandOptions(){const opts=(store.brands||[]).filter(b=>b.active).sort((a,b)=>a.sort-b.sort).map(b=>`<option value="${b.name}">${b.name}</option>`).join('');q('#pBrand').innerHTML=opts}
function filteredProducts(){const term=(q('#adminSearch').value||q('#globalSearch').value||'').toLocaleLowerCase('tr-TR'),cat=q('#filterCategory').value,status=q('#filterStatus').value;return store.products.filter(p=>`${p.code} ${p.name} ${p.brand}`.toLocaleLowerCase('tr-TR').includes(term)&&(cat==='all'||p.category===cat)&&(status==='all'||(status==='active'&&p.active)||(status==='passive'&&!p.active)||(status==='featured'&&p.featured)))}
function renderProducts(){const list=filteredProducts(),pages=Math.max(1,Math.ceil(list.length/pageSize));page=Math.min(page,pages);const slice=list.slice((page-1)*pageSize,page*pageSize),cats=Object.fromEntries(store.categories.map(c=>[c.id,c.name]));q('#productTable').innerHTML=slice.map(p=>{const minWarn=Number(p.minimumSalePrice||0)>0&&Number(p.cashPrice||0)<Number(p.minimumSalePrice||0);return `<tr class="${minWarn?'price-warning':''}"><td><input class="row-check" type="checkbox" data-id="${p.id}" ${selected.has(p.id)?'checked':''}></td><td><b>${p.code}</b></td><td>${p.barcode||'—'}</td><td class="product-name">${p.name}</td><td>${p.brand||'—'}</td><td>${cats[p.category]||p.category}</td><td>${money(p.purchasePrice)}</td><td>${money(p.listPrice)}</td><td><b>${money(p.cashPrice)}</b>${minWarn?'<small class="warn-text">Minimum altı</small>':''}</td><td>${money(p.cardPrice)}</td><td>%${p.vatRate||20}</td><td>${p.stock}</td><td><span class="status ${p.active?'':'off'}">${p.active?'Yayında':'Pasif'}</span></td><td class="row-actions"><button onclick="editProduct('${p.id}')">Düzenle</button><button onclick="disableProduct('${p.id}')">Pasif</button></td></tr>`}).join('');q('#pageInfo').textContent=`${page} / ${pages} · ${list.length} ürün`;q('#prevPage').disabled=page<=1;q('#nextPage').disabled=page>=pages;qa('.row-check').forEach(x=>x.onchange=()=>{x.checked?selected.add(x.dataset.id):selected.delete(x.dataset.id);renderSelection()});renderSelection()}
function renderSelection(){q('#selectionBar').classList.toggle('hidden',selected.size===0);q('#selectedCount').textContent=selected.size}
q('#adminSearch').oninput=()=>{page=1;renderProducts()};q('#globalSearch').oninput=()=>{q('#adminSearch').value=q('#globalSearch').value;goTab('products');page=1;renderProducts()};q('#filterCategory').onchange=q('#filterStatus').onchange=()=>{page=1;renderProducts()};q('#prevPage').onclick=()=>{page--;renderProducts()};q('#nextPage').onclick=()=>{page++;renderProducts()};q('#selectAll').onchange=e=>{filteredProducts().slice((page-1)*pageSize,page*pageSize).forEach(p=>e.target.checked?selected.add(p.id):selected.delete(p.id));renderProducts()};q('#clearSelection').onclick=()=>{selected.clear();q('#selectAll').checked=false;renderProducts()};
qa('[data-bulk]').forEach(b=>b.onclick=async()=>{const map={active:['active',true],passive:['active',false],featured:['featured',true],unfeatured:['featured',false]},[action,value]=map[b.dataset.bulk];if(!selected.size)return;await bulk({action,value});});
async function bulk(body){const r=await api('/web-api/admin/bulk-products',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:[...selected],...body})});toast(`${r.count} ürün güncellendi`);selected.clear();await load()}
q('#newProductBtn').onclick=()=>openProduct({active:true,featured:false,brand:'Beko',priceMode:'same',stock:0,tags:[],vatRate:20,purchasePrice:0,listPrice:0,cashPrice:0,cardPrice:0,minimumSalePrice:0,barcode:''});q('#quickNewProduct')?.addEventListener('click',()=>{goTab('products');q('#newProductBtn')?.click()});q('#closeModal').onclick=()=>q('#productModal').classList.add('hidden');window.editProduct=id=>openProduct(store.products.find(p=>p.id===id));window.disableProduct=async id=>{if(!confirm('Ürün pasife alınsın mı?'))return;await api('/web-api/admin/product/'+id,{method:'DELETE'});toast('Ürün pasife alındı');await load()};
function vatForCategory(){return q('#pCategory').value==='yazar-kasa'?10:20}
function refreshProfit(){const purchase=Number(q('#pPurchasePrice').value||0),cash=Number(q('#pCashPrice').value||0),card=Number(q('#pCardPrice').value||0),minimum=Number(q('#pMinimumSalePrice').value||0);const row=(name,price)=>{const profit=price-purchase,pct=purchase?profit/purchase*100:0,warn=minimum>0&&price<minimum;return `<span class="${warn?'bad':''}"><b>${name}</b> Kâr: ${money(profit)} · %${pct.toFixed(1)}${warn?' · Minimum altı':''}</span>`};q('#profitPreview').innerHTML=row('Nakit',cash)+row('Kart',card)}
function openProduct(p){q('#pId').value=p.id||'';q('#pCode').value=p.code||'';q('#pBarcode').value=p.barcode||'';q('#pBrand').value=p.brand||'Beko';q('#pName').value=p.name||'';q('#pCategory').value=p.category||store.categories[0]?.id||'';q('#pVatRate').value=p.category==='yazar-kasa'?10:(p.vatRate||20);q('#pPurchasePrice').value=p.purchasePrice||0;q('#pListPrice').value=p.listPrice||p.oldPrice||0;q('#pCashPrice').value=p.cashPrice||p.salePrice||0;q('#pCardPrice').value=p.cardPrice||p.salePrice||0;q('#pMinimumSalePrice').value=p.minimumSalePrice||0;q('#pBekoPrice').value=p.bekoPrice||0;q('#pOldPrice').value=p.oldPrice||0;q('#pPriceMode').value=p.priceMode||'same';q('#pPriceValue').value=p.priceValue||0;q('#pStock').value=p.stock||0;q('#pTags').value=(p.tags||[]).join(', ');q('#pImage').value=p.image||'';q('#pDescription').value=p.description||'';q('#pActive').checked=p.active!==false;q('#pFeatured').checked=!!p.featured;q('#productModal').classList.remove('hidden');refreshProfit()}
q('#pCategory').onchange=()=>{q('#pVatRate').value=vatForCategory()};['#pPurchasePrice','#pCashPrice','#pCardPrice','#pMinimumSalePrice'].forEach(id=>q(id).oninput=refreshProfit);
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
function guessImportCategory(p){const t=`${p?.name||''} ${p?.category||''}`.toLocaleLowerCase('tr-TR');if(/klima/.test(t))return'klima';if(/televizyon|smart tv|google tv|oled|qled|\btv\b/.test(t))return'tv-elektronik';if(/buzdolabı|çamaşır|kurutma|bulaşık|fırın|ocak|dondurucu/.test(t))return'beyaz-esya';return'kucuk-ev-aletleri'}
function setImportStatus(text,type=''){const e=q('#importStatus');e.textContent=text;e.className=type}
function renderImportProduct(p){importDraft=p;const imgs=p.images||[],specs=p.specifications||[],docs=p.documents||[];q('#importCode').value=p.code||'';q('#importBrand').value=p.brand||'Beko';q('#importName').value=p.name||'';q('#importPrice').value=Number(p.bekoPrice||p.price||0)||'';q('#importStock').value=0;q('#importVat').value=20;q('#importPriceMode').value='same';q('#importPriceValue').value=0;q('#importDescription').value=p.description||'';importCategoryOptions(p.category||guessImportCategory(p));q('#importMainImage').src=imgs[0]||'';q('#importThumbs').innerHTML=imgs.map((src,i)=>`<button type="button" class="${i===0?'active':''}" data-img="${src}"><img src="${src}" alt=""></button>`).join('');qa('#importThumbs button').forEach(b=>b.onclick=()=>{q('#importMainImage').src=b.dataset.img;qa('#importThumbs button').forEach(x=>x.classList.toggle('active',x===b))});q('#importImageCount').textContent=imgs.length;q('#importSpecCount').textContent=specs.length;q('#importDocCount').textContent=docs.length;q('#importSpecs').innerHTML=specs.length?specs.map(x=>`<article><b>${x.name}</b><span>${x.value}</span></article>`).join(''):'<p>Teknik özellik bulunamadı.</p>';q('#importDocs').innerHTML=docs.length?docs.map(x=>`<a href="${x.url}" target="_blank" rel="noopener">${x.title} ↗</a>`).join(''):'<p>Geçerli belge bulunamadı.</p>';q('#importEmpty').classList.add('hidden');q('#importPreview').classList.remove('hidden')}
q('#importFetchForm').onsubmit=async e=>{e.preventDefault();const url=q('#importUrl').value.trim(),btn=q('#importFetchBtn');if(!url)return;btn.disabled=true;btn.textContent='Getiriliyor...';setImportStatus('Beko sayfası okunuyor...','loading');try{const r=await api('/web-api/admin/product-import/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url})});renderImportProduct(r.product);setImportStatus('Ürün getirildi. Kontrol edip kaydedin.','success')}catch(err){setImportStatus(err.message,'error')}finally{btn.disabled=false;btn.textContent='Ürünü Getir'}};
q('#importSaveBtn').onclick=async()=>{if(!importDraft)return toast('Önce ürünü getirin');const btn=q('#importSaveBtn'),product={...importDraft,code:q('#importCode').value.trim(),brand:q('#importBrand').value.trim(),name:q('#importName').value.trim(),bekoPrice:Number(q('#importPrice').value||0),listPrice:Number(q('#importPrice').value||0),cashPrice:Number(q('#importPrice').value||0),cardPrice:Number(q('#importPrice').value||0),category:q('#importCategory').value,stock:Number(q('#importStock').value||0),vatRate:Number(q('#importVat').value||20),priceMode:q('#importPriceMode').value,priceValue:Number(q('#importPriceValue').value||0),description:q('#importDescription').value.trim(),image:q('#importMainImage').src,active:true};btn.disabled=true;btn.textContent='Kaydediliyor...';try{const r=await api('/web-api/admin/product-import/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({product})});toast(r.created?'Ürün, Ürünler listesine eklendi':'Mevcut ürün güncellendi');await load();goTab('products')}catch(err){setImportStatus(err.message,'error')}finally{btn.disabled=false;btn.textContent="Ürünler'e Kaydet"}};
q('#importResetBtn').onclick=()=>{importDraft=null;q('#importUrl').value='';q('#importPreview').classList.add('hidden');q('#importEmpty').classList.remove('hidden');setImportStatus('Hazır')};


const ROLE_LABELS={owner:'Sahip / Tam Yetki',admin:'Yönetici',sales:'Satış Personeli',warehouse:'Depo',accounting:'Muhasebe',service:'Servis',viewer:'Sadece Görüntüleme'};

let permissionDefs=[],rolePermissionMap={};
function currentCheckedPermissions(){return qa('[data-user-permission]:checked').map(x=>x.value)}
function renderPermissionEditor(selected=[]){
  const box=q('#userPermissionList');if(!box)return;
  const selectedSet=new Set(selected),groups={};
  permissionDefs.forEach(p=>(groups[p.group]||(groups[p.group]=[])).push(p));
  box.innerHTML=Object.entries(groups).map(([group,rows])=>`<fieldset><legend>${group}</legend>${rows.map(p=>`<label class="permission-check"><input type="checkbox" data-user-permission value="${p.id}" ${selectedSet.has(p.id)?'checked':''}><span>${p.name}</span></label>`).join('')}</fieldset>`).join('');
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
function can(permission,user=window.__currentAdminUser){const p=user?.permissions||[];return p.includes('*')||p.includes(permission)}
const TAB_PERMISSION_MAP={
 dashboard:'dashboard_view',salesCenter:'sales_manage',salesTracking:'sales_manage',mySalesReport:'own_sales_view',
 staffSalesReport:'sales_reports_view',managerApprovals:'cancellations_approve',customersPage:'customers_manage',
 financeCenter:'finance_view',financeDashboard:'finance_view',uninvoicedSales:'invoices_manage',
 products:'products_view',dynamicsExcelImport:'products_manage',stockCenter:'stock_view',prices:'products_manage',
 brands:'products_manage',categories:'products_manage',productImport:'web_manage',campaigns:'web_manage',
 banners:'web_manage',webOrders:'web_manage',foundation:'foundation_manage',revenue:'reports_view',
 sync:'sync_manage',users:'users_manage',settings:'settings_manage'
};
function applyPermissionVisibility(){
  qa('[data-tab]').forEach(el=>{const needed=TAB_PERMISSION_MAP[el.dataset.tab];if(needed)el.classList.toggle('permission-hidden',!can(needed))});
}
async function loadCurrentAdminPermissions(){
  try{const d=await api('/web-api/me');window.__currentAdminUser=d.user||null;applyPermissionVisibility()}catch(e){}
}
function resetUserForm(){q('#userId').value='';q('#userName').value='';q('#userUsername').value='';q('#userRole').value='viewer';q('#userPassword').value='';q('#userActive').checked=true;setTimeout(applyRoleDefaultPermissions,0)}
function renderUsers(){
  if(!q('#userList'))return;
  const users=store?.users||[];
  q('#userRole').innerHTML=Object.entries(ROLE_LABELS).map(([id,name])=>`<option value="${id}">${name}</option>`).join('');
  q('#userList').innerHTML=users.length?users.map(u=>`<div class="admin-card user-card"><div><h3>${u.name}</h3><p>@${u.username} · ${u.roleName||ROLE_LABELS[u.role]}</p><small>${u.active!==false?'Aktif':'Pasif'}</small></div><div class="admin-card-actions"><button data-user-edit="${u.id}">Düzenle</button>${u.active!==false?`<button data-user-disable="${u.id}">Pasife al</button>`:''}</div></div>`).join(''):'<p>Henüz ek kullanıcı yok.</p>';
  qa('[data-user-edit]').forEach(b=>b.onclick=()=>{const u=users.find(x=>x.id===b.dataset.userEdit);q('#userId').value=u.id;q('#userName').value=u.name;q('#userUsername').value=u.username;q('#userRole').value=u.role;q('#userPassword').value='';q('#userActive').checked=u.active!==false;renderPermissionEditor((u.permissions||[]).includes('*')?permissionDefs.map(p=>p.id):(u.permissions||[]));goTab('users')});
  qa('[data-user-disable]').forEach(b=>b.onclick=async()=>{if(!confirm('Kullanıcı pasife alınsın mı?'))return;await api(`/web-api/admin/user/${b.dataset.userDisable}`,{method:'DELETE'});await load();toast('Kullanıcı pasife alındı')});
}
q('#userForm').onsubmit=async e=>{e.preventDefault();const payload={id:q('#userId').value||undefined,name:q('#userName').value.trim(),username:q('#userUsername').value.trim(),role:q('#userRole').value,password:q('#userPassword').value,active:q('#userActive').checked,permissions:currentCheckedPermissions()};await api('/web-api/admin/user',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});resetUserForm();await load();toast(payload.id?'Kullanıcı ve yetkileri güncellendi':'Kullanıcı eklendi')};
q('#userReset').onclick=resetUserForm;
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
async function loadFoundation(){foundationData=await api('/web-api/admin/foundation');renderFoundation()}
function renderFoundation(){
  if(!foundationData||!q('#foundationSummary'))return;
  const f=foundationData,s=f.summary;
  q('#foundationSummary').innerHTML=`<article><b>${money(s.totalTurnover)}</b><span>Bugünkü Toplam Ciro</span></article><article><b>${s.completedStores}/${s.storeCount}</b><span>Ciro Giren Mağaza</span></article><article><b>${f.staff.filter(x=>x.active).length}</b><span>Aktif Personel</span></article><article><b>${f.announcements.filter(x=>x.active).length}</b><span>Aktif Duyuru</span></article>`;
  const storeOptions=`<option value="">Tüm mağazalar</option>`+f.stores.filter(x=>x.active).map(x=>`<option value="${x.id}">${x.name}</option>`).join('');
  q('#fStaffStore').innerHTML=f.stores.filter(x=>x.active).map(x=>`<option value="${x.id}">${x.name}</option>`).join('');
  q('#fAnnouncementStore').innerHTML=storeOptions;
  q('#fStoreList').innerHTML=f.stores.map(x=>`<button type="button" data-fstore="${x.id}"><b>${x.name}</b><small>${x.code||''} · ${x.active?'Aktif':'Pasif'}</small></button>`).join('');
  q('#fStaffList').innerHTML=f.staff.map(x=>`<button type="button" data-fstaff="${x.id}"><b>${x.name}</b><small>${x.storeName} · ${x.active?'Aktif':'Pasif'}</small></button>`).join('');
  q('#fAnnouncementList').innerHTML=f.announcements.map(x=>`<div><b>${x.title}</b><small>${x.storeId?f.stores.find(s=>s.id===x.storeId)?.name:'Tüm personel'}</small><button type="button" data-fannouncement-delete="${x.id}">Sil</button></div>`).join('');
  q('#fTurnoverCount').textContent=`${f.turnovers.length} kayıt`;
  q('#fTurnoverList').innerHTML=f.turnovers.length?`<table><thead><tr><th>Tarih</th><th>Mağaza</th><th>Personel</th><th>Sipariş</th><th>Net Ciro</th></tr></thead><tbody>${f.turnovers.map(x=>`<tr><td>${x.date}</td><td>${x.storeName}</td><td>${x.staffName}</td><td>${x.orderCount}</td><td><b>${money(x.netAmount)}</b></td></tr>`).join('')}</tbody></table>`:'<p>Henüz personel ciro girişi yok.</p>';
  qa('[data-fstore]').forEach(b=>b.onclick=()=>{const x=f.stores.find(v=>v.id===b.dataset.fstore);q('#fStoreId').value=x.id;q('#fStoreName').value=x.name;q('#fStoreCode').value=x.code||'';q('#fStoreAddress').value=x.address||'';q('#fStoreActive').checked=x.active});
  qa('[data-fstaff]').forEach(b=>b.onclick=()=>{const x=f.staff.find(v=>v.id===b.dataset.fstaff);q('#fStaffId').value=x.id;q('#fStaffName').value=x.name;q('#fStaffUsername').value=x.username;q('#fStaffPassword').value='';q('#fStaffStore').value=x.storeId;q('#fStaffActive').checked=x.active});
  qa('[data-fannouncement-delete]').forEach(b=>b.onclick=async()=>{if(!confirm('Duyuru silinsin mi?'))return;await api('/web-api/admin/announcement/'+b.dataset.fannouncementDelete,{method:'DELETE'});await loadFoundation()});
}
q('#storeFoundationForm').onsubmit=async e=>{e.preventDefault();try{const result=await api('/web-api/admin/store-location',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:q('#fStoreId').value,name:q('#fStoreName').value,code:q('#fStoreCode').value,address:q('#fStoreAddress').value,active:q('#fStoreActive').checked})});e.target.reset();q('#fStoreId').value='';q('#fStoreActive').checked=true;await loadFoundation();toast(`Mağaza kaydedildi: ${result.row?.name||''}`)}catch(err){toast('Mağaza kaydedilemedi: '+err.message)}};
q('#staffFoundationForm').onsubmit=async e=>{e.preventDefault();await api('/web-api/admin/staff-member',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:q('#fStaffId').value,name:q('#fStaffName').value,username:q('#fStaffUsername').value,password:q('#fStaffPassword').value,storeId:q('#fStaffStore').value,active:q('#fStaffActive').checked})});e.target.reset();q('#fStaffId').value='';q('#fStaffActive').checked=true;await loadFoundation();toast('Personel kaydedildi')};
q('#announcementFoundationForm').onsubmit=async e=>{e.preventDefault();await api('/web-api/admin/announcement',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:q('#fAnnouncementType').value,title:q('#fAnnouncementTitle').value,message:q('#fAnnouncementMessage').value,storeId:q('#fAnnouncementStore').value,endDate:q('#fAnnouncementEnd').value,active:true})});e.target.reset();await loadFoundation();toast('Duyuru yayınlandı')};
const oldGoTab=goTab;goTab=function(id){oldGoTab(id);if(id==='foundation')loadFoundation().catch(e=>toast(e.message))};


let stockData=null;
async function loadStockCenter(){stockData=await api('/web-api/admin/stock-center');renderStockCenter()}
function renderStockCenter(){
  if(!stockData||!q('#stockSummary'))return;
  const activeWarehouses=stockData.warehouses.filter(x=>x.active!==false&&!x.deletedAt);
  const total=stockData.stocks.reduce((a,x)=>a+Number(x.quantity||0),0);
  const reserved=stockData.stocks.reduce((a,x)=>a+Number(x.reserved||0),0);
  const critical=stockData.stocks.filter(x=>Number(x.available||0)<=2).length;
  q('#stockSummary').innerHTML=`<article><b>${total}</b><span>Toplam Fiziksel Stok</span></article><article><b>${reserved}</b><span>Rezerve Stok</span></article><article><b>${activeWarehouses.length}</b><span>Aktif Depo</span></article><article><b>${critical}</b><span>Kritik Stok Satırı</span></article>`;
  const stores=foundationData?.stores||[];
  q('#warehouseStore').innerHTML='<option value="">Mağazaya bağlı değil</option>'+stores.map(x=>`<option value="${x.id}">${x.name}</option>`).join('');
  const whOpts=activeWarehouses.map(x=>`<option value="${x.id}">${x.name}</option>`).join('');
  ['#stockWarehouse','#transferFrom','#transferTo','#importWarehouse'].forEach(id=>q(id).innerHTML=whOpts);
  const productOpts=stockData.products.filter(x=>x.active).map(x=>`<option value="${x.code}">${x.code} — ${x.name}</option>`).join('');
  ['#stockProduct','#transferProduct'].forEach(id=>q(id).innerHTML=productOpts);
  q('#warehouseList').innerHTML=stockData.warehouses.filter(x=>!x.deletedAt).map(x=>`<div class="warehouse-list-row"><button type="button" class="warehouse-edit-main" data-warehouse-edit="${x.id}"><b>${x.name}</b><small>${x.code||''} · ${x.active?'Aktif':'Pasif'}</small></button><button type="button" class="warehouse-delete-btn" data-warehouse-delete="${x.id}" title="Depoyu sil">Sil</button></div>`).join('');
  qa('[data-warehouse-edit]').forEach(b=>b.onclick=()=>{const x=stockData.warehouses.find(v=>v.id===b.dataset.warehouseEdit);q('#warehouseId').value=x.id;q('#warehouseName').value=x.name;q('#warehouseCode').value=x.code||'';q('#warehouseStore').value=x.storeId||'';q('#warehouseActive').checked=x.active!==false});
  qa('[data-warehouse-delete]').forEach(b=>b.onclick=async()=>{const x=stockData.warehouses.find(v=>v.id===b.dataset.warehouseDelete);if(!x)return;if(!confirm(`${x.name} deposu silinsin mi? Depoda stok varsa sistem silmeye izin vermeyecek.`))return;try{await api('/web-api/admin/warehouse/'+encodeURIComponent(x.id),{method:'DELETE'});toast('Depo silindi');await loadStockCenter()}catch(e){toast(e.message)}});
  renderStockTable();
  q('#movementCount').textContent=`${stockData.movements.length} hareket`;
  q('#movementTable').innerHTML=stockData.movements.length?`<table><thead><tr><th>Tarih</th><th>Ürün</th><th>Depo</th><th>İşlem</th><th>Değişim</th><th>Sonuç</th></tr></thead><tbody>${stockData.movements.map(x=>`<tr><td>${new Date(x.createdAt).toLocaleString('tr-TR')}</td><td>${x.productCode}</td><td>${stockData.warehouses.find(w=>w.id===x.warehouseId)?.name||x.warehouseId}</td><td>${x.type}</td><td class="${x.quantity>=0?'stock-plus':'stock-minus'}">${x.quantity>=0?'+':''}${x.quantity}</td><td>${x.after}</td></tr>`).join('')}</tbody></table>`:'<p>Henüz stok hareketi yok.</p>';
}
function renderStockTable(){
  const term=(q('#stockSearch')?.value||'').toLocaleLowerCase('tr-TR');
  const rows=stockData.stocks.filter(x=>`${x.productCode} ${x.productName} ${x.warehouseName}`.toLocaleLowerCase('tr-TR').includes(term));
  q('#stockTable').innerHTML=rows.length?`<table><thead><tr><th>Ürün</th><th>Depo</th><th>Fiziksel</th><th>Rezerve</th><th>Satılabilir</th></tr></thead><tbody>${rows.map(x=>`<tr><td><b>${x.productCode}</b><small>${x.productName}</small></td><td>${x.warehouseName}</td><td>${x.quantity}</td><td>${x.reserved||0}</td><td><b>${x.available}</b></td></tr>`).join('')}</tbody></table>`:'<p>Stok kaydı bulunamadı.</p>';
}
q('#stockSearch').oninput=renderStockTable;
q('#warehouseForm').onsubmit=async e=>{e.preventDefault();await api('/web-api/admin/warehouse',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:q('#warehouseId').value,name:q('#warehouseName').value,code:q('#warehouseCode').value,storeId:q('#warehouseStore').value,active:q('#warehouseActive').checked})});e.target.reset();q('#warehouseId').value='';q('#warehouseActive').checked=true;await loadStockCenter();toast('Depo kaydedildi')};
q('#stockAdjustForm').onsubmit=async e=>{e.preventDefault();await api('/web-api/admin/stock-adjust',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({productCode:q('#stockProduct').value,warehouseId:q('#stockWarehouse').value,quantity:q('#stockQuantity').value,note:q('#stockNote').value})});e.target.reset();await loadStockCenter();toast('Stok güncellendi')};
q('#stockTransferForm').onsubmit=async e=>{e.preventDefault();await api('/web-api/admin/stock-transfer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({productCode:q('#transferProduct').value,fromWarehouseId:q('#transferFrom').value,toWarehouseId:q('#transferTo').value,quantity:q('#transferQuantity').value,note:q('#transferNote').value})});e.target.reset();q('#transferQuantity').value=1;await loadStockCenter();toast('Transfer tamamlandı')};
q('#stockImportForm').onsubmit=async e=>{e.preventDefault();const fd=new FormData();fd.append('file',q('#stockImportFile').files[0]);fd.append('warehouseId',q('#importWarehouse').value);const r=await api('/web-api/admin/stock-import',{method:'POST',body:fd});e.target.reset();await loadStockCenter();toast(`${r.imported} stok satırı aktarıldı`)};
const foundationGoTab=goTab;goTab=function(id){foundationGoTab(id);if(id==='stockCenter'){if(!foundationData)loadFoundation().then(loadStockCenter);else loadStockCenter().catch(e=>toast(e.message))}};


let financeData=null;
async function loadFinanceCenter(){financeData=await api('/web-api/admin/finance-center');renderFinanceCenter()}
function renderFinanceCenter(){
  if(!financeData||!q('#financeSummary'))return;
  const s=financeData.summary;
  q('#financeSummary').innerHTML=`<article><b>${money(s.cash)}</b><span>Toplam Kasa</span></article><article><b>${money(s.bank)}</b><span>Toplam Banka</span></article><article><b>${money(s.receivable)}</b><span>Müşteri Alacağı</span></article><article><b>${money(s.todayExpense)}</b><span>Bugünkü Masraf</span></article>`;
  const storeOpts='<option value="">Merkez / Bağımsız</option>'+financeData.stores.map(x=>`<option value="${x.id}">${x.name}</option>`).join('');
  q('#financeAccountStore').innerHTML=storeOpts;
  const accountOpts=financeData.accounts.filter(x=>x.active!==false).map(x=>`<option value="${x.id}">${x.name} — ${money(x.balance)}</option>`).join('');
  ['#financeMovementAccount','#transferFromAccount','#transferToAccount'].forEach(id=>q(id).innerHTML=accountOpts);
  const customerOpts='<option value="">Müşteri seçilmedi</option>'+financeData.customers.filter(x=>x.active!==false).map(x=>`<option value="${x.id}">${x.name} — Bakiye ${money(x.balance)}</option>`).join('');
  q('#financeCustomer').innerHTML=customerOpts;
  q('#financeAccountList').innerHTML=financeData.accounts.map(x=>`<button type="button" data-fin-account="${x.id}"><b>${x.name}</b><small>${x.type==='bank'?'Banka':'Kasa'} · ${money(x.balance)}</small></button>`).join('');
    q('#financeAccountCount').textContent=`${financeData.accounts.length} hesap`;
  q('#financeAccountsTable').innerHTML=`<table><thead><tr><th>Hesap</th><th>Tür</th><th>Mağaza</th><th>Bakiye</th></tr></thead><tbody>${financeData.accounts.map(x=>`<tr><td><b>${x.name}</b></td><td>${x.type==='bank'?'Banka':'Kasa'}</td><td>${financeData.stores.find(s=>s.id===x.storeId)?.name||'Merkez'}</td><td><b>${money(x.balance)}</b></td></tr>`).join('')}</tbody></table>`;
  renderCustomerTable();
  q('#financeTransactionCount').textContent=`${financeData.transactions.length} hareket`;
  q('#financeTransactionTable').innerHTML=financeData.transactions.length?`<table><thead><tr><th>Tarih</th><th>İşlem</th><th>Hesap</th><th>Müşteri</th><th>Tutar</th><th></th></tr></thead><tbody>${financeData.transactions.map(x=>`<tr><td>${x.date}</td><td>${x.kind}</td><td>${x.accountName}${x.counterAccountName?` ← ${x.counterAccountName}`:''}</td><td>${x.customerName||'-'}</td><td class="${x.amount>=0?'stock-plus':'stock-minus'}">${money(x.amount)}</td><td><a class="receipt-link" href="/web-api/admin/receipt/${x.id}" target="_blank">Makbuz</a> ${x.reversedBy?'Ters kayıt oluşturuldu':`<button type="button" data-reverse-finance="${x.id}">Ters Kayıt</button>`}</td></tr>`).join('')}</tbody></table>`:'<p>Henüz finans hareketi yok.</p>';
  qa('[data-fin-account]').forEach(b=>b.onclick=()=>{const x=financeData.accounts.find(v=>v.id===b.dataset.finAccount);q('#financeAccountId').value=x.id;q('#financeAccountName').value=x.name;q('#financeAccountType').value=x.type;q('#financeAccountStore').value=x.storeId||'';q('#financeOpeningBalance').value=x.openingBalance||0;q('#financeAccountActive').checked=x.active!==false});
    qa('[data-reverse-finance]').forEach(b=>b.onclick=async()=>{if(!confirm('Bu hareket için ters kayıt oluşturulsun mu?'))return;await api('/web-api/admin/finance-reverse/'+b.dataset.reverseFinance,{method:'POST'});await loadFinanceCenter();toast('Ters kayıt oluşturuldu')});
}
function renderCustomerTable(){
  const term=(q('#customerSearch')?.value||'').toLocaleLowerCase('tr-TR');
  const rows=financeData.customers.filter(x=>`${x.name} ${x.phone} ${x.taxNo}`.toLocaleLowerCase('tr-TR').includes(term));
  q('#customerTable').innerHTML=rows.length?`<table><thead><tr><th>Müşteri</th><th>Telefon</th><th>VKN/TCKN</th><th>Bakiye</th><th>Durum</th></tr></thead><tbody>${rows.map(x=>`<tr><td><b>${x.name}</b></td><td>${x.phone||'-'}</td><td>${x.taxNo||'-'}</td><td><b>${money(x.balance)}</b></td><td>${x.balance>0?'Borçlu':x.balance<0?'Alacaklı':'Kapalı'}</td></tr>`).join('')}</tbody></table>`:'<p>Müşteri bulunamadı.</p>';
}
q('#customerSearch').oninput=renderCustomerTable;
q('#financeDate').value=q('#transferDate').value=new Date().toISOString().slice(0,10);
q('#financeAccountForm').onsubmit=async e=>{e.preventDefault();await api('/web-api/admin/finance-account',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:q('#financeAccountId').value,name:q('#financeAccountName').value,type:q('#financeAccountType').value,storeId:q('#financeAccountStore').value,openingBalance:q('#financeOpeningBalance').value,active:q('#financeAccountActive').checked})});e.target.reset();q('#financeAccountId').value='';q('#financeOpeningBalance').value=0;q('#financeAccountActive').checked=true;await loadFinanceCenter();toast('Hesap kaydedildi')};

q('#financeMovementForm').onsubmit=async e=>{e.preventDefault();await api('/web-api/admin/finance-transaction',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:q('#financeKind').value,date:q('#financeDate').value,accountId:q('#financeMovementAccount').value,customerId:q('#financeCustomer').value,amount:q('#financeAmount').value,category:q('#financeCategory').value,description:q('#financeDescription').value})});e.target.reset();q('#financeDate').value=new Date().toISOString().slice(0,10);await loadFinanceCenter();toast('Finans hareketi kaydedildi')};
q('#financeTransferForm').onsubmit=async e=>{e.preventDefault();await api('/web-api/admin/finance-transfer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({date:q('#transferDate').value,fromAccountId:q('#transferFromAccount').value,toAccountId:q('#transferToAccount').value,amount:q('#transferFinanceAmount').value,description:q('#transferFinanceDescription').value})});e.target.reset();q('#transferDate').value=new Date().toISOString().slice(0,10);await loadFinanceCenter();toast('Transfer tamamlandı')};
const stockGoTab=goTab;goTab=function(id){stockGoTab(id);if(id==='financeCenter')loadFinanceCenter().catch(e=>toast(e.message))};



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

let salesCenterData={customers:[],accounts:[],products:[],categories:[],warehouses:[],stocks:[],dealerSettings:[],salespeople:[],currentUser:null,canManage:false};
async function loadSalesCenter(){
  try{
    const [cat,fin,stock,people]=await Promise.all([
      api('/web-api/admin/sales-catalog'),
      api('/web-api/admin/finance-center'),
      api('/web-api/admin/stock-center'),
      api('/web-api/admin/salespeople').catch(()=>({rows:[],currentUser:null,canManage:false}))
    ]);
    salesCenterData.products=cat.products||[];
    salesCenterData.categories=cat.categories||[];
    salesCenterData.dealerSettings=cat.dealerSettings||[];
    salesCenterData.customers=(fin.customers||[]).filter(c=>c.active!==false);
    salesCenterData.accounts=fin.accounts||[];
    salesCenterData.warehouses=stock.warehouses||[];
    salesCenterData.stocks=stock.stocks||[];
    salesCenterData.salespeople=people.rows||[];
    salesCenterData.currentUser=people.currentUser||null;
    salesCenterData.canManage=Boolean(people.canManage);
    if(q('#salesCategoryFilter'))q('#salesCategoryFilter').innerHTML='<option value="">Tüm kategoriler</option>'+salesCenterData.categories.map(c=>`<option value="${c.id}">${c.name}</option>`).join('');
    if(q('#salesDealer'))q('#salesDealer').innerHTML=salesCenterData.dealerSettings.filter(d=>d.active!==false).map(d=>`<option value="${d.id}">${d.name}</option>`).join('')||'<option value="">Bayi tanımlı değil</option>';
    if(q('#salesSalesperson')){
      const cur=salesCenterData.currentUser;
      q('#salesSalesperson').innerHTML='<option value="">Satıcı seçin</option>'+salesCenterData.salespeople.map(p=>`<option value="${p.id}">${p.name}</option>`).join('');
      if(cur){
        const match=salesCenterData.salespeople.find(p=>String(p.id)===String(cur.id)||String(p.name).toLocaleLowerCase('tr-TR')===String(cur.name||'').toLocaleLowerCase('tr-TR'));
        if(match)q('#salesSalesperson').value=match.id;
      }
    }
    const accountOpts=salesCenterData.accounts.map(a=>`<option value="${a.id}">${a.name}</option>`).join('');
    ['#salesAccount','#payCashAccount','#payCardAccount','#payTransferAccount'].forEach(id=>{
      if(q(id))q(id).innerHTML=accountOpts;
    });
    // Nakit için kasa, kart/havale için banka tercihi
    const cashAcc=salesCenterData.accounts.find(a=>a.type==='cash')||salesCenterData.accounts[0];
    const bankAcc=salesCenterData.accounts.find(a=>a.type==='bank')||salesCenterData.accounts[0];
    if(cashAcc&&q('#payCashAccount'))q('#payCashAccount').value=cashAcc.id;
    if(bankAcc&&q('#payCardAccount'))q('#payCardAccount').value=bankAcc.id;
    if(bankAcc&&q('#payTransferAccount'))q('#payTransferAccount').value=bankAcc.id;
    if(q('#salesWarehouse'))q('#salesWarehouse').innerHTML=salesCenterData.warehouses.map(w=>`<option value="${w.id}">${w.name}</option>`).join('');
    if(typeof salesRenderCustomers==='function')salesRenderCustomers();
    if(typeof refreshSalesProductSelects==='function')refreshSalesProductSelects();
    if(typeof loadSalesPromissoryDefaults==='function')loadSalesPromissoryDefaults();
    if(typeof salesCalculate==='function')salesCalculate();
  }catch(e){if(typeof toast==='function')toast(e.message||'Satış merkezi verileri yüklenemedi')}
}
function salesMoney(v){return money2(Number(v||0))}
function salesMaterialCode(p){return String(p?.searchName||p?.code||p?.name||'').trim()}
function salesItemCode(p){return String(p?.itemCode||'').trim()}
function salesProductLabel(p){
  const madde=salesItemCode(p)||'-';
  const malzeme=salesMaterialCode(p)||'-';
  return `${madde} · ${malzeme}`;
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
  const deduct=q('#salesDeductStock')?.value==='yes';
  if(!deduct)return undefined;
  const warehouseId=q('#salesWarehouse')?.value||'';
  if(!warehouseId)return null;
  const row=(salesCenterData.stocks||[]).find(s=>String(s.productCode)===String(productCode)&&String(s.warehouseId)===String(warehouseId));
  if(!row)return 0;
  return Math.max(0,Number(row.quantity||0)-Number(row.reserved||0));
}
function salesAddRow(selectedCode=''){
  const wrap=q('#salesRows');
  if(!wrap)return;
  const product=(salesCenterData.products||[]).find(p=>String(p.code)===String(selectedCode));
  const unit=salesProductUnitPrice(product,salesPreferredPriceMethod());
  const row=document.createElement('div');
  row.className='sales-row';
  row.innerHTML=`
    <select class="sales-product">${salesProductOptions(selectedCode)}</select>
    <input class="sales-qty" type="number" min="1" step="1" value="1" title="Adet"/>
    <input class="sales-price" type="number" min="0" step="0.01" value="${unit}" placeholder="Birim fiyat"/>
    <span class="sales-stock-info">Stok: -</span>
    <b class="sales-row-total">${salesMoney(unit)}</b>
    <button class="sales-row-delete" type="button">Sil</button>`;
  wrap.appendChild(row);
  const sel=row.querySelector('.sales-product');
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
  row.querySelector('.sales-row-delete').addEventListener('click',()=>{row.remove();salesCalculate()});
  updateStockInfo();
  salesCalculate();
  price.focus();price.select();
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

function salesReset(){
  if(q('#salesRows'))q('#salesRows').innerHTML='';
  if(q('#salesDiscountPct'))q('#salesDiscountPct').value='0';
  if(q('#salesDiscountAmount'))q('#salesDiscountAmount').value='0';
  ['#payCash','#payCard','#payTransfer','#payCredit','#payNote','#salesPaidAmount'].forEach(id=>{if(q(id))q(id).value='0'});
  if(q('#salesDescription'))q('#salesDescription').value='';
  if(q('#salesInvoiceStatus'))q('#salesInvoiceStatus').value='pending';
  if(q('#salesInvoiceNumber'))q('#salesInvoiceNumber').value='';
  if(q('#salesCustomerSearch'))q('#salesCustomerSearch').value='';
  if(q('#salesCustomerSelect'))q('#salesCustomerSelect').value='';
  if(q('#salesStatus')){q('#salesStatus').textContent='';q('#salesStatus').className='form-status'}
  if(q('#salesDate'))q('#salesDate').value=new Date().toISOString().slice(0,10);
  if(q('#salesPromissoryDescription'))q('#salesPromissoryDescription').value='';
  if(q('#salesPromissorySchedule'))q('#salesPromissorySchedule').innerHTML='';
  salesCustomerChanged();
  salesInvoiceChanged();
  loadSalesPromissoryDefaults();
  salesPaymentChanged();
  salesCalculate();
  toast('Yeni satış formu hazır');
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
  return Math.round((p.cash+p.card+p.transfer)*100)/100;
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
  const due=Math.round((splits.credit+splits.note+Math.max(0,remaining))*100)/100;
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
  const bal=q('#payBalanceHint');
  if(bal){
    if(c.net<=0){bal.className='sales-pay-balance ok';bal.textContent='Ödeme dağılımını net tutara eşitleyin.';}
    else if(Math.abs(c.remaining)<0.009){bal.className='sales-pay-balance ok';bal.textContent=`✓ Ödeme dağılımı net tutara eşit (${salesMoney(c.net)})`;}
    else if(c.remaining>0){bal.className='sales-pay-balance warn';bal.textContent=`⚠ Henüz ${salesMoney(c.remaining)} dağıtılmadı. Nakit/kart/havale/senet/vadeli girin.`;}
    else{bal.className='sales-pay-balance bad';bal.textContent=`⚠ Dağıtılan tutar netten ${salesMoney(Math.abs(c.remaining))} fazla.`;}
  }
  if(q('#salesDiscountLimit'))q('#salesDiscountLimit').textContent=c.dealer?`${c.dealer.name} · ${c.method} · İskonto serbest · Kâr bölü %${String(c.dealer.marginDividePct??0).replace('.',',')}`:'Bayi seçin';
  if(q('#salesCommissionPreview'))q('#salesCommissionPreview').textContent=c.dealer?`Tahmini prim: ${salesMoney(c.commission)}  →  net ${salesMoney(c.net)} × %${String(c.commissionPct).replace('.',',')}`:'Tahmini prim: bayi seçin';
  const hint=q('#salesCalcHint');
  if(hint){
    if(!c.dealer){hint.className='warn';hint.textContent='Bayi seçilmeden prim hesaplanamaz.';}
    else if(c.gross<=0){hint.className='ok';hint.textContent='Ürün tutarı girin; iskonto ve çoklu ödeme anlık hesaplanır.';}
    else{hint.className='ok';hint.textContent=`✓ Brüt ${salesMoney(c.gross)} − iskonto ${salesMoney(c.discountAmount)} = net ${salesMoney(c.net)} · tahsil ${salesMoney(c.paid)} · senet/vadeli ${salesMoney(c.splits.note+c.splits.credit)}`;}
  }
  salesPaymentChanged();
}
function salesRenderCustomers(){
  const term=(q('#salesCustomerSearch')?.value||'').toLocaleLowerCase('tr-TR'),current=q('#salesCustomerSelect')?.value||'';
  const rows=salesCenterData.customers.filter(c=>`${c.name} ${c.phone||''} ${c.taxNo||''}`.toLocaleLowerCase('tr-TR').includes(term));
  q('#salesCustomerCount').textContent=term?`${rows.length}/${salesCenterData.customers.length} müşteri`:`${salesCenterData.customers.length} müşteri`;
  q('#salesCustomerSelect').innerHTML='<option value="">Müşteri seçin</option>'+rows.map(c=>`<option value="${c.id}" ${String(c.id)===String(current)?'selected':''}>${c.name}${c.phone?' · '+c.phone:''}</option>`).join('');
  if(current && rows.some(c=>String(c.id)===String(current)))q('#salesCustomerSelect').value=current;
  salesCustomerChanged();
}
function salesCustomerChanged(){
  const c=salesCenterData.customers.find(x=>x.id===q('#salesCustomerSelect').value),box=q('#salesCustomerInfo'),noteWrap=q('#salesCustomerNoteWrap');
  if(!c){box.classList.add('hidden');box.innerHTML='';noteWrap?.classList.add('hidden');if(q('#salesCustomerNote'))q('#salesCustomerNote').value='';return}
  box.classList.remove('hidden');
  box.innerHTML=`<div><small>Müşteri</small><b>${c.name}</b></div><div><small>Telefon</small><b>${c.phone||'-'}</b></div><div><small>Güncel Cari</small><b class="${Number(c.balance)>0?'debt':'credit'}">${salesMoney(c.balance)}</b></div>`;
  noteWrap?.classList.remove('hidden');if(q('#salesCustomerNote'))q('#salesCustomerNote').value=c.note||'';
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
  }else if(q('#salesPromissorySchedule'))q('#salesPromissorySchedule').innerHTML='';
}



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
      <em>Ekle</em>
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

function salesDeductStockChanged(){const enabled=q('#salesDeductStock')?.value==='yes';q('#salesWarehouseWrap')?.classList.toggle('hidden',!enabled);if(!enabled&&q('#salesWarehouse'))q('#salesWarehouse').value='';salesRefreshRowStocks()}
q('#salesDeductStock')?.addEventListener('change',salesDeductStockChanged);
q('#salesWarehouse')?.addEventListener('change',salesRefreshRowStocks);
q('#salesAddRowBtn')?.addEventListener('click',()=>salesAddRow());q('#salesResetBtn')?.addEventListener('click',salesReset);
['#payCash','#payCard','#payTransfer','#payCredit','#payNote'].forEach(id=>{
  q(id)?.addEventListener('input',salesCalculate);
  q(id)?.addEventListener('change',salesCalculate);
});
function salesFillRemainingTo(fieldId){
  const map={payCash:'cash',payCard:'card',payTransfer:'transfer',payCredit:'credit',payNote:'note'};
  const key=map[fieldId];if(!key)return;
  const c=salesCalcState();
  const current=Math.max(0,salesNum(c.splits[key]));
  const others=Math.round((c.allocated-current)*100)/100;
  const fill=Math.max(0,Math.round((c.net-others)*100)/100);
  const el=q('#'+fieldId);if(!el)return;
  el.value=String(fill);
  salesCalculate();
  el.focus();el.select?.();
}
qa('[data-pay-fill]').forEach(btn=>{
  btn.addEventListener('click',()=>salesFillRemainingTo(btn.getAttribute('data-pay-fill')));
});
['#salesPromissoryInstallments','#salesPromissoryInterval','#salesPromissoryFirstDue'].forEach(id=>{
  q(id)?.addEventListener('input',salesRenderPromissorySchedule);
  q(id)?.addEventListener('change',salesRenderPromissorySchedule);
});
q('#salesDealer')?.addEventListener('change',salesCalculate);q('#salesDiscountPct')?.addEventListener('input',salesCalculate);q('#salesDiscountPct')?.addEventListener('change',salesCalculate);q('#salesCustomerSearch')?.addEventListener('input',salesRenderCustomers);q('#salesCustomerSelect')?.addEventListener('change',salesCustomerChanged);

q('#salesCustomerNoteSave')?.addEventListener('click',async()=>{
  const customerId=q('#salesCustomerSelect')?.value||'';if(!customerId){toast('Önce müşteri seçin');return}
  try{
    const r=await api('/web-api/admin/customer/'+encodeURIComponent(customerId)+'/note',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({note:q('#salesCustomerNote').value||''})});
    const i=salesCenterData.customers.findIndex(c=>String(c.id)===String(customerId));if(i>=0)salesCenterData.customers[i]=r.row;
    toast('Müşteri notu kaydedildi');
  }catch(e){toast(e.message)}
});

q('#salesNewCustomerBtn')?.addEventListener('click',()=>{
  q('#salesQuickCustomerForm')?.reset();q('#salesQuickCustomerStatus').textContent='';
  q('#salesQuickCustomerModal')?.classList.remove('hidden');q('#salesQuickCustomerName')?.focus();
});
q('#salesQuickCustomerClose')?.addEventListener('click',()=>q('#salesQuickCustomerModal')?.classList.add('hidden'));
q('#salesQuickCustomerForm')?.addEventListener('submit',async e=>{
  e.preventDefault();const st=q('#salesQuickCustomerStatus'),name=q('#salesQuickCustomerName').value.trim();
  if(!name){st.textContent='Müşteri adı zorunludur.';st.className='form-status error';return}
  try{
    const r=await api('/web-api/admin/customer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      name,phone:q('#salesQuickCustomerPhone').value,email:q('#salesQuickCustomerEmail').value,taxNo:q('#salesQuickCustomerTaxNo').value,
      address:q('#salesQuickCustomerAddress').value,note:q('#salesQuickCustomerNote').value,active:true
    })});
    const fin=await api('/web-api/admin/finance-center');
    salesCenterData.customers=(fin.customers||[]).filter(c=>c.active!==false);
    q('#salesCustomerSearch').value=name;salesRenderCustomers();q('#salesCustomerSelect').value=r.row.id;salesCustomerChanged();
    q('#salesQuickCustomerModal').classList.add('hidden');toast('Müşteri kaydedildi ve satışa seçildi.');
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
  const deductStock=q('#salesDeductStock')?.value==='yes';
  const salespersonId=q('#salesSalesperson')?.value||'',salesperson=salesCenterData.salespeople.find(p=>String(p.id)===String(salespersonId));
  const draft={status,customerId,customer,dealerId,dealer,salespersonId,salesperson,discountPct,discountAmount:calc.discountAmount,commissionPct:calc.commissionPct,commissionAmount:calc.commission,grossTotal,warehouseId,warehouse,deductStock,items,total,paid:calc.paid,due:calc.due,method:calc.method,payments,promissory,allocated:calc.allocated,remaining:calc.remaining,date:q('#salesDate').value,description:q('#salesDescription').value||'Mağaza satışı',invoiceStatus:q('#salesInvoiceStatus')?.value||'pending',invoiceNumber:q('#salesInvoiceNumber')?.value||'',invoiceDate:q('#salesInvoiceDate')?.value||''};
  if(!customerId)return{error:'Müşteri seçmelisiniz.',...draft};
  if(!dealer)return{error:'Satış bayisini seçmelisiniz.',...draft};
  if(!salesperson)return{error:'Satış personelini seçmelisiniz.',...draft};
  if(!items.length)return{error:'En az bir ürün eklemelisiniz.',...draft};
  if(deductStock&&!warehouseId)return{error:'Stoktan düşmek için satış deposu seçmelisiniz.',...draft};
  if(total>0&&Math.abs(calc.remaining)>0.009)return{error:`Ödeme dağılımı net tutara eşit olmalı. Kalan: ${salesMoney(calc.remaining)}`,...draft};
  if(draft.payments.some(p=>['Nakit','Kredi Kartı','Havale'].includes(p.method)&&p.amount>0&&!p.accountId))return{error:'Nakit / kart / havale için hesap seçmelisiniz.',...draft};
  if(promissory){
    if(!promissory.firstDueDate)return{error:'Senet için ilk vade tarihini girin.',...draft};
    if(!promissory.schedule.length)return{error:'Senet takvimi oluşturulamadı. Vade tarihini kontrol edin.',...draft};
  }
  if(draft.invoiceStatus==='issued'&&!draft.invoiceNumber.trim())return{error:'Şimdi faturalandı seçildiğinde fatura numarası zorunludur.',...draft};
  return draft;
}
function salesPreviewHtml(d){
  const rows=d.items.map(i=>`<tr><td>${i.itemCode||'-'}</td><td>${i.materialCode||i.productName||i.productCode}</td><td>${i.quantity}</td><td>${salesMoney(i.unitPrice)}</td><td>${salesMoney(i.quantity*i.unitPrice)}</td></tr>`).join('');
  const payRows=(d.payments||[]).map(p=>`<div class="sales-total-line"><span>${p.method}${p.accountId?' · hesap seçildi':''}</span><b>${salesMoney(p.amount)}</b></div>`).join('');
  const note=d.promissory?`<div class="preview-note"><b>⚠ Senet düzenlemesi:</b> ${salesMoney(d.promissory.amount)} · ${d.promissory.installments} taksit · İlk vade ${d.promissory.firstDueDate}<br>${(d.promissory.schedule||[]).map(r=>`${r.no}) ${r.dueDate} → ${salesMoney(r.amount)}`).join(' · ')}</div>`:'';
  return `<div class="preview-cards"><div><small>Müşteri</small><b>${d.customer?.name||'-'}</b><span>${d.customer?.phone||''}</span></div><div><small>Bayi / Satıcı</small><b>${d.dealer?.name||'-'}</b><span>${d.salesperson?.name||'-'}</span></div><div><small>Ödeme</small><b>${d.method}</b><span>Tahsil: ${salesMoney(d.paid)}</span></div></div><div class="table-wrap"><table><thead><tr><th>Madde Kodu</th><th>Malzeme</th><th>Adet</th><th>Birim</th><th>Toplam</th></tr></thead><tbody>${rows}</tbody></table></div><div class="preview-totals"><div><span>Brüt Toplam</span><b>${salesMoney(d.grossTotal)}</b></div><div><span>İskonto (%${String(d.discountPct||0).replace('.',',')})</span><b>-${salesMoney(d.discountAmount||0)}</b></div><div><span>Net Satış</span><b>${salesMoney(d.total)}</b></div>${payRows}<div><span>Personel Prim (%${String(d.commissionPct||0).replace('.',',')})</span><b>${salesMoney(d.commissionAmount||0)}</b></div><div><span>Cariye / Senede Kalacak</span><strong>${salesMoney(d.due)}</strong></div></div>${note}<div class="preview-note"><b>Fatura:</b> ${d.invoiceStatus==='issued'?`Kesildi · ${d.invoiceNumber} · ${d.invoiceDate||d.date}`:'Daha sonra kesilecek'}</div><div class="preview-stock-choice"><b>Stok işlemi:</b> ${d.deductStock?`Stoktan düşülecek · ${d.warehouse?.name||'-'}`:'Stoktan düşülmeyecek'}<small>Fatura kesme durumu stoğu etkilemez.</small></div><div class="preview-description"><b>Açıklama:</b> ${d.description||'-'}</div>`;
}
let activeSalesDraft=null;
function openSalesPreview(){
  const d=collectSalesDraft();if(d.error){d.status.textContent=d.error;d.status.className='form-status error';return}
  activeSalesDraft=d;q('#salesPreviewBody').innerHTML=salesPreviewHtml(d);q('#salesPreviewModal').classList.remove('hidden');q('#salesPreviewModal').setAttribute('aria-hidden','false');document.body.classList.add('modal-open');
}
function closeSalesPreview(){q('#salesPreviewModal').classList.add('hidden');q('#salesPreviewModal').setAttribute('aria-hidden','true');document.body.classList.remove('modal-open')}
function salesOfferText(d){
  const pay=(d.payments||[]).map(p=>`${p.method}: ${salesMoney(p.amount)}`).join('\n');
  const note=d.promissory?`\nSenet: ${salesMoney(d.promissory.amount)} / ${d.promissory.installments} taksit / ilk vade ${d.promissory.firstDueDate}`:'';
  return `ATAK PAZARLAMA TEKLİF\nMüşteri: ${d.customer?.name||''}\n${d.items.map(i=>`${i.quantity} x ${i.itemCode||'-'} / ${i.materialCode||i.productName} - ${salesMoney(i.quantity*i.unitPrice)}`).join('\n')}\n\nBrüt: ${salesMoney(d.grossTotal)}\nİskonto (%${String(d.discountPct||0).replace('.',',')}): -${salesMoney(d.discountAmount||0)}\nNet Toplam: ${salesMoney(d.total)}\nÖdeme:\n${pay}${note}\n${d.description||''}`;
}
function sendSalesOffer(){const d=activeSalesDraft||collectSalesDraft();if(d.error)return toast(d.error);const phone=String(d.customer?.phone||'').replace(/\D/g,'');const raw=salesOfferText(d),text=encodeURIComponent(raw);if(phone){const trPhone=phone.startsWith('0')?'90'+phone.slice(1):phone;const win=window.open(`https://wa.me/${trPhone}?text=${text}`,'_blank');if(!win){navigator.clipboard?.writeText(raw);toast('Tarayıcı yeni pencereyi engelledi. Teklif panoya kopyalandı.')}}else{navigator.clipboard?.writeText(raw);toast('Müşterinin telefonu yok. Teklif metni panoya kopyalandı.')}}
function printSalesPreview(){const d=activeSalesDraft||collectSalesDraft();if(d.error)return toast(d.error);const w=window.open('','_blank');if(!w){toast('Tarayıcı yazdırma penceresini engelledi. Açılır pencerelere izin verin.');return}w.document.write(`<html><head><title>Atak Pazarlama Teklif</title><meta charset="utf-8"><style>body{font:14px Arial;padding:30px;color:#14233b}h1{color:#07366c}table{width:100%;border-collapse:collapse}th,td{padding:9px;border-bottom:1px solid #ddd;text-align:left}.preview-cards{display:flex;gap:12px}.preview-cards>div{flex:1;border:1px solid #ddd;padding:10px}.preview-cards small,.preview-cards b,.preview-cards span{display:block}.preview-totals{margin:20px 0 0 auto;width:380px}.preview-totals>div{display:flex;justify-content:space-between;padding:7px;border-bottom:1px solid #ddd}.preview-note,.preview-description{margin-top:12px;padding:10px;border:1px solid #ddd}</style></head><body><h1>ATAK PAZARLAMA</h1><h2>Satış / Teklif Önizleme</h2>${salesPreviewHtml(d)}<script>window.onload=()=>setTimeout(()=>window.print(),250)<\/script></body></html>`);w.document.close()}
async function confirmSalesDraft(){
  const d=activeSalesDraft||collectSalesDraft();if(d.error){toast(d.error);return}const deductStock=Boolean(d.deductStock);if(deductStock&&!d.warehouseId){toast('Stoktan düşmek için satış deposu seçmelisiniz.');return}const status=d.status,btn=q('#salesPreviewConfirmBtn');btn.disabled=true;btn.textContent='Satış Yapılıyor...';status.textContent='';
  try{
    const result=await api('/web-api/admin/customer-sale',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      customerId:d.customerId,dealerId:d.dealerId,salespersonId:d.salespersonId,salespersonName:d.salesperson?.name||'',
      discountPct:d.discountPct,warehouseId:d.warehouseId,date:d.date,paymentMethod:d.method,
      payments:d.payments,promissory:d.promissory,
      description:d.description,items:d.items,invoiceStatus:d.invoiceStatus,invoiceNumber:d.invoiceNumber,invoiceDate:d.invoiceDate,deductStock
    })});
    let noteText='';
    (result.collections||[]).forEach(c=>{if(c?.id)window.open('/web-api/admin/receipt/'+c.id,'_blank')});
    if(result.promissory?.printUrl){noteText=` · ${result.promissory.notes?.length||0} senet oluşturuldu`;window.open(result.promissory.printUrl,'_blank')}
    closeSalesPreview();status.textContent=`Satış kaydedildi. Yeni cari bakiye: ${salesMoney(result.balance)}${noteText}`;status.className='form-status success';await check();await loadSalesCenter();salesReset();
  }catch(e){status.textContent=e.message;status.className='form-status error'}finally{btn.disabled=false;btn.textContent='✓ Kontrol Ettim, Satışı Yap'}
}
q('#salesSaveBtn')?.addEventListener('click',openSalesPreview);
q('#salesPreviewClose')?.addEventListener('click',closeSalesPreview);
q('#salesPreviewConfirmBtn')?.addEventListener('click',confirmSalesDraft);
q('#salesPreviewOfferBtn')?.addEventListener('click',sendSalesOffer);
q('#salesPreviewPrintBtn')?.addEventListener('click',printSalesPreview);
document.addEventListener('click',e=>{
  const offer=e.target.closest('#salesPreviewOfferBtn');
  if(offer && !offer.dataset.boundFallback){e.preventDefault();sendSalesOffer()}
  const print=e.target.closest('#salesPreviewPrintBtn');
  if(print && !print.dataset.boundFallback){e.preventDefault();printSalesPreview()}
});
q('#salesPreviewOfferBtn')?.setAttribute('data-bound-fallback','1');
q('#salesPreviewPrintBtn')?.setAttribute('data-bound-fallback','1');
q('#salesPreviewModal')?.addEventListener('click',e=>{if(e.target===q('#salesPreviewModal'))closeSalesPreview()});



async function runSystemSelfTest(target='#settingsSelfTestResult'){
 const box=q(target);if(box)box.innerHTML='<p>Test çalışıyor…</p>';
 try{const r=await api('/web-api/admin/self-test');const html=(r.checks||[]).map(c=>`<div class="self-test-row ${c.ok?'ok':'bad'}"><b>${c.ok?'✓':'✕'} ${c.name}</b><small>${c.detail||''}</small></div>`).join('');if(box)box.innerHTML=html;toast(r.ok?'Sistem testi başarılı':'Sistem testinde hata bulundu')}catch(e){if(box)box.innerHTML=`<div class="self-test-row bad"><b>Test çalışmadı</b><small>${e.message}</small></div>`;toast(e.message)}
}
async function loadPromissorySettings(){try{const d=await api('/web-api/admin/promissory-settings'),s=d.settings||{};q('#noteCreditor').value=s.creditorName||'';q('#notePaymentPlace').value=s.paymentPlace||'';q('#noteIssuePlace').value=s.issuePlace||'';q('#notePrefix').value=s.prefix||'ATAK';q('#noteDefaultInstallments').value=s.defaultInstallments||1;q('#noteFirstDueDays').value=s.firstDueDays??30;q('#noteIntervalMonths').value=s.intervalMonths||1;q('#noteCopies').value=s.copies||1;q('#noteFooter').value=s.footer||''}catch(e){toast(e.message)}}
q('[data-tab="settings"]')?.addEventListener('click',()=>setTimeout(loadPromissorySettings,30));
q('#systemSelfTestBtn')?.addEventListener('click',()=>{goTab('settings');setTimeout(()=>runSystemSelfTest(),60)});q('#settingsSelfTestBtn')?.addEventListener('click',()=>runSystemSelfTest());
q('#promissorySettingsForm')?.addEventListener('submit',async e=>{e.preventDefault();const s=q('#promissorySettingsStatus');try{await api('/web-api/admin/promissory-settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({creditorName:q('#noteCreditor').value,paymentPlace:q('#notePaymentPlace').value,issuePlace:q('#noteIssuePlace').value,prefix:q('#notePrefix').value,defaultInstallments:q('#noteDefaultInstallments').value,firstDueDays:q('#noteFirstDueDays').value,intervalMonths:q('#noteIntervalMonths').value,copies:q('#noteCopies').value,footer:q('#noteFooter').value})});s.textContent='Senet ayarları kaydedildi';s.className='form-status success'}catch(err){s.textContent=err.message;s.className='form-status error'}});





async function loadInvoiceIntegration(){
 try{const d=await api('/web-api/admin/invoice-integration'),s=d.settings||{};q('#invoiceEnvironment').value=s.environment||'test';q('#invoiceCompanyVkn').value=s.companyVkn||'';q('#invoiceCompanyTitle').value=s.companyTitle||'';q('#invoiceSenderAlias').value=s.senderAlias||'';q('#invoiceServiceUrl').value=s.webServiceUrl||'';q('#invoiceUsername').value=s.username||'';q('#invoicePassword').value=s.password||'';q('#invoiceEnabled').checked=!!s.enabled;q('#invoiceDraftMode').checked=s.draftMode!==false;q('#invoiceAutoDetect').checked=s.autoDetectType!==false}catch(e){toast(e.message)}
}
q('[data-tab="settings"]')?.addEventListener('click',()=>setTimeout(loadInvoiceIntegration,40));
q('#invoiceIntegrationForm')?.addEventListener('submit',async e=>{e.preventDefault();const st=q('#invoiceIntegrationStatus');try{await api('/web-api/admin/invoice-integration',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({environment:q('#invoiceEnvironment').value,companyVkn:q('#invoiceCompanyVkn').value,companyTitle:q('#invoiceCompanyTitle').value,senderAlias:q('#invoiceSenderAlias').value,webServiceUrl:q('#invoiceServiceUrl').value,username:q('#invoiceUsername').value,password:q('#invoicePassword').value,enabled:q('#invoiceEnabled').checked,draftMode:q('#invoiceDraftMode').checked,autoDetectType:q('#invoiceAutoDetect').checked})});st.textContent='QNB eFinans altyapı ayarları kaydedildi.';st.className='form-status success'}catch(err){st.textContent=err.message;st.className='form-status error'}});
q('#invoiceConnectionTestBtn')?.addEventListener('click',async()=>{const box=q('#invoiceConnectionTestResult');box.innerHTML='<p>Kontrol ediliyor…</p>';try{const r=await api('/web-api/admin/invoice-integration/test');box.innerHTML=(r.checks||[]).map(c=>`<div class="self-test-row ${c.ok?'ok':'bad'}"><b>${c.ok?'✓':'✕'} ${c.name}</b><small>${c.detail}</small></div>`).join('')+`<div class="self-test-row"><small>${r.note||''}</small></div>`}catch(e){box.innerHTML=`<div class="self-test-row bad"><b>Test çalışmadı</b><small>${e.message}</small></div>`}});

let dynamicsPreviewData=null;
let dynamicsCategories=[];

async function loadDynamicsImport(){
  const status=q('#dynamicsImportStatus');
  if(status){
    status.textContent='Exceldeki Arama adı ürün kodu olarak alınır. Sistem kategoriyi otomatik seçer; yanlışsa listeden değiştirebilirsiniz. Stok bu ekranda girilmez.';
    status.className='form-status';
  }
}

function dynamicsForm(includeCategories=false){
  const file=q('#dynamicsExcelFile')?.files?.[0];
  if(!file)throw new Error('Önce Dynamics Excel dosyasını seçin.');
  const fd=new FormData();
  fd.append('file',file);
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

  q('#dynamicsImportSummary').innerHTML=
    `<article><b>${d.total||0}</b><span>Toplam Satır</span></article>
     <article class="good"><b>${d.newCount||0}</b><span>Yeni Ürün</span></article>
     <article class="warn"><b>${d.existingCount||0}</b><span>Zaten Var</span></article>
     <article class="bad"><b>${d.invalidCount||0}</b><span>Hatalı</span></article>`;

  const rows=d.preview||[];
  q('#dynamicsPreviewTable').innerHTML=rows.map(r=>{
    const categoryCell = r.status==='new'
      ? `<select data-dynamics-category data-item-code="${r.itemCode||''}" data-search-name="${r.searchName||''}">
           ${dynamicsCategoryOptions(r.suggestedCategoryId||'')}
         </select>`
      : (r.status==='existing'
          ? '<span class="muted">Mevcut ürün</span>'
          : '<span class="muted">Aktarılmaz</span>');
    return `<tr class="dynamics-preview-row ${r.status}">
      <td><span class="dynamics-status ${r.status}">${r.status==='new'?'Yeni':r.status==='existing'?'Zaten Var':'Hatalı'}</span></td>
      <td><b>${r.searchName||'-'}</b>${r.existingCode?`<small>Mevcut: ${r.existingCode}</small>`:''}</td>
      <td>${categoryCell}</td>
    </tr>`;
  }).join('');

  q('#dynamicsPreviewEmpty').style.display=rows.length?'none':'block';
  q('#dynamicsImportBtn').disabled=!d.newCount;

  if(!dynamicsCategories.length){
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
  const selectors=qa('[data-dynamics-category]');
  const missing=selectors.filter(sel=>!sel.value);
  if(missing.length){
    status.textContent=`${missing.length} yeni ürünün kategorisi seçilmemiş. Hepsine kategori seçin.`;
    status.className='form-status error';
    missing[0]?.scrollIntoView({behavior:'smooth',block:'center'});
    missing[0]?.focus();
    return;
  }
  if(!confirm(`${newRows.length} yeni Arama adı ürün kodu eklensin mi?`))return;
  try{
    btn.disabled=true;btn.textContent='Aktarılıyor...';
    const r=await api('/web-api/admin/dynamics-excel-import',{method:'POST',body:dynamicsForm(true)});
    status.textContent=`Tamamlandı: ${r.added} yeni ürün eklendi, ${r.skipped} mevcut ürün atlandı. Stok değişmedi.`;
    status.className='form-status success';
    toast('Ürün kodları aktarıldı');
    dynamicsPreviewData=null;
    await check();
  }catch(e){
    status.textContent=e.message;status.className='form-status error';
  }finally{
    btn.disabled=false;btn.textContent='Yeni Ürünleri Aktar';
  }
});


let uninvoicedRows=[];
async function loadUninvoicedSales(){
  const status=q('#uninvoicedStatus');
  try{
    const d=await api('/web-api/admin/uninvoiced-sales');
    uninvoicedRows=d.rows||[];
    q('#uninvoicedCount').textContent=uninvoicedRows.length;
    q('#uninvoicedTable').innerHTML=uninvoicedRows.map(r=>`<tr>
      <td><b>${r.reference||'-'}</b></td>
      <td>${r.date||'-'}</td>
      <td>${r.customerName||'-'}</td>
      <td>${salesMoney(r.total)}</td>
      <td>${r.paymentMethod||'-'}</td>
      <td><button type="button" data-mark-invoiced="${r.id}">Faturayı Kes / İşle</button></td>
    </tr>`).join('');
    q('#uninvoicedEmpty').style.display=uninvoicedRows.length?'none':'block';
    qa('[data-mark-invoiced]').forEach(btn=>btn.onclick=async()=>{
      const row=uninvoicedRows.find(x=>String(x.id)===String(btn.dataset.markInvoiced));if(!row)return;
      const invoiceNumber=prompt(`${row.reference} için fatura numarası:`,'');
      if(!invoiceNumber)return;
      const invoiceDate=prompt('Fatura tarihi (YYYY-MM-DD):',new Date().toISOString().slice(0,10));
      if(!invoiceDate)return;
      try{
        await api('/web-api/admin/sale/'+encodeURIComponent(row.id)+'/mark-invoiced',{
          method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({invoiceNumber,invoiceDate})
        });
        toast('Fatura işlendi');
        await loadUninvoicedSales();
      }catch(e){toast(e.message)}
    });
    if(status){status.textContent=`${uninvoicedRows.length} adet kesilmeyen fatura bulundu.`;status.className='form-status success'}
  }catch(e){
    if(status){status.textContent=e.message;status.className='form-status error'}
  }
}
q('#uninvoicedRefreshBtn')?.addEventListener('click',loadUninvoicedSales);
q('[data-tab="uninvoicedSales"]')?.addEventListener('click',()=>setTimeout(loadUninvoicedSales,20));

loadDealerSettings();

function reportKpis(s={}){return `<article><small>Satış Adedi</small><b>${Number(s.count||0)}</b></article><article><small>Brüt Ciro</small><b>${salesMoney(s.gross||0)}</b></article><article><small>Net Ciro</small><b>${salesMoney(s.net||0)}</b></article><article><small>İskonto</small><b>${salesMoney(s.discount||0)}</b></article><article class="commission"><small>Hak Edilen Prim</small><b>${salesMoney(s.commission||0)}</b></article>`}
async function requestCancellation(targetType,targetId,ref=''){
  const reason=prompt(`${ref||'İşlem'} iptal sebebi:`);if(!reason)return;
  const warn=targetType==='sale'?'Satış iptalinde bağlı tahsilat, cari, stok ve prim ters kayıtla düzeltilecek. Devam edilsin mi?':'Tahsilat iptalinde kasa/banka ve cari ters kayıtla düzeltilecek. Devam edilsin mi?';
  if(!confirm(warn))return;
  try{const r=await api('/web-api/admin/cancellation-request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({targetType,targetId,reason})});toast(r.direct?'İşlem iptal edildi.':'İptal talebi yönetici onayına gönderildi.');await loadMySalesReport();await loadStaffSalesReport();await loadApprovals()}catch(e){toast(e.message)}
}
async function loadMySalesReport(){
  const st=q('#mySalesStatus');
  try{const d=await api('/web-api/admin/sales-performance');q('#mySalesSummary').innerHTML=reportKpis(d.summary);
    q('#mySalesTable').innerHTML=(d.rows||[]).map(r=>`<tr><td>${r.date||'-'}</td><td>${r.dealerName||'-'}</td><td>${r.salespersonName||r.createdBy||'-'}</td><td><b>${salesMoney(r.total)}</b></td><td>%${Number(r.discountPct||0)}</td><td><b>${salesMoney(r.commissionAmount||0)}</b></td><td><button type="button" data-my-cancel="${r.id}" data-ref="${r.reference||''}">İptal</button></td></tr>`).join('');
    qa('[data-my-cancel]').forEach(b=>b.onclick=()=>requestCancellation('sale',b.dataset.myCancel,b.dataset.ref));st.textContent=`${d.rows?.length||0} satış.`;st.className='form-status success';
  }catch(e){st.textContent=e.message;st.className='form-status error'}
}
async function loadStaffSalesReport(){
  const st=q('#staffSalesStatus'),params=new URLSearchParams(),person=q('#staffSalesPersonFilter')?.value||'',dealer=q('#staffSalesDealerFilter')?.value||'',from=q('#staffSalesFrom')?.value||'',to=q('#staffSalesTo')?.value||'';
  if(person)params.set('salespersonId',person);if(dealer)params.set('dealerId',dealer);if(from)params.set('from',from);if(to)params.set('to',to);
  try{const d=await api('/web-api/admin/sales-performance?'+params.toString());
    const current=person;q('#staffSalesPersonFilter').innerHTML='<option value="">Tüm personel</option>'+(d.people||[]).map(p=>`<option value="${p.id}">${p.name}</option>`).join('');if(current)q('#staffSalesPersonFilter').value=current;
    q('#staffSalesSummary').innerHTML=reportKpis(d.summary);
    q('#staffSalesTable').innerHTML=(d.rows||[]).map(r=>`<tr><td>${r.date||'-'}</td><td><b>${r.salespersonName||r.createdBy||'-'}</b></td><td>${r.dealerName||'-'}</td><td>${salesMoney(r.grossTotal||r.total)}</td><td><b>${salesMoney(r.total)}</b></td><td>${salesMoney(r.commissionAmount||0)}</td><td><button type="button" data-report-cancel="${r.id}" data-ref="${r.reference||''}">İptal</button></td></tr>`).join('');
    q('#staffCollectionsTable').innerHTML=(d.collections||[]).map(c=>`<tr><td>${c.date||'-'}</td><td>${c.customerName||'-'}</td><td><b>${salesMoney(c.amount)}</b></td><td>${c.accountName||c.category||'-'}</td><td>${c.reference||'-'}</td><td><button type="button" data-col-cancel="${c.id}" data-ref="${c.reference||''}">İptal</button></td></tr>`).join('');
    qa('[data-report-cancel]').forEach(b=>b.onclick=()=>requestCancellation('sale',b.dataset.reportCancel,b.dataset.ref));qa('[data-col-cancel]').forEach(b=>b.onclick=()=>requestCancellation('collection',b.dataset.colCancel,b.dataset.ref));
    if(!d.canManage){q('[data-tab="staffSalesReport"]')?.classList.add('hidden');q('[data-tab="managerApprovals"]')?.classList.add('hidden')}
    st.textContent=d.canManage?'Yönetici raporu hazır.':'Yalnız kendi satışlarınız.';st.className='form-status success';
  }catch(e){st.textContent=e.message;st.className='form-status error'}
}
async function loadApprovals(){
  const info=q('#approvalInfo');
  try{const d=await api('/web-api/admin/cancellation-requests');if(!d.canManage){q('[data-tab="managerApprovals"]')?.classList.add('hidden');info.textContent='Yalnız yönetici.';return}
    q('#approvalTable').innerHTML=(d.rows||[]).map(r=>`<tr><td><span class="approval-status ${r.status}">${r.status==='pending'?'Bekliyor':r.status==='approved'?'Onaylandı':'Reddedildi'}</span></td><td>${r.targetType==='sale'?'Satış':'Tahsilat'}</td><td>${r.targetReference||'-'}</td><td>${r.requestedByName||'-'}</td><td>${r.reason||'-'}</td><td>${String(r.requestedAt||'').replace('T',' ').slice(0,16)}</td><td>${r.status==='pending'?`<button type="button" data-appr="${r.id}">Onayla</button> <button type="button" data-rej="${r.id}">Reddet</button>`:(r.reviewedBy||'-')}</td></tr>`).join('');
    qa('[data-appr]').forEach(b=>b.onclick=async()=>{if(!confirm('Onaylansın mı? Satış ise tahsilat, cari, stok ve prim de düzeltilecek.'))return;try{await api('/web-api/admin/cancellation-request/'+b.dataset.appr+'/review',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'approve'})});toast('Onaylandı');await loadApprovals();await loadStaffSalesReport()}catch(e){toast(e.message)}});
    qa('[data-rej]').forEach(b=>b.onclick=async()=>{const note=prompt('Red açıklaması:','')||'';try{await api('/web-api/admin/cancellation-request/'+b.dataset.rej+'/review',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'reject',note})});toast('Reddedildi');await loadApprovals()}catch(e){toast(e.message)}});
    info.textContent='Personel iptal talepleri burada onaylanır. Kayıtlar silinmez, ters kayıtla düzeltilir.';info.className='form-status success';
  }catch(e){info.textContent=e.message;info.className='form-status error'}
}
q('#mySalesRefresh')?.addEventListener('click',loadMySalesReport);q('#staffSalesRefresh')?.addEventListener('click',loadStaffSalesReport);q('#approvalRefresh')?.addEventListener('click',loadApprovals);
['#staffSalesPersonFilter','#staffSalesDealerFilter','#staffSalesFrom','#staffSalesTo'].forEach(id=>q(id)?.addEventListener('change',loadStaffSalesReport));


let salesTrackingRows=[];
const deliveryStatusNames={order_received:'Sipariş Alındı',preparing:'Hazırlanıyor',ready:'Teslimata Hazır',shipped:'Sevkte',delivered:'Teslim Edildi'};
function renderSalesTracking(){
  const term=(q('#salesTrackingSearch')?.value||'').trim().toLocaleLowerCase('tr-TR'),status=q('#salesTrackingStatusFilter')?.value||'';
  const rows=salesTrackingRows.filter(r=>{
    if(status&&r.deliveryStatus!==status)return false;
    if(term){
      const hay=`${r.reference} ${r.customerName} ${r.customerPhone} ${r.salespersonName} ${r.dealerName} ${(r.items||[]).map(i=>`${i.productCode} ${i.productName}`).join(' ')}`.toLocaleLowerCase('tr-TR');
      if(!hay.includes(term))return false;
    }
    return true;
  });
  const open=rows.filter(r=>r.deliveryStatus!=='delivered').length,delivered=rows.filter(r=>r.deliveryStatus==='delivered').length,total=rows.reduce((a,r)=>a+Number(r.total||0),0);
  q('#salesTrackingSummary').innerHTML=`<article><small>Gösterilen</small><b>${rows.length}</b></article><article><small>Açık Satış</small><b>${open}</b></article><article><small>Teslim Edildi</small><b>${delivered}</b></article><article><small>Toplam Tutar</small><b>${salesMoney(total)}</b></article>`;
  q('#salesTrackingTable').innerHTML=rows.map(r=>`<tr>
    <td><b>${r.reference||'-'}</b><small>${r.date||''}</small></td>
    <td><b>${r.customerName||'-'}</b><small>${r.customerPhone||''}</small></td>
    <td>${r.dealerName||'-'}<small>${r.salespersonName||'-'}</small></td>
    <td><b>${salesMoney(r.total)}</b></td>
    <td><select data-track-status="${r.id}">${Object.entries(deliveryStatusNames).map(([k,v])=>`<option value="${k}" ${k===r.deliveryStatus?'selected':''}>${v}</option>`).join('')}</select></td>
    <td><textarea data-track-note="${r.customerId}" rows="2">${r.customerNote||''}</textarea></td>
    <td><button type="button" data-track-save="${r.id}" data-customer="${r.customerId}">Kaydet</button></td>
  </tr>`).join('');
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

loadPermissionDefinitions();loadCurrentAdminPermissions();
check().catch(()=>{});

qa('a[href="#"]').forEach(a=>a.addEventListener('click',e=>e.preventDefault()));
