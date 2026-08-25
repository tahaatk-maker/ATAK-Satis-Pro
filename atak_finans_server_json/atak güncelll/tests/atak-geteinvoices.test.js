'use strict';
const atak = require('../lib/atak-geteinvoices');
const rapid = require('../lib/rapid360-einvoice');

function assert(cond, msg){
  if(!cond) throw new Error(msg);
}

const muleQuery = {
  client_id: '842fb1bc7caf495bb8cdda9e12039adb',
  client_secret: '3f0774B1c94E4750Bf07a059EEea48d6',
  DealerID: '340344',
  EInvoiceCode: '2E1N1D3E4',
  SystemId: '1'
};
const creds = { clientId: muleQuery.client_id, clientSecret: muleQuery.client_secret, dealerId: muleQuery.DealerID, eInvoiceCode: muleQuery.EInvoiceCode, systemId: '1', enabled: true, includeInbox: true };

assert(atak.PATH === '/exp/dms/dms/geteinvoices', 'path');
assert(atak.authenticate({}, muleQuery).ok === true, 'mule auth');
assert(atak.authenticate({}, { ...muleQuery, EInvoiceCode: '' }).ok === false, 'servis kodu zorunlu');
assert(atak.authenticate({}, { ...muleQuery, DealerID: '' }).ok === false, 'DealerID zorunlu');
assert(atak.authenticate({}, { ...muleQuery, DealerID: '999' }).ok === false, 'DealerID yanlış');
assert(atak.authenticate({}, { ...muleQuery, DealerID: '21134761' }).ok === false, 'Arçelik bayi Atak’ta geçmez');
assert(atak.authenticate({}, { ...muleQuery, client_id: '' }).ok === false, 'client_id zorunlu');
assert(atak.authenticate({}, { ...muleQuery, client_secret: 'wrong' }).ok === false, 'secret');
assert(atak.authenticate({}, { ...muleQuery, client_secret: 'wrong' }).message === 'Unauthorized', 'hata sızmaz');
assert(atak.ipAllowedForDms({}, '1.2.3.4', {}).ok === true, 'boş IP Rapid360 gibi açık');
assert(atak.ipAllowedForDms({ allowedIps: '10.1.1.8' }, '10.1.1.8', {}).ok === true, 'izinli IP');
assert(atak.ipAllowedForDms({ allowedIps: '10.1.1.8' }, '9.9.9.9', {}).ok === false, 'yabancı IP');
assert(atak.ipAllowedForDms({ allowedIps: '10.1.1.0/24' }, '10.1.1.50', {}).ok === true, 'CIDR izin');
assert(atak.ipAllowedForDms({ allowedIps: '10.1.1.0/24' }, '10.1.2.50', {}).ok === false, 'CIDR red');
assert(atak.ipAllowedForDms({}, '8.8.8.8', { ATAK_DMS_ALLOWED_IPS: '8.8.8.8' }).ok === true, 'env IP');
assert(atak.ipAllowedForDms({ allowedIps: '*' }, '9.9.9.9', {}).ok === true, 'yıldız açık');
assert(atak.publicConfig({}, { env: {} }).ipLocked === false, 'IP yoksa kilit yok');
assert(atak.publicConfig({ allowedIps: '1.1.1.1' }, { env: {} }).ipLocked === true, 'IP varsa kilit');
assert(atak.publicConfig({}, { env: {} }).ready === true, 'mule ready');

const seeded = atak.ensureConfig({});
assert(seeded.cfg.clientId === muleQuery.client_id, 'default client_id');
assert(seeded.cfg.clientSecret === muleQuery.client_secret, 'default secret');
assert(seeded.cfg.eInvoiceCode === '2E1N1D3E4', 'default servis kodu');
assert(seeded.cfg.dealerId === '340344', 'Atak DealerID');
assert(seeded.cfg.bayi === 'ATAKHOME', 'bayi ATAKHOME');
assert(atak.ensureConfig({ dealerId: '21134761' }).cfg.dealerId === '340344', 'eski Arçelik bayi Atak’ta düzelir');

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
      invoiceNumber: 'BEA2026000002096',
      invoiceDate: '2026-08-11',
      uuid: 'uuid-foreign-q',
      total: 880,
      status: 'issued',
      source: 'rapid360'
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
assert(all.RecordCount === 2, 'RecordCount ' + all.RecordCount);
assert(all.DealerId === 340344, 'DealerId');
assert(!all.EInvoices.some(x => String(x.FaturaNo || '').startsWith('BEA')), 'başka bayi yok');
assert(all.EInvoiceCode === '2E1N1D3E4', 'EInvoiceCode');
assert(all.startDate === '2026-08-01T00:00:00', 'startDate');
assert(all.$id === '1' && all._schema === 0 && all._reference === '', 'zarf meta');
const rootWant = ['$id','DealerId','startDate','endDate','RecordCount','EInvoiceCode','addReturns','EInvoices','_reference','_schema'];
assert(rootWant.every(k => Object.prototype.hasOwnProperty.call(all, k)) && Object.keys(all).every(k => rootWant.includes(k)), 'zarf alanları');
const giden = all.EInvoices.find(x => x.FaturaNo === 'ATK2026000000001');
assert(giden && giden.FaturalanacakMusteriAdi === 'Ahmet Yılmaz', 'müşteri');
assert(giden.Bayi === 'ATAKHOME', 'Bayi ATAKHOME');
assert(String(giden.BayiKodu) === '340344', 'BayiKodu');
assert(giden.FaturaTarihi === '10/08/2026', 'tr tarih');
assert(giden.TutarToplami === 1200, 'tutar');
assert(Array.isArray(giden.EInvoicesLines) && giden.EInvoicesLines[0].MalzemeKodu === 'P1', 'satır');
const invWant = ['$id','FaturaTarihi','FaturaSayac','FaturaNo','EmanetMi','EFaturaMi','ResmiBelgeNo','FaturaSinifi','FaturaTipi','FaturaAsama','FaturaAciklama','MusteriKodu','MusteriEmail','SubeKodu','Bayi','BayiKodu','MusteriSayac','VergiNo','VergiDairesi','Adres','Sehir','Ilce','Semt','IrtibatTelefonu','EvTelefonu','CepTelefonu','MuhasebeBaglantiKodu','FaturalanacakMusteriAdi','ValorTarihi','TutarToplami','KDVTutarToplami','AktarimToplami','IndirimToplami','FaturaMiktari','EInvoicesLines'];
const lineWant = ['$id','FaturaTarihi','FaturaSayac','FaturaDetaySayac','SiparisSayac','Sirket','MalzemeKodu','UrunAdi','TransferTarihi','Depo','Birim','Miktar','BirimFiyat','Tutar','IndirimTutari','KDVTutari','SatirTutari','KDVOrani','SiparisSatirSayac'];
assert(invWant.every(k => Object.prototype.hasOwnProperty.call(giden, k)), 'fatura alanları');
assert(lineWant.every(k => Object.prototype.hasOwnProperty.call(giden.EInvoicesLines[0], k)), 'satır alanları');
assert(all.EInvoices.some(x => x.FaturaNo === 'ATK2026000000002' && x.FaturaAsama === 'IADE'), 'iade');

const noRet = atak.buildResponse(store, creds, {
  StartDate: '2026-08-01',
  EndDate: '2026-08-31',
  addReturns: 'false'
});
assert(noRet.RecordCount === 1 && !noRet.EInvoices.some(x => x.FaturaAsama === 'IADE'), 'addReturns false');

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
}, new Date('2026-08-12T12:00:00'));
assert(sameDay.RecordCount === 1 && sameDay.EInvoices[0].FaturaNo === 'ATK2026000000002', 'EndDate gün dahil');
assert(sameDay.endDate === '2026-08-12T00:00:00', 'endDate format');

const staleNow = new Date('2026-08-25T12:00:00');
const staleStore = {
  invoiceQueue: [
    {
      invoiceNumber: 'ATA2026000000003',
      invoiceDate: '2026-08-10',
      uuid: 'uuid-old-range',
      total: 10,
      status: 'issued',
      customer: { name: 'Eski aralık' },
      items: [{ productCode: 'P0', name: 'A', quantity: 1, unitPrice: 10, vatRate: 20 }]
    },
    {
      invoiceNumber: 'ATA2026000000004',
      invoiceDate: '2026-08-20',
      uuid: 'uuid-after-end',
      total: 20,
      status: 'issued',
      customer: { name: 'Yeni fatura' },
      items: [{ productCode: 'P4', name: 'B', quantity: 1, unitPrice: 20, vatRate: 20 }]
    },
    {
      invoiceNumber: 'ATK2026000000001',
      invoiceDate: '2026-08-21',
      uuid: 'uuid-atk-1',
      total: 30,
      status: 'queued',
      customer: { name: 'Kuyruk' },
      items: [{ productCode: 'P5', name: 'C', quantity: 1, unitPrice: 30, vatRate: 20 }]
    }
  ]
};
const stale = atak.buildResponse(staleStore, creds, {
  StartDate: '2026-08-01T00:00:00',
  EndDate: '2026-08-19T00:00:00',
  addReturns: 'true'
}, staleNow);
assert(stale.RecordCount === 3, 'eski EndDate bugüne uzar ' + stale.RecordCount);
assert(stale.endDate === '2026-08-25T00:00:00', 'yanıttaki EndDate bugün');
assert(stale.EInvoices.some(x => x.FaturaNo === 'ATA2026000000004'), '20 Ağustos aktarılır');
assert(stale.EInvoices.some(x => x.FaturaNo === 'ATK2026000000001'), 'ATK kuyruk aktarılır');

const pendingStore = {
  customers: [{ id: 'c1', name: 'Ayşe Yılmaz', taxNo: '22222222222', city: 'İstanbul' }],
  invoiceQueue: [],
  financeTransactions: [
    {
      id: 'sale-pending-1',
      kind: 'sale',
      invoiceStatus: 'pending',
      date: '2026-08-22',
      total: 500,
      reference: 'S-99',
      customerId: 'c1',
      items: [{ productCode: 'K1', name: 'Koltuk', quantity: 1, unitPrice: 500, vatRate: 20 }]
    },
    {
      id: 'sale-rapid-open',
      kind: 'sale',
      invoiceStatus: 'pending',
      rapidDraft: true,
      date: '2026-08-22',
      total: 9,
      reference: 'RAPID-1',
      items: [{ name: 'Taslak', quantity: 1, unitPrice: 9, vatRate: 20 }]
    }
  ]
};
const pending = atak.buildResponse(pendingStore, creds, {
  StartDate: '2026-08-01T00:00:00',
  EndDate: '2026-08-31T00:00:00',
  addReturns: 'true'
}, staleNow);
assert(pending.RecordCount === 1, 'kesilmeyen satış aktarılır ' + pending.RecordCount);
assert(pending.EInvoices[0].FaturaNo === 'S-99', 'kesilmeyen fatura no satış referansı');
assert(pending.EInvoices[0].FaturalanacakMusteriAdi === 'Ayşe Yılmaz', 'kesilmeyen müşteri');

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

const copyNow = new Date('2026-08-25T12:00:00');
const pub = atak.publicConfig(creds, { reveal: false, baseUrl: 'https://panel.atakhome.com.tr', now: copyNow });
assert(pub.copyUrl.includes('EInvoiceCode=2E1N1D3E4'), 'copy servis kodu');
assert(pub.copyUrl.includes('client_id=' + muleQuery.client_id), 'copy client');
assert(pub.copyUrl.includes('client_secret=' + muleQuery.client_secret), 'copy secret');
assert(pub.copyUrl.includes('DealerID=340344'), 'copy DealerID');
assert(pub.copyUrl.includes('SystemId=1'), 'copy SystemId');
assert(pub.copyUrl.includes('addReturns=true'), 'copy addReturns');
assert(pub.copyUrl.includes('StartDate=2026-06-27T00:00:00'), 'copy StartDate son 60 gün');
assert(pub.copyUrl.includes('EndDate=2026-08-25T00:00:00'), 'copy EndDate bugün');
assert(!pub.copyUrl.includes('2023-03-'), 'eski örnek tarih yok');
assert(!pub.copyUrl.includes('%3A'), 'tarih encode yok');
assert(pub.copyUrl === 'https://panel.atakhome.com.tr/exp/dms/dms/geteinvoices?client_id=' + muleQuery.client_id + '&client_secret=' + muleQuery.client_secret + '&StartDate=2026-06-27T00:00:00&EndDate=2026-08-25T00:00:00&DealerID=340344&EInvoiceCode=2E1N1D3E4&SystemId=1&addReturns=true', 'Arçelik ile aynı sıra, güncel tarih');

const fs = require('fs');
const path = require('path');
const faturaHtml = fs.readFileSync(path.join(__dirname, '../public/fatura.html'), 'utf8');
const faturaJs = fs.readFileSync(path.join(__dirname, '../public/assets/fatura.js'), 'utf8');
assert(faturaHtml.includes('Kesilmeyen Faturalar'), 'fatura başlık');
assert(!faturaHtml.includes('data-inv-module="efatura"'), 'e-Fatura ağacı yok');
assert(!faturaHtml.includes('data-inv-view="ef_out_pending"'), 'gönderilecek klasör yok');
assert(faturaJs.includes('ATAK_FATURA_BUILD=fix-v264'), 'fatura build');
assert(faturaJs.includes("view:'pending_sales'"), 'varsayılan kesilmeyen');

console.log('atak-geteinvoices.test.js ok');
