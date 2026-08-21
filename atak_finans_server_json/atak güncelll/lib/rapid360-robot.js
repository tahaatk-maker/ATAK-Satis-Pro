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

function turkeyTodayIso(){
  try{
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Istanbul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date());
  }catch(_){
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
}

function foldButtonText(text){
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/İ/g, 'I')
    .replace(/ı/g, 'i')
    .toLowerCase();
}

function isNextButtonLabel(text){
  return /^(ileri|next|continue|devam(\s+et(mek)?)?)$/.test(foldButtonText(text));
}

function isLoginButtonLabel(text){
  return /^(dogrula|doğrula|verify|oturum ac|oturum aç|sign in|log in|login|giris(\s+yap)?|giriş(\s+yap)?)$/.test(foldButtonText(text));
}

function setStatus(job, msg){
  if(job) job.status = String(msg || '');
}

function robotLog(job, stage, message){
  if(job){
    job.stage = stage;
    if(message) job.status = message;
    else job.status = stage;
  }
  console.log('[RAPID-ROBOT] ' + stage + (message ? ' ' + message : ''));
}

function robotFail(job, stage, message){
  const msg = String(message || 'Robot hatası');
  if(job){
    job.stage = stage;
    job.error = msg;
    job.status = msg;
  }
  console.error('[RAPID-ROBOT-ERROR] stage=' + stage + ' message=' + msg);
  const err = new Error(msg);
  err.stage = stage;
  throw err;
}

function jobPublicView(job){
  if(!job) return null;
  const today = turkeyTodayIso();
  return {
    stage: job.stage || '',
    url: job.lastUrl || '',
    store: (job.meta && job.meta.store) || '340334',
    date: (job.meta && (job.meta.date || job.meta.startDate)) || today,
    error: job.error || null,
    status: job.status || '',
    done: Boolean(job.done),
    ok: Boolean(job.ok),
    hasShot: Boolean(job.shot)
  };
}

function startPull(opts = {}){
  sweepJobs();
  if(runningJobId && jobs.get(runningJobId) && !jobs.get(runningJobId).done){
    throw new Error('Robot zaten çalışıyor. Birkaç saniye bekleyin.');
  }
  const today = turkeyTodayIso();
  const id = crypto.randomBytes(12).toString('hex');
  const job = {
    id,
    at: Date.now(),
    status: 'Başlatılıyor…',
    stage: 'START',
    done: false,
    ok: false,
    error: '',
    result: null,
    meta: {
      startDate: today,
      endDate: today,
      date: today,
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
      if(job.stage !== 'SALES_IMPORTED' && job.result && !job.result.probe){
        robotLog(job, 'SALES_IMPORTED', 'Satışlar alındı');
      }else{
        setStatus(job, job.status || 'Satışlar alındı');
      }
    }catch(e){
      job.error = e && e.message ? e.message : 'Robot hatası';
      if(e && e.stage) job.stage = e.stage;
      if(!job.stage) job.stage = 'ERROR';
      console.error('[RAPID-ROBOT-ERROR] stage=' + job.stage + ' message=' + job.error);
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

async function clickWithFallback(page, locator){
  try{
    await locator.click({ timeout: 4000 });
    return 'click';
  }catch(_){ }
  try{
    await locator.click({ force: true, timeout: 4000 });
    return 'force';
  }catch(_){ }
  try{
    await locator.evaluate((el) => el.click());
    return 'evaluate';
  }catch(_){ }
  return '';
}

async function usernameLocator(page){
  return page.locator('input[name="identifier"], #okta-signin-username, input[name="username"]:not([type=hidden])').first();
}

async function passwordLocator(page){
  return page.locator('input[name="credentials.passcode"], #okta-signin-password, input[type="password"]:not([type=hidden])').first();
}

async function isVisibleLocator(loc){
  try{
    return (await loc.count()) > 0 && await loc.isVisible();
  }catch(_){
    return false;
  }
}

async function passwordVisible(page){
  return isVisibleLocator(await passwordLocator(page));
}

async function usernameVisible(page){
  return isVisibleLocator(await usernameLocator(page));
}

async function markVisibleButtonByLabel(page, kind){
  return page.evaluate((which) => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      const st = window.getComputedStyle(el);
      return r.width > 8 && r.height > 8 && st.visibility !== 'hidden' && st.display !== 'none' && !el.disabled;
    };
    const labelOf = (el) => String(el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('value') || '').replace(/\s+/g, ' ').trim();
    const nextRe = /^(ileri|next|continue|devam(\s+et(mek)?)?)$/i;
    const loginRe = /^(doğrula|dogrula|verify|oturum aç|oturum ac|sign in|log in|login|giriş(\s+yap)?|giris(\s+yap)?)$/i;
    const fold = (s) => String(s || '').replace(/\s+/g, ' ').trim().replace(/İ/g, 'I').replace(/ı/g, 'i').toLowerCase();
    const re = which === 'login' ? loginRe : nextRe;
    const attr = which === 'login' ? 'data-atak-login' : 'data-atak-next';
    [...document.querySelectorAll('[data-atak-next],[data-atak-login]')].forEach((el) => {
      el.removeAttribute('data-atak-next');
      el.removeAttribute('data-atak-login');
    });
    const els = [...document.querySelectorAll('button, input[type=submit], input[type=button], a[role=button], [role=button]')];
    const hit = els.find((el) => vis(el) && re.test(fold(labelOf(el))));
    if(!hit) return '';
    hit.setAttribute(attr, '1');
    return labelOf(hit);
  }, kind).catch(() => '');
}

async function waitForPasswordPage(page, timeoutMs = 15000){
  const started = Date.now();
  while(Date.now() - started < timeoutMs){
    if(await passwordVisible(page)) return true;
    await page.waitForTimeout(350);
  }
  return passwordVisible(page);
}

async function clickNextAndWaitForPassword(page, job){
  const user = await usernameLocator(page);
  await user.press('Tab').catch(() => {});
  await page.waitForTimeout(400);

  const nextNames = ['İleri', 'Ileri', 'ileri', 'Next', 'Continue', 'Devam', 'Devam et', 'Devam etmek'];
  for(const name of nextNames){
    const roleNext = page.getByRole('button', { name, exact: true }).first();
    if(await roleNext.count()){
      const how = await clickWithFallback(page, roleNext);
      if(how) console.log('[RAPID-ROBOT] NEXT click via role(' + name + ')+' + how);
      if(await waitForPasswordPage(page, 4000)) return true;
    }
  }

  const label = await markVisibleButtonByLabel(page, 'next');
  if(label){
    const marked = page.locator('[data-atak-next="1"]').first();
    const how = await clickWithFallback(page, marked);
    if(how) console.log('[RAPID-ROBOT] NEXT click via visible:' + label + '+' + how);
  }
  if(await waitForPasswordPage(page, 4000)) return true;

  await user.press('Enter').catch(() => {});
  console.log('[RAPID-ROBOT] NEXT fallback Enter on username');
  if(await waitForPasswordPage(page, 8000)) return true;

  await takeShot(job, page);
  return false;
}

async function clickLoginSubmit(page){
  const loginNames = ['Doğrula', 'Dogrula', 'Verify', 'Oturum aç', 'Sign in', 'Log in', 'Login', 'Giriş', 'Giriş yap'];
  for(const name of loginNames){
    const role = page.getByRole('button', { name, exact: true }).first();
    if(await role.count()){
      const how = await clickWithFallback(page, role);
      if(how) return how;
    }
  }
  const label = await markVisibleButtonByLabel(page, 'login');
  if(label){
    const how = await clickWithFallback(page, page.locator('[data-atak-login="1"]').first());
    if(how) return how;
  }
  const submit = page.locator('#okta-signin-submit, button[type="submit"], input[type="submit"], [data-type="save"], [data-se="save"]').first();
  if(await submit.count()){
    const how = await clickWithFallback(page, submit);
    if(how) return how;
  }
  const pass = await passwordLocator(page);
  await pass.press('Enter').catch(() => {});
  return 'enter';
}

async function handleOkta(page, opts, job){
  const login = String(opts.oktaLogin || (opts.user || '').split('@')[0] || '').trim();
  const body = await pageInnerText(page);
  if(/oturum açılamıyor|unable to sign in|invalid credentials|authentication failed|şifre yanlış/i.test(body)){
    robotFail(job, job.stage || 'LOGIN_CLICKED', 'Okta “Oturum açılamıyor” dedi. Kullanıcı W340334.1 olmalı (nokta var). Ayarlar → Rapid Aktar şifresini kontrol edin.');
  }

  if(await passwordVisible(page)){
    robotLog(job, 'PASSWORD_PAGE', 'Şifre ekranı açıldı');
    if(!opts.password){
      robotFail(job, 'PASSWORD_PAGE', 'Okta şifresi kayıtlı değil. Ayarlar → Rapid Aktar’dan şifre kaydedin.');
    }
    if(job._oktaPassTried){
      setStatus(job, 'Okta şifre gönderildi, sonuç bekleniyor…');
      return;
    }
    const pass = await passwordLocator(page);
    await typeOktaField(pass, opts.password);
    robotLog(job, 'PASSWORD_FILLED', 'Kayıtlı Okta şifresi yazıldı');
    await takeShot(job, page);
    job._oktaPassTried = true;
    await clickLoginSubmit(page);
    robotLog(job, 'LOGIN_CLICKED', 'Oturum aç / Doğrula basıldı');
    await takeShot(job, page);
    await page.waitForTimeout(1500);
    return;
  }

  if(await usernameVisible(page)){
    robotLog(job, 'USERNAME_PAGE', 'Okta kullanıcı adı ekranı');
    const user = await usernameLocator(page);
    const cur = await user.inputValue().catch(() => '');
    if(login && cur !== login){
      await typeOktaField(user, login);
    }
    const after = await user.inputValue().catch(() => '');
    if(login && after !== login){
      robotFail(job, 'USERNAME_PAGE', 'Kullanıcı adı yazılamadı (kutuda: ' + after + ')');
    }
    robotLog(job, 'USERNAME_FILLED', 'Kullanıcı adı: ' + (after || login));
    await takeShot(job, page);
    const ok = await clickNextAndWaitForPassword(page, job);
    if(!ok){
      robotFail(job, 'NEXT_CLICKED', 'İleri basıldı ama şifre alanı gelmedi. Ekran fotoğrafına bakın.');
    }
    robotLog(job, 'NEXT_CLICKED', 'İleri sonrası şifre alanı göründü');
    await takeShot(job, page);
    return;
  }

  if(/anlık bildirim|okta verify|push notification|telefonda/i.test(body)){
    robotLog(job, 'LOGIN_CLICKED', 'Telefonda Okta bildirimini onaylayın…');
    await clickFirst(page, [/anlık bildirim gönder/i, /send push/i]);
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
  robotFail(job, 'STORE_SELECTED', `Mağaza ${w} seçilemedi${last.value ? ' (kutuda: ' + last.value + ')' : ''}. Sorgula basılmadı.`);
}

async function waitQuerySettled(page){
  return page.evaluate(() => {
    const t = document.body ? document.body.innerText : '';
    if(/Burada gösterecek hiçbir şey bulamadık|kayıt yok|no data to display|no records/i.test(t)) return 'empty';
    const rows = [...document.querySelectorAll('[data-dyn-role="GridRow"], table tbody tr, [role="row"]')];
    const real = rows.filter((r) => String(r.innerText || '').trim().length > 2);
    if(real.length > 1) return 'rows';
    return '';
  }).catch(() => '');
}

async function fillReportAndQuery(page, opts, job){
  const todayIso = turkeyTodayIso();
  const todayTr = trDate(todayIso);
  const store = String(opts.store || '340334');
  job.meta = job.meta || {};
  job.meta.startDate = todayIso;
  job.meta.endDate = todayIso;
  job.meta.date = todayIso;
  robotLog(job, 'RAPID_PAGE', 'Rapid360 rapor ekranı bekleniyor');
  const formOk = await waitReportForm(page, job);
  if(!formOk) robotFail(job, 'RAPID_PAGE', 'Rapid360 rapor ekranı açılmadı (Mağaza kutusu yok).');
  await takeShot(job, page);
  setStatus(job, 'Tarih dolduruluyor (bugün ' + todayTr + ')…');
  const startSel = 'input[aria-label*="Başlangıç" i], input[aria-label*="Baslangic" i], input[id*="FromDate" i], input[name*="FromDate" i], [data-dyn-controlname*="FromDate" i] input';
  const endSel = 'input[aria-label*="Bitiş" i], input[aria-label*="Bitis" i], input[id*="ToDate" i], input[name*="ToDate" i], [data-dyn-controlname*="ToDate" i] input';
  await typeIntoD365(page, startSel, todayTr);
  await typeIntoD365(page, endSel, todayTr);
  robotLog(job, 'DATES_FILLED', 'Tarih ' + todayTr + ' — ' + todayTr);
  const mag = await selectMagaza(page, store, job);
  if(!magazaFilled(mag.value, store)){
    robotFail(job, 'STORE_SELECTED', 'Mağaza kutusu 340334 değil (kutuda: ' + (mag.value || 'boş') + '). Sorgula basılmadı.');
  }
  robotLog(job, 'STORE_SELECTED', 'Mağaza seçildi: ' + mag.value);
  job.meta.magazaValue = mag.value || store;
  await takeShot(job, page);
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
  if(!clicked) robotFail(job, 'QUERY_CLICKED', 'Sorgula düğmesi bulunamadı.');
  robotLog(job, 'QUERY_CLICKED', 'Sorgula basıldı');
  const until = Date.now() + 45000;
  while(Date.now() < until){
    await page.waitForTimeout(2500);
    const stillMag = await readMagazaField(page);
    if(stillMag.ok && !magazaFilled(stillMag.value, store)){
      robotFail(job, 'STORE_SELECTED', 'Sorgula’dan sonra Mağaza kutusu 340334 değil. Satış listesi gelmez.');
    }
    const settled = await waitQuerySettled(page);
    if(settled === 'rows' || settled === 'empty'){
      robotLog(job, 'RESULTS_READY', settled === 'empty' ? 'Kayıt yok' : 'Sonuç tablosu yüklendi');
      return settled === 'rows';
    }
  }
  await takeShot(job, page);
  robotFail(job, 'RESULTS_READY', 'Sorgula sonrası tablo veya “kayıt yok” gelmedi.');
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
    if(e && e.stage) throw e;
    if(e && /Mağaza|rapor ekranı|Sorgula|İleri|şifre/i.test(String(e.message || ''))) throw e;
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
    robotLog(job, 'USERNAME_PAGE', 'Rapid360 / Okta açılıyor');
    await page.goto(opts.reportUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    const deadline = Date.now() + (opts.loginTimeoutMs || LOGIN_TIMEOUT_MS);
    let loggedIn = false;
    while(Date.now() < deadline){
      const kind = classifyUrl(page.url());
      if(kind === 'dynamics'){
        const hasLoginForm = await page.$('input[name="loginfmt"], input[name="identifier"]').catch(() => null);
        const hasForm = await page.$('[data-dyn-controlname], input[aria-label*="Mağaza" i]').catch(() => null);
        const passOnDyn = await passwordVisible(page);
        if(!hasLoginForm && !passOnDyn && hasForm){
          loggedIn = true;
          robotLog(job, 'RAPID_PAGE', 'Rapid360 satış ekranı açıldı');
          break;
        }
      }
      if(kind === 'microsoft') await handleMicrosoft(page, opts, job);
      else if(kind === 'okta') await handleOkta(page, opts, job);
      await takeShot(job, page);
      await page.waitForTimeout(2000);
    }
    if(!loggedIn){
      await takeShot(job, page);
      robotFail(job, job.stage || 'USERNAME_PAGE', 'Rapid360 girişi tamamlanamadı (son aşama: ' + (job.stage || '-') + '). Ekran fotoğrafına bakın.');
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
  magazaFilled,
  turkeyTodayIso,
  isNextButtonLabel,
  isLoginButtonLabel,
  jobPublicView,
  clickWithFallback,
  clickNextAndWaitForPassword,
  loadPlaywright
};
