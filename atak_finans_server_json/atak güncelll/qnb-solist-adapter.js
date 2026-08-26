/**
 * QNB eSolutions / Solist e-Fatura & e-Arşiv adapter (altyapı).
 * Gerçek SOAP gönderimi için QNB’nin vereceği WSDL + kullanıcı bilgileri gerekir.
 * Bu modül: UBL taslağı, tip tespiti, kuyruk durumu ve bağlantı hazırlık kontrolü sağlar.
 */

const {formatInvoicePaymentNote}=require('./lib/invoice-payment-note');
const digitalPlanet=require('./lib/digital-planet');

function escXml(v){
  return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
}
function money2(n){return (Math.round(Number(n||0)*100)/100).toFixed(2)}
function onlyDigits(v){return String(v||'').replace(/\D/g,'')}

function defaultEndpoints(environment){
  if(environment==='live'){
    return {
      einvoiceWsdl:'https://connector.efinans.com.tr/connector/ws/connectorService?wsdl',
      note:'Canlı QNB eFinans connector WSDL. Panelde farklı adres verdiyse onu yazın.'
    };
  }
  return {
    einvoiceWsdl:'https://earsivtest.efinans.com.tr/earsiv/ws/EarsivWebService?wsdl',
    note:'Test WSDL. QNB panelindeki test adresini yazabilirsiniz.'
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
  const paymentNote=formatInvoicePaymentNote(sale);
  const noteXml=paymentNote?`  <cbc:Note>${escXml(paymentNote)}</cbc:Note>\n`:'';
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
${noteXml}  <cbc:DocumentCurrencyCode>TRY</cbc:DocumentCurrencyCode>
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
  const ef=String(cfg.efaturaSeries||'ATK').toUpperCase().replace(/[^A-Z]/g,'').slice(0,3)||'ATK';
  const ea=String(cfg.earsivSeries||'ATA').toUpperCase().replace(/[^A-Z]/g,'').slice(0,3)||'ATA';
  return [
    {name:'Sağlayıcı',ok:['qnb-efinans','qnb-esolutions','qnb-solist'].includes(String(cfg.provider||'')),detail:cfg.provider||'-'},
    {name:'Ortam',ok:['test','live'].includes(String(cfg.environment||'')),detail:cfg.environment||'-'},
    {name:'Firma VKN',ok:onlyDigits(cfg.companyVkn).length>=10,detail:cfg.companyVkn||'QNB’den / mali mühür VKN'},
    {name:'Firma ünvanı',ok:!!String(cfg.companyTitle||'').trim(),detail:cfg.companyTitle||'Eksik'},
    {name:'Vergi dairesi',ok:!!String(cfg.companyTaxOffice||'').trim(),detail:cfg.companyTaxOffice||'Fatura belgesinde görünür'},
    {name:'Firma adresi',ok:!!String(cfg.companyAddress||'').trim(),detail:cfg.companyAddress||'Açık adres yazın'},
    {name:'e-Fatura seri',ok:ef.length===3,detail:`${ef} (örn. ${ef}${new Date().getFullYear()}000000001)`},
    {name:'e-Arşiv seri',ok:ea.length===3,detail:`${ea} (örn. ${ea}${new Date().getFullYear()}000000001)`},
    {name:'Gönderici alias',ok:!!String(cfg.senderAlias||'').trim(),detail:cfg.senderAlias||'QNB Solist birim etiketi'},
    {name:'WSDL / servis URL',ok:!!String(cfg.webServiceUrl||'').trim(),detail:cfg.webServiceUrl||ep.note},
    {name:'Kullanıcı',ok:!!String(cfg.username||'').trim(),detail:cfg.username?'Tanımlı':'QNB kullanıcı adı'},
    {name:'Şifre',ok:!!String(cfg.password||'').trim(),detail:cfg.password?'Tanımlı':'QNB şifre'},
    {name:'Etkin',ok:cfg.enabled===true,detail:cfg.enabled?'Açık':'Kapalı (test için açık bırakılabilir)'}
  ];
}

function decodeXml(v){
  return String(v||'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'");
}
function xmlTag(xml,names){
  const src=String(xml||'');
  for(const n of names){
    const re=new RegExp(`<(?:[\\w.-]+:)?${n}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.-]+:)?${n}>`,'i');
    const m=src.match(re);
    if(m && String(m[1]||'').trim())return decodeXml(String(m[1]).replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim());
  }
  return '';
}
function parseTaxpayerXml(xml=''){
  const companyName=xmlTag(xml,['Title','Unvan','unvan','companyName','ticariUnvan','PartyName','name']);
  const taxOffice=xmlTag(xml,['TaxOffice','vergiDairesi','VergiDairesi','taxOfficeName']);
  const city=xmlTag(xml,['CityName','Il','il','city','City']);
  const district=xmlTag(xml,['CitySubdivisionName','Ilce','ilce','district','District']);
  const address=xmlTag(xml,['StreetName','Adres','adres','address','PostalAddress']);
  const alias=xmlTag(xml,['Alias','etiket','pkAlias','gbAlias']);
  const identifier=onlyDigits(xmlTag(xml,['Identifier','identifier','VKN','vkn','vergiTcKimlikNo']));
  const eInvoiceRaw=xmlTag(xml,['efaturaKullanicisi','isEInvoiceUser','eInvoiceUser','result','return']);
  const eInvoiceUser=/true|1|evet|yes/i.test(eInvoiceRaw) || Boolean(companyName||alias);
  return{
    companyName,taxOffice,city,district,address,alias,identifier,
    eInvoiceUser:Boolean(eInvoiceUser && (companyName||alias||eInvoiceRaw))
  };
}
async function soapPost(url,body,cfg={}){
  const ac=new AbortController();
  const t=setTimeout(()=>ac.abort(),12000);
  try{
    const headers={
      'Content-Type':'text/xml; charset=utf-8',
      'SOAPAction':'""',
      Accept:'text/xml, application/xml, */*'
    };
    if(cfg.username&&cfg.password){
      headers.Authorization='Basic '+Buffer.from(`${cfg.username}:${cfg.password}`).toString('base64');
    }
    const r=await fetch(url,{method:'POST',headers,body,signal:ac.signal});
    const text=await r.text();
    return{ok:r.ok,status:r.status,text};
  }finally{clearTimeout(t)}
}
function soapEnvelope(inner,cfg={}){
  const user=escXml(cfg.username||'');
  const pass=escXml(cfg.password||'');
  const sec=user?`<soapenv:Header><wsse:Security xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">
    <wsse:UsernameToken><wsse:Username>${user}</wsse:Username><wsse:Password>${pass}</wsse:Password></wsse:UsernameToken>
  </wsse:Security></soapenv:Header>`:'<soapenv:Header/>';
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">${sec}
  <soapenv:Body>${inner}</soapenv:Body>
</soapenv:Envelope>`;
}
function lookupEndpoint(cfg={}){
  const custom=String(cfg.webServiceUrl||'').trim();
  if(custom && !/\(QNB|değiştirilecek|degistirilecek/i.test(custom))return custom.replace(/\?wsdl$/i,'');
  return defaultEndpoints(cfg.environment||'test').einvoiceWsdl.replace(/\?wsdl$/i,'');
}
async function lookupViaQnb(vkn,cfg={}){
  const url=lookupEndpoint(cfg);
  if(!url)return null;
  const id=escXml(vkn);
  const bodies=[
    soapEnvelope(`<efaturaKullanicisi xmlns="http://service.connector.uut.cs.com.tr/"><vergiTcKimlikNo>${id}</vergiTcKimlikNo></efaturaKullanicisi>`,cfg),
    soapEnvelope(`<CheckUser xmlns="http://service.connector.uut.cs.com.tr/"><user><identifier>${id}</identifier></user></CheckUser>`,cfg),
    soapEnvelope(`<ser:CheckUser xmlns:ser="http://service.connector.uut.cs.com.tr/"><user><identifier>${id}</identifier></user></ser:CheckUser>`,cfg)
  ];
  let lastErr='';
  for(const body of bodies){
    try{
      const r=await soapPost(url,body,cfg);
      if(!r.text)continue;
      if(/faultstring|soap:Fault|SOAP-ENV:Fault/i.test(r.text)){
        lastErr=xmlTag(r.text,['faultstring','FaultString'])||'QNB SOAP hata';
        continue;
      }
      const parsed=parseTaxpayerXml(r.text);
      if(parsed.companyName||parsed.alias||parsed.eInvoiceUser){
        return{...parsed,source:'qnb',rawOk:true};
      }
      if(/<(?:[\w.-]+:)?(?:return|result)[^>]*>\s*(true|1)\s*</i.test(r.text)){
        return{companyName:'',taxOffice:'',city:'',district:'',address:'',alias:'',identifier:vkn,eInvoiceUser:true,source:'qnb',rawOk:true};
      }
    }catch(e){lastErr=e.name==='AbortError'?'QNB zaman aşımı':(e.message||'QNB bağlantı hatası')}
  }
  if(lastErr)return{error:lastErr,source:'qnb'};
  return null;
}
async function lookupTaxpayer(vkn,cfg={}){
  const id=onlyDigits(vkn);
  if(id.length!==10 && id.length!==11){
    return{ok:false,error:'VKN 10, TCKN 11 hane olmalı'};
  }
  if(!String(cfg.username||'').trim()||!String(cfg.password||'').trim()){
    return{
      ok:false,
      vkn:id,
      eInvoiceUser:false,
      error:'e-Fatura ünvanı için e-Fatura Merkezi’nde QNB kullanıcı ve şifre kaydedin.'
    };
  }
  const qnb=await lookupViaQnb(id,cfg);
  if(qnb && (qnb.companyName||qnb.alias||qnb.eInvoiceUser)&&!qnb.error){
    return{ok:true,vkn:id,...qnb};
  }
  return{
    ok:false,
    vkn:id,
    eInvoiceUser:false,
    error:qnb?.error||'e-Fatura ünvanı alınamadı. e-Fatura Merkezi’nde QNB WSDL / kullanıcı / şifre kaydedin.'
  };
}

/**
 * Digital Planet SOAP ile keser. Kayıt yoksa sahte kuyruk yazmaz —
 * satış Kesilmeyen’de kalır, EVA Rapid Veri Çek çeker.
 */
async function sendOrQueueInvoice({record,sale,customer,cfg}){
  const docType=detectDocumentType(customer,cfg);
  const dpCfg=digitalPlanet.ensureConfig(cfg.digitalPlanet).cfg;
  if(!digitalPlanet.isReady(dpCfg)){
    return {
      ok:false,
      keepPending:true,
      eva:true,
      mode:'need_eva',
      status:'pending',
      docType,
      message:'Dijital Planet SOAP yok. Satış Kesilmeyen’de kalsın; EVA Rapid Veri Çek kessin.'
    };
  }
  const ubl=buildUblInvoiceDraft({
    sale:{
      ...sale,
      ...record,
      payments:Array.isArray(sale?.payments)&&sale.payments.length?sale.payments:record?.payments,
      promissory:sale?.promissory||record?.promissory,
      paymentNote:record?.paymentNote||sale?.paymentNote
    },
    customer,
    cfg,
    docType
  });
  const sent=await digitalPlanet.sendUbl(dpCfg,ubl);
  if(!sent.ok){
    return {ok:false,mode:'digital_planet',status:'error',docType,ublXml:ubl,message:sent.error||'Dijital Planet gönderilemedi'};
  }
  return {
    ok:true,
    mode:'digital_planet',
    status:'issued',
    docType,
    ublXml:ubl,
    providerDocumentId:sent.invoiceId||'',
    uuid:sent.uuid||'',
    message:sent.message||'Dijital Planet’e gönderildi'
  };
}

module.exports={
  defaultEndpoints,
  detectDocumentType,
  buildUblInvoiceDraft,
  readinessChecks,
  sendOrQueueInvoice,
  lookupTaxpayer,
  parseTaxpayerXml,
  onlyDigits
};
