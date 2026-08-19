/* ATAK_FATURA_BUILD=fix-v177 */
const q=(s,r=document)=>r.querySelector(s);
const qa=(s,r=document)=>[...r.querySelectorAll(s)];
let state={module:'efatura',view:'ef_out_pending',data:null,selected:new Set(),portal:'admin',canSetup:true,canIssue:true};

const INV_VIEW_META={
  ef_out_pending:{title:'e-Fatura · Gönderilecek',hint:'Satıştan kuyruğa düşen giden e-Faturalar. Satıra tıklayınca belge açılır.'},
  ef_out_sent:{title:'e-Fatura · Gönderilen',hint:'Kuyruğa alınan / kesilmiş e-Faturalar.'},
  ef_out_error:{title:'e-Fatura · Hatalı',hint:'Doğrulama hatası. Tekrar deneyebilirsiniz.'},
  ef_out_archive:{title:'e-Fatura · Giden Arşiv',hint:'İptal / arşivlenmiş giden e-Faturalar.'},
  ef_in_incoming:{title:'e-Fatura · Gelen',hint:'Arçelik Rapid360 geteinvoices. Rapid360’dan çek son 14 günü alır.'},
  ef_in_responses:{title:'e-Fatura · Uygulama Yanıtları',hint:'Ticari fatura kabul/red yanıtları.'},
  ef_in_archive:{title:'e-Fatura · Gelen Arşiv',hint:'Arşivlenmiş gelen e-Faturalar.'},
  ea_out_pending:{title:'e-Arşiv · Gönderilecek',hint:'Giden e-Arşiv kuyruğu.'},
  ea_out_sent:{title:'e-Arşiv · Gönderilen',hint:'Kuyruğa alınmış e-Arşiv faturaları.'},
  ea_out_error:{title:'e-Arşiv · Hatalı',hint:'Hatalı e-Arşiv kayıtları.'},
  ea_out_archive:{title:'e-Arşiv · Giden Arşiv',hint:'Arşivlenmiş giden e-Arşiv.'},
  ea_in_incoming:{title:'e-Arşiv · Gelen',hint:'Gelen e-Arşiv kayıtları.'},
  ea_in_archive:{title:'e-Arşiv · Gelen Arşiv',hint:'Arşivlenmiş gelen e-Arşiv.'},
  pending_sales:{title:'Kesilmeyen Faturalar',hint:'Geç kesilen satışlar. Kuyruğa alın veya manuel işaretleyin. Satıra tıklayınca belge açılır.'},
  setup_ready:{title:'Kurulum / Hazırlık',hint:'Firma, Rapid360 ve Atak geteinvoices kontrolü.'},
  setup_settings:{title:'Firma ve servis',hint:'Atak fatura ayarları.'}
};

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
  q('#invSetupModBtn')?.classList.toggle('hidden',!state.canSetup);
  q('#invIssueSelectedBtn')?.classList.toggle('hidden',!state.canIssue);
  q('#invRetrySelectedBtn')?.classList.toggle('hidden',!state.canIssue);
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
        q('#gate p').textContent='e-Fatura ekranı yetkiniz kapalı. Yöneticiden “e-Fatura Merkezi” yetkisini açın.';
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
  const dms=settings.atakDms||{};
  if(dms.enabled===false){el.textContent='Servis Kapalı';el.className='inv-env off';return}
  el.textContent='ATAK';el.className='inv-env';
}
function invoicePrintUrl(row,view){
  if(view==='pending_sales')return `/web-api/admin/sale/${encodeURIComponent(row.id)}/invoice-print`;
  return `/web-api/admin/invoice-queue/${encodeURIComponent(row.id)}/print`;
}
function openInvoiceDoc(row,view){
  const w=window.open(invoicePrintUrl(row,view),'_blank','noopener');
  if(!w)toast('Tarayıcı yeni sekmeyi engelledi');
}
function bindRowOpen(rows,view){
  qa('#invTableBody tr[data-inv-id]').forEach(tr=>{
    tr.classList.add('clickable');
    tr.addEventListener('click',e=>{
      if(e.target.closest('button,input,a,label'))return;
      const row=rows.find(x=>String(x.id||x.uuid||'')===String(tr.dataset.invId));
      if(row)openInvoiceDoc(row,view);
    });
  });
  qa('[data-inv-print]').forEach(btn=>btn.onclick=e=>{
    e.stopPropagation();
    const row=rows.find(x=>String(x.id||x.uuid||'')===String(btn.dataset.invPrint));
    if(row)openInvoiceDoc(row,view);
  });
}

function invRenderSetup(checks=[]){
  q('#invTableWrap')?.classList.add('hidden');
  q('#invToolbar')?.classList.add('hidden');
  q('#invSetupBox')?.classList.remove('hidden');
  loadInvoiceIntegration().catch(()=>{});
  if(q('#invReadyChecks')){
    q('#invReadyChecks').innerHTML=(checks||[]).map(c=>`<div class="inv-check ${c.ok?'ok':'bad'}"><b>${c.ok?'✓':'✕'} ${invEsc(c.name)}</b><span>${invEsc(c.detail||'')}</span></div>`).join('')||'<div class="inv-empty">Test çalıştırılmadı — “Altyapıyı Test Et”e basın</div>';
  }
  q('#invFootCount').textContent=(checks||[]).length?`${(checks||[]).filter(c=>c.ok).length}/${(checks||[]).length} hazır`:'Kurulum';
}
function invRenderTable(rows){
  q('#invSetupBox')?.classList.add('hidden');
  q('#invTableWrap')?.classList.remove('hidden');
  q('#invToolbar')?.classList.remove('hidden');
  const view=state.view;
  const head=q('#invTableHead'),body=q('#invTableBody'),empty=q('#invEmpty');
  const issueBtns=state.canIssue;
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
        ${issueBtns?`<button type="button" class="inv-btn" data-inv-qnb="${invEsc(r.id)}">Kuyruğa al</button>
        <button type="button" class="inv-btn" data-mark-invoiced="${invEsc(r.id)}">Manuel Kes</button>`:''}
        <button type="button" class="inv-btn" data-inv-print="${invEsc(r.id)}">Belgeyi aç</button>
      </td>
    </tr>`).join('');
    empty?.classList.toggle('hidden',rows.length>0);
    q('#invFootCount').textContent=`${rows.length} kesilmeyen`;
    state.selected=new Set();
    qa('[data-inv-check]').forEach(chk=>chk.onchange=()=>{
      const id=chk.dataset.invCheck;
      if(chk.checked)state.selected.add(id);else state.selected.delete(id);
      chk.closest('tr')?.classList.toggle('selected',chk.checked);
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
    bindRowOpen(rows,view);
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
      <td style="display:flex;gap:6px;flex-wrap:wrap">
        ${issueBtns?`<button type="button" class="inv-btn" data-inv-retry="${invEsc(r.id)}">Tekrar</button>`:''}
        ${r.ublXml?`<button type="button" class="inv-btn" data-inv-ubl="${invEsc(r.id)}">UBL</button>`:''}
        <button type="button" class="inv-btn" data-inv-print="${invEsc(r.id)}">Belgeyi aç</button>
      </td>
    </tr>`).join('');
  }
  empty?.classList.toggle('hidden',rows.length>0);
  q('#invFootCount').textContent=`${rows.length} kayıt`;
  state.selected=new Set();
  qa('[data-inv-check]').forEach(chk=>chk.onchange=()=>{
    const id=chk.dataset.invCheck;
    if(chk.checked)state.selected.add(id);else state.selected.delete(id);
    chk.closest('tr')?.classList.toggle('selected',chk.checked);
  });
  qa('[data-inv-retry]').forEach(btn=>btn.onclick=async()=>{
    try{await api('/web-api/admin/invoice-queue/'+encodeURIComponent(btn.dataset.invRetry)+'/retry',{method:'POST',body:'{}'});toast('Tekrar denendi');await loadInvoiceCenter()}catch(e){toast(e.message)}
  });
  qa('[data-inv-ubl]').forEach(btn=>btn.onclick=()=>{
    const row=(state.data?.queue||[]).find(x=>String(x.id)===String(btn.dataset.invUbl));
    if(!row?.ublXml)return toast('UBL yok');
    const w=window.open('','_blank');if(!w)return toast('Popup engellendi');
    w.document.write(`<pre style="white-space:pre-wrap;font:12px/1.4 monospace;padding:16px">${invEsc(row.ublXml)}</pre>`);
  });
  bindRowOpen(rows,view);
}
function invSetModule(mod,{keepView=false}={}){
  if(mod==='setup'&&!state.canSetup){toast('Kurulum yetkiniz yok');return}
  state.module=mod;
  qa('[data-inv-module]').forEach(b=>b.classList.toggle('active',b.dataset.invModule===mod));
  qa('[data-inv-pane]').forEach(p=>p.classList.toggle('active',p.dataset.invPane===mod));
  if(!keepView){
    if(mod==='efatura')state.view='ef_out_pending';
    else if(mod==='earsiv')state.view='ea_out_pending';
    else if(mod==='pending')state.view='pending_sales';
    else state.view='setup_settings';
  }
  invPaintCurrentView();
}
function invPaintCurrentView(){
  const view=state.view;
  const meta=INV_VIEW_META[view]||{title:view,hint:''};
  if(q('#invViewTitle'))q('#invViewTitle').textContent=meta.title;
  if(q('#invViewHint'))q('#invViewHint').textContent=meta.hint;
  qa('[data-inv-view]').forEach(b=>b.classList.toggle('active',b.dataset.invView===view));
  if(q('#invDocTypeFilter')){
    q('#invDocTypeFilter').value=view.startsWith('ea_')?'earsiv':(view.startsWith('ef_')?'efatura':'all');
    q('#invDocTypeFilter').style.display='none';
  }
  if(view==='setup_settings'||view==='setup_ready'){
    if(!state.canSetup){invSetModule('efatura');return}
    invRenderSetup([]);
    q('#invFootStatus').textContent=view==='setup_ready'?'Hazırlık kontrolü':'Firma ve servis';
    if(view==='setup_ready')invoiceConnectionTestForCenter();
    else setTimeout(()=>q('#invoiceIntegrationForm')?.scrollIntoView({behavior:'smooth',block:'start'}),40);
    return;
  }
  const d=state.data||{};
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
    const r=await api('/web-api/admin/invoice-integration/test',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    invRenderSetup(r.checks||[]);
    q('#invFootStatus').textContent=r.note||'Altyapı testi tamam';
  }catch(e){invRenderSetup([{name:'Test',ok:false,detail:e.message}]);}
}
async function loadInvoiceCenter(){
  try{
    const d=await api('/web-api/admin/invoice-center');
    state.data=d;
    if(d.canSetup!=null)state.canSetup=!!d.canSetup;
    if(d.canIssue!=null)state.canIssue=!!d.canIssue;
    applyAccessUi();
    invSetCounts(d.counts||{});
    invUpdateEnvBadge(d.settings||{});
    invPaintCurrentView();
  }catch(e){
    if(q('#invFootStatus'))q('#invFootStatus').textContent=e.message;
    toast(e.message);
  }
}
function invSetView(view){
  if(view.startsWith('setup')&&!state.canSetup){toast('Kurulum yetkiniz yok');return}
  state.view=view;
  if(view.startsWith('ef_'))state.module='efatura';
  else if(view.startsWith('ea_'))state.module='earsiv';
  else if(view==='pending_sales')state.module='pending';
  else if(view.startsWith('setup'))state.module='setup';
  qa('[data-inv-module]').forEach(b=>b.classList.toggle('active',b.dataset.invModule===state.module));
  qa('[data-inv-pane]').forEach(p=>p.classList.toggle('active',p.dataset.invPane===state.module));
  const folderKey=view.startsWith('ef_out')?'ef_out':view.startsWith('ef_in')?'ef_in':view.startsWith('ea_out')?'ea_out':view.startsWith('ea_in')?'ea_in':view==='pending_sales'?'pending':view.startsWith('setup')?'setup':'';
  if(folderKey){const f=q(`[data-inv-folder="${folderKey}"]`);f?.classList.add('open');const t=f?.querySelector('[data-inv-toggle] span:last-child');if(t)t.textContent='▾'}
  invPaintCurrentView();
}

function gibSeriesPreview(series,next){
  const ser=String(series||'').toUpperCase().replace(/[^A-Z]/g,'').slice(0,3)||'???';
  const seq=Math.max(1,Math.min(999999999,Math.round(Number(next)||1)));
  return `${ser}${new Date().getFullYear()}${String(seq).padStart(9,'0')}`;
}
function refreshInvoiceSeriesPreview(){
  if(q('#invoiceEfaturaPreview'))q('#invoiceEfaturaPreview').textContent='Önizleme: '+gibSeriesPreview(q('#invoiceEfaturaSeries')?.value||'ATK',q('#invoiceEfaturaNext')?.value||1);
  if(q('#invoiceEarsivPreview'))q('#invoiceEarsivPreview').textContent='Önizleme: '+gibSeriesPreview(q('#invoiceEarsivSeries')?.value||'ATA',q('#invoiceEarsivNext')?.value||1);
}
function setVal(id,v){const el=q('#'+id);if(el)el.value=v??''}
function fillAtakDms(s){
  const d=s.atakDms||{};
  setVal('atakDmsClientId',d.clientId||'');
  setVal('atakDmsSecret',d.clientSecret||'');
  setVal('atakDmsDealerId',d.dealerId||'');
  setVal('atakDmsCode',d.eInvoiceCode||'');
  setVal('atakDmsSystemId',d.systemId||'1');
  if(q('#atakDmsEnabled'))q('#atakDmsEnabled').checked=d.enabled!==false;
  if(q('#atakDmsIncludeInbox'))q('#atakDmsIncludeInbox').checked=false;
  setVal('atakDmsAllowedIps',d.allowedIps||'');
  setVal('atakDmsCopyUrl',d.copyUrl||'');
}
function atakDmsPayload(extra){
  return Object.assign({
    atakDmsEnabled:!!q('#atakDmsEnabled')?.checked,
    atakDmsIncludeInbox:!!q('#atakDmsIncludeInbox')?.checked,
    atakDmsDealerId:q('#atakDmsDealerId')?.value||'',
    atakDmsCode:q('#atakDmsCode')?.value||'',
    atakDmsSystemId:q('#atakDmsSystemId')?.value||'1',
    atakDmsClientId:q('#atakDmsClientId')?.value||'',
    atakDmsSecret:q('#atakDmsSecret')?.value||'',
    atakDmsAllowedIps:q('#atakDmsAllowedIps')?.value||''
  },extra||{});
}
async function loadInvoiceIntegration(){
  try{
    const d=await api('/web-api/admin/invoice-integration'),s=d.settings||{};
    if(q('#invoiceProvider'))q('#invoiceProvider').value=s.provider||'qnb-solist';
    setVal('invoiceEnvironment',s.environment||'test');
    setVal('invoiceCompanyVkn',s.companyVkn||'');
    setVal('invoiceCompanyTitle',s.companyTitle||'');
    setVal('invoiceCompanyTaxOffice',s.companyTaxOffice||'');
    setVal('invoiceMersisNo',s.mersisNo||'');
    setVal('invoiceCompanyPhone',s.companyPhone||'');
    setVal('invoiceCompanyEmail',s.companyEmail||'');
    setVal('invoiceCompanyAddress',s.companyAddress||'');
    setVal('invoiceCompanyDistrict',s.companyDistrict||'');
    setVal('invoiceCompanyCity',s.companyCity||'');
    if(q('#invoiceEfaturaSeries'))q('#invoiceEfaturaSeries').value=(s.efaturaSeries||'ATK').toUpperCase();
    if(q('#invoiceEarsivSeries'))q('#invoiceEarsivSeries').value=(s.earsivSeries||'ATA').toUpperCase();
    if(q('#invoiceEfaturaNext'))q('#invoiceEfaturaNext').value=s.efaturaNext||1;
    if(q('#invoiceEarsivNext'))q('#invoiceEarsivNext').value=s.earsivNext||1;
    setVal('invoiceSenderAlias',s.senderAlias||s.gbAlias||'');
    setVal('invoicePkAlias',s.pkAlias||'');
    setVal('invoiceServiceUrl',s.webServiceUrl||'');
    setVal('invoiceUsername',s.username||'');
    setVal('invoicePassword',s.password||'');
    if(q('#invoiceEnabled'))q('#invoiceEnabled').checked=!!s.enabled;
    if(q('#invoiceDraftMode'))q('#invoiceDraftMode').checked=s.draftMode!==false;
    if(q('#invoiceAutoDetect'))q('#invoiceAutoDetect').checked=s.autoDetectType!==false;
    const rz=s.rapid360||{};
    setVal('rapid360Url',rz.url||'');
    setVal('rapid360ClientId',rz.clientId||'');
    setVal('rapid360Secret',rz.clientSecret||'');
    setVal('rapid360DealerId',rz.dealerId||'');
    setVal('rapid360Code',rz.eInvoiceCode||'');
    setVal('rapid360SystemId',rz.systemId||'1');
    if(q('#rapid360AddReturns'))q('#rapid360AddReturns').checked=rz.addReturns!==false;
    fillAtakDms(s);
    refreshInvoiceSeriesPreview();
  }catch(e){toast(e.message)}
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
  const ids=[...state.selected];
  if(!ids.length)return toast('Önce satır seçin');
  for(const id of ids){
    try{await api('/web-api/admin/invoice-queue/'+encodeURIComponent(id)+'/retry',{method:'POST',body:'{}'})}catch(_){}
  }
  toast(`${ids.length} kayıt tekrar denendi`);
  await loadInvoiceCenter();
});
q('#invIssueSelectedBtn')?.addEventListener('click',async()=>{
  if(!state.canIssue)return toast('Fatura kesme yetkiniz yok');
  const ids=[...state.selected];
  if(!ids.length)return toast('Önce satır seçin');
  if(state.view==='pending_sales'){
    for(const id of ids){
      try{await api('/web-api/admin/sale/'+encodeURIComponent(id)+'/issue-invoice',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})}catch(_){}
    }
    toast(`${ids.length} satış kuyruğa alındı`);
  }else{
    for(const id of ids){
      try{await api('/web-api/admin/invoice-queue/'+encodeURIComponent(id)+'/retry',{method:'POST',body:'{}'})}catch(_){}
    }
    toast(`${ids.length} fatura işlendi`);
  }
  await loadInvoiceCenter();
});
q('#invRunReadyTestBtn')?.addEventListener('click',()=>invoiceConnectionTestForCenter());
['invoiceEfaturaSeries','invoiceEarsivSeries','invoiceEfaturaNext','invoiceEarsivNext'].forEach(id=>{
  q('#'+id)?.addEventListener('input',refreshInvoiceSeriesPreview);
});
q('#invoiceIntegrationForm')?.addEventListener('submit',async e=>{
  e.preventDefault();
  if(!state.canSetup)return toast('Kurulum yetkiniz yok');
  const st=q('#invoiceIntegrationStatus');
  try{
    await api('/web-api/admin/invoice-integration',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      provider:q('#invoiceProvider')?.value||'qnb-solist',
      environment:'live',
      companyVkn:q('#invoiceCompanyVkn').value,
      companyTitle:q('#invoiceCompanyTitle').value,
      companyTaxOffice:q('#invoiceCompanyTaxOffice')?.value||'',
      mersisNo:q('#invoiceMersisNo')?.value||'',
      companyPhone:q('#invoiceCompanyPhone')?.value||'',
      companyEmail:q('#invoiceCompanyEmail')?.value||'',
      companyAddress:q('#invoiceCompanyAddress')?.value||'',
      companyDistrict:q('#invoiceCompanyDistrict')?.value||'',
      companyCity:q('#invoiceCompanyCity')?.value||'',
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
      enabled:true,
      draftMode:q('#invoiceDraftMode')?.checked!==false,
      autoDetectType:q('#invoiceAutoDetect')?.checked!==false,
      rapid360Url:q('#rapid360Url')?.value||'',
      rapid360ClientId:q('#rapid360ClientId')?.value||'',
      rapid360Secret:q('#rapid360Secret')?.value||'',
      rapid360DealerId:q('#rapid360DealerId')?.value||'',
      rapid360Code:q('#rapid360Code')?.value||'',
      rapid360SystemId:q('#rapid360SystemId')?.value||'1',
      rapid360AddReturns:!!q('#rapid360AddReturns')?.checked,
      ...atakDmsPayload()
    })});
    st.textContent='Atak fatura ayarları kaydedildi.';
    st.className='form-status success';
    await loadInvoiceIntegration();
    invoiceConnectionTestForCenter();
    await loadInvoiceCenter();
  }catch(err){st.textContent=err.message;st.className='form-status error'}
});
q('#invoiceConnectionTestBtn')?.addEventListener('click',async()=>{
  const box=q('#invoiceConnectionTestResult');
  box.innerHTML='<p>Kontrol ediliyor…</p>';
  try{
    const r=await api('/web-api/admin/invoice-integration/test',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    box.innerHTML=(r.checks||[]).map(c=>`<div class="self-test-row ${c.ok?'ok':'bad'}"><b>${c.ok?'✓':'✕'} ${c.name}</b><small>${c.detail}</small></div>`).join('')+`<div class="self-test-row"><small>${r.note||''}</small></div>`;
  }catch(e){box.innerHTML=`<div class="self-test-row bad"><b>Test çalışmadı</b><small>${e.message}</small></div>`}
});
q('#atakDmsCopyBtn')?.addEventListener('click',async()=>{
  const url=String(q('#atakDmsCopyUrl')?.value||'').trim();
  if(!url || url.indexOf('client_id=')<0 || url.indexOf('client_secret=')<0)return toast('Hazır URL tam değil, sayfayı yenileyin');
  try{
    await navigator.clipboard.writeText(url);
    toast('Tam geteinvoices URL kopyalandı');
  }catch(_){
    q('#atakDmsCopyUrl')?.select();
    try{document.execCommand('copy');toast('Tam geteinvoices URL kopyalandı')}catch(e){toast('Kopyalanamadı, metni elle alın')}
  }
});
q('#atakDmsRotateBtn')?.addEventListener('click',async()=>{
  if(!state.canSetup)return toast('Kurulum yetkiniz yok');
  if(!confirm('Yeni client_id / client_secret üretilecek. E-fatura firmasına yeni URL vermeniz gerekir.'))return;
  const st=q('#invoiceIntegrationStatus');
  try{
    await api('/web-api/admin/invoice-integration/atak-dms-rotate',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    toast('Atak geteinvoices anahtarları yenilendi');
    if(st){st.textContent='Atak geteinvoices anahtarları yenilendi. Yeni URL’yi firmaya verin.';st.className='form-status success'}
    await loadInvoiceIntegration();
  }catch(e){toast(e.message);if(st){st.textContent=e.message;st.className='form-status error'}}
});

boot();
