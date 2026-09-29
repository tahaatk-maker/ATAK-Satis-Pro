'use strict';

const {formatInvoicePaymentNote}=require('./invoice-payment-note');

function esc(v){
  return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function money(n){
  return new Intl.NumberFormat('tr-TR',{style:'currency',currency:'TRY',minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(n||0));
}
function onlyDigits(v){return String(v||'').replace(/\D/g,'')}
function isEarsiv(docType){
  return String(docType||'').toLowerCase()==='earsiv';
}

function lineAmounts(item){
  const qty=Number(item.quantity||1)||1;
  const unit=Number(item.unitPrice||item.price||0)||0;
  const gross=Math.round(qty*unit*100)/100;
  const vatRate=Number(item.vatRate!=null?item.vatRate:20)||0;
  const net=vatRate>0?Math.round((gross/(1+vatRate/100))*100)/100:gross;
  const vat=Math.round((gross-net)*100)/100;
  return{qty,unit,gross,net,vat,vatRate};
}

function buildInvoicePrintHtml({company={},customer={},record={},sale={},settings={}}={}){
  const docType=record.docType||sale.invoiceType||record.invoiceType||'efatura';
  const earsiv=isEarsiv(docType);
  const title=earsiv?'e-ARŞİV FATURA':'e-FATURA';
  const invoiceNumber=record.invoiceNumber||sale.invoiceNumber||record.reference||sale.reference||'—';
  const invoiceDate=(record.invoiceDate||sale.invoiceDate||sale.date||'').slice(0,10)||'—';
  const uuid=record.uuid||sale.uuid||'';
  const status=record.status||sale.invoiceStatus||'pending';
  const items=Array.isArray(record.items)&&record.items.length?record.items:(Array.isArray(sale.items)?sale.items:[]);
  const lines=items.map(lineAmounts);
  const sumGross=lines.reduce((a,x)=>a+x.gross,0);
  const sumNet=lines.reduce((a,x)=>a+x.net,0);
  const sumVat=lines.reduce((a,x)=>a+x.vat,0);
  const payable=Number(record.total||sale.total||sumGross)||sumGross;
  const paymentNote=formatInvoicePaymentNote({
    ...record,
    ...sale,
    payments:Array.isArray(sale.payments)&&sale.payments.length?sale.payments:record.payments,
    promissory:sale.promissory||record.promissory,
    paymentNote:record.paymentNote||sale.paymentNote
  });
  const sellerName=company.companyTitle||settings.siteName||'ATAK EV GEREÇLERİ PAZ. TİC. LTD. ŞTİ.';
  const buyerName=customer.companyName||customer.name||record.customer?.name||'—';
  const buyer=record.customer&&typeof record.customer==='object'?{...customer,...record.customer}:customer;
  const statusLabel={pending:'Taslak / kesilmedi',ready:'Hazır',queued:'Kuyrukta',draft_sent:'Taslak gönderildi',queued_remote:'Portal kuyruk',issued:'Kesildi',error:'Hatalı',cancelled:'İptal'}[status]||status;
  const rows=lines.map((l,i)=>{
    const it=items[i]||{};
    return `<tr>
      <td>${i+1}</td>
      <td><b>${esc(it.productName||it.materialCode||it.productCode||'Ürün')}</b><div class="muted">${esc(it.itemCode||it.productCode||'')}</div></td>
      <td class="num">${l.qty}</td>
      <td class="num">${money(l.unit)}</td>
      <td class="num">%${l.vatRate}</td>
      <td class="num">${money(l.net)}</td>
      <td class="num">${money(l.vat)}</td>
      <td class="num"><b>${money(l.gross)}</b></td>
    </tr>`;
  }).join('')||`<tr><td colspan="8" class="empty">Kalem yok</td></tr>`;

  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(title)} · ${esc(invoiceNumber)}</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#e8eef5;color:#122033;font:13px/1.45 "Segoe UI",Arial,sans-serif}
.paper{max-width:210mm;margin:18px auto;background:#fff;padding:16mm 14mm 12mm;box-shadow:0 18px 50px rgba(15,35,60,.16)}
.top{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;border-bottom:3px solid #0b2a4a;padding-bottom:12px}
.brand small{letter-spacing:.14em;font-weight:800;color:#5b6d86;font-size:10px}
.brand h1{margin:4px 0 0;font-size:22px;letter-spacing:.04em;color:#0b2a4a}
.meta{text-align:right;font-size:12px}
.meta b{display:block;font-size:18px;color:#0b2a4a;margin-bottom:4px}
.badge{display:inline-block;margin-top:6px;padding:3px 8px;border-radius:999px;font-size:10px;font-weight:800;background:#eef4fb;color:#1d4ed8}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:14px 0}
.box{border:1px solid #d5e0ee;border-radius:8px;padding:10px 12px;min-height:118px}
.box h2{margin:0 0 8px;font-size:10px;letter-spacing:.12em;color:#5b6d86}
.box b{display:block;font-size:14px}
table{width:100%;border-collapse:collapse;margin-top:8px}
th{background:#0b2a4a;color:#fff;font-size:11px;text-align:left;padding:8px}
td{border-bottom:1px solid #e6edf5;padding:8px;vertical-align:top}
.num{text-align:right;white-space:nowrap}
.muted{color:#667890;font-size:11px}
.totals{margin-top:12px;margin-left:auto;width:320px;border:1px solid #d5e0ee}
.totals div{display:flex;justify-content:space-between;padding:7px 10px;border-bottom:1px solid #eef2f7}
.totals div:last-child{border:0;background:#0b2a4a;color:#fff;font-weight:800}
.pay-note{margin-top:14px;padding:10px 12px;border:1px solid #f0d48a;background:#fff8e8;border-radius:8px;font-size:12px;color:#13233f}
.pay-note b{display:block;font-size:10px;letter-spacing:.12em;color:#5b6d86;margin-bottom:4px}
.foot{margin-top:18px;font-size:11px;color:#5b6d86;border-top:1px solid #d5e0ee;padding-top:10px}
.actions{position:sticky;top:0;background:#0b2a4a;color:#fff;padding:10px 16px;display:flex;justify-content:space-between;align-items:center;z-index:2}
.actions button,.actions a{background:#dda20c;color:#1a1300;border:0;border-radius:8px;padding:8px 14px;font-weight:800;cursor:pointer;text-decoration:none}
@media print{body{background:#fff}.actions{display:none}.paper{margin:0;box-shadow:none;max-width:none}}
</style></head><body>
<div class="actions"><span>${esc(title)} belgesi · ${esc(statusLabel)}</span><span><button type="button" onclick="window.print()">Yazdır</button></span></div>
<div class="paper">
  <div class="top">
    <div class="brand">
      <small>GELİR İDARESİ BAŞKANLIĞI UYUMLU BELGE ÖNİZLEME</small>
      <h1>${esc(title)}</h1>
      <div class="muted">Satış faturası · TRY</div>
    </div>
    <div class="meta">
      <b>${esc(invoiceNumber)}</b>
      <div>Tarih: ${esc(invoiceDate)}</div>
      <div>ETTN: ${esc(uuid||'henüz üretilmedi')}</div>
      <span class="badge">${esc(statusLabel)}</span>
    </div>
  </div>
  <div class="grid">
    <div class="box">
      <h2>SATICI</h2>
      <b>${esc(sellerName)}</b>
      <div>VKN: ${esc(company.companyVkn||'')}</div>
      <div>Vergi dairesi: ${esc(company.companyTaxOffice||'')}</div>
      <div>${esc(company.companyAddress||settings.address||'')}</div>
      <div>${esc([company.companyDistrict,company.companyCity].filter(Boolean).join(' / '))}</div>
      <div>${esc(company.companyPhone||settings.phone||'')} ${esc(company.companyEmail||settings.email||'')}</div>
    </div>
    <div class="box">
      <h2>ALICI</h2>
      <b>${esc(buyerName)}</b>
      <div>${onlyDigits(buyer.taxNumber||buyer.taxNo||buyer.tckn).length===11?'TCKN':'VKN'}: ${esc(buyer.taxNumber||buyer.taxNo||buyer.tckn||'—')}</div>
      <div>Vergi dairesi: ${esc(buyer.taxOffice||'—')}</div>
      <div>${esc(buyer.address||'—')}</div>
      <div>${esc([buyer.district,buyer.city].filter(Boolean).join(' / ')||'')}</div>
      <div>${esc(buyer.phone||'')} ${esc(buyer.email||'')}</div>
    </div>
  </div>
  <table>
    <thead><tr><th>#</th><th>Mal / Hizmet</th><th class="num">Adet</th><th class="num">Birim</th><th class="num">KDV</th><th class="num">Matrah</th><th class="num">KDV</th><th class="num">KDV Dahil</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="totals">
    <div><span>Mal hizmet toplamı</span><span>${money(sumNet)}</span></div>
    <div><span>Hesaplanan KDV</span><span>${money(sumVat)}</span></div>
    <div><span>Ödenecek tutar</span><span>${money(payable)}</span></div>
  </div>
  ${paymentNote?`<div class="pay-note"><b>FATURA NOTU</b>${esc(paymentNote)}</div>`:''}
  <div class="foot">
    ${earsiv
      ? 'Bu belgenin aslı elektronik ortamda e-Arşiv Fatura olarak saklanır. 433 sıra no.lu VUK Genel Tebliği kapsamında düzenlenmiştir. Mali mühür / imza QNB bağlantısı tamamlanınca eklenir.'
      : 'Bu belgenin aslı elektronik ortamda e-Fatura olarak saklanır. 397 sıra no.lu VUK Genel Tebliği kapsamında düzenlenmiştir. GİB’e iletim QNB Solist / eFinans bağlantısı tamamlanınca yapılır.'}
    <br/>Satış no: ${esc(record.reference||sale.reference||'—')} · Senet / sözleşme belgesi değildir.
  </div>
</div>
</body></html>`;
}

module.exports={buildInvoicePrintHtml,lineAmounts,esc,money};
