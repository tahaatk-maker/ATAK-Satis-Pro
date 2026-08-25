'use strict';
const assert=require('assert');
const csv=require('../lib/purchase-csv');
const stock=require('../lib/stock-cost');

const sample=[
  'İstikbal Stok Listesi',
  '',
  'Malzeme1;Malzeme Uzun Metni E;Birim Fiyat',
  'KMX91;KMX 91 Yatak;10000',
  'KMX92;"Comfort, baza";8500,50'
].join('\n');

const rows=csv.parseCsvBuffer(Buffer.from(sample,'utf8'));
assert.equal(rows.length,2,'başlık satırından sonra 2 ürün');
assert.equal(rows[0]['Malzeme1'],'KMX91');
assert.equal(rows[0]['Birim Fiyat'],'10000');
assert.equal(rows[1]['Malzeme Uzun Metni E'],'Comfort, baza','tırnaklı virgül');

assert.equal(csv.headerIndex(['başlık','Malzeme1;Birim Fiyat','x']),1);
assert.equal(csv.detectDelim('a;b;c'),';');

const utf16=Buffer.from('\ufeffMalzeme1;Birim Fiyat\r\nKMX91;1','utf16le');
utf16[0]=0xFF;utf16[1]=0xFE;
const from16=csv.parseCsvBuffer(utf16);
assert.ok(from16.length>=1,'utf16 csv');
assert.equal(String(from16[0]['Malzeme1']||from16[0].Malzeme1||'').trim()||Object.values(from16[0])[0],'KMX91');

assert.deepEqual(
  stock.countImportColumns(['Malzeme1','Malzeme Uzun Metni E','Birim Fiyat']),
  {codeIndex:0,qtyIndex:-1,costIndex:2}
);
assert.deepEqual(
  stock.countImportColumns(['Malzeme1','Miktar','Birim Fiyat']),
  {codeIndex:0,qtyIndex:1,costIndex:2}
);

const virt=csv.virtualInvoiceNo({supplier:'İstikbal / Doğtaş',date:'2026-08-24',mode:'stock',now:new Date('2026-08-24T15:30:45')});
assert.match(virt,/^IST-SANAL-STOK-20260824-153045-[A-Z0-9]{4}$/);
const virt2=csv.virtualInvoiceNo({supplier:'İstikbal',date:'2026-08-24',mode:'stock',now:new Date('2026-08-24T15:30:45')});
assert.notEqual(virt,virt2,'her çağrıda farklı sonek');
const costNo=csv.virtualInvoiceNo({supplier:'İstikbal',date:'2026-08-24',mode:'cost',now:new Date('2026-08-24T15:30:45')});
assert.match(costNo,/^IST-SANAL-FIYAT-/);

// İstikbal depo stok CSV: Malzeme1=ad, Stok Miktarı, PP=fiyat
const depo=[
  ';Malzeme1;Üretim yeri;Stok Miktarı;PP',
  ';Borneo sandalye 8230 2 li;4041;2,000;₺15.545,00',
  ';borneo sandalye 8231;4041;1,000;₺6.198,00'
].join('\n');
const depoRows=csv.parseCsvBuffer(Buffer.from(depo,'utf8'));
assert.ok(depoRows.length>=2,'depo stok satır');
assert.equal(depoRows[0]['Malzeme1'],'Borneo sandalye 8230 2 li');
assert.ok(String(depoRows[0]['Birim Fiyat']||'').includes('15.545'),'PP → Birim Fiyat');
assert.equal(String(depoRows[0]['Miktar']||''),'2,000');
assert.ok(depoRows[0]['Malzeme Uzun Metni E'],'ad uzun metin');

function toWin1254(str){
  const map={ı:0xFD,İ:0xDD,ş:0xFE,Ş:0xDE,ğ:0xF0,Ğ:0xD0,ü:0xFC,Ü:0xDC,ö:0xF6,Ö:0xD6,ç:0xE7,Ç:0xC7};
  const bytes=[];
  for(const ch of str){
    if(Object.prototype.hasOwnProperty.call(map,ch))bytes.push(map[ch]);
    else bytes.push(ch.charCodeAt(0));
  }
  return Buffer.from(bytes);
}
const trCsv=toWin1254(';Malzeme1;Üretim yeri;Stok Miktarı;PP\n;borneo açılır masa;4041;1,000;₺10,00\n;borneo konsol aynası;4041;1;1\n');
const trRows=csv.parseCsvBuffer(trCsv);
assert.equal(trRows[0]['Malzeme1'],'borneo açılır masa');
assert.equal(trRows[1]['Malzeme1'],'borneo konsol aynası');
assert.equal(csv.fixTrMojibake('borneo açýlýr masa'),'borneo açılır masa');
assert.equal(csv.fixTrMojibake('borneo konsol aynasý'),'borneo konsol aynası');

console.log('OK purchase-csv tests passed');
