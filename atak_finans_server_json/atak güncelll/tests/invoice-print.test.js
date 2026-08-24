const {buildInvoicePrintHtml,lineAmounts}=require('../lib/invoice-print');

function assert(cond,msg){if(!cond)throw new Error(msg)}

const html=buildInvoicePrintHtml({
  company:{companyTitle:'ATAK EV GEREÇLERİ PAZ. TİC. LTD. ŞTİ.',companyVkn:'0940148218',companyTaxOffice:'Sarıyer',companyAddress:'Ferahevler Mah.',companyCity:'İstanbul',companyDistrict:'Sarıyer'},
  customer:{name:'Test Müşteri',taxNo:'1234567890',taxOffice:'Şişli',address:'Test cad.'},
  record:{invoiceNumber:'ATK2026000000001',invoiceDate:'2026-08-18',uuid:'abc-123',status:'pending',docType:'efatura',reference:'SAT-1',total:1200,items:[{productName:'Buzdolabı',productCode:'BM1',quantity:1,unitPrice:1200,vatRate:20}]},
  sale:{}
});
assert(html.includes('e-FATURA'),'başlık e-FATURA olmalı');
assert(html.includes('ATK2026000000001'),'fatura no basılmalı');
assert(html.includes('0940148218'),'satıcı VKN basılmalı');
assert(html.includes('Test Müşteri'),'alıcı adı basılmalı');
assert(html.includes('Buzdolabı'),'kalem basılmalı');
assert(!html.includes('<script src='),'belge harici script çekmemeli');
assert(!html.includes('FATURA NOTU'),'ödeme yoksa not basılmamalı');

const paidHtml=buildInvoicePrintHtml({
  company:{companyTitle:'ATAK'},
  customer:{name:'Taha'},
  record:{invoiceNumber:'ATK2026000000091',invoiceDate:'2026-08-24',status:'pending',docType:'earsiv',reference:'SAT-91',total:10000,items:[{productName:'KMX 91',quantity:1,unitPrice:10000,vatRate:20}]},
  sale:{payments:[
    {method:'Nakit',amount:4000},
    {method:'Kredi Kartı',amount:2000},
    {method:'Havale',amount:2000},
    {method:'Vadeli',amount:2000}
  ]}
});
assert(paidHtml.includes('FATURA NOTU'),'ödeme notu başlığı');
assert(paidHtml.includes('4.000,00 TL Nakit'),'nakit tutarı');
assert(paidHtml.includes('2.000,00 TL Cari'),'vadeli cari olarak yazılır');
assert(paidHtml.includes('KMX 91'),'ürün adı');

const line=lineAmounts({quantity:2,unitPrice:100,vatRate:20});
assert(line.gross===200,'satır brüt 200');
assert(Math.abs(line.net-166.67)<0.01,'KDV hariç matrah');

const earsiv=buildInvoicePrintHtml({company:{},customer:{},record:{docType:'earsiv',invoiceNumber:'ATA2026000000001',items:[]},sale:{}});
assert(earsiv.includes('e-ARŞİV FATURA'),'e-arşiv başlığı');

console.log('OK invoice-print tests passed');
