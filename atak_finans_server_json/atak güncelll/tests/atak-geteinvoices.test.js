'use strict';
const atak = require('../lib/atak-geteinvoices');

function assert(cond, msg){
  if(!cond) throw new Error(msg);
}

const creds = { clientId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', clientSecret: 'bbbbBBBBccccccccccccccccdddddddd', dealerId: '21134761', eInvoiceCode: '2E1N1D3E4', systemId: '1', enabled: true, includeInbox: true };

assert(atak.PATH === '/exp/dms/dms/geteinvoices', 'path');
assert(atak.PUBLIC_PATHS.includes('/api/dms/geteinvoices'), 'alias');

const seeded = atak.ensureConfig({});
assert(seeded.generated === true && seeded.cfg.clientId.length === 32, 'seed id');
assert(seeded.cfg.clientSecret.length >= 32, 'seed secret');
assert(seeded.cfg.dealerId === '21134761', 'default dealer');

const authOk = atak.authenticate(creds, {
  client_id: creds.clientId,
  client_secret: creds.clientSecret,
  DealerID: creds.dealerId,
  EInvoiceCode: creds.eInvoiceCode,
  SystemId: creds.systemId
});
assert(authOk.ok === true, 'auth ok');

const authBad = atak.authenticate(creds, {
  client_id: creds.clientId,
  client_secret: 'wrong',
  DealerID: creds.dealerId,
  EInvoiceCode: creds.eInvoiceCode
});
assert(authBad.ok === false && authBad.status === 401, 'auth fail');

const authDealer = atak.authenticate(creds, {
  client_id: creds.clientId,
  client_secret: creds.clientSecret,
  DealerID: '00000000',
  EInvoiceCode: creds.eInvoiceCode
});
assert(authDealer.ok === false, 'dealer mismatch');

const disabled = atak.authenticate({ ...creds, enabled: false }, {
  client_id: creds.clientId,
  client_secret: creds.clientSecret
});
assert(disabled.ok === false && disabled.status === 403, 'disabled');

const store = {
  invoiceIntegration: { companyTitle: 'ATAK PAZARLAMA SANAYİ VE TİCARET LİMİTED ŞİRKETİ', companyVkn: '1234567890' },
  invoiceQueue: [
    {
      invoiceNumber: 'ATK2026000000001',
      invoiceDate: '2026-08-10',
      uuid: 'uuid-out-1',
      total: 1500.25,
      status: 'issued',
      docType: 'efatura',
      saleId: 'sale-1',
      reference: 'S-1',
      customer: { name: 'Ahmet Yılmaz', taxNo: '11111111111' }
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
      invoiceNumber: 'ARC2026000000555',
      invoiceDate: '2026-08-11',
      uuid: 'uuid-in-1',
      total: 880,
      supplierName: 'Arçelik A.Ş.',
      supplierVkn: '1234567890',
      source: 'rapid360',
      docType: 'efatura',
      isReturn: false
    }
  ]
};

const all = atak.buildResponse(store, creds, {
  StartDate: '2026-08-01T00:00:00',
  EndDate: '2026-08-31T23:59:59',
  addReturns: 'true'
});
assert(all.IsSuccess === true && all.Count === 3, 'range count ' + all.Count);
assert(all.Data.some(x => x.InvoiceNumber === 'ATK2026000000001' && x.Direction === 'Outgoing' && x.Source === 'ATAK'), 'giden');
assert(all.Data.some(x => x.InvoiceNumber === 'ARC2026000000555' && x.Direction === 'Incoming'), 'gelen');
assert(all.Data.some(x => x.InvoiceNumber === 'ATK2026000000002' && x.IsReturn === true), 'iade dahil');
const giden = all.Data.find(x => x.InvoiceNumber === 'ATK2026000000001');
assert(giden.CustomerName === 'Ahmet Yılmaz' && giden.Amount === 1500.25, 'müşteri/tutar');
assert(giden.Profile === 'TEMELFATURA', 'profil');

const noRet = atak.buildResponse(store, creds, {
  StartDate: '2026-08-01',
  EndDate: '2026-08-31',
  addReturns: 'false'
});
assert(noRet.Count === 2 && !noRet.Data.some(x => x.IsReturn), 'addReturns false');

const noInbox = atak.buildResponse(store, { ...creds, includeInbox: false }, {
  StartDate: '2026-08-01',
  EndDate: '2026-08-31',
  addReturns: 'true'
});
assert(noInbox.Count === 2 && !noInbox.Data.some(x => x.Source === 'RAPID360'), 'inbox kapalı');

const pub = atak.publicConfig(creds, { reveal: true, baseUrl: 'https://panel.atakhome.com.tr' });
assert(pub.clientSecret === '********', 'maske');
assert(pub.copyUrl.includes('client_id=' + creds.clientId), 'copy url');
assert(pub.copyUrl.includes('/exp/dms/dms/geteinvoices?'), 'copy path');
assert(pub.copyUrlMasked.includes('client_secret=********'), 'masked url');

const hidden = atak.publicConfig(creds, { reveal: false, baseUrl: 'https://panel.atakhome.com.tr' });
assert(hidden.copyUrl === '', 'gizle');

const rotated = atak.mergeIncoming(creds, { dealerId: '21134761' }, { rotate: true });
assert(rotated.clientId !== creds.clientId && rotated.clientSecret !== creds.clientSecret, 'rotate');

const merged = atak.mergeIncoming(creds, { clientSecret: '********', dealerId: '21134761', enabled: true });
assert(merged.clientSecret === creds.clientSecret, 'secret korunur');

console.log('atak-geteinvoices.test.js ok');
