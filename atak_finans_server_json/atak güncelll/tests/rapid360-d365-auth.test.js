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

  const interactive = await auth.startInteractiveLogin({
    sessionId: 'sess-pkce',
    loginHint: 'taha@atakhome.com.tr',
    redirectUri: 'https://panel.atakhome.com.tr/web-api/admin/rapid360-okta-callback',
    rapid: { oauthClientId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }
  });
  assert.ok(interactive.loginUrl.includes('login.microsoftonline.com'));
  assert.ok(interactive.loginUrl.includes('login_hint=taha'));
  assert.ok(interactive.loginUrl.includes('code_challenge'));
  assert.equal(interactive.userCode, undefined);
  assert.ok(!JSON.stringify(interactive).includes('user_code'));
  assert.ok(/Okta Verify/.test(interactive.message));
  assert.ok(!/kod yazılmaz/i.test(JSON.stringify(interactive)));

  const pendingPkce = await auth.pollDeviceLogin({
    sessionId: 'sess-pkce',
    pollId: interactive.pollId
  });
  assert.equal(pendingPkce.pending, true);

  const authed = await auth.completeAuthorizationCode({
    sessionId: 'sess-pkce',
    state: interactive.pollId,
    code: 'auth-code-1',
    fetchImpl: async () => jsonRes(200, {
      access_token: `${header}.${payload}.x`,
      refresh_token: 'r1',
      expires_in: 3600
    })
  });
  assert.equal(authed.ok, true);
  const polled = await auth.pollDeviceLogin({ sessionId: 'sess-pkce', pollId: interactive.pollId });
  assert.equal(polled.ok, true);
  assert.equal(polled.tokens.account, 'taha@atakhome.com.tr');

  auth.resetPendingForTests();
  const noAzureApp = await auth.startInteractiveLogin({
    sessionId: 'sess-noaad',
    redirectUri: 'https://atakhome.com.tr/web-api/admin/rapid360-okta-callback',
    fetchImpl: async (url) => {
      if(String(url).includes('v2.0/devicecode')) return jsonRes(400, { error: 'invalid_client' });
      return jsonRes(200, {
        user_code: 'HIDE-ME',
        device_code: 'dev-x',
        verification_uri_complete: 'https://microsoft.com/devicelogin?otc=HIDE-ME',
        expires_in: 900,
        interval: 5
      });
    }
  });
  assert.ok(!noAzureApp.loginUrl.includes('okta-callback'));
  assert.ok(noAzureApp.loginUrl.includes('liverapid360.operations.dynamics.com'));
  assert.ok(noAzureApp.loginUrl.includes('mi=DmrDetailedSalesReport'));
  assert.ok(noAzureApp.loginUrl.includes('Magaza=340334'));
  assert.ok(!noAzureApp.loginUrl.includes('nativeclient'));
  assert.ok(!noAzureApp.loginUrl.includes('deviceauth'));
  assert.ok(noAzureApp.deviceLoginUrl.includes('otc=HIDE-ME'));
  assert.ok(!noAzureApp.deviceLoginUrl.includes('login_hint'));
  assert.equal(noAzureApp.userCode, undefined);

  auth.resetPendingForTests();
  const started = await auth.startDeviceLogin({
    sessionId: 'sess-1',
    loginHint: 'taha@atakhome.com.tr',
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
  assert.equal(started.userCode, undefined);
  assert.ok(started.loginUrl);
  assert.ok(started.pollId);
  assert.ok(/Okta Verify/.test(started.message));
  assert.ok(!JSON.stringify(started).includes('dev-1'));
  assert.ok(!started.loginUrl.includes('rapid360-okta-callback'));
  assert.ok(started.loginUrl.includes('DmrDetailedSalesReport'));
  assert.ok(started.loginUrl.includes('cmp=2521'));
  assert.ok(started.loginUrl.includes('Magaza=340334'));
  assert.ok(!started.loginUrl.includes('nativeclient'));
  assert.ok(!started.loginUrl.includes('deviceauth'));
  assert.ok(started.deviceLoginUrl.includes('otc=ABCD-EFGH'));
  assert.ok(!started.deviceLoginUrl.includes('login_hint'));
  assert.ok(!('userCode' in started));
  assert.equal(
    auth.dynamicsReportUrl({ company: '2521', store: '340334' }),
    'https://liverapid360.operations.dynamics.com/?cmp=2521&mi=DmrDetailedSalesReport&InventLocationId=340334&Magaza=340334'
  );
  assert.equal(auth.isBlockedMicrosoftUrl('https://login.microsoftonline.com/common/oauth2/nativeclient?code=x'), true);

  assert.equal(auth.isBrokenDeviceLoginUrl('https://login.microsoftonline.com/common/oauth2/deviceauth?login_hint=W340334.1%40x'), true);
  assert.equal(auth.isBrokenDeviceLoginUrl('https://microsoft.com/devicelogin?otc=ABCD-EFGH'), false);
  assert.equal(
    auth.deviceLoginUrl({
      verification_uri: 'https://login.microsoftonline.com/common/oauth2/deviceauth',
      user_code: 'OKTA-OK'
    }),
    'https://login.microsoftonline.com/common/oauth2/deviceauth?otc=OKTA-OK'
  );
  assert.ok(!auth.deviceLoginUrl({
    verification_uri_complete: 'https://microsoft.com/devicelogin?otc=KEEP-ME',
    user_code: 'KEEP-ME'
  }).includes('login_hint'));

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

  auth.resetPendingForTests();
  const onlyUri = await auth.startDeviceLogin({
    sessionId: 'sess-otc',
    loginHint: 'W340334.1@rapid360.arcelikpazarlama.com.tr',
    company: '2521',
    store: '340334',
    fetchImpl: async (url) => {
      if(String(url).includes('v2.0/devicecode')) return jsonRes(400, { error: 'invalid_client' });
      return jsonRes(200, {
        user_code: 'ZZZZ-YYYY',
        device_code: 'dev-2',
        verification_uri: 'https://login.microsoftonline.com/common/oauth2/deviceauth',
        expires_in: 900,
        interval: 5
      });
    }
  });
  assert.ok(onlyUri.loginUrl.includes('DmrDetailedSalesReport'));
  assert.ok(onlyUri.loginUrl.includes('Magaza=340334'));
  assert.ok(!onlyUri.loginUrl.includes('nativeclient'));
  assert.ok(!onlyUri.loginUrl.includes('deviceauth'));
  assert.ok(onlyUri.deviceLoginUrl.includes('otc=ZZZZ-YYYY'));
  assert.ok(!onlyUri.deviceLoginUrl.includes('login_hint'));

  const reused = await auth.startDeviceLogin({
    sessionId: 'sess-otc',
    loginHint: 'W340334.1@rapid360.arcelikpazarlama.com.tr',
    fetchImpl: async () => { throw new Error('should reuse pending otc url'); }
  });
  assert.equal(reused.pollId, onlyUri.pollId);
  assert.ok(reused.loginUrl.includes('DmrDetailedSalesReport'));
  assert.ok(reused.deviceLoginUrl.includes('otc=ZZZZ-YYYY'));
  assert.ok(!reused.deviceLoginUrl.includes('login_hint'));

  console.log('rapid360-d365-auth tests OK');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
