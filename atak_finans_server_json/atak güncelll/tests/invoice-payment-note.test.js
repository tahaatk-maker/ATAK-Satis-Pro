'use strict';
const assert=require('assert');
const note=require('../lib/invoice-payment-note');
const {buildUblInvoiceDraft}=require('../qnb-solist-adapter');

const tahaSale={
  customer:{name:'Taha'},
  items:[{productName:'KMX 91',productCode:'KMX91',quantity:1,unitPrice:10000,vatRate:20}],
  total:10000,
  payments:[
    {method:'Nakit',amount:4000},
    {method:'Kredi Kartı',amount:2000},
    {method:'Havale',amount:2000},
    {method:'Vadeli',amount:2000}
  ]
};

const text=note.formatInvoicePaymentNote(tahaSale);
assert.equal(
  text,
  'Ödeme: 4.000,00 TL Nakit, 2.000,00 TL Kredi Kartı, 2.000,00 TL Havale, 2.000,00 TL Cari',
  'Taha / KMX 91 karma ödeme notu'
);
assert.equal(note.methodLabel('Vadeli'),'Cari');
assert.equal(note.methodLabel('cari'),'Cari');
assert.equal(note.formatInvoicePaymentNote({payments:[]}),'');
assert.equal(note.formatInvoicePaymentNote({payments:[{method:'Nakit',amount:10000}]}),'Ödeme: 10.000,00 TL Nakit');
assert.equal(
  note.formatInvoicePaymentNote({payments:[{method:'Nakit',amount:6000}],promissory:{amount:4000}}),
  'Ödeme: 6.000,00 TL Nakit, 4.000,00 TL Senet'
);
assert.equal(
  note.formatInvoicePaymentNote({payments:[{method:'Nakit',amount:6000},{method:'Senet',amount:4000}],promissory:{amount:4000}}),
  'Ödeme: 6.000,00 TL Nakit, 4.000,00 TL Senet',
  'senet çift yazılmamalı'
);
assert.equal(
  note.formatInvoicePaymentNote({paymentNote:'Ödeme: 1.000,00 TL Nakit'}),
  'Ödeme: 1.000,00 TL Nakit',
  'kayıtlı not yedek kalır'
);

const ubl=buildUblInvoiceDraft({sale:{...tahaSale,invoiceNumber:'ATK2026000000091'},customer:{name:'Taha'},cfg:{companyTitle:'ATAK'},docType:'earsiv'});
assert(ubl.includes('<cbc:Note>Ödeme: 4.000,00 TL Nakit, 2.000,00 TL Kredi Kartı, 2.000,00 TL Havale, 2.000,00 TL Cari</cbc:Note>'),'UBL Note ödeme dağılımı');
assert(ubl.indexOf('<cbc:InvoiceTypeCode>SATIS</cbc:InvoiceTypeCode>') < ubl.indexOf('<cbc:Note>'),'Note InvoiceTypeCode sonrası');

const emptyUbl=buildUblInvoiceDraft({sale:{invoiceNumber:'X',total:0,items:[]},customer:{},cfg:{},docType:'efatura'});
assert(!emptyUbl.includes('<cbc:Note>'),'ödeme yoksa Note yok');

console.log('OK invoice-payment-note tests passed');
