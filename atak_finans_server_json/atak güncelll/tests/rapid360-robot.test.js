const assert = require('assert');
const robot = require('../lib/rapid360-robot');

assert.equal(typeof robot.available(), 'boolean');
assert.ok(Array.isArray(robot.PW_SEARCH_PATHS));
assert.ok(robot.PW_SEARCH_PATHS.includes('/root/atak-v10'));
assert.ok(robot.PW_SEARCH_PATHS.includes('/root/atakhome-platform'));
assert.equal(typeof robot.resolvePlaywrightPath(), 'string');
assert.ok(robot.resolvePlaywrightMeta() === null || typeof robot.resolvePlaywrightMeta().entry === 'string');

assert.equal(robot.classifyUrl('https://login.microsoftonline.com/common/oauth2/authorize?x=1'), 'microsoft');
assert.equal(robot.classifyUrl('https://arcelik.okta-emea.com/signin/verify/okta/push'), 'okta');
assert.equal(robot.classifyUrl('https://liverapid360.operations.dynamics.com/?cmp=2521&mi=DmrDetailedSalesReport'), 'dynamics');
assert.equal(robot.classifyUrl('https://panel.atakhome.com.tr/web-admin'), 'other');

assert.equal(robot.trDate('2026-08-18'), '18.08.2026');
assert.equal(robot.trDate('2026-08-20T00:00:00'), '20.08.2026');
assert.equal(robot.trDate(''), '');

async function run(){
  const v = await robot.verifyLaunch();
  assert.equal(typeof v.ok, 'boolean');
  if(!v.ok) assert.ok(v.error.length > 0);

  robot.resetForTests();
  const job = robot.startPull({
    startDate: '2026-08-18',
    endDate: '2026-08-20',
    store: '340334',
    company: '2521',
    runner: async (j) => {
      j.status = 'Telefonda Okta bildirimini onaylayın…';
      await new Promise((r) => setTimeout(r, 30));
      return { json: { value: [{ SalesOrderNumber: 'S1' }] } };
    }
  });
  assert.ok(job.id);
  assert.equal(robot.getJob(job.id).done, false);
  assert.throws(() => robot.startPull({ runner: async () => ({}) }), /zaten çalışıyor/);
  await new Promise((r) => setTimeout(r, 80));
  const done = robot.getJob(job.id);
  assert.equal(done.done, true);
  assert.equal(done.ok, true);
  assert.equal(done.result.json.value[0].SalesOrderNumber, 'S1');

  robot.resetForTests();
  const bad = robot.startPull({
    runner: async () => { throw new Error('Okta şifresi kayıtlı değil.'); }
  });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(robot.getJob(bad.id).ok, false);
  assert.ok(/Okta şifresi/.test(robot.getJob(bad.id).error));

  console.log('rapid360-robot tests OK');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
