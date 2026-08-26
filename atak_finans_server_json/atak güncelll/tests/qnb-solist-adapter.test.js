'use strict';
const assert = require('assert');
const qnb = require('../qnb-solist-adapter');

(async()=>{
  const out = await qnb.sendOrQueueInvoice({
    record: { total: 100, items: [], payments: [] },
    sale: { total: 100, items: [], payments: [] },
    customer: { name: 'Test', taxNo: '11111111111' },
    cfg: {}
  });
  assert.strictEqual(out.ok, false, 'DP yokken ok olmamalı');
  assert.strictEqual(out.keepPending, true, 'Faturalar listesinde kalsın');
  assert.strictEqual(out.eva, true, 'EVA yolu');
  assert.strictEqual(out.mode, 'need_eva');
  assert.strictEqual(out.status, 'pending');
  assert.doesNotMatch(String(out.mode || ''), /queued_local|stub_send/);

  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'qnb-solist-adapter.js'), 'utf8');
  assert.doesNotMatch(src, /queued_local/);
  assert.doesNotMatch(src, /stub_send/);
  assert.match(src, /need_eva/);
  console.log('qnb-solist-adapter.test.js ok');
})().catch(e=>{ console.error(e); process.exit(1); });
