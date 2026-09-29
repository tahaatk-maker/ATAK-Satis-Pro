'use strict';

const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const robot = require('../lib/rapid360-robot');

const fixture = fs.readFileSync(path.join(__dirname, 'fixtures', 'okta-next.html'), 'utf8');

async function run(){
  if(!robot.available()){
    console.log('rapid360-okta-next SKIP (playwright yok — Hostinger’da Chromium ile çalışır)');
    return;
  }
  const launch = await robot.verifyLaunch();
  if(!launch.ok){
    console.log('rapid360-okta-next SKIP (' + launch.error + ')');
    return;
  }
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fixture);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const pw = robot.loadPlaywright();
  const browser = await pw.chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try{
    const page = await browser.newPage();
    await page.goto('http://127.0.0.1:' + port + '/', { waitUntil: 'domcontentloaded' });
    const job = { stage: '', status: '', error: '', meta: {} };
    const ok = await robot.clickNextAndWaitForPassword(page, job);
    assert.equal(ok, true);
    assert.equal(await page.locator('#okta-signin-password').isVisible(), true);
    console.log('rapid360-okta-next Chromium OK (İleri → şifre alanı)');
  }finally{
    await browser.close().catch(() => {});
    await new Promise((resolve) => server.close(resolve));
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
