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
const path = require('path');
const { ODATA_ENTITIES } = require('./rapid360-sales-bridge');

const JOB_TTL_MS = 15 * 60 * 1000;
const LOGIN_TIMEOUT_MS = 180000;
const jobs = new Map();
let runningJobId = '';

// Sunucuda birden fazla uygulama klasörü olabilir (atak-v10, atakhome-platform).
// playwright hangisine kurulduysa oradan bul.
const PW_SEARCH_PATHS = [
  path.join(__dirname, '..'),
  '/root/atak-v10',
  '/root/atakhome-platform',
  process.cwd()
];

function resolvePlaywrightMeta(){
  const bases = ['', ...PW_SEARCH_PATHS];
  for(const name of ['playwright', 'playwright-core']){
    for(const base of bases){
      try{
        const opts = base ? { paths: [base] } : undefined;
        const entry = require.resolve(name, opts);
        let version = '';
        try{
          version = String(require(require.resolve(name + '/package.json', opts)).version || '');
        }catch(_){ }
        return { name, entry, version, searchedFrom: base || 'default' };
      }catch(_){ }
    }
  }
  return null;
}

function resolvePlaywrightPath(){
  const meta = resolvePlaywrightMeta();
  return meta ? meta.entry : '';
}

function available(){
  return Boolean(resolvePlaywrightPath());
}

function loadPlaywright(){
  const p = resolvePlaywrightPath();
  if(!p) throw new Error('playwright bulunamadı');
  return require(p);
}

let launchCheck = null;
async function verifyLaunch(){
  if(launchCheck){
    const prev = await launchCheck;
    if(prev.ok) return prev;
    launchCheck = null;
  }
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

async function pageInnerText(page){
  return page.evaluate(() => document.body ? document.body.innerText.slice(0, 4000) : '').catch(() => '');
}

async function clickFirst(page, names){
  for(const re of names){
    try{
      const loc = page.getByText(re).first();
      if(await loc.count()){
        await loc.click({ timeout: 4000 });
        return true;
      }
    }catch(_){ }
  }
  return false;
}

async function typeOktaField(locator, value){
  await locator.click({ timeout: 5000 });
  await locator.fill('');
  await locator.press('Control+A').catch(() => {});
  await locator.type(String(value), { delay: 55 });
}

async function handleOkta(page, opts, job){
  const login = String(opts.oktaLogin || (opts.user || '').split('@')[0] || '').trim();
  try{
    const body = await pageInnerText(page);
    if(/oturum açılamıyor|unable to sign in|invalid credentials|authentication failed|şifre yanlış/i.test(body)){
      throw new Error('Okta “Oturum açılamıyor” dedi. Kullanıcı W340334.1 olmalı (nokta var — W3403341 değil). Şifreyi tekrar denemeyin, hesap kilitlenir. Ayarlar → Rapid Aktar’dan hesabı düzeltin; giriş telefonda Okta bildirimi ile olur.');
    }
    if(/şifreniz ile doğrulayın|verify with your password/i.test(body)){
      setStatus(job, 'Şifre ekranı — Okta bildirimine geçiliyor…');
      const switched = await clickFirst(page, [/başka bir yöntemle doğrula/i, /verify with another method/i, /diğer yöntem/i]);
      if(switched){
        await page.waitForTimeout(1200);
        return;
      }
    }
    const pushClicked = await clickFirst(page, [
      /anlık bildirim gönder/i, /send push/i, /okta verify/i, /telefona bildirim/i, /bildirim gönder/i
    ]);
    if(pushClicked || /anlık bildirim|okta verify|push notification/i.test(body)){
      setStatus(job, 'Telefonda Okta bildirimini onaylayın…');
      return;
    }
    const userSel = 'input[name="identifier"], #okta-signin-username, input[name="username"]';
    const passSel = 'input[name="credentials.passcode"], #okta-signin-password, input[type="password"]';
    const pass = page.locator(passSel).first();
    if(await pass.count() && await pass.isVisible().catch(() => false)){
      if(!opts.password){
        throw new Error('Okta şifresi kayıtlı değil. Ayarlar → Rapid Aktar’dan kullanıcı + şifre kaydedin.');
      }
      if(job._oktaPassTried){
        setStatus(job, 'Okta şifre denendi. Telefonda bildirimi bekleyin veya Ayarlar’daki hesabı kontrol edin…');
        return;
      }
      job._oktaPassTried = true;
      setStatus(job, 'Okta şifresi giriliyor…');
      await typeOktaField(pass, opts.password);
      await clickFirst(page, [/doğrula/i, /^verify$/i, /oturum aç/i]);
      await page.locator('#okta-signin-submit, button[type="submit"], [data-se="save"]').first().click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(1500);
      return;
    }
    const user = page.locator(userSel).first();
    if(await user.count() && await user.isVisible().catch(() => false)){
      const cur = await user.inputValue().catch(() => '');
      if(login && cur !== login){
        setStatus(job, 'Okta kullanıcısı giriliyor…');
        await typeOktaField(user, login);
      }
      await clickFirst(page, [/ileri/i, /^next$/i, /devam/i]);
      await page.locator('#okta-signin-submit, button[type="submit"], [data-se="save"]').first().click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(1200);
    }
  }catch(e){
    if(/Okta|oturum açılamıyor/i.test(String(e && e.message))) throw e;
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

function isMagazaControlName(name){
  return /inventlocation|ma[gğ]aza|retailstore|storeid|^store$|dmrstore|warehouse/i.test(String(name || ''));
}

function magazaFilled(value, store){
  const v = String(value || '').replace(/\s+/g, ' ');
  const w = String(store || '340334');
  return v.includes(w);
}

async function waitReportForm(page, job, timeoutMs = 45000){
  setStatus(job, 'Rapor ekranı yükleniyor (Mağaza kutusu aranıyor)…');
  try{
    await page.waitForFunction(() => {
      const named = [...document.querySelectorAll('[data-dyn-controlname]')];
      if(named.some(el => /inventlocation|magaza|retailstore|storeid|^store$/i.test(el.getAttribute('data-dyn-controlname') || ''))) return true;
      return [...document.querySelectorAll('input:not([type=hidden])')].some(i => /ma[gğ]aza/i.test(i.getAttribute('aria-label') || ''));
    }, { timeout: timeoutMs });
    return true;
  }catch(_){
    return false;
  }
}

async function readMagazaField(page){
  return page.evaluate(() => {
    const vis = (el) => {
      if(!el) return false;
      const r = el.getBoundingClientRect();
      const st = window.getComputedStyle(el);
      return r.width > 8 && r.height > 8 && st.visibility !== 'hidden' && st.display !== 'none';
    };
    const named = [...document.querySelectorAll('[data-dyn-controlname]')];
    const host = named.find(el => /inventlocation|^ma[gğ]aza$|parm+ma[gğ]aza|retailstore|^store$|storeid|dmrstore/i.test(el.getAttribute('data-dyn-controlname') || ''))
      || named.find(el => /inventlocation|magaza|store|warehouse/i.test(el.getAttribute('data-dyn-controlname') || ''));
    let input = host && [...host.querySelectorAll('input:not([type=hidden])')].find(vis);
    if(!input){
      input = [...document.querySelectorAll('input:not([type=hidden])')].find(i => vis(i) && /ma[gğ]aza|inventlocation|depo/i.test((i.getAttribute('aria-label') || '') + (i.id || '') + (i.name || '')));
    }
    if(!input) return { ok: false, value: '', name: host ? host.getAttribute('data-dyn-controlname') : '' };
    input.setAttribute('data-atak-magaza', '1');
    return {
      ok: true,
      value: String(input.value || ''),
      name: host ? host.getAttribute('data-dyn-controlname') : '',
      id: input.id || ''
    };
  }).catch(() => ({ ok: false, value: '', name: '' }));
}

async function clickMagazaLookupRow(page, store){
  const w = String(store || '340334');
  try{
    const row = page.locator('[role="row"], .lookupFlyout tr, [data-dyn-role="GridRow"], .popupWin tr').filter({ hasText: w }).first();
    if(await row.count()){
      await row.click({ timeout: 4000 });
      return true;
    }
  }catch(_){ }
  return page.evaluate((magaza) => {
    const rows = [...document.querySelectorAll('[role="row"], .lookupFlyout tr, [data-dyn-role="GridRow"], .popupWin tr, [id*="Lookup"] [role="option"]')];
    const hit = rows.find(r => (r.innerText || '').includes(magaza) && /ATAK/i.test(r.innerText || ''))
      || rows.find(r => (r.innerText || '').includes(magaza));
    if(hit){ hit.click(); return true; }
    return false;
  }, w).catch(() => false);
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

async function selectMagaza(page, store, job){
  const w = String(store || '340334');
  setStatus(job, `Mağaza ${w} yazılıyor…`);
  for(let attempt = 1; attempt <= 5; attempt++){
    const field = await readMagazaField(page);
    if(field.ok && magazaFilled(field.value, w)){
      setStatus(job, `Mağaza seçildi: ${field.value}`);
      return field;
    }
    const loc = page.locator('[data-atak-magaza="1"], input[aria-label*="Mağaza" i], input[aria-label*="Magaza" i]').first();
    if(await loc.count().catch(() => 0)){
      await loc.click({ timeout: 5000 }).catch(() => {});
      await loc.press('Control+A').catch(() => {});
      await loc.press('Backspace').catch(() => {});
      await page.keyboard.type(w, { delay: 80 });
      await page.waitForTimeout(1600);
      await clickMagazaLookupRow(page, w);
      await loc.press('Tab').catch(() => {});
      await page.waitForTimeout(800);
    }else{
      await page.evaluate((magaza) => {
        const vis = (el) => {
          const r = el.getBoundingClientRect();
          const st = window.getComputedStyle(el);
          return r.width > 8 && r.height > 8 && st.visibility !== 'hidden' && st.display !== 'none';
        };
        const named = [...document.querySelectorAll('[data-dyn-controlname]')];
        const host = named.find(el => /inventlocation|magaza|retailstore|storeid|^store$/i.test(el.getAttribute('data-dyn-controlname') || ''));
        const input = (host && [...host.querySelectorAll('input:not([type=hidden])')].find(vis))
          || [...document.querySelectorAll('input:not([type=hidden])')].find(i => vis(i) && /ma[gğ]aza|inventlocation/i.test((i.getAttribute('aria-label') || '') + (i.id || '')));
        if(!input) return;
        input.focus(); input.click();
        const d = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
        if(d && d.set) d.set.call(input, magaza); else input.value = magaza;
        ['input', 'change', 'blur'].forEach(t => input.dispatchEvent(new Event(t, { bubbles: true })));
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      }, w).catch(() => {});
      await page.waitForTimeout(1200);
      await clickMagazaLookupRow(page, w);
    }
    const after = await readMagazaField(page);
    if(after.ok && magazaFilled(after.value, w)){
      setStatus(job, `Mağaza seçildi: ${after.value}`);
      return after;
    }
    setStatus(job, `Mağaza henüz boş (deneme ${attempt}/5)…`);
    await takeShot(job, page);
    await page.waitForTimeout(1500);
  }
  const last = await readMagazaField(page);
  throw new Error(`Mağaza ${w} seçilemedi${last.value ? ' (kutuda: ' + last.value + ')' : ''}. Sorgula basılmadı — boş rapor gelmesin diye. Ayarlar → Robot testi ile ekran fotoğrafına bakın.`);
}

async function fillReportAndQuery(page, opts, job){
  const start = trDate(opts.startDate);
  const end = trDate(opts.endDate);
  const store = String(opts.store || '340334');
  const formOk = await waitReportForm(page, job);
  if(!formOk) throw new Error('Rapid360 rapor ekranı açılmadı (Mağaza kutusu yok). Okta onayından sonra Satışları oku’ya tekrar basın.');
  await takeShot(job, page);
  setStatus(job, 'Tarih dolduruluyor…');
  const startSel = 'input[aria-label*="Başlangıç" i], input[aria-label*="Baslangic" i], input[id*="FromDate" i], input[name*="FromDate" i], [data-dyn-controlname*="FromDate" i] input';
  const endSel = 'input[aria-label*="Bitiş" i], input[aria-label*="Bitis" i], input[id*="ToDate" i], input[name*="ToDate" i], [data-dyn-controlname*="ToDate" i] input';
  if(start) await typeIntoD365(page, startSel, start);
  if(end) await typeIntoD365(page, endSel, end);
  const mag = await selectMagaza(page, store, job);
  job.meta = job.meta || {};
  job.meta.magazaValue = mag.value || store;
  await takeShot(job, page);
  setStatus(job, `Sorgula (mağaza ${mag.value || store})…`);
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
  if(!clicked) throw new Error('Sorgula düğmesi bulunamadı. Robotun gördüğü ekranı açın.');
  setStatus(job, 'Rapid360 satışları sorgulanıyor…');
  const until = Date.now() + 45000;
  while(Date.now() < until){
    await page.waitForTimeout(3000);
    const stillMag = await readMagazaField(page);
    if(stillMag.ok && !magazaFilled(stillMag.value, store)){
      throw new Error('Sorgula’dan sonra Mağaza kutusu yine boş. 340334 seçilmedi, satış listesi gelmez.');
    }
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
    await page.waitForTimeout(4000);
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
  }catch(e){
    if(e && /Mağaza|rapor ekranı|Sorgula düğmesi/i.test(String(e.message || ''))) throw e;
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
        const hasForm = await page.$('[data-dyn-controlname], input[aria-label*="Mağaza" i]').catch(() => null);
        if(!hasLoginForm && hasForm){ loggedIn = true; break; }
      }
      if(kind === 'microsoft') await handleMicrosoft(page, opts, job);
      else if(kind === 'okta') await handleOkta(page, opts, job);
      await takeShot(job, page);
      await page.waitForTimeout(2000);
    }
    if(!loggedIn){
      await takeShot(job, page);
      throw new Error('Rapid360 girişi tamamlanamadı. Telefonda Okta bildirimini onaylayıp Satışları oku’ya tekrar basın.');
    }
    setStatus(job, 'Mağaza 340334 seçilecek…');
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
    const until = Date.now() + 40000;
    while(Date.now() < until){
      const kind = classifyUrl(page.url());
      try{
        if(kind === 'microsoft') await handleMicrosoft(page, opts, job);
        else if(kind === 'okta') await handleOkta(page, opts, job);
        else if(kind === 'dynamics'){
          const want = opts.store || '340334';
          const cur = await readMagazaField(page);
          if(cur.ok && magazaFilled(cur.value, want)){
            setStatus(job, `Mağaza seçildi: ${cur.value}`);
          }else{
            const form = await waitReportForm(page, job, 8000);
            if(form) await selectMagaza(page, want, job);
          }
        }
      }catch(e){
        setStatus(job, e && e.message ? e.message : 'Robot hatası');
      }
      await takeShot(job, page);
      if(!/Oturum açılamıyor|bildirimini onaylayın|Mağaza/i.test(String(job.status || ''))){
        setStatus(job, `Robot şu an: ${classifyUrl(page.url())} ekranında`);
      }
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
  LOGIN_TIMEOUT_MS,
  PW_SEARCH_PATHS,
  resolvePlaywrightPath,
  resolvePlaywrightMeta,
  isMagazaControlName,
  magazaFilled
};
