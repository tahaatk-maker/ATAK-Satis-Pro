'use strict';
const atak = require('../lib/atak-geteinvoices');
const rapid = require('../lib/rapid360-einvoice');

function assert(cond, msg){
  if(!cond) throw new Error(msg);
}

const muleQuery = {
  client_id: '842fb1bc7caf495bb8cdda9e12039adb',
  client_secret: '3f0774B1c94E4750Bf07a059EEea48d6',
  DealerID: '21134761',
  EInvoiceCode: '2E1N1D3E4',
  SystemId: '1'
};
const creds = { clientId: muleQuery.client_id, clientSecret: muleQuery.client_secret, dealerId: muleQuery.DealerID, eInvoiceCode: muleQuery.EInvoiceCode, systemId: '1', enabled: true, includeInbox: true };

assert(atak.PATH === '/exp/dms/dms/geteinvoices', 'path');
assert(atak.authenticate({}, muleQuery).ok === true, 'mule auth');
assert(atak.authenticate({}, { ...muleQuery, EInvoiceCode: '' }).ok === false, 'servis kodu zorunlu');
assert(atak.authenticate({}, { ...muleQuery, client_id: '' }).ok === false, 'client_id zorunlu');
assert(atak.authenticate({}, { ...muleQuery, client_secret: 'wrong' }).ok === false, 'secret');

const seeded = atak.ensureConfig({});
assert(seeded.cfg.clientId === muleQuery.client_id, 'default client_id');
assert(seeded.cfg.clientSecret === muleQuery.client_secret, 'default secret');
assert(seeded.cfg.eInvoiceCode === '2E1N1D3E4', 'default servis kodu');

const store = {
  invoiceIntegration: { companyTitle: 'ATAK PAZARLAMA SANAYİ VE TİCARET LİMİTED ŞİRKETİ', companyVkn: '1234567890' },
  invoiceQueue: [
    {
      invoiceNumber: 'ATK2026000000001',
      invoiceDate: '2026-08-10',
      uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      total: 1200,
      status: 'issued',
      docType: 'efatura',
      saleId: 'sale-1',
      reference: 'S-1',
      customer: { name: 'Ahmet Yılmaz', taxNo: '11111111111', phone: '5320000000', city: 'İstanbul' },
      items: [{ productCode: 'P1', name: 'Ürün A', quantity: 1, unitPrice: 1200, vatRate: 20 }]
    },
    {
      invoiceNumber: 'ATK2026000000002',
      invoiceDate: '2026-08-12',
      uuid: 'uuid-ret-1',
      total: 200,
      status: 'cancelled',
      docType: 'efatura',
      customer: { name: 'İade Müşteri' }
    },
    {
      invoiceNumber: 'ATK2025000000099',
      invoiceDate: '2025-01-01',
      uuid: 'old',
      total: 9,
      status: 'issued',
      customer: { name: 'Eski' }
    }
  ],
  invoiceInbox: [
    {
      invoiceNumber: 'BEA2026000002096',
      invoiceDate: '2026-08-11',
      uuid: 'uuid-in-1',
      total: 880,
      source: 'rapid360',
      rapidRaw: {
        FaturaNo: 'BEA2026000002096',
        FaturaTarihi: '11/08/2026',
        FaturalanacakMusteriAdi: 'Örnek Müşteri',
        TutarToplami: 880,
        EInvoicesLines: []
      }
    }
  ]
};

const all = atak.buildResponse(store, creds, {
  StartDate: '2026-08-01T00:00:00',
  EndDate: '2026-08-31T00:00:00',
  addReturns: 'true'
});
assert(Array.isArray(all.EInvoices), 'EInvoices');
assert(all.RecordCount === 3, 'RecordCount ' + all.RecordCount);
assert(all.DealerId === 21134761, 'DealerId');
assert(all.EInvoiceCode === '2E1N1D3E4', 'EInvoiceCode');
assert(all.startDate === '2026-08-01T00:00:00', 'startDate');
const giden = all.EInvoices.find(x => x.FaturaNo === 'ATK2026000000001');
assert(giden && giden.FaturalanacakMusteriAdi === 'Ahmet Yılmaz', 'müşteri');
assert(giden.FaturaTarihi === '10/08/2026', 'tr tarih');
assert(giden.TutarToplami === 1200, 'tutar');
assert(Array.isArray(giden.EInvoicesLines) && giden.EInvoicesLines[0].MalzemeKodu === 'P1', 'satır');
assert(all.EInvoices.some(x => x.FaturaNo === 'ATK2026000000002' && x.FaturaAsama === 'IADE'), 'iade');

const noRet = atak.buildResponse(store, creds, {
  StartDate: '2026-08-01',
  EndDate: '2026-08-31',
  addReturns: 'false'
});
assert(noRet.RecordCount === 2 && !noRet.EInvoices.some(x => x.FaturaAsama === 'IADE'), 'addReturns false');

const noInbox = atak.buildResponse(store, { ...creds, includeInbox: false }, {
  StartDate: '2026-08-01',
  EndDate: '2026-08-31',
  addReturns: 'true'
});
assert(noInbox.RecordCount === 2 && !noInbox.EInvoices.some(x => x.FaturaNo === 'BEA2026000002096'), 'inbox kapalı');

const sameDay = atak.buildResponse(store, creds, {
  StartDate: '2026-08-12T00:00:00',
  EndDate: '2026-08-12T00:00:00',
  addReturns: 'true'
});
assert(sameDay.RecordCount === 1 && sameDay.EInvoices[0].FaturaNo === 'ATK2026000000002', 'EndDate gün dahil');
assert(sameDay.endDate === '2026-08-12T00:00:00', 'endDate format');

const parsed = rapid.parseInvoices({
  DealerId: 21134761,
  EInvoiceCode: '2E1N1D3E4',
  RecordCount: 1,
  EInvoices: [{
    FaturaNo: 'BEA2026000002096',
    FaturaTarihi: '17/08/2026',
    FaturalanacakMusteriAdi: 'Örnek',
    TutarToplami: 84999,
    EInvoicesLines: [{ MalzemeKodu: 'X', UrunAdi: 'Ürün', Miktar: 1 }]
  }]
});
assert(parsed.length === 1 && parsed[0].invoiceNumber === 'BEA2026000002096', 'parse FaturaNo');
assert(parsed[0].invoiceDate === '2026-08-17', 'parse DD/MM/YYYY');
assert(parsed[0].total === 84999, 'parse TutarToplami');

const pub = atak.publicConfig(creds, { reveal: true, baseUrl: 'https://panel.atakhome.com.tr' });
assert(pub.copyUrl.includes('EInvoiceCode=2E1N1D3E4'), 'copy servis kodu');
assert(pub.copyUrl.includes('client_id=' + muleQuery.client_id), 'copy client');

console.log('atak-geteinvoices.test.js ok');
