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

const line=lineAmounts({quantity:2,unitPrice:100,vatRate:20});
assert(line.gross===200,'satır brüt 200');
assert(Math.abs(line.net-166.67)<0.01,'KDV hariç matrah');

const earsiv=buildInvoicePrintHtml({company:{},customer:{},record:{docType:'earsiv',invoiceNumber:'ATA2026000000001',items:[]},sale:{}});
assert(earsiv.includes('e-ARŞİV FATURA'),'e-arşiv başlığı');

console.log('OK invoice-print tests passed');
