'use strict';

/**
 * Rapid360 (D365 F&O) kullanıcı girişi.
 * Popup, kullanıcının her gün açtığı detaylı satış ekranını açar
 * (liverapid360 … mi=DmrDetailedSalesReport). Okta Verify orada gelir.
 * nativeclient açılmaz (Microsoft /common/wrongplace).
 */

const crypto = require('crypto');

const DEFAULT_DYNAMICS_URL = 'https://liverapid360.operations.dynamics.com';
const LOGIN_HOST = 'https://login.microsoftonline.com';
const DEFAULT_TENANT = 'organizations';
const DEFAULT_ACCOUNT = 'W340334.1@rapid360.arcelikpazarlama.com.tr';
/** Azure PowerShell (d365fo.integrations) + Microsoft örnek public client. */
const DEFAULT_CLIENT_IDS = [
  '1950a258-227b-4e31-a9cf-717495945fc2',
  '51f81489-12ee-4a9e-aaae-a2591f45987d'
];
const NATIVE_REDIRECT = 'https://login.microsoftonline.com/common/oauth2/nativeclient';
const DEVICE_COMPLETE_HOST = 'https://microsoft.com/devicelogin';

const pendingById = new Map();

function normalizeDynamicsUrl(raw){
  let s = String(raw || '').trim().split('?')[0].replace(/\/+$/, '');
  if(!s) s = DEFAULT_DYNAMICS_URL;
  if(/^\/\//.test(s)) s = `https:${s}`;
  if(!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try{
    const u = new URL(s);
    if(u.protocol !== 'https:') throw new Error('https');
    return `${u.protocol}//${u.host}`.replace(/\/+$/, '');
  }catch{
    return DEFAULT_DYNAMICS_URL;
  }
}

function isMuleUrl(url){
  return /arcelik\.com|geteinvoices/i.test(String(url || ''));
}

function formBody(obj){
  return Object.entries(obj || {})
    .filter(([, v]) => v != null && String(v) !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
}

async function postForm(url, fields, fetchImpl){
  const fetchFn = fetchImpl || fetch;
  const res = await fetchFn(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json'
    },
    body: formBody(fields)
  });
  const text = typeof res.text === 'function' ? await res.text() : String(res.body || '');
  let json = {};
  try{ json = text ? JSON.parse(text) : {}; }catch{ json = { error_description: text.slice(0, 300) }; }
  return { status: res.status, ok: res.ok, json, text };
}

function decodeJwtPayload(token){
  const parts = String(token || '').split('.');
  if(parts.length < 2) return {};
  const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  try{
    return JSON.parse(Buffer.from(pad, 'base64').toString('utf8'));
  }catch{
    return {};
  }
}

function accountFromToken(token){
  const p = decodeJwtPayload(token);
  return String(p.upn || p.unique_name || p.preferred_username || p.email || p.name || '').trim();
}

function loginMessage(loginHint){
  const who = String(loginHint || DEFAULT_ACCOUNT).trim();
  return `Rapid360 açılır (${who}). Telefona Okta bildirimi gelir; onaylayın. Kod yazılmaz. Mağaza 340334 ATAK Atak’ta uygulanır.`;
}

function isoDateParam(v){
  const s = String(v || '').trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

function dynamicsReportUrl({ dynamicsUrl, company } = {}){
  const base = normalizeDynamicsUrl(dynamicsUrl || DEFAULT_DYNAMICS_URL);
  const cmp = String(company || '2521').trim() || '2521';
  const u = new URL(`${base}/`);
  u.searchParams.set('cmp', cmp);
  u.searchParams.set('mi', 'DmrDetailedSalesReport');
  u.searchParams.set('prt', 'initial');
  return u.toString();
}

function isBlockedMicrosoftUrl(url){
  return /nativeclient|wrongplace|deviceauth|devicelogin/i.test(String(url || ''));
}

function withLoginHint(url, loginHint){
  const hint = String(loginHint || '').trim();
  const base = String(url || '').trim();
  if(!base) return '';
  if(!hint) return base;
  try{
    const u = new URL(base);
    u.searchParams.set('login_hint', hint);
    return u.toString();
  }catch{
    return base;
  }
}

/** microsoft.com/devicelogin?otc= kod kutusunu atlar. deviceauth Kod sayfası açmaz. */
function deviceLoginUrl(json){
  const userCode = String((json && json.user_code) || '').trim();
  const complete = String((json && (json.verification_uri_complete || json.verificationUriComplete)) || '').trim();
  const uri = String((json && (json.verification_uri || json.verification_url || json.verificationUri)) || '').trim();
  let code = userCode;
  for(const raw of [complete, uri]){
    if(!raw) continue;
    try{
      const u = new URL(raw);
      if(u.searchParams.has('login_hint') || u.searchParams.has('username') || u.searchParams.has('whr')) continue;
      const otc = String(u.searchParams.get('otc') || '').trim();
      if(otc) code = otc;
      if(otc && /microsoft\.com\/devicelogin/i.test(raw)) return `${DEVICE_COMPLETE_HOST}?otc=${encodeURIComponent(otc)}`;
    }catch(_){}
  }
  if(code) return `${DEVICE_COMPLETE_HOST}?otc=${encodeURIComponent(code)}`;
  return '';
}

function isBrokenDeviceLoginUrl(url){
  const s = String(url || '');
  if(!s) return true;
  if(/deviceauth/i.test(s)) return true;
  if(/oauth2\/v2\.0\/authorize|rapid360-okta-callback/i.test(s)) return false;
  try{
    const u = new URL(s);
    const otc = String(u.searchParams.get('otc') || '').trim();
    const extra = u.searchParams.has('login_hint') || u.searchParams.has('username') || u.searchParams.has('whr');
    if(extra) return true;
    if(/devicelogin/i.test(s) && !otc) return true;
    return false;
  }catch{
    return true;
  }
}

function pkceVerifier(){
  return crypto.randomBytes(32).toString('base64url');
}

function pkceChallenge(verifier){
  return crypto.createHash('sha256').update(String(verifier || '')).digest('base64url');
}

function buildAuthorizeUrl({ tenant, clientId, resource, redirectUri, loginHint, challenge, state, prompt }){
  const q = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    response_mode: 'query',
    scope: `${resource}/.default offline_access openid profile`,
    state
  });
  if(challenge){
    q.set('code_challenge', challenge);
    q.set('code_challenge_method', 'S256');
  }
  if(prompt) q.set('prompt', prompt);
  if(loginHint){
    q.set('login_hint', loginHint);
    const domain = loginHint.includes('@') ? loginHint.split('@').pop() : '';
    if(/rapid360|arcelik|okta/i.test(domain)) q.set('domain_hint', domain);
  }
  return `${LOGIN_HOST}/${tenant}/oauth2/v2.0/authorize?${q.toString()}`;
}

function publicLoginStart(row){
  if(!row) return null;
  const deviceUrl = deviceLoginUrl({
    verification_uri_complete: row.verificationUriComplete || row.deviceLoginUrl,
    verification_uri: row.verificationUri,
    user_code: row.userCode
  });
  let loginUrl = String(row.loginUrl || row.reportUrl || '');
  if(!loginUrl || isBlockedMicrosoftUrl(loginUrl)){
    loginUrl = dynamicsReportUrl({
      dynamicsUrl: row.resource,
      company: row.company,
      store: row.store,
      startDate: row.startDate,
      endDate: row.endDate
    });
  }
  const out = {
    pollId: row.pollId,
    loginUrl,
    expiresIn: Math.max(0, Math.round((row.expiresAt - Date.now()) / 1000)),
    interval: row.interval,
    message: row.message
  };
  if(row.deviceCode && deviceUrl && !isBrokenDeviceLoginUrl(deviceUrl) && !isBlockedMicrosoftUrl(loginUrl)){
    out.deviceLoginUrl = deviceUrl;
  }
  return out;
}

function sweepPending(){
  const now = Date.now();
  for(const [id, row] of pendingById){
    if(!row || now > row.expiresAt) pendingById.delete(id);
  }
}

function findPendingForSession(sessionId){
  sweepPending();
  const sid = String(sessionId || '');
  if(!sid) return null;
  for(const row of pendingById.values()){
    if(row.sessionId === sid) return row;
  }
  return null;
}

async function requestDeviceCode({ tenant, clientId, resource, fetchImpl }){
  const v2 = await postForm(`${LOGIN_HOST}/${tenant}/oauth2/v2.0/devicecode`, {
    client_id: clientId,
    scope: `${resource}/.default offline_access openid profile`
  }, fetchImpl);
  if(v2.json && v2.json.user_code && v2.json.device_code){
    return { protocol: 'v2', json: v2.json, clientId, tenant, resource };
  }
  const v1 = await postForm(`${LOGIN_HOST}/${tenant}/oauth2/devicecode`, {
    client_id: clientId,
    resource
  }, fetchImpl);
  if(v1.json && v1.json.user_code && (v1.json.device_code || v1.json.code)){
    return { protocol: 'v1', json: v1.json, clientId, tenant, resource };
  }
  const err = (v2.json && (v2.json.error_description || v2.json.error))
    || (v1.json && (v1.json.error_description || v1.json.error))
    || 'cihaz kodu alınamadı';
  return { error: String(err).slice(0, 400), v2Status: v2.status, v1Status: v1.status };
}

function clientIdsFrom(cfg){
  const custom = String(cfg && (cfg.oauthClientId || cfg.clientId) || '').trim();
  const out = [];
  if(custom && !DEFAULT_CLIENT_IDS.includes(custom)) out.push(custom);
  for(const id of DEFAULT_CLIENT_IDS){
    if(!out.includes(id)) out.push(id);
  }
  return out;
}

function configFromRapid(rapid = {}, env = process.env){
  const r = rapid && typeof rapid === 'object' ? rapid : {};
  const d = r.d365Auth && typeof r.d365Auth === 'object' ? r.d365Auth : {};
  const dynamicsUrl = normalizeDynamicsUrl(
    d.dynamicsUrl || r.dynamicsUrl || env.RAPID360_DYNAMICS_URL || DEFAULT_DYNAMICS_URL
  );
  return {
    dynamicsUrl,
    tenant: String(d.tenant || r.aadTenant || env.RAPID360_AAD_TENANT || DEFAULT_TENANT).trim() || DEFAULT_TENANT,
    oauthClientId: String(d.oauthClientId || r.oauthClientId || env.RAPID360_OAUTH_CLIENT_ID || '').trim(),
    odataEntity: String(d.odataEntity || r.odataEntity || env.RAPID360_ODATA_ENTITY || '').trim(),
    accessToken: String(d.accessToken || '').trim(),
    refreshToken: String(d.refreshToken || '').trim(),
    expiresAt: String(d.expiresAt || '').trim(),
    account: String(d.account || '').trim(),
    protocol: String(d.protocol || 'v1').trim() || 'v1',
    clientIdUsed: String(d.clientIdUsed || '').trim()
  };
}

function publicAuth(rapid, env){
  const c = configFromRapid(rapid, env);
  const exp = Date.parse(c.expiresAt || '') || 0;
  const connected = Boolean(c.accessToken) && (exp ? exp > Date.now() + 5000 : true);
  return {
    connected,
    account: c.account,
    lastUser: c.account || String((rapid && rapid.d365Auth && rapid.d365Auth.lastUser) || '').trim(),
    expiresAt: c.expiresAt,
    dynamicsUrl: isMuleUrl(c.dynamicsUrl) ? DEFAULT_DYNAMICS_URL : c.dynamicsUrl,
    odataEntity: c.odataEntity,
    tenant: c.tenant
  };
}

function persistTokens(prevRapid, tokens){
  const prev = prevRapid && typeof prevRapid === 'object' ? prevRapid : {};
  const cfg = configFromRapid(prev);
  const expiresAt = tokens.expiresAt
    || new Date(Date.now() + (Number(tokens.expires_in || 3600) * 1000) - 60000).toISOString();
  const accessToken = String(tokens.access_token || tokens.accessToken || '').trim();
  return {
    ...prev,
    d365Auth: {
      dynamicsUrl: tokens.resource || cfg.dynamicsUrl,
      tenant: tokens.tenant || cfg.tenant,
      oauthClientId: cfg.oauthClientId,
      odataEntity: cfg.odataEntity,
      accessToken,
      refreshToken: String(tokens.refresh_token || tokens.refreshToken || cfg.refreshToken || '').trim(),
      expiresAt,
      account: tokens.account || accountFromToken(accessToken) || cfg.account,
      lastUser: tokens.account || tokens.loginHint || cfg.account || '',
      protocol: tokens.protocol || cfg.protocol,
      clientIdUsed: tokens.clientId || tokens.clientIdUsed || cfg.clientIdUsed
    }
  };
}

function clearTokens(prevRapid){
  const prev = prevRapid && typeof prevRapid === 'object' ? prevRapid : {};
  const cfg = configFromRapid(prev);
  return {
    ...prev,
    d365Auth: {
      dynamicsUrl: cfg.dynamicsUrl,
      tenant: cfg.tenant,
      oauthClientId: cfg.oauthClientId,
      odataEntity: cfg.odataEntity,
      accessToken: '',
      refreshToken: '',
      expiresAt: '',
      account: '',
      protocol: cfg.protocol,
      clientIdUsed: ''
    }
  };
}

function tokenFresh(cfg){
  if(!cfg || !cfg.accessToken) return false;
  const exp = Date.parse(cfg.expiresAt || '');
  if(!Number.isFinite(exp)) return true;
  return exp > Date.now() + 15000;
}

function startWebOnlyLogin(opts = {}){
  const rapid = opts.rapid || {};
  const cfg = configFromRapid(rapid, opts.env);
  const company = String(opts.company || rapid.salesCompany || '2521').trim() || '2521';
  const store = String(opts.store || rapid.salesStore || '340334').trim() || '340334';
  const startDate = isoDateParam(opts.startDate);
  const endDate = isoDateParam(opts.endDate);
  const loginUrl = dynamicsReportUrl({
    dynamicsUrl: isMuleUrl(cfg.dynamicsUrl) ? DEFAULT_DYNAMICS_URL : cfg.dynamicsUrl,
    company,
    store,
    startDate,
    endDate
  });
  return {
    pollId: '',
    loginUrl,
    expiresIn: 900,
    interval: 3,
    message: `Rapid360 açıldı (${DEFAULT_ACCOUNT}). Telefonda Okta bildirimine basın. Kod yazılmaz. Rapid’te Mağaza 340334 ATAK seçip XML indirin. Dosyayı Atak’ta seçin, sonra Seçilenleri aktar.`
  };
}

async function startInteractiveLogin(opts = {}){
  const sessionId = String(opts.sessionId || '');
  if(!sessionId) throw new Error('Oturum yok');
  const loginHint = String(opts.loginHint || opts.username || DEFAULT_ACCOUNT).trim() || DEFAULT_ACCOUNT;
  const redirectUri = String(opts.redirectUri || '').trim();
  const rapid = opts.rapid || {};
  const cfg = configFromRapid(rapid, opts.env);
  const usePkce = Boolean(cfg.oauthClientId && redirectUri);
  const company = String(opts.company || rapid.salesCompany || '2521').trim() || '2521';
  const store = String(opts.store || rapid.salesStore || '340334').trim() || '340334';
  const startDate = isoDateParam(opts.startDate);
  const endDate = isoDateParam(opts.endDate);
  const existing = findPendingForSession(sessionId);
  if(existing){
    const isCallbackPkce = /rapid360-okta-callback/.test(String(existing.redirectUri || existing.authorizeUrl || ''));
    const stalePkce = isCallbackPkce && !usePkce;
    const staleNative = isBlockedMicrosoftUrl(existing.loginUrl) || isBlockedMicrosoftUrl(existing.authorizeUrl) || isBlockedMicrosoftUrl(existing.redirectUri);
    const isDynamics = /operations\.dynamics\.com/i.test(String(existing.loginUrl || existing.reportUrl || ''));
    if(!stalePkce && !staleNative && (isDynamics || isCallbackPkce)){
      if(loginHint) existing.loginHint = loginHint;
      existing.company = company;
      existing.store = store;
      existing.startDate = startDate || existing.startDate;
      existing.endDate = endDate || existing.endDate;
      existing.message = loginMessage(loginHint || existing.loginHint);
      if(isDynamics){
        existing.loginUrl = dynamicsReportUrl({
          dynamicsUrl: existing.resource || cfg.dynamicsUrl,
          company,
          store,
          startDate: existing.startDate,
          endDate: existing.endDate
        });
        existing.reportUrl = existing.loginUrl;
      }else if(existing.authorizeUrl){
        existing.loginUrl = withLoginHint(existing.authorizeUrl, loginHint || existing.loginHint);
      }
      return publicLoginStart(existing);
    }
    pendingById.delete(existing.pollId);
  }
  const resource = isMuleUrl(cfg.dynamicsUrl) ? DEFAULT_DYNAMICS_URL : cfg.dynamicsUrl;
  const tenant = cfg.tenant || DEFAULT_TENANT;
  const clientId = usePkce ? cfg.oauthClientId : clientIdsFrom(cfg)[0];

  if(usePkce){
    const pollId = crypto.randomBytes(16).toString('hex');
    const verifier = pkceVerifier();
    const authorizeUrl = buildAuthorizeUrl({
      tenant,
      clientId,
      resource,
      redirectUri,
      loginHint,
      challenge: pkceChallenge(verifier),
      state: pollId,
      prompt: 'login'
    });
    const row = {
      pollId,
      sessionId,
      deviceCode: '',
      clientId,
      tenant,
      resource,
      protocol: 'v2',
      verificationUri: '',
      verificationUriComplete: '',
      authorizeUrl,
      redirectUri,
      codeVerifier: verifier,
      loginHint,
      loginUrl: authorizeUrl,
      interval: 3,
      expiresAt: Date.now() + 15 * 60 * 1000,
      message: loginMessage(loginHint)
    };
    pendingById.set(pollId, row);
    return publicLoginStart(row);
  }

  let lastErr = 'Okta girişi başlatılamadı';
  for(const id of clientIdsFrom(cfg)){
    const got = await requestDeviceCode({
      tenant,
      clientId: id,
      resource,
      fetchImpl: opts.fetchImpl
    });
    if(got && got.json && got.json.user_code){
      const json = got.json;
      const pollId = crypto.randomBytes(16).toString('hex');
      const expiresIn = Number(json.expires_in || 900);
      const interval = Math.max(3, Number(json.interval || 5));
      const verificationUri = String(json.verification_uri || json.verification_url || 'https://microsoft.com/devicelogin');
      const verificationUriComplete = String(json.verification_uri_complete || '');
      const userCode = String(json.user_code || '');
      const deviceUrl = deviceLoginUrl({
        verification_uri_complete: verificationUriComplete,
        verification_uri: verificationUri,
        user_code: userCode
      });
      const reportUrl = dynamicsReportUrl({
        dynamicsUrl: resource,
        company,
        store,
        startDate,
        endDate
      });
      const row = {
        pollId,
        sessionId,
        deviceCode: String(json.device_code || json.code || ''),
        userCode,
        clientId: id,
        tenant,
        resource,
        protocol: got.protocol,
        verificationUri,
        verificationUriComplete,
        authorizeUrl: '',
        redirectUri: '',
        codeVerifier: '',
        loginHint,
        company,
        store,
        startDate,
        endDate,
        reportUrl,
        loginUrl: reportUrl,
        deviceLoginUrl: deviceUrl,
        interval,
        expiresAt: Date.now() + expiresIn * 1000,
        message: loginMessage(loginHint)
      };
      pendingById.set(pollId, row);
      return publicLoginStart(row);
    }
    lastErr = (got && got.error) || lastErr;
  }
  throw new Error(`Okta Verify başlatılamadı (${lastErr}). Rapid Aktar’a tekrar basın.`);
}

async function startDeviceLogin(opts = {}){
  return startInteractiveLogin(opts);
}

function aadErrorMessage(json){
  const code = String(json && json.error || '').toLowerCase();
  if(code === 'authorization_pending') return { pending: true };
  if(code === 'slow_down') return { pending: true, slowDown: true };
  if(code === 'expired_token' || code === 'code_expired') return { error: 'Giriş süresi doldu. Rapid Aktar’a tekrar basın.' };
  if(code === 'authorization_declined') return { error: 'Okta Verify reddedildi. Rapid Aktar’a tekrar basın.' };
  if(code === 'bad_verification_code') return { error: 'Giriş iptal. Rapid Aktar’a tekrar basın.' };
  const desc = String((json && (json.error_description || json.error)) || 'Okta doğrulanamadı').slice(0, 400);
  return { error: desc };
}

async function pollDeviceLogin(opts = {}){
  const sessionId = String(opts.sessionId || '');
  const pollId = String(opts.pollId || '');
  sweepPending();
  const row = pendingById.get(pollId);
  if(!row || row.sessionId !== sessionId){
    return { ok: false, error: 'Okta bekleyen giriş yok. Rapid Aktar’a tekrar basın.' };
  }
  if(Date.now() > row.expiresAt){
    pendingById.delete(pollId);
    return { ok: false, error: 'Giriş süresi doldu. Rapid Aktar’a tekrar basın.' };
  }
  if(row.callbackTokens && row.callbackTokens.access_token){
    const tokens = row.callbackTokens;
    pendingById.delete(pollId);
    return { ok: true, pending: false, tokens };
  }
  if(!row.deviceCode){
    return { ok: false, pending: true };
  }
  const fields = row.protocol === 'v2'
    ? {
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      client_id: row.clientId,
      device_code: row.deviceCode
    }
    : {
      grant_type: 'device_code',
      client_id: row.clientId,
      code: row.deviceCode,
      resource: row.resource
    };
  const tokenUrl = row.protocol === 'v2'
    ? `${LOGIN_HOST}/${row.tenant}/oauth2/v2.0/token`
    : `${LOGIN_HOST}/${row.tenant}/oauth2/token`;
  const res = await postForm(tokenUrl, fields, opts.fetchImpl);
  if(res.ok && res.json && res.json.access_token){
    pendingById.delete(pollId);
    const json = res.json;
    return {
      ok: true,
      pending: false,
      tokens: {
        access_token: json.access_token,
        refresh_token: json.refresh_token || '',
        expires_in: json.expires_in,
        account: accountFromToken(json.access_token) || accountFromToken(json.id_token),
        protocol: row.protocol,
        clientId: row.clientId,
        tenant: row.tenant,
        resource: row.resource
      }
    };
  }
  const mapped = aadErrorMessage(res.json || {});
  if(mapped.pending) return { ok: false, pending: true, slowDown: mapped.slowDown === true };
  pendingById.delete(pollId);
  return { ok: false, pending: false, error: mapped.error };
}

async function refreshAccessToken(cfg, fetchImpl){
  if(!cfg || !cfg.refreshToken) return null;
  const tenant = cfg.tenant || DEFAULT_TENANT;
  const clientId = cfg.clientIdUsed || clientIdsFrom(cfg)[0];
  const resource = cfg.dynamicsUrl || DEFAULT_DYNAMICS_URL;
  const v2 = cfg.protocol === 'v2';
  const url = v2
    ? `${LOGIN_HOST}/${tenant}/oauth2/v2.0/token`
    : `${LOGIN_HOST}/${tenant}/oauth2/token`;
  const fields = v2
    ? {
      grant_type: 'refresh_token',
      client_id: clientId,
      refresh_token: cfg.refreshToken,
      scope: `${resource}/.default offline_access openid profile`
    }
    : {
      grant_type: 'refresh_token',
      client_id: clientId,
      refresh_token: cfg.refreshToken,
      resource
    };
  const res = await postForm(url, fields, fetchImpl);
  if(!res.ok || !res.json || !res.json.access_token) return null;
  return {
    access_token: res.json.access_token,
    refresh_token: res.json.refresh_token || cfg.refreshToken,
    expires_in: res.json.expires_in,
    account: accountFromToken(res.json.access_token) || cfg.account,
    protocol: cfg.protocol,
    clientId,
    tenant,
    resource
  };
}

async function ensureAccessToken(rapid, { fetchImpl, env } = {}){
  const cfg = configFromRapid(rapid, env);
  if(tokenFresh(cfg)){
    return { ok: true, token: cfg.accessToken, cfg, refreshed: false };
  }
  if(cfg.refreshToken){
    const tokens = await refreshAccessToken(cfg, fetchImpl);
    if(tokens && tokens.access_token){
      return { ok: true, token: tokens.access_token, cfg: configFromRapid(persistTokens(rapid, tokens), env), refreshed: true, tokens };
    }
  }
  return { ok: false, needsOkta: true, cfg };
}

async function completeAuthorizationCode(opts = {}){
  const sessionId = String(opts.sessionId || '');
  const state = String(opts.state || opts.pollId || '');
  const code = String(opts.code || '').trim();
  const err = String(opts.error || '').trim();
  sweepPending();
  const row = pendingById.get(state);
  if(!row || row.sessionId !== sessionId){
    return { ok: false, error: 'Giriş oturumu bulunamadı. Rapid Aktar’a tekrar basın.' };
  }
  if(err){
    return { ok: false, error: err === 'access_denied' ? 'Giriş iptal edildi.' : 'Rapid360 girişi tamamlanamadı.' };
  }
  if(!code){
    return { ok: false, error: 'Giriş tamamlanamadı.' };
  }
  const tryExchange = async (url, fields) => postForm(url, fields, opts.fetchImpl);
  let res = await tryExchange(`${LOGIN_HOST}/${row.tenant}/oauth2/v2.0/token`, {
    grant_type: 'authorization_code',
    client_id: row.clientId,
    code,
    redirect_uri: row.redirectUri,
    code_verifier: row.codeVerifier
  });
  if(!(res.ok && res.json && res.json.access_token)){
    res = await tryExchange(`${LOGIN_HOST}/${row.tenant}/oauth2/token`, {
      grant_type: 'authorization_code',
      client_id: row.clientId,
      code,
      redirect_uri: row.redirectUri,
      resource: row.resource
    });
  }
  if(!(res.ok && res.json && res.json.access_token)){
    const desc = String((res.json && (res.json.error_description || res.json.error)) || 'token alınamadı').slice(0, 300);
    return { ok: false, error: `Rapid360 girişi tamamlanamadı (${desc}).` };
  }
  const json = res.json;
  const tokens = {
    access_token: json.access_token,
    refresh_token: json.refresh_token || '',
    expires_in: json.expires_in,
    account: accountFromToken(json.access_token) || accountFromToken(json.id_token) || row.loginHint,
    protocol: 'v2',
    clientId: row.clientId,
    tenant: row.tenant,
    resource: row.resource,
    loginHint: row.loginHint
  };
  row.callbackTokens = tokens;
  return { ok: true, tokens };
}

function popupResultHtml(ok, error){
  const msg = ok
    ? 'Giriş tamam. Okta onaylandı, bu pencere kapanıyor.'
    : String(error || 'Giriş olmadı. Pencereyi kapatıp Rapid Aktar’a tekrar basın.');
  const payload = JSON.stringify({ type: 'atak-rapid360-okta', ok: !!ok });
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>Rapid360</title></head><body style="font-family:sans-serif;padding:28px;color:#0f172a">
<p>${String(msg).replace(/[<>]/g, '')}</p>
<script>
try{ if(window.opener) window.opener.postMessage(${payload}, window.location.origin); }catch(e){}
setTimeout(function(){ window.close(); }, 700);
</script>
</body></html>`;
}

function resetPendingForTests(){
  pendingById.clear();
}

module.exports = {
  DEFAULT_DYNAMICS_URL,
  DEFAULT_TENANT,
  DEFAULT_ACCOUNT,
  DEFAULT_CLIENT_IDS,
  NATIVE_REDIRECT,
  isoDateParam,
  dynamicsReportUrl,
  isBlockedMicrosoftUrl,
  normalizeDynamicsUrl,
  isMuleUrl,
  accountFromToken,
  configFromRapid,
  publicAuth,
  persistTokens,
  clearTokens,
  tokenFresh,
  startDeviceLogin,
  startInteractiveLogin,
  startWebOnlyLogin,
  pollDeviceLogin,
  completeAuthorizationCode,
  popupResultHtml,
  refreshAccessToken,
  ensureAccessToken,
  resetPendingForTests,
  loginMessage,
  deviceLoginUrl,
  isBrokenDeviceLoginUrl
};
