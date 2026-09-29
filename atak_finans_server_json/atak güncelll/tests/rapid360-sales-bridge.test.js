const assert = require('assert');
const bridge = require('../lib/rapid360-sales-bridge');

bridge.resetForTests();
const row = bridge.createBridge({ startDate: '2026-08-18', endDate: '2026-08-20', dealerId: 'atak-beko' });
assert.ok(row.id);
assert.equal(bridge.getBridge(row.id).meta.store, '340334');

const xml = `<?xml version="1.0"?>
<Satislar XMLVERSION="1">
  <SatisBilgileri SiparisNo="2521-065682" SiparisTarihi="18/08/2026" MusteriKodu="C1" Ad="ALI" Soyad="SEZER" ToplamTutar="100" Magaza="340334">
    <SatisSatirlari>
      <SatisSatiri MalzemeKodu="P1" MalzemeAdi="Urun" Miktar="1" BirimFiyat="100" Tutar="100" KDVOrani="20"/>
    </SatisSatirlari>
  </SatisBilgileri>
</Satislar>`;
const pushed = bridge.acceptPush(row.id, { xml });
assert.equal(pushed.ok, true, pushed.error);
assert.equal(pushed.count, 1);
assert.equal(bridge.getBridge(row.id).parsed.sales[0].salesId, '2521-065682');

const jsonPush = bridge.parseIncoming({
  json: {
    value: [{
      SalesOrderNumber: 'S9',
      ItemNumber: 'P1',
      ItemName: 'Buzdolabi',
      InventLocationId: '340334',
      OrderDate: '2026-08-18',
      LineAmount: 50,
      OrderedSalesQuantity: 1,
      CustomerName: 'AYSE KAYA'
    }]
  }
});
assert.ok(jsonPush.sales.length >= 1, 'odata json parse');

const href = bridge.bookmarklet({
  bridgeId: row.id,
  baseUrl: 'https://panel.atakhome.com.tr',
  startDate: '2026-08-18',
  endDate: '2026-08-20'
});
assert.ok(href.startsWith('javascript:'));
assert.ok(!/login\.microsoftonline\.com/.test(href));
assert.ok(href.includes('rapid360-bridge'));
assert.equal(bridge.corsOrigin('https://liverapid360.operations.dynamics.com'), 'https://liverapid360.operations.dynamics.com');
assert.equal(bridge.corsOrigin('https://login.microsoftonline.com'), '');

console.log('rapid360-sales-bridge tests OK');
