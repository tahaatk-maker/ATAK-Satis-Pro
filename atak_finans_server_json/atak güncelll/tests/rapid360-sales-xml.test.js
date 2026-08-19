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
assert(xml.toIsoDate('18/08/2026') === '2026-08-19'.replace('19','18'), 'slash tarih');

const detayli = `<?xml version="1.0" encoding="utf-8"?>
<Satislar XMLVERSION="1">
  <SatisBilgileri SiparisNo="2521-065691" SiparisTarihi="18/08/2026" MusteriKodu="2521-M0043821" FaturalanacakMusteriAdi="AÇIKGÖZ" FaturaSinifi="İPTAL" FaturaAsama="İPTAL" ToplamTutar="0,00" Magaza="340334">
    <SatisSatirlari>
      <SatisSatiri MalzemeKodu="8919051200" MalzemeAdi="Beko CSR 55 B" Miktar="1" Tutar="0,00" SatisTemsilcisi="MUHAMMED EMİR ATAK"/>
    </SatisSatirlari>
  </SatisBilgileri>
  <SatisBilgileri SiparisNo="2521-065711" SiparisTarihi="18/08/2026" MusteriKodu="2521-M0044001" Ad="ALİ" Soyad="SEZER" FaturalanacakMusteriAdi="SEZER" TCKimlik="" Adres="Ferahevler" Sehir="İstanbul / TUR" Ilce="SARIYER" CepTelefonu="532 111 22 33" FaturaSinifi="BEKLEYEN" FaturaAsama="NORMAL" ToplamTutar="125.097,00" Magaza="340334">
    <SatisSatirlari>
      <SatisSatiri MalzemeKodu="6072S" MalzemeAdi="Beko 6072 S" Miktar="1,00" BirimFiyat="50.000,00" Tutar="50.000,00" KDVOrani="20,00" SatisTemsilcisi="MUHAMMED EMİR ATAK"/>
      <SatisSatiri MalzemeKodu="BOCD" MalzemeAdi="Beko BOCD D 9020 DWS" Miktar="1" BirimFiyat="40.000,00" Tutar="40.000,00"/>
      <SatisSatiri MalzemeKodu="632S" MalzemeAdi="Beko 632 S" Miktar="1" BirimFiyat="35.097,00" Tutar="35.097,00"/>
    </SatisSatirlari>
    <OdemeSatirlari>
      <OdemeSatiri OdemeTarihi="18/08/2026" Tutar="125.097,00" VadeTarihi="18/08/2026" TaksitSayisi="1"/>
    </OdemeSatirlari>
  </SatisBilgileri>
</Satislar>`;
const d = xml.extractSales(detayli);
assert(d.cancelledCount === 1, '1 iptal ' + d.cancelledCount);
assert(d.sales.length === 1, 'iptal atılır, 1 satış kalır ' + d.sales.length);
assert(d.sales[0].salesId === '2521-065711', 'sipariş no öznitelik');
assert(d.sales[0].custName === 'ALİ SEZER', 'ad+soyad birleşir ' + d.sales[0].custName);
assert(d.sales[0].custAccount === '2521-M0044001', 'musteri kodu');
assert(d.sales[0].orderDate === '2026-08-18', 'sipariş tarihi slash');
assert(d.sales[0].lines.length === 3, '3 kalem ' + d.sales[0].lines.length);
assert(d.sales[0].lines[0].itemCode === '6072S' && d.sales[0].lines[0].name.includes('6072'), 'malzeme');
assert(d.sales[0].total === 125097, 'toplam TR ' + d.sales[0].total);
assert(d.sales[0].salespersonName === 'MUHAMMED EMİR ATAK', 'satış temsilcisi');
assert(d.sales[0].payments[0].amount === 125097, 'ödeme tutar');
assert(d.sales[0].phone === '532 111 22 33' || d.sales[0].phone.includes('532'), 'telefon');
assert(d.sales[0].city === 'İstanbul', 'şehir');

assert(xml.composeCustomerName({ad:'AYSE', soyad:'YILMAZ'}) === 'AYSE YILMAZ', 'compose ad soyad');
assert(xml.composeCustomerName({musteriadi:'HANİFE', faturalanacakmusteriadi:'DEMİR'}) === 'HANİFE DEMİR', 'musteriadi+soyad sütunu');
assert(xml.composeCustomerName({faturalanacakmusteriadi:'HANİFE DEMİR'}) === 'HANİFE DEMİR', 'tek alanda ad soyad');
assert(xml.composeCustomerName({ad:'ALİ', soyad:'SEZER', faturalanacakmusteriadi:'SEZER'}) === 'ALİ SEZER', 'soyad tekrar etmez');

const trCols = xml.extractSales(`<?xml version="1.0" encoding="utf-8"?>
<Satislar>
  <SatisBilgileri SiparisNo="2521-1" SiparisTarihi="18/08/2026" MusteriKodu="2521-M1" Adı="ELİF" Soyadı="KAYA" FaturalanacakMusteriAdi="KAYA" ToplamTutar="100,00">
    <SatisSatirlari>
      <SatisSatiri MalzemeKodu="X" MalzemeAdi="Ürün" Miktar="1" Tutar="100,00"/>
    </SatisSatirlari>
  </SatisBilgileri>
</Satislar>`);
assert(trCols.sales[0].custName === 'ELİF KAYA', 'türkçe sütun Adı/Soyadı ' + (trCols.sales[0] && trCols.sales[0].custName));

const utf16 = Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(sample, 'utf16le')]);
const decoded = xml.extractSales(xml.decodeBuffer(utf16));
assert(decoded.sales.length === 2, 'utf16');

console.log('rapid360-sales-xml.test.js ok');
