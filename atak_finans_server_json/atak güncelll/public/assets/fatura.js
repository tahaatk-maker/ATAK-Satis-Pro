/* ATAK_FATURA_BUILD=fix-v264 */
const q=(s,r=document)=>r.querySelector(s);
const qa=(s,r=document)=>[...r.querySelectorAll(s)];
let state={view:'pending_sales',data:null,selected:new Set(),portal:'admin',canSetup:true,canIssue:true};

function toast(t){const el=q('#toast');if(!el)return;el.textContent=t;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),2600)}
function salesMoney(n){return new Intl.NumberFormat('tr-TR',{style:'currency',currency:'TRY',minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(n||0))}
function invEsc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function invStatusBadge(st){
  const s=String(st||'pending');
  const label={pending:'Bekliyor',ready:'Hazır',queued:'Kuyruk',draft_sent:'Taslak',queued_remote:'Portal kuyruk',issued:'Kesildi',error:'Hatalı',cancelled:'İptal',archived:'Arşiv'}[s]||s;
  return `<span class="inv-badge ${invEsc(s)}">${invEsc(label)}</span>`;
}
async function api(url,opt={}){
  const r=await fetch(url,{credentials:'same-origin',...opt});
  const text=await r.text();
  let d={};try{d=JSON.parse(text||'{}')}catch(_){d={}}
  if(r.status===401)throw new Error('Oturum yok');
  if(!r.ok)throw new Error(d.error||'İşlem başarısız');
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
      state.canIssue=has('sale_invoice_qnb')||has('invoices_manage')||has('finance_manage');
      if(!(has('screen_invoice_center')||has('invoices_manage')||has('sale_invoice_qnb')||has('screen_uninvoiced')||has('finance_manage')||has('orders_manage')||has('screen_sales_center'))){
        q('#gate').classList.remove('hidden');
        q('#gate p').textContent='Kesilmeyen fatura ekranı yetkiniz kapalı.';
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
  return (rows||[]).filter(r=>{
    if(!term)return true;
    const hay=`${r.reference||''} ${r.customerName||''} ${r.id||''}`.toLocaleLowerCase('tr-TR');
    return hay.includes(term);
  });
}

function openInvoiceDoc(row){
  const w=window.open(`/web-api/admin/sale/${encodeURIComponent(row.id)}/invoice-print`,'_blank','noopener');
  if(!w)toast('Tarayıcı yeni sekmeyi engelledi');
}

function invRenderTable(rows){
  const head=q('#invTableHead'),body=q('#invTableBody'),empty=q('#invEmpty');
  const issueBtns=state.canIssue;
  if(head)head.innerHTML=`<tr><th></th><th>Satış No</th><th>Tarih</th><th>Müşteri</th><th>Tutar</th><th>Ödeme</th><th>Durum</th><th>İşlem</th></tr>`;
  if(body)body.innerHTML=rows.map(r=>`<tr data-inv-id="${invEsc(r.id)}">
      <td><input type="checkbox" data-inv-check="${invEsc(r.id)}"/></td>
      <td><b>${invEsc(r.reference||'-')}</b></td>
      <td>${invEsc(r.date||'-')}</td>
      <td>${invEsc(r.customerName||'-')}</td>
      <td>${salesMoney(r.total)}</td>
      <td>${invEsc(r.paymentMethod||'-')}</td>
      <td>${invStatusBadge(r.invoiceStatus)}</td>
      <td style="display:flex;gap:6px;flex-wrap:wrap">
        ${issueBtns?`<button type="button" class="inv-btn" data-inv-qnb="${invEsc(r.id)}">Kuyruğa al</button>
        <button type="button" class="inv-btn" data-mark-invoiced="${invEsc(r.id)}">Manuel Kes</button>`:''}
        <button type="button" class="inv-btn" data-inv-print="${invEsc(r.id)}">Belgeyi aç</button>
      </td>
    </tr>`).join('');
  empty?.classList.toggle('hidden',rows.length>0);
  if(q('#invFootCount'))q('#invFootCount').textContent=`${rows.length} kesilmeyen`;
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
  qa('[data-inv-print]').forEach(btn=>btn.onclick=e=>{
    e.stopPropagation();
    const row=rows.find(x=>String(x.id)===String(btn.dataset.invPrint));
    if(row)openInvoiceDoc(row);
  });
  qa('[data-inv-qnb]').forEach(btn=>btn.onclick=async()=>{
    try{
      const out=await api('/web-api/admin/sale/'+encodeURIComponent(btn.dataset.invQnb)+'/issue-invoice',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
      toast(`Kuyruk: ${out.result?.docType||''}`);await loadInvoiceCenter();
    }catch(e){toast(e.message)}
  });
  qa('[data-mark-invoiced]').forEach(btn=>btn.onclick=async()=>{
    const row=(state.data?.salesPending||[]).find(x=>String(x.id)===String(btn.dataset.markInvoiced));if(!row)return;
    const invoiceNumber=prompt(`${row.reference} için fatura numarası:`,'');if(!invoiceNumber)return;
    const invoiceDate=prompt('Fatura tarihi (YYYY-MM-DD):',new Date().toISOString().slice(0,10));if(!invoiceDate)return;
    try{
      await api('/web-api/admin/sale/'+encodeURIComponent(row.id)+'/mark-invoiced',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({invoiceNumber,invoiceDate})});
      toast('Manuel fatura işlendi');await loadInvoiceCenter();
    }catch(e){toast(e.message)}
  });
}

function invPaintCurrentView(){
  const rows=invApplySearch(state.data?.salesPending||[]);
  invRenderTable(rows);
  if(q('#invFootStatus'))q('#invFootStatus').textContent=state.data?.note||'Kesilmeyen faturalar e-fatura firmasına otomatik aktarılır';
}

async function loadInvoiceCenter(){
  try{
    const d=await api('/web-api/admin/invoice-center');
    state.data=d;
    if(d.canSetup!=null)state.canSetup=!!d.canSetup;
    if(d.canIssue!=null)state.canIssue=!!d.canIssue;
    applyAccessUi();
    const url=d.settings?.atakDms?.copyUrl||'';
    if(q('#atakDmsCopyUrl'))q('#atakDmsCopyUrl').value=url;
    invPaintCurrentView();
  }catch(e){
    if(q('#invFootStatus'))q('#invFootStatus').textContent=e.message;
    toast(e.message);
  }
}

q('#invRefreshBtn')?.addEventListener('click',()=>loadInvoiceCenter());
q('#invSearch')?.addEventListener('input',()=>invPaintCurrentView());
q('#invIssueSelectedBtn')?.addEventListener('click',async()=>{
  if(!state.canIssue)return toast('Fatura kesme yetkiniz yok');
  const ids=[...state.selected];
  if(!ids.length)return toast('Önce satır seçin');
  for(const id of ids){
    try{await api('/web-api/admin/sale/'+encodeURIComponent(id)+'/issue-invoice',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})}catch(_){}
  }
  toast(`${ids.length} satış kuyruğa alındı`);
  await loadInvoiceCenter();
});
q('#atakDmsCopyBtn')?.addEventListener('click',async()=>{
  const url=String(q('#atakDmsCopyUrl')?.value||'').trim();
  if(!url || url.indexOf('client_id=')<0 || url.indexOf('client_secret=')<0)return toast('Hazır URL tam değil, sayfayı yenileyin');
  try{
    await navigator.clipboard.writeText(url);
    toast('Güncel geteinvoices URL kopyalandı');
  }catch(_){
    q('#atakDmsCopyUrl')?.select();
    try{document.execCommand('copy');toast('Güncel geteinvoices URL kopyalandı')}catch(e){toast('Kopyalanamadı, metni elle alın')}
  }
});

boot();
