'use strict';

/**
 * Rapid360 robotu — DYNEX mantığının web karşılığı.
 * Sunucuda gizli bir Chromium açar, Microsoft + Okta girişini doldurur,
 * kullanıcı telefonda Okta push onaylar, sonra D365'ten satışları okur
 * (önce OData, olmazsa rapor ekranından XML/Excel indirir).
 * Oturum profili diskte kalır; sonraki çekimler tam otomatik olur.
 */

const crypto = require('crypto');
const fs = require('fs');
const { ODATA_ENTITIES } = require('./rapid360-sales-bridge');

const JOB_TTL_MS = 15 * 60 * 1000;
const LOGIN_TIMEOUT_MS = 180000;
const jobs = new Map();
let runningJobId = '';

function available(){
  try{ require.resolve('playwright'); return true; }
  catch{
    try{ require.resolve('playwright-core'); return true; }
    catch{ return false; }
  }
}

function loadPlaywright(){
  try{ return require('playwright'); }
  catch{ return require('playwright-core'); }
}

let launchCheck = null;
async function verifyLaunch(){
  if(launchCheck) return launchCheck;
  launchCheck = (async () => {
    if(!available()) return { ok: false, error: 'Sunucuda playwright kurulu değil. Hostinger scriptini tekrar çalıştırın.' };
    try{
      const pw = loadPlaywright();
      const b = await pw.chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
      await b.close();
      return { ok: true, error: '' };
    }catch(e){
      return { ok: false, error: ('Chromium açılamadı: ' + String(e && e.message || '').split('\n')[0]).slice(0, 220) };
    }
  })();
  return launchCheck;
}

function classifyUrl(url){
  const u = String(url || '').toLowerCase();
  if(/login\.microsoftonline\.com|login\.live\.com/.test(u)) return 'microsoft';
  if(/okta/.test(u)) return 'okta';
  if(/operations\.dynamics\.com/.test(u)) return 'dynamics';
  return 'other';
}

function sweepJobs(){
  const now = Date.now();
  for(const [id, j] of jobs){
    if(now - j.at > JOB_TTL_MS) jobs.delete(id);
  }
}

let lastJob = null;
function getLastJob(){
  return lastJob;
}

async function takeShot(job, page){
  if(!job || !page) return;
  try{
    job.shot = await page.screenshot({ type: 'png', timeout: 8000 });
    job.shotAt = new Date().toISOString();
    job.lastUrl = String(page.url() || '');
  }catch(_){ }
}

function getJob(id){
  sweepJobs();
  return jobs.get(String(id || '')) || null;
}

function setStatus(job, msg){
  if(job) job.status = String(msg || '');
}

function startPull(opts = {}){
  sweepJobs();
  if(runningJobId && jobs.get(runningJobId) && !jobs.get(runningJobId).done){
    throw new Error('Robot zaten çalışıyor. Birkaç saniye bekleyin.');
  }
  const id = crypto.randomBytes(12).toString('hex');
  const job = {
    id,
    at: Date.now(),
    status: 'Başlatılıyor…',
    done: false,
    ok: false,
    error: '',
    result: null,
    meta: {
      startDate: String(opts.startDate || '').slice(0, 10),
      endDate: String(opts.endDate || '').slice(0, 10),
      store: String(opts.store || '340334'),
      company: String(opts.company || '2521'),
      dealerId: String(opts.dealerId || '')
    }
  };
  jobs.set(id, job);
  runningJobId = id;
  lastJob = job;
  const runner = typeof opts.runner === 'function' ? opts.runner : runPull;
  (async () => {
    try{
      job.result = await runner(job, opts);
      job.ok = true;
      setStatus(job, 'Satışlar alındı');
    }catch(e){
      job.error = e && e.message ? e.message : 'Robot hatası';
      setStatus(job, job.error);
    }finally{
      job.done = true;
      if(runningJobId === id) runningJobId = '';
    }
  })();
  return job;
}

async function handleMicrosoft(page, opts, job){
  try{
    const body = await page.evaluate(() => document.body ? document.body.innerText.slice(0, 3000) : '').catch(() => '');
    const btn = await page.$('#idSIButton9');
    if(btn && /oturum açık|stay signed in|açık kalsın/i.test(body)){
      setStatus(job, 'Oturum açık tutuluyor…');
      await btn.click().catch(() => {});
      return;
    }
    if(opts.user){
      const tile = await page.getByText(opts.user, { exact: false }).first().elementHandle().catch(() => null);
      if(tile){
        setStatus(job, 'Microsoft hesabı seçiliyor…');
        await tile.click().catch(() => {});
        return;
      }
    }
    const email = await page.$('input[name="loginfmt"]');
    if(email){
      setStatus(job, 'Microsoft hesabı giriliyor…');
      await email.fill(String(opts.user || '')).catch(() => {});
      await page.click('#idSIButton9').catch(() => {});
    }
  }catch(_){ }
}

async function handleOkta(page, opts, job){
  const userSel = 'input[name="identifier"], #okta-signin-username, input[name="username"]';
  const passSel = 'input[name="credentials.passcode"], #okta-signin-password, input[type="password"]';
  try{
    const pass = await page.$(passSel);
    if(pass){
      if(!opts.password){
        throw new Error('Okta şifresi kayıtlı değil. Faturalar → Kurulum → Rapid360 Okta şifre alanını doldurun.');
      }
      setStatus(job, 'Okta şifresi giriliyor…');
      await pass.fill(String(opts.password)).catch(() => {});
      await page.click('#okta-signin-submit, input[type="submit"], button[type="submit"], [data-se="save"]').catch(() => {});
      await page.waitForTimeout(1500);
      return;
    }
    const user = await page.$(userSel);
    if(user){
      const cur = await user.inputValue().catch(() => '');
      if(!cur){
        setStatus(job, 'Okta kullanıcısı giriliyor…');
        await user.fill(String(opts.oktaLogin || opts.user || '')).catch(() => {});
      }
      await page.click('#okta-signin-submit, input[type="submit"], button[type="submit"], [data-se="save"]').catch(() => {});
      await page.waitForTimeout(1200);
      return;
    }
    const push = await page.$('[data-se="okta_verify-push"] a, [data-se="okta_verify-push"] button, button:has-text("bildirim"), a:has-text("bildirim"), input[value*="bildirim" i]');
    if(push){
      setStatus(job, 'Telefonda Okta bildirimini onaylayın…');
      await push.click().catch(() => {});
      return;
    }
    const body = await page.evaluate(() => document.body ? document.body.innerText.slice(0, 3000) : '').catch(() => '');
    if(/anlık bildirim|push|Okta Verify/i.test(body)){
      setStatus(job, 'Telefonda Okta bildirimini onaylayın…');
    }
  }catch(e){
    if(/Okta şifresi kayıtlı değil/.test(String(e && e.message))) throw e;
  }
}

async function probeOdata(page){
  for(const entity of ODATA_ENTITIES){
    const out = await page.evaluate(async (name) => {
      try{
        const r = await fetch('/data/' + name + '?cross-company=true&$top=1000', {
          credentials: 'include',
          headers: { Accept: 'application/json' }
        });
        if(!r.ok) return null;
        const j = await r.json();
        return (j && ((j.value && j.value.length) || j.Satislar)) ? j : null;
      }catch(_){ return null; }
    }, entity).catch(() => null);
    if(out) return out;
  }
  return null;
}

function trDate(iso){
  const s = String(iso || '').slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : '';
}

async function typeIntoD365(page, selector, value, { pressEnter = true } = {}){
  const loc = page.locator(selector).first();
  if(!(await loc.count().catch(() => 0))) return false;
  try{
    await loc.click({ timeout: 5000 });
    await loc.fill('');
    await loc.type(String(value), { delay: 70 });
    await page.waitForTimeout(1200);
    if(pressEnter) await loc.press('Enter').catch(() => {});
    await page.waitForTimeout(600);
    return true;
  }catch(_){
    return false;
  }
}

async function fillReportAndQuery(page, opts, job){
  const start = trDate(opts.startDate);
  const end = trDate(opts.endDate);
  setStatus(job, 'Tarih ve mağaza dolduruluyor…');
  // Selenium mantığı: elemanın adresine git, tıkla, değeri yaz, listeden seç.
  const startSel = 'input[aria-label*="Başlangıç" i], input[aria-label*="Baslangic" i], input[id*="FromDate" i], input[name*="FromDate" i]';
  const endSel = 'input[aria-label*="Bitiş" i], input[aria-label*="Bitis" i], input[id*="ToDate" i], input[name*="ToDate" i]';
  const magSel = 'input[aria-label*="Mağaza" i], input[aria-label*="Magaza" i], input[id*="Magaza" i], input[id*="InventLocation" i], input[name*="Store" i]';
  const okStart = start ? await typeIntoD365(page, startSel, start) : false;
  const okEnd = end ? await typeIntoD365(page, endSel, end) : false;
  let okMag = await typeIntoD365(page, magSel, opts.store);
  if(okMag){
    // Lookup listesi açık kaldıysa ilk eşleşen satırı tıkla
    await page.evaluate((magaza) => {
      const rows = [...document.querySelectorAll('[data-dyn-role="LookupGrid"] [role="row"], .lookup-popup [role="row"], [id*="LookupGrid"] [role="row"]')];
      const hit = rows.find(r => (r.innerText || '').includes(String(magaza)));
      if(hit) hit.click();
    }, opts.store).catch(() => {});
    await page.waitForTimeout(800);
  }
  if(!okStart || !okEnd || !okMag){
    await page.evaluate(({ start, end, magaza }) => {
      const setVal = (input, v) => {
        if(!input || !v) return;
        input.focus(); input.click();
        const d = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
        if(d && d.set) d.set.call(input, v); else input.value = v;
        ['input', 'change'].forEach(t => input.dispatchEvent(new Event(t, { bubbles: true })));
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        if(input.blur) input.blur();
      };
      const inputs = [...document.querySelectorAll('input:not([type=hidden])')];
      const byLabel = (re) => inputs.find(i => re.test(
        (i.getAttribute('aria-label') || '') + ' ' + (i.id || '') + ' ' + (i.name || '') + ' ' +
        String((i.closest('[data-dyn-controlname]') || {}).getAttribute ? (i.closest('[data-dyn-controlname]').getAttribute('data-dyn-controlname') || '') : '')
      ));
      setVal(byLabel(/başlangıç|baslangic|fromdate|startdate/i), start);
      setVal(byLabel(/bitiş|bitis|todate|enddate/i), end);
      setVal(byLabel(/ma[gğ]aza|store|inventlocation/i), magaza);
    }, { start, end, magaza: opts.store }).catch(() => {});
  }
  await page.waitForTimeout(1500);
  setStatus(job, 'Sorgula’ya basılıyor…');
  let clicked = false;
  try{
    const btn = page.getByRole('button', { name: /sorgula/i }).first();
    if(await btn.count()){ await btn.click({ timeout: 5000 }); clicked = true; }
  }catch(_){ }
  if(!clicked){
    clicked = await page.evaluate(() => {
      const els = [...document.querySelectorAll('button, [role="button"], span, a, input')];
      const hit = els.find(el => /^sorgula$/i.test(String(el.innerText || el.value || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim()));
      if(hit){ hit.click(); return true; }
      return false;
    }).catch(() => false);
  }
  if(clicked) setStatus(job, 'Rapid360 satışları sorgulanıyor…');
  const until = Date.now() + 45000;
  while(Date.now() < until){
    await page.waitForTimeout(3000);
    const empty = await page.evaluate(() => /Burada gösterecek hiçbir şey bulamadık/i.test(document.body ? document.body.innerText : '')).catch(() => true);
    if(!empty) return true;
  }
  return false;
}

async function clickXmlExport(page){
  try{
    const btn = page.getByRole('button', { name: /xml/i }).first();
    if(await btn.count()){ await btn.click({ timeout: 5000 }); return true; }
  }catch(_){ }
  return page.evaluate(() => {
    const els = [...document.querySelectorAll('button, [role="button"], span, a, input')];
    const label = (el) => String(el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('title') || '').replace(/\s+/g, ' ').trim();
    const hit = els.find(el => /^xml\s*aktar$/i.test(label(el)))
      || els.find(el => /^(XML|Xml)$/.test(label(el)))
      || els.find(el => /xml/i.test(label(el)) && /aktar|indir|export|download/i.test(label(el)))
      || els.find(el => {
        const n = String(el.getAttribute('data-dyn-controlname') || el.id || '');
        return /xml/i.test(n) && /(aktar|export|download|indir)/i.test(n + label(el));
      });
    if(hit){ hit.click(); return true; }
    return false;
  }).catch(() => false);
}

async function downloadReportFile(page, opts, job){
  try{
    if(!/DmrDetailedSalesReport/i.test(String(page.url()))){
      await page.goto(opts.reportUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    }
    setStatus(job, 'Rapor ekranı yükleniyor…');
    await page.waitForTimeout(15000);
    const hasRows = await fillReportAndQuery(page, opts, job);
    if(!hasRows){
      setStatus(job, 'Sorgu boş döndü, XML Aktar deneniyor…');
    }
    const dlPromise = page.waitForEvent('download', { timeout: 120000 });
    setStatus(job, 'XML Aktar’a basılıyor…');
    const clicked = await clickXmlExport(page);
    if(!clicked){
      await page.waitForTimeout(3000);
      await clickXmlExport(page);
    }
    const dl = await dlPromise;
    setStatus(job, 'XML indiriliyor…');
    const filePath = await dl.path();
    const buffer = fs.readFileSync(filePath);
    return { file: { originalname: dl.suggestedFilename() || 'rapid360.xml', buffer } };
  }catch(_){
    return null;
  }
}

async function runPull(job, opts = {}){
  const pw = loadPlaywright();
  if(!pw || !pw.chromium) throw new Error('Sunucuda tarayıcı (playwright) kurulu değil. Deploy scriptini çalıştırın.');
  fs.mkdirSync(opts.profileDir, { recursive: true });
  let ctx;
  try{
    ctx = await pw.chromium.launchPersistentContext(opts.profileDir, {
      headless: true,
      acceptDownloads: true,
      viewport: { width: 1366, height: 900 },
      locale: 'tr-TR',
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });
  }catch(e){
    throw new Error('Sunucuda Chromium açılamadı. Deploy scriptini tekrar çalıştırın. (' + String(e && e.message || '').slice(0, 120) + ')');
  }
  let page = null;
  try{
    page = ctx.pages()[0] || await ctx.newPage();
    setStatus(job, 'Rapid360 açılıyor…');
    await page.goto(opts.reportUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    const deadline = Date.now() + (opts.loginTimeoutMs || LOGIN_TIMEOUT_MS);
    let loggedIn = false;
    while(Date.now() < deadline){
      const kind = classifyUrl(page.url());
      if(kind === 'dynamics'){
        const hasLoginForm = await page.$('input[name="loginfmt"], input[type="password"]').catch(() => null);
        if(!hasLoginForm){ loggedIn = true; break; }
      }
      if(kind === 'microsoft') await handleMicrosoft(page, opts, job);
      else if(kind === 'okta') await handleOkta(page, opts, job);
      await takeShot(job, page);
      await page.waitForTimeout(2000);
    }
    if(!loggedIn){
      await takeShot(job, page);
      throw new Error('Rapid360 girişi tamamlanamadı. Telefonda Okta bildirimini onaylayıp Satışları oku’ya tekrar basın.');
    }    setStatus(job, 'Satışlar okunuyor…');
    await page.waitForTimeout(4000);
    const dl = await downloadReportFile(page, opts, job);
    if(dl){ await takeShot(job, page); return dl; }
    const json = await probeOdata(page);
    if(json){ await takeShot(job, page); return { json }; }
    await takeShot(job, page);
    throw new Error('Rapid360 satış vermedi. Tarihi genişletin veya XML yükleyin.');
  }catch(e){
    if(page && !job.shot) await takeShot(job, page);
    throw e;
  }finally{
    if(ctx) await ctx.close().catch(() => {});
  }
}

async function runProbe(job, opts = {}){
  const pw = loadPlaywright();
  if(!pw || !pw.chromium) throw new Error('Sunucuda tarayıcı (playwright) kurulu değil.');
  fs.mkdirSync(opts.profileDir, { recursive: true });
  const ctx = await pw.chromium.launchPersistentContext(opts.profileDir, {
    headless: true,
    viewport: { width: 1366, height: 900 },
    locale: 'tr-TR',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  });
  try{
    const page = ctx.pages()[0] || await ctx.newPage();
    setStatus(job, 'Robot Rapid360’ı açıyor…');
    await page.goto(opts.reportUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    const until = Date.now() + 25000;
    while(Date.now() < until){
      await takeShot(job, page);
      setStatus(job, `Robot şu an: ${classifyUrl(page.url())} ekranında`);
      await page.waitForTimeout(3000);
    }
    await takeShot(job, page);
    return { probe: { url: String(page.url() || ''), kind: classifyUrl(page.url()) } };
  }finally{
    await ctx.close().catch(() => {});
  }
}

function startProbe(opts = {}){
  return startPull({ ...opts, runner: runProbe });
}

function resetForTests(){
  jobs.clear();
  runningJobId = '';
  lastJob = null;
}

module.exports = {
  available,
  verifyLaunch,
  classifyUrl,
  trDate,
  startPull,
  startProbe,
  runProbe,
  getJob,
  getLastJob,
  runPull,
  resetForTests,
  LOGIN_TIMEOUT_MS
};
