/**
 * QNB eSolutions / Solist e-Fatura & e-Arşiv adapter (altyapı).
 * Gerçek SOAP gönderimi için QNB’nin vereceği WSDL + kullanıcı bilgileri gerekir.
 * Bu modül: UBL taslağı, tip tespiti, kuyruk durumu ve bağlantı hazırlık kontrolü sağlar.
 */

function escXml(v){
  return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
}
function money2(n){return (Math.round(Number(n||0)*100)/100).toFixed(2)}
function onlyDigits(v){return String(v||'').replace(/\D/g,'')}

function defaultEndpoints(environment){
  // QNB canlı/test WSDL adresleri firmaya özel verilir; placeholder bırakıyoruz.
  if(environment==='live'){
    return {
      einvoiceWsdl:'https://earsivportal.efatura.gov.tr/earsiv-services (QNB WSDL ile değiştirilecek)',
      note:'Canlı WSDL adresi QNB Solist panelinden / teknik ekipten alınır.'
    };
  }
  return {
    einvoiceWsdl:'https://earsivportaltest.efatura.gov.tr (QNB test WSDL ile değiştirilecek)',
    note:'Test WSDL adresi QNB Solist aktivasyonu sonrası verilir.'
  };
}

function detectDocumentType(customer={},cfg={}){
  if(cfg.autoDetectType===false)return cfg.forcedType==='earsiv'?'earsiv':'efatura';
  const tax=onlyDigits(customer.taxNo||customer.taxNumber||customer.vkn||'');
  const tckn=onlyDigits(customer.tckn||'');
  // Kurumsal VKN (10 hane) → e-Fatura adayı; bireysel → e-Arşiv varsayılanı.
  // Gerçek kayıtlı kullanıcı sorgusu QNB SOAP "efaturaKullanicisi" ile yapılacak.
  if(customer.invoiceType==='corporate'||tax.length===10)return 'efatura';
  if(tckn.length===11||tax.length===11)return 'earsiv';
  return 'earsiv';
}

function buildUblInvoiceDraft({sale,customer,cfg,docType}){
  const uuid=sale.uuid||sale.invoiceUuid||'';
  const issueDate=sale.invoiceDate||sale.date||new Date().toISOString().slice(0,10);
  const items=Array.isArray(sale.items)?sale.items:[];
  const lines=items.map((it,idx)=>{
    const qty=Number(it.quantity||1);
    const unit=Number(it.unitPrice||0);
    const line=Math.round(qty*unit*100)/100;
    const vat=Number(it.vatRate!=null?it.vatRate:20);
    return `    <cac:InvoiceLine>
      <cbc:ID>${idx+1}</cbc:ID>
      <cbc:InvoicedQuantity unitCode="C62">${qty}</cbc:InvoicedQuantity>
      <cbc:LineExtensionAmount currencyID="TRY">${money2(line)}</cbc:LineExtensionAmount>
      <cac:Item><cbc:Name>${escXml(it.productName||it.materialCode||it.productCode||'Ürün')}</cbc:Name>
        <cac:SellersItemIdentification><cbc:ID>${escXml(it.itemCode||it.productCode||'')}</cbc:ID></cac:SellersItemIdentification>
      </cac:Item>
      <cac:Price><cbc:PriceAmount currencyID="TRY">${money2(unit)}</cbc:PriceAmount></cac:Price>
      <cac:TaxTotal><cbc:TaxAmount currencyID="TRY">${money2(line*vat/(100+vat))}</cbc:TaxAmount></cac:TaxTotal>
    </cac:InvoiceLine>`;
  }).join('\n');
  const total=money2(sale.total||0);
  const profile=docType==='earsiv'?'EARSIVFATURA':'TEMELFATURA';
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- QNB Solist / eSolutions UBL-TR taslağı · henüz imzalanmamış/gönderilmemiş -->
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>TR1.2</cbc:CustomizationID>
  <cbc:ProfileID>${profile}</cbc:ProfileID>
  <cbc:ID>${escXml(sale.invoiceNumber||sale.reference||'')}</cbc:ID>
  <cbc:UUID>${escXml(uuid)}</cbc:UUID>
  <cbc:IssueDate>${escXml(issueDate)}</cbc:IssueDate>
  <cbc:InvoiceTypeCode>SATIS</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>TRY</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyName><cbc:Name>${escXml(cfg.companyTitle||'Atak Pazarlama')}</cbc:Name></cac:PartyName>
      <cac:PartyTaxScheme><cac:TaxScheme/><cbc:CompanyID>${escXml(cfg.companyVkn||'')}</cbc:CompanyID></cac:PartyTaxScheme>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyName><cbc:Name>${escXml(customer.companyName||customer.name||'')}</cbc:Name></cac:PartyName>
      <cac:PartyTaxScheme><cac:TaxScheme/><cbc:CompanyID>${escXml(customer.taxNumber||customer.taxNo||customer.tckn||'')}</cbc:CompanyID></cac:PartyTaxScheme>
      <cac:Contact>
        <cbc:Telephone>${escXml(customer.phone||'')}</cbc:Telephone>
        <cbc:ElectronicMail>${escXml(customer.email||'')}</cbc:ElectronicMail>
      </cac:Contact>
      <cac:PostalAddress>
        <cbc:StreetName>${escXml(customer.address||'')}</cbc:StreetName>
        <cbc:CityName>${escXml(customer.city||'')}</cbc:CityName>
        <cbc:CitySubdivisionName>${escXml(customer.district||'')}</cbc:CitySubdivisionName>
      </cac:PostalAddress>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="TRY">${total}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="TRY">${total}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="TRY">${total}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="TRY">${total}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
${lines}
</Invoice>
`;
}

function readinessChecks(cfg={}){
  const ep=defaultEndpoints(cfg.environment||'test');
  return [
    {name:'Sağlayıcı',ok:['qnb-efinans','qnb-esolutions','qnb-solist'].includes(String(cfg.provider||'')),detail:cfg.provider||'-'},
    {name:'Ortam',ok:['test','live'].includes(String(cfg.environment||'')),detail:cfg.environment||'-'},
    {name:'Firma VKN',ok:onlyDigits(cfg.companyVkn).length>=10,detail:cfg.companyVkn||'QNB’den / mali mühür VKN'},
    {name:'Firma ünvanı',ok:!!String(cfg.companyTitle||'').trim(),detail:cfg.companyTitle||'Eksik'},
    {name:'Gönderici alias',ok:!!String(cfg.senderAlias||'').trim(),detail:cfg.senderAlias||'QNB Solist birim etiketi'},
    {name:'WSDL / servis URL',ok:!!String(cfg.webServiceUrl||'').trim(),detail:cfg.webServiceUrl||ep.note},
    {name:'Kullanıcı',ok:!!String(cfg.username||'').trim(),detail:cfg.username?'Tanımlı':'QNB kullanıcı adı'},
    {name:'Şifre',ok:!!String(cfg.password||'').trim(),detail:cfg.password?'Tanımlı':'QNB şifre'},
    {name:'Etkin',ok:cfg.enabled===true,detail:cfg.enabled?'Açık':'Kapalı (test için açık bırakılabilir)'}
  ];
}

/**
 * Gerçek SOAP çağrısı burada yapılacak.
 * Şimdilik: hazırlık + UBL üretimi + kuyruk durumu güncelleme.
 */
async function sendOrQueueInvoice({record,sale,customer,cfg}){
  const checks=readinessChecks(cfg);
  const ready=checks.filter(c=>['Firma VKN','Firma ünvanı','WSDL / servis URL','Kullanıcı','Şifre'].includes(c.name)).every(c=>c.ok);
  const docType=detectDocumentType(customer,cfg);
  const ubl=buildUblInvoiceDraft({sale:{...sale,...record},customer,cfg,docType});
  if(!ready||!cfg.enabled){
    return {
      ok:true,
      mode:'queued_local',
      status:'ready',
      docType,
      ublXml:ubl,
      message:'QNB bilgileri tamamlanınca otomatik gönderime hazır. UBL taslağı üretildi; dış servise henüz gitmedi.'
    };
  }
  // Canlı SOAP entegrasyonu: QNB WSDL metodları (sendInvoice / belgeleriv2 vb.) buraya bağlanır.
  return {
    ok:true,
    mode:'stub_send',
    status:cfg.draftMode!==false?'draft_sent':'queued_remote',
    docType,
    ublXml:ubl,
    message:cfg.draftMode!==false
      ?'QNB taslak/imza kuyruğuna gönderim noktası hazır (SOAP stub). WSDL bağlanınca aktifleşir.'
      :'QNB gönderim noktası hazır (SOAP stub). WSDL bağlanınca aktifleşir.'
  };
}

module.exports={
  defaultEndpoints,
  detectDocumentType,
  buildUblInvoiceDraft,
  readinessChecks,
  sendOrQueueInvoice
};
