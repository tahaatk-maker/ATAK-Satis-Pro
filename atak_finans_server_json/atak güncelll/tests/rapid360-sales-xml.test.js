'use strict';
const xml = require('../lib/rapid360-sales-xml');

function assert(cond, msg){
  if(!cond) throw new Error(msg);
}

const sample = `<?xml version="1.0" encoding="utf-8"?>
<Document>
  <SalesTable>
    <SalesId>2521-065691</SalesId>
    <ReceiptDate>2026-08-18</ReceiptDate>
    <InvoiceDate>18.08.2026</InvoiceDate>
    <CustAccount>2521-M0043821</CustAccount>
    <CustName>AYŞE YILMAZ</CustName>
    <InventLocationId>340344</InventLocationId>
    <IsEInvoice>Yes</IsEInvoice>
  </SalesTable>
  <SalesLine>
    <SalesId>2521-065691</SalesId>
    <ItemId>BEK123</ItemId>
    <ItemName>Buzdolabı</ItemName>
    <SalesQty>1</SalesQty>
    <SalesPrice>25000</SalesPrice>
    <LineAmount>25000</LineAmount>
  </SalesLine>
  <SalesLine>
    <SalesId>2521-065691</SalesId>
    <ItemId>BEK999</ItemId>
    <Name>Stand</Name>
    <Qty>2</Qty>
    <LineAmount>1.200,50</LineAmount>
  </SalesLine>
  <CustPaym>
    <SalesId>2521-065691</SalesId>
    <PaymMode>NAK</PaymMode>
    <PaymModeName>Nakit</PaymModeName>
    <AmountCur>26200.50</AmountCur>
  </CustPaym>
  <SatisBilgileri>
    <SatisSiparisi>2521-065701</SatisSiparisi>
    <SiparisTarihi>18.08.2026</SiparisTarihi>
    <MusteriHesabi>2521-M0044081</MusteriHesabi>
    <MusteriAdi>HANİFE DEMİR</MusteriAdi>
    <WebSiparisiMi>1</WebSiparisiMi>
  </SatisBilgileri>
  <Satirlari>
    <SatisSiparisi>2521-065701</SatisSiparisi>
    <MalzemeKodu>IST55</MalzemeKodu>
    <Metin>Kanepe</Metin>
    <Adet>1</Adet>
    <Tutar>18499</Tutar>
  </Satirlari>
  <Odemeler>
    <SatisSiparisi>2521-065701</SatisSiparisi>
    <OdemeYontemi>Kredi Kartı</OdemeYontemi>
    <OdenecekTutar>18499</OdenecekTutar>
  </Odemeler>
</Document>`;

const out = xml.extractSales(sample);
assert(out.sales.length === 2, '2 satış ' + out.sales.length);
const a = out.sales.find(s => s.salesId === '2521-065691');
assert(a && a.custAccount === '2521-M0043821', 'müşteri hesap');
assert(a.custName === 'AYŞE YILMAZ', 'müşteri ad');
assert(a.orderDate === '2026-08-18', 'sipariş tarihi');
assert(a.invoiceDate === '2026-08-18', 'fatura tarihi');
assert(a.store === '340344', 'mağaza');
assert(a.eInvoice === true, 'e-fatura');
assert(a.lines.length === 2, '2 kalem');
assert(a.lines[0].itemCode === 'BEK123' && a.lines[0].total === 25000, 'kalem 1');
assert(a.lines[1].quantity === 2 && a.lines[1].total === 1200.5, 'TR tutar');
assert(a.total === 26200.5, 'toplam ' + a.total);
assert(a.payments[0].method === 'Nakit', 'nakit');

const b = out.sales.find(s => s.salesId === '2521-065701');
assert(b && b.webOrder === true, 'web sipariş');
assert(b.custName === 'HANİFE DEMİR', 'TR müşteri');
assert(b.lines[0].itemCode === 'IST55', 'malzeme');
assert(b.payments[0].method === 'Kredi Kartı', 'kart');

const payOnly = xml.extractSales(`<?xml version="1.0"?>
<Document>
  <SalesTable><SalesId>2521-1</SalesId><CustName>TEST</CustName><OrderDate>2026-08-19</OrderDate></SalesTable>
  <CustPaym><SalesId>2521-1</SalesId><PaymModeName>Havale</PaymModeName><AmountCur>100</AmountCur></CustPaym>
</Document>`);
assert(payOnly.sales[0].lines.length === 1 && payOnly.sales[0].total === 100, 'ödemeden satır');

assert(xml.mapPaymentMethod('KK 3 taksit') === 'Kredi Kartı', 'kk map');
assert(xml.toIsoDate('19.08.2026') === '2026-08-19', 'tr tarih');

const utf16 = Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(sample, 'utf16le')]);
const decoded = xml.extractSales(xml.decodeBuffer(utf16));
assert(decoded.sales.length === 2, 'utf16');

console.log('rapid360-sales-xml.test.js ok');
