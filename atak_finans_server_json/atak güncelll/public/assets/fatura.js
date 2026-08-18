/* ATAK_FATURA_BUILD=fix-v153 */
const q=(s,r=document)=>r.querySelector(s);
const qa=(s,r=document)=>[...r.querySelectorAll(s)];
let state={view:'pending',data:null,selected:new Set(),step:1};

function toast(t){const el=q('#toast');el.textContent=t;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),2600)}
function money(n){return new Intl.NumberFormat('tr-TR',{style:'currency',currency:'TRY',maximumFractionDigits:2}).format(Number(n||0))}
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function badge(st){
  const s=String(st||'pending');
  const label={pending:'Bekliyor',ready:'Hazır',queued:'Kuyruk',draft_sent:'Taslak',queued_remote:'Portal',issued:'Kesildi',error:'Hatalı',cancelled:'İptal',not_required:'Yok'}[s]||s;
  return `<span class="badge ${esc(s)}">${esc(label)}</span>`;
}
async function api(url,opt={}){
  const r=await fetch(url,{credentials:'same-origin',...opt});
  const text=await r.text();
  let d={};try{d=JSON.parse(text||'{}')}catch(_){d={}}
  if(r.status===401)throw new Error('Oturum yok');
  if(!r.ok)throw new Error(d.error||'İşlem başarısız');
  return d;
}

async function boot(){
  try{
    const me=await api('/web-api/me');
    if(!me.authenticated){q('#gate').classList.remove('hidden');return}
    q('#app').classList.remove('hidden');
    q('#app').style.display='flex';
    await load();
  }catch(_){
    q('#gate').classList.remove('hidden');
  }
}

async function load(){
  const d=await api('/web-api/admin/invoice-center');
  state.data=d;
  paintEnv(d.settings||{});
  q('#cPending').textContent=`${d.counts?.sales_pending||0} satış bekliyor`;
  q('#cQueue').textContent=`${(d.counts?.ef_out_pending||0)+(d.counts?.ea_out_pending||0)} gönderilecek`;
  paint();
}

function paintEnv(s){
  const el=q('#envBadge');
  if(!s.enabled){el.textContent='Bağlantı kapalı — önce Firma kurulumu';el.className='env off';return}
  if(s.environment==='live'){el.textContent='Canlı ortam';el.className='env live';return}
  el.textContent='Test ortamı';el.className='env';
}

function currentRows(){
  const d=state.data||{};
  const term=String(q('#search')?.value||'').toLocaleLowerCase('tr-TR').trim();
  let rows=[];
  if(state.view==='pending')rows=d.salesPending||[];
  else if(state.view==='sent')rows=(d.queue||[]).filter(r=>['issued','draft_sent','queued_remote','queued'].includes(String(r.status||'')));
  else rows=(d.queue||[]).filter(r=>['pending','ready','error','queued'].includes(String(r.status||'pending')));
  return rows.filter(r=>{
    if(!term)return true;
    const hay=`${r.invoiceNumber||''} ${r.reference||''} ${r.customerName||r.customer?.name||''}`.toLocaleLowerCase('tr-TR');
    return hay.includes(term);
  });
}

function invoiceUrl(row){
  if(state.view==='pending')return `/web-api/admin/sale/${encodeURIComponent(row.id)}/invoice-print`;
  return `/web-api/admin/invoice-queue/${encodeURIComponent(row.id)}/print`;
}
function openInvoice(row){
  const w=window.open(invoiceUrl(row),'_blank','noopener');
  if(!w)toast('Tarayıcı yeni sekmeyi engelledi');
}

function paint(){
  const setup=state.view==='setup';
  q('#setupBox').classList.toggle('hidden',!setup);
  q('#tablePanel').classList.toggle('hidden',setup);
  q('#toolbar').classList.toggle('hidden',setup);
  const titles={
    pending:['Kesilmeyen faturalar','Satış yapıldı, fatura henüz kesilmedi. Satıra tıklayınca belge yeni sekmede açılır.'],
    queue:['Giden kutu','QNB kuyruğundaki taslaklar. Satıra tıklayınca e-Fatura / e-Arşiv belgesi açılır.'],
    sent:['Kesilen / gönderilen','Portal veya taslak olarak işlenmiş faturalar.'],
    setup:['Firma kurulumu','Başka firmalar da aynı adımlarla kendi VKN, seri ve QNB bilgilerini girer.']
  };
  const t=titles[state.view];
  q('#viewTitle').textContent=t[0];
  q('#viewHint').textContent=t[1];
  qa('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===state.view));
  if(setup){loadSetup();return}
  const rows=currentRows();
  const pending=state.view==='pending';
  q('#thead').innerHTML=pending
    ?`<tr><th></th><th>Satış</th><th>Tarih</th><th>Müşteri</th><th>Tutar</th><th>Durum</th><th></th></tr>`
    :`<tr><th></th><th>Durum</th><th>Fatura no</th><th>Tarih</th><th>Müşteri</th><th>Tip</th><th>Tutar</th><th></th></tr>`;
  q('#tbody').innerHTML=rows.map(r=>{
    const id=esc(r.id);
    if(pending){
      return `<tr class="clickable" data-open="${id}">
        <td><input type="checkbox" data-check="${id}"/></td>
        <td><b>${esc(r.reference||'-')}</b></td>
        <td>${esc(r.date||'-')}</td>
        <td>${esc(r.customerName||'-')}</td>
        <td>${money(r.total)}</td>
        <td>${badge(r.invoiceStatus)}</td>
        <td><button type="button" class="btn light" data-open-btn="${id}">Belgeyi aç</button></td>
      </tr>`;
    }
    return `<tr class="clickable" data-open="${id}">
      <td><input type="checkbox" data-check="${id}"/></td>
      <td>${badge(r.status)}</td>
      <td><b>${esc(r.invoiceNumber||r.reference||'-')}</b></td>
      <td>${esc((r.invoiceDate||r.createdAt||'').slice(0,10)||'-')}</td>
      <td>${esc(r.customer?.name||r.customerName||'-')}</td>
      <td>${esc(r.docType||r.invoiceType||'auto')}</td>
      <td>${money(r.total)}</td>
      <td><button type="button" class="btn light" data-open-btn="${id}">Belgeyi aç</button></td>
    </tr>`;
  }).join('');
  q('#empty').classList.toggle('hidden',rows.length>0);
  state.selected=new Set();
  qa('[data-check]').forEach(chk=>chk.onclick=e=>e.stopPropagation());
  qa('tr[data-open]').forEach(tr=>tr.onclick=()=>{
    const id=tr.dataset.open;
    const row=rows.find(x=>String(x.id)===String(id));
    if(row)openInvoice(row);
  });
  qa('[data-open-btn]').forEach(btn=>btn.onclick=e=>{
    e.stopPropagation();
    const row=rows.find(x=>String(x.id)===String(btn.dataset.openBtn));
    if(row)openInvoice(row);
  });
}

function formVal(name){return q(`[name="${name}"]`)?.value||''}
function setForm(name,v){const el=q(`[name="${name}"]`);if(el)el.value=v??''}
function setCheck(name,v){const el=q(`[name="${name}"]`);if(el)el.checked=!!v}

async function loadSetup(){
  try{
    const r=await api('/web-api/admin/invoice-integration');
    const s=r.settings||{};
    setForm('companyTitle',s.companyTitle);
    setForm('companyVkn',s.companyVkn);
    setForm('companyTaxOffice',s.companyTaxOffice);
    setForm('mersisNo',s.mersisNo);
    setForm('companyPhone',s.companyPhone);
    setForm('companyEmail',s.companyEmail);
    setForm('companyAddress',s.companyAddress);
    setForm('companyDistrict',s.companyDistrict);
    setForm('companyCity',s.companyCity);
    setForm('efaturaSeries',s.efaturaSeries||'ATK');
    setForm('efaturaNext',s.efaturaNext||1);
    setForm('earsivSeries',s.earsivSeries||'ATA');
    setForm('earsivNext',s.earsivNext||1);
    setForm('provider',s.provider||'qnb-solist');
    setForm('senderAlias',s.senderAlias||s.gbAlias);
    setForm('pkAlias',s.pkAlias);
    setForm('webServiceUrl',s.webServiceUrl);
    setForm('username',s.username);
    setForm('password','');
    setForm('environment',s.environment||'test');
    setCheck('enabled',s.enabled);
    setCheck('draftMode',s.draftMode!==false);
    setCheck('autoDetectType',s.autoDetectType!==false);
    previewSeries();
    renderChecks([]);
  }catch(e){toast(e.message)}
}

function previewSeries(){
  const y=new Date().getFullYear();
  const pad=n=>String(Math.max(1,Number(n)||1)).padStart(9,'0');
  const ef=String(formVal('efaturaSeries')||'ATK').toUpperCase().replace(/[^A-Z]/g,'').slice(0,3)||'ATK';
  const ea=String(formVal('earsivSeries')||'ATA').toUpperCase().replace(/[^A-Z]/g,'').slice(0,3)||'ATA';
  if(q('#efPrev'))q('#efPrev').textContent=`Önizleme: ${ef}${y}${pad(formVal('efaturaNext'))}`;
  if(q('#eaPrev'))q('#eaPrev').textContent=`Önizleme: ${ea}${y}${pad(formVal('earsivNext'))}`;
}

function showStep(n){
  state.step=Math.min(5,Math.max(1,n));
  qa('[data-step]').forEach(b=>b.classList.toggle('active',Number(b.dataset.step)===state.step));
  qa('[data-step-pane]').forEach(p=>p.classList.toggle('hidden',Number(p.dataset.stepPane)!==state.step));
}

function setupPayload(){
  return{
    companyTitle:formVal('companyTitle'),
    companyVkn:formVal('companyVkn'),
    companyTaxOffice:formVal('companyTaxOffice'),
    mersisNo:formVal('mersisNo'),
    companyPhone:formVal('companyPhone'),
    companyEmail:formVal('companyEmail'),
    companyAddress:formVal('companyAddress'),
    companyDistrict:formVal('companyDistrict'),
    companyCity:formVal('companyCity'),
    efaturaSeries:formVal('efaturaSeries'),
    efaturaNext:formVal('efaturaNext'),
    earsivSeries:formVal('earsivSeries'),
    earsivNext:formVal('earsivNext'),
    provider:formVal('provider'),
    senderAlias:formVal('senderAlias'),
    gbAlias:formVal('senderAlias'),
    pkAlias:formVal('pkAlias'),
    webServiceUrl:formVal('webServiceUrl'),
    username:formVal('username'),
    password:formVal('password')||'********',
    environment:formVal('environment'),
    enabled:q('[name="enabled"]')?.checked===true,
    draftMode:q('[name="draftMode"]')?.checked===true,
    autoDetectType:q('[name="autoDetectType"]')?.checked===true
  };
}

function renderChecks(checks){
  q('#readyChecks').innerHTML=(checks||[]).map(c=>`<div class="checkrow ${c.ok?'ok':'bad'}"><b>${c.ok?'✓':'✕'} ${esc(c.name)}</b><span>${esc(c.detail||'')}</span></div>`).join('')||'<div class="empty">Henüz test edilmedi.</div>';
}

qa('[data-view]').forEach(b=>b.onclick=()=>{state.view=b.dataset.view;paint()});
q('#refreshBtn').onclick=()=>load().catch(e=>toast(e.message));
q('#search').oninput=()=>paint();
q('#prevStep').onclick=()=>showStep(state.step-1);
q('#nextStep').onclick=()=>showStep(state.step+1);
qa('[data-step]').forEach(b=>b.onclick=()=>showStep(Number(b.dataset.step)));
['efaturaSeries','efaturaNext','earsivSeries','earsivNext'].forEach(n=>q(`[name="${n}"]`)?.addEventListener('input',previewSeries));
q('#setupForm').onsubmit=async e=>{
  e.preventDefault();
  const st=q('#setupStatus');
  st.textContent='Kaydediliyor…';
  try{
    await api('/web-api/admin/invoice-integration',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(setupPayload())});
    const test=await api('/web-api/admin/invoice-integration/test',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    renderChecks(test.checks||[]);
    st.textContent=test.ok?'Kurulum kaydedildi. Altyapı hazır.':'Kaydedildi. Kırmızı satırları tamamlayın.';
    toast('Kurulum kaydedildi');
    await load();
  }catch(err){st.textContent=err.message}
};
q('#testBtn').onclick=async()=>{
  try{
    const test=await api('/web-api/admin/invoice-integration/test',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    renderChecks(test.checks||[]);
    q('#setupStatus').textContent=test.note||'Test tamam';
  }catch(e){toast(e.message)}
};
q('#issueSelectedBtn').onclick=async()=>{
  const ids=[...qa('[data-check]:checked')].map(x=>x.dataset.check);
  if(!ids.length)return toast('Önce satır seçin');
  for(const id of ids){
    try{
      if(state.view==='pending')await api('/web-api/admin/sale/'+encodeURIComponent(id)+'/issue-invoice',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
      else await api('/web-api/admin/invoice-queue/'+encodeURIComponent(id)+'/retry',{method:'POST',body:'{}'});
    }catch(_){}
  }
  toast('Seçilenler işlendi');
  await load();
};

boot();
