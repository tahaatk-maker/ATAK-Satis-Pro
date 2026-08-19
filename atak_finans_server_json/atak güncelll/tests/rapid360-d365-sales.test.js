const assert = require('assert');
const d365 = require('../lib/rapid360-d365-sales');

function jsonRes(status, body){
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => JSON.stringify(body)
  };
}

async function run(){
  assert.ok(d365.scoreEntityName('DmrDetailedSalesReportLines') > d365.scoreEntityName('SalesOrderHeadersV2'));
  assert.equal(d365.filterSales([
    { store: '340334', orderDate: '2026-08-18', total: 10 },
    { store: '999', orderDate: '2026-08-18', total: 10 }
  ], { store: '340334', startDate: '2026-08-18', endDate: '2026-08-18' }).length, 1);

  const out = await d365.fetchWithToken({
    token: 'tok',
    dynamicsUrl: 'https://liverapid360.operations.dynamics.com',
    company: '2521',
    store: '340334',
    startDate: '2026-08-18',
    endDate: '2026-08-18',
    odataEntity: 'SalesOrderLinesV3',
    fetchImpl: async (url) => {
      const u = String(url);
      if(u.endsWith('/data/') || u.endsWith('/data')){
        return jsonRes(200, { value: [{ name: 'SalesOrderLinesV3' }] });
      }
      if(u.includes('$top=1')){
        return jsonRes(200, { value: [{ SalesOrderNumber: 'S1', ItemNumber: 'P1', InventLocationId: '340334', OrderDate: '2026-08-18', LineAmount: 100, OrderedSalesQuantity: 1, OrderingCustomerAccountNumber: 'C1', CustomerName: 'ALI SEZER' }] });
      }
      return jsonRes(200, {
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
      });
    }
  });
  assert.equal(out.ok, true, out.error);
  assert.equal(out.parsed.sales.length, 1);
  assert.equal(out.parsed.sales[0].salesId, 'S1');
  assert.equal(out.parsed.sales[0].custName, 'ALI SEZER');
  assert.equal(out.parsed.sales[0].lines[0].itemCode, 'P1');

  const unauth = await d365.fetchWithToken({
    token: 'tok',
    odataEntity: 'SalesOrderLinesV3',
    fetchImpl: async () => jsonRes(401, { error: { message: 'expired' } })
  });
  assert.equal(unauth.needsOkta, true);

  console.log('rapid360-d365-sales tests OK');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
