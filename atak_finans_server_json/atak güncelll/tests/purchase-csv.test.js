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

console.log('OK purchase-csv tests passed');
