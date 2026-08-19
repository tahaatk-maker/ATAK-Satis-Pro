'use strict';
const rapid = require('../lib/rapid360-einvoice');

function assert(cond, msg){
  if(!cond) throw new Error(msg);
}

(async () => {
  const q = rapid.buildQuery({}, { startDate: '2023-03-27', endDate: '2023-03-31' });
  assert(q.includes('client_id=842fb1bc7caf495bb8cdda9e12039adb'), 'client_id');
  assert(q.includes('client_secret=3f0774B1c94E4750Bf07a059EEea48d6'), 'client_secret');
  assert(q.includes('StartDate=2023-03-27T00%3A00%3A00'), 'StartDate');
  assert(q.includes('EndDate=2023-03-31T23%3A59%3A59'), 'EndDate');
  assert(q.includes('DealerID=21134761'), 'DealerID');
  assert(q.includes('EInvoiceCode=2E1N1D3E4'), 'EInvoiceCode');
  assert(q.includes('SystemId=1'), 'SystemId');
  assert(q.includes('addReturns=true'), 'addReturns');

  const url = rapid.buildUrl({}, { startDate: '2023-03-27', endDate: '2023-03-31' });
  assert(url.startsWith('https://arc-p-ms-op.arcelik.com/exp/dms/dms/geteinvoices?'), 'base url');

  const listA = rapid.parseInvoices({
    Data: [{
      InvoiceNumber: 'ABC2023000000001',
      InvoiceDate: '2023-03-28T00:00:00',
      UUID: '11111111-2222-3333-4444-555555555555',
      SupplierName: 'ARÇELİK A.Ş.',
      Amount: 1250.5,
      Profile: 'TEMELFATURA'
    }]
  });
  assert(listA.length === 1 && listA[0].invoiceNumber === 'ABC2023000000001', 'Data[]');
  assert(listA[0].total === 1250.5, 'tutar');

  const listB = rapid.parseInvoices([{ FaturaNo: 'X1', FaturaTarihi: '2023-03-29', Tutar: '1.000,25', Ettn: 'abc' }]);
  assert(listB.length === 1 && listB[0].uuid === 'abc', 'TR alan');
  assert(listB[0].total === 1000.25, 'TR tutar');

  const listC = rapid.parseInvoices({ GetEInvoicesResult: { EInvoices: [{ invoiceNo: 'Z9', IssueDate: '2023-03-30', PayableAmount: 10 }] } });
  assert(listC.length === 1 && listC[0].invoiceNumber === 'Z9', 'iç içe');

  const store = { invoiceInbox: [] };
  const m1 = rapid.mergeInbox(store, listA);
  assert(m1.added === 1, 'ilk ekleme');
  const m2 = rapid.mergeInbox(store, listA);
  assert(m2.added === 0 && m2.updated === 1, 'tekrar yok');

  const pub = rapid.publicConfig({});
  assert(pub.clientSecret === '********', 'maske');
  assert(pub.dealerId === '21134761', 'bayi');

  let seenUrl = '';
  const fake = async (u) => {
    seenUrl = u;
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ Data: [{ InvoiceNumber: 'LIVE1', InvoiceDate: '2026-08-01', Amount: 99 }] })
    };
  };
  const fetched = await rapid.fetchGetEInvoices({}, { startDate: '2026-08-01', endDate: '2026-08-02' }, { fetchImpl: fake });
  assert(fetched.count === 1 && fetched.invoices[0].invoiceNumber === 'LIVE1', 'fetch');
  assert(seenUrl.includes('DealerID=21134761'), 'fetch url');

  console.log('rapid360-einvoice.test.js ok');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
