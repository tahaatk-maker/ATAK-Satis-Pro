const assert = require('assert');
const {
  fetchRapid360Sales,
  candidateUrls,
  salesQueryVariants,
  resolveSalesConsume,
  keepSaleStore
} = require('../lib/rapid360-sales-fetch');

function makeStore(over = {}) {
  return {
    invoiceIntegration: {
      rapid360: {
        enabled: true,
        dealerId: '340344',
        apiKey: 'k',
        clientId: 'c',
        clientSecret: 'secret-value',
        url: 'https://example.test/exp/dms/dms/geteinvoices',
        ...over,
      },
    },
  };
}

function xmlBody(store) {
  const magaza = store || '340334';
  return `<?xml version="1.0"?>
<Satislar XMLVERSION="1">
  <SatisBilgileri SiparisNo="R1" SiparisTarihi="18/03/2026" MusteriKodu="C1" Ad="ALI" Soyad="SEZER" ToplamTutar="100" Magaza="${magaza}">
    <SatisSatirlari>
      <SatisSatiri MalzemeKodu="P1" MalzemeAdi="Urun" Miktar="1" BirimFiyat="100" Tutar="100" KDVOrani="20"/>
    </SatisSatirlari>
  </SatisBilgileri>
</Satislar>`;
}

async function run() {
  const urls = candidateUrls({ url: 'https://example.test/exp/dms/dms/geteinvoices' });
  assert.ok(urls.some((u) => u.endsWith('/getdetailedsales')));
  assert.ok(!urls.some((u) => /geteinvoices$/i.test(u)));

  const consume = resolveSalesConsume({ dealerId: '21134761', url: 'https://example.test/x', clientId: 'c', clientSecret: 's' });
  assert.equal(consume.dealerId, '340344');
  const q = salesQueryVariants(consume, { startDate: '2026-08-18', endDate: '2026-08-19', store: '340334', company: '2521' });
  assert.ok(q[0].includes('DealerID=340344'));
  assert.ok(!q[0].includes('Magaza='));
  assert.ok(!q[0].includes('Sirket=340334'));
  assert.ok(q.some((s) => s.includes('Magaza=340334') && s.includes('Company=2521')));
  assert.ok(keepSaleStore({ store: '340344' }, '340334'));
  assert.ok(!keepSaleStore({ store: '999' }, '340334'));

  const origChair = global.fetch;
  global.fetch = async (url) => {
    const u = String(url);
    assert.ok(!u.includes('DealerID=21134761'));
    if (u.includes('getdetailedsales') && u.includes('DealerID=340344')) {
      return { ok: true, status: 200, text: async () => xmlBody() };
    }
    return { ok: false, status: 404, text: async () => '' };
  };
  try {
    const out = await fetchRapid360Sales({
      store: makeStore({ dealerId: '21134761' }),
      startDate: '2026-03-01',
      endDate: '2026-03-18',
    });
    assert.equal(out.ok, true, out.error);
    assert.ok(out.sourceUrl.includes('DealerID=340344'));
  } finally {
    global.fetch = origChair;
  }

  const orig = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes('getdetailedsales')) {
      return { ok: true, status: 200, text: async () => xmlBody() };
    }
    return { ok: false, status: 404, text: async () => '' };
  };
  try {
    const out = await fetchRapid360Sales({
      store: makeStore(),
      startDate: '2026-03-01',
      endDate: '2026-03-18',
    });
    assert.equal(out.ok, true);
    assert.equal(out.parsed.sales.length, 1);
    assert.equal(out.parsed.sales[0].custName, 'ALI SEZER');
    assert.ok(out.sourceUrl.includes('DealerID=340344'));
    assert.ok(!out.sourceUrl.includes('secret-value'));
    assert.ok(!out.sourceUrl.includes('Sirket=340334'));
  } finally {
    global.fetch = orig;
  }

  const origStore = global.fetch;
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('getdetailedsales') && !u.includes('Magaza=')) {
      return { ok: true, status: 200, text: async () => xmlBody('340344') };
    }
    return { ok: true, status: 200, text: async () => '<Satislar/>' };
  };
  try {
    const out = await fetchRapid360Sales({
      store: makeStore(),
      magaza: '340334',
      startDate: '2026-03-01',
      endDate: '2026-03-18',
    });
    assert.equal(out.ok, true, out.error);
    assert.equal(out.parsed.sales[0].store, '340344');
  } finally {
    global.fetch = origStore;
  }

  const origJson = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    text: async () => JSON.stringify({
      Satislar: {
        SatisBilgileri: {
          SiparisNo: 'J1',
          SiparisTarihi: '18/03/2026',
          Ad: 'AYSE',
          Soyad: 'KAYA',
          MusteriKodu: 'C2',
          ToplamTutar: '50',
          SatisSatirlari: { SatisSatiri: { MalzemeKodu: 'P2', MalzemeAdi: 'Urun', Miktar: '1', Tutar: '50' } }
        }
      }
    })
  });
  try {
    const out = await fetchRapid360Sales({
      store: makeStore({ salesUrl: 'https://example.test/exp/dms/dms/getsales' }),
      startDate: '2026-03-01',
      endDate: '2026-03-18',
    });
    assert.equal(out.ok, true);
    assert.equal(out.parsed.sales[0].custName, 'AYSE KAYA');
  } finally {
    global.fetch = origJson;
  }

  const orig2 = global.fetch;
  global.fetch = async () => ({ ok: false, status: 404, text: async () => '' });
  try {
    const out = await fetchRapid360Sales({
      store: makeStore(),
      startDate: '2026-03-01',
      endDate: '2026-03-18',
    });
    assert.equal(out.ok, false);
    assert.equal(out.needsOkta, true);
    assert.ok(/Okta/i.test(out.error));
  } finally {
    global.fetch = orig2;
  }

  const origEmpty = global.fetch;
  global.fetch = async () => ({ ok: false, status: 404, text: async () => '' });
  try {
    const empty = await fetchRapid360Sales({
      store: { invoiceIntegration: { rapid360: {} } },
      startDate: '2026-08-18',
      endDate: '2026-08-18',
    });
    assert.equal(empty.ok, false);
    assert.equal(empty.needsOkta, true);
    assert.ok(/Okta/i.test(empty.error));
    assert.ok(!/Servis URL, Client ID ve Client secret kaydedin/i.test(empty.error));
  } finally {
    global.fetch = origEmpty;
  }

  const origOkta = global.fetch;
  let muleHits = 0;
  global.fetch = async (url) => {
    const u = String(url);
    if (/getdetailedsales|getsales|geteinvoices/i.test(u)) {
      muleHits += 1;
      return { ok: false, status: 404, text: async () => '' };
    }
    if (u.includes('/data/') && !u.includes('SalesOrderLines')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ value: [{ name: 'SalesOrderLinesV3' }] }) };
    }
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        value: [{
          SalesOrderNumber: 'S1',
          ItemNumber: 'P1',
          ItemName: 'Buzdolabi',
          InventLocationId: '340334',
          OrderDate: '2026-08-18',
          LineAmount: 100,
          OrderedSalesQuantity: 1,
          OrderingCustomerAccountNumber: 'C1',
          CustomerName: 'ALI SEZER'
        }]
      })
    };
  };
  try {
    const out = await fetchRapid360Sales({
      store: makeStore({
        d365Auth: {
          accessToken: 'tok',
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
          dynamicsUrl: 'https://liverapid360.operations.dynamics.com'
        }
      }),
      startDate: '2026-08-18',
      endDate: '2026-08-18',
    });
    assert.equal(out.ok, true, out.error);
    assert.equal(out.via, 'okta');
    assert.equal(out.parsed.sales[0].salesId, 'S1');
    assert.equal(muleHits, 0);
  } finally {
    global.fetch = origOkta;
  }

  console.log('rapid360-sales-fetch tests OK');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
