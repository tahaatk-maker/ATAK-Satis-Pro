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
    redirectUri: 'https://atakhome.com.tr/web-api/admin/rapid360-okta-callback',
    rapid: { oauthClientId: '51f81489-12ee-4a9e-aaae-a2591f45987d' }
  });
  assert.ok(interactive.loginUrl.includes('liverapid360.operations.dynamics.com'));
  assert.ok(interactive.loginUrl.includes('mi=DmrDetailedSalesReport'));
  assert.ok(!interactive.loginUrl.includes('login.microsoftonline.com'));
  assert.ok(!interactive.loginUrl.includes('rapid360-okta-callback'));
  assert.ok(!interactive.loginUrl.includes('code_challenge'));
  assert.ok(!JSON.stringify(interactive).includes('51f81489'));
  assert.equal(interactive.deviceLoginUrl, undefined);
  assert.ok(/Kod yazılmaz/i.test(interactive.message));

  auth.resetPendingForTests();
  const noAzureApp = await auth.startInteractiveLogin({
    sessionId: 'sess-noaad',
    redirectUri: 'https://atakhome.com.tr/web-api/admin/rapid360-okta-callback'
  });
  assert.ok(!noAzureApp.loginUrl.includes('okta-callback'));
  assert.ok(noAzureApp.loginUrl.includes('liverapid360.operations.dynamics.com'));
  assert.ok(noAzureApp.loginUrl.includes('mi=DmrDetailedSalesReport'));
  assert.ok(noAzureApp.loginUrl.includes('cmp=2521'));
  assert.ok(!noAzureApp.loginUrl.includes('Magaza='));
  assert.ok(!noAzureApp.loginUrl.includes('nativeclient'));
  assert.ok(!noAzureApp.loginUrl.includes('deviceauth'));
  assert.equal(noAzureApp.deviceLoginUrl, undefined);

  auth.resetPendingForTests();
  const started = await auth.startDeviceLogin({
    sessionId: 'sess-1',
    loginHint: 'taha@atakhome.com.tr'
  });
  assert.equal(started.userCode, undefined);
  assert.ok(started.loginUrl);
  assert.ok(/Okta/.test(started.message));
  assert.ok(/Kod yazılmaz/i.test(started.message));
  assert.ok(!started.loginUrl.includes('rapid360-okta-callback'));
  assert.ok(started.loginUrl.includes('DmrDetailedSalesReport'));
  assert.ok(started.loginUrl.includes('cmp=2521'));
  assert.ok(!started.loginUrl.includes('Magaza='));
  assert.ok(!started.loginUrl.includes('nativeclient'));
  assert.ok(!started.loginUrl.includes('deviceauth'));
  assert.ok(!started.loginUrl.includes('login.microsoftonline.com'));
  assert.equal(started.deviceLoginUrl, undefined);
  const report = auth.dynamicsReportUrl({ company: '2521', store: '340334', startDate: '2026-08-18', endDate: '2026-08-19' });
  assert.ok(report.includes('cmp=2521'));
  assert.ok(report.includes('mi=DmrDetailedSalesReport'));
  assert.ok(report.includes('prt=initial'));
  assert.ok(!report.includes('Magaza='));
  assert.ok(!report.includes('parmMagaza'));
  assert.ok(!report.includes('nativeclient'));
  assert.equal(auth.isBlockedMicrosoftUrl('https://login.microsoftonline.com/common/oauth2/nativeclient?code=x'), true);
  assert.equal(auth.isBlockedMicrosoftUrl('https://login.microsoftonline.com/login.srf'), true);
  assert.equal(auth.isBlockedMicrosoftUrl('https://atakhome.com.tr/web-api/admin/rapid360-okta-callback'), true);

  assert.equal(auth.isBrokenDeviceLoginUrl('https://login.microsoftonline.com/common/oauth2/deviceauth?login_hint=W340334.1%40x'), true);
  assert.equal(auth.isBrokenDeviceLoginUrl('https://microsoft.com/devicelogin?otc=ABCD-EFGH'), false);
  assert.equal(
    auth.deviceLoginUrl({
      verification_uri: 'https://login.microsoftonline.com/common/oauth2/deviceauth',
      user_code: 'OKTA-OK'
    }),
    'https://microsoft.com/devicelogin?otc=OKTA-OK'
  );
  assert.ok(!auth.deviceLoginUrl({
    verification_uri_complete: 'https://login.microsoftonline.com/common/oauth2/deviceauth?otc=KEEP-ME',
    user_code: 'KEEP-ME'
  }).includes('deviceauth'));
  assert.ok(!auth.deviceLoginUrl({
    verification_uri_complete: 'https://microsoft.com/devicelogin?otc=KEEP-ME',
    user_code: 'KEEP-ME'
  }).includes('login_hint'));

  const saved = auth.persistTokens({}, {
    access_token: `${header}.${payload}.x`,
    refresh_token: 'r1',
    expires_in: 3600,
    account: 'taha@atakhome.com.tr'
  });
  assert.equal(saved.d365Auth.account, 'taha@atakhome.com.tr');
  assert.equal(saved.d365Auth.refreshToken, 'r1');

  auth.resetPendingForTests();
  const webOnly = auth.startWebOnlyLogin({
    company: '2521',
    store: '340334',
    startDate: '2026-08-18',
    endDate: '2026-08-19'
  });
  assert.ok(webOnly.loginUrl.includes('liverapid360.operations.dynamics.com'));
  assert.ok(webOnly.loginUrl.includes('mi=DmrDetailedSalesReport'));
  assert.ok(!webOnly.loginUrl.includes('Magaza='));
  assert.ok(!webOnly.loginUrl.includes('StartDate='));
  assert.equal(webOnly.deviceLoginUrl, undefined);
  assert.ok(!('deviceLoginUrl' in webOnly));
  assert.ok(!JSON.stringify(webOnly).includes('user_code'));
  assert.ok(!JSON.stringify(webOnly).includes('devicelogin'));
  assert.ok(!JSON.stringify(webOnly).includes('deviceauth'));
  assert.ok(/Kod yazılmaz/i.test(webOnly.message));
  assert.ok(/Satışları oku/i.test(webOnly.message));
  assert.ok(!JSON.stringify(webOnly).includes('51f81489'));
  assert.ok(!webOnly.loginUrl.includes('rapid360-okta-callback'));

  const fs = require('fs');
  const path = require('path');
  for (const file of ['admin.js', 'personel.js']) {
    const src = fs.readFileSync(path.join(__dirname, '../public/assets', file), 'utf8');
    assert.ok(src.includes('function rapidBlockedMicrosoftHref'), `${file} Microsoft popup kilidi fonksiyonu yok`);
    assert.ok(src.includes("blocked='login.microsoftonline.com'"), `${file} Hostinger grep -F kilidi yok`);
  }

  console.log('rapid360-d365-auth tests OK');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
