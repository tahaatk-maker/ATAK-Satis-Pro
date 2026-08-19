const assert = require('assert');
const auth = require('../lib/rapid360-d365-auth');

function jsonRes(status, body){
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => JSON.stringify(body)
  };
}

async function run(){
  auth.resetPendingForTests();
  assert.equal(auth.normalizeDynamicsUrl('liverapid360.operations.dynamics.com/?cmp=2521'), 'https://liverapid360.operations.dynamics.com');
  assert.equal(auth.isMuleUrl('https://arc-p-ms-op.arcelik.com/exp/dms/dms/geteinvoices'), true);

  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ upn: 'taha@atakhome.com.tr' })).toString('base64url');
  assert.equal(auth.accountFromToken(`${header}.${payload}.x`), 'taha@atakhome.com.tr');

  const pub = auth.publicAuth({
    d365Auth: { accessToken: 'secret-token', account: 'taha@atakhome.com.tr', expiresAt: new Date(Date.now() + 3600000).toISOString() }
  });
  assert.equal(pub.connected, true);
  assert.equal(pub.account, 'taha@atakhome.com.tr');
  assert.ok(!JSON.stringify(pub).includes('secret-token'));

  const started = await auth.startDeviceLogin({
    sessionId: 'sess-1',
    fetchImpl: async (url) => {
      if(String(url).includes('v2.0/devicecode')){
        return jsonRes(400, { error: 'invalid_client' });
      }
      return jsonRes(200, {
        user_code: 'ABCD-EFGH',
        device_code: 'dev-1',
        verification_uri: 'https://microsoft.com/devicelogin',
        verification_uri_complete: 'https://microsoft.com/devicelogin?otc=ABCD-EFGH',
        expires_in: 900,
        interval: 5
      });
    }
  });
  assert.equal(started.userCode, 'ABCD-EFGH');
  assert.ok(started.pollId);
  assert.ok(/Okta Verify/.test(started.message));
  assert.ok(!JSON.stringify(started).includes('dev-1'));

  const pending = await auth.pollDeviceLogin({
    sessionId: 'sess-1',
    pollId: started.pollId,
    fetchImpl: async () => jsonRes(400, { error: 'authorization_pending' })
  });
  assert.equal(pending.pending, true);

  const denied = await auth.pollDeviceLogin({
    sessionId: 'other',
    pollId: started.pollId,
    fetchImpl: async () => jsonRes(200, { access_token: 'nope' })
  });
  assert.equal(denied.ok, false);

  const done = await auth.pollDeviceLogin({
    sessionId: 'sess-1',
    pollId: started.pollId,
    fetchImpl: async () => jsonRes(200, {
      access_token: `${header}.${payload}.x`,
      refresh_token: 'r1',
      expires_in: 3600
    })
  });
  assert.equal(done.ok, true);
  assert.equal(done.tokens.account, 'taha@atakhome.com.tr');
  const saved = auth.persistTokens({}, done.tokens);
  assert.equal(saved.d365Auth.account, 'taha@atakhome.com.tr');
  assert.equal(saved.d365Auth.refreshToken, 'r1');

  console.log('rapid360-d365-auth tests OK');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
