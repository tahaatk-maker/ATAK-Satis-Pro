const assert = require('assert');
const { fetchRapid360Sales, candidateUrls } = require('../lib/rapid360-sales-fetch');

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

function xmlBody() {
  return `<?xml version="1.0"?>
<Satislar XMLVERSION="1">
  <SatisBilgileri SiparisNo="R1" SiparisTarihi="18/03/2026" MusteriKodu="C1" Ad="ALI" Soyad="SEZER" ToplamTutar="100" Magaza="340334">
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

  await assert.rejects(
    () => fetchRapid360Sales({ store: makeStore({ dealerId: '21134761' }), startDate: '2026-03-01', endDate: '2026-03-18' }),
    /21134761/
  );

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
    assert.ok(out.sourceUrl.includes('Magaza=340334'));
  } finally {
    global.fetch = orig;
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
    assert.ok(/XML/i.test(out.error));
  } finally {
    global.fetch = orig2;
  }

  console.log('rapid360-sales-fetch tests OK');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
