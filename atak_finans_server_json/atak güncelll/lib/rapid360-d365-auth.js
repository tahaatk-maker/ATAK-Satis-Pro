'use strict';

/**
 * Rapid360 (D365 F&O) kullanıcı girişi — Microsoft cihaz kodu.
 * Kullanıcı microsoft.com/devicelogin + Okta Verify onaylar; Atak sadece okuma token’ı tutar.
 */

const crypto = require('crypto');

const DEFAULT_DYNAMICS_URL = 'https://liverapid360.operations.dynamics.com';
const LOGIN_HOST = 'https://login.microsoftonline.com';
const DEFAULT_TENANT = 'organizations';
/** Azure PowerShell (d365fo.integrations) + Microsoft örnek public client. */
const DEFAULT_CLIENT_IDS = [
  '1950a258-227b-4e31-a9cf-717495945fc2',
  '51f81489-12ee-4a9e-aaae-a2591f45987d'
];

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

function publicDeviceStart(row){
  if(!row) return null;
  return {
    pollId: row.pollId,
    userCode: row.userCode,
    verificationUri: row.verificationUri,
    verificationUriComplete: row.verificationUriComplete,
    expiresIn: Math.max(0, Math.round((row.expiresAt - Date.now()) / 1000)),
    interval: row.interval,
    message: row.message
  };
}

function deviceMessage(userCode, verificationUri){
  const uri = verificationUri || 'https://microsoft.com/devicelogin';
  return `Telefonda Okta Verify’ı onaylayın. Açılmazsa ${uri} adresine gidin, kodu yazın: ${userCode}`;
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

async function startDeviceLogin(opts = {}){
  const sessionId = String(opts.sessionId || '');
  if(!sessionId) throw new Error('Oturum yok');
  const existing = findPendingForSession(sessionId);
  if(existing) return publicDeviceStart(existing);

  const rapid = opts.rapid || {};
  const cfg = configFromRapid(rapid, opts.env);
  const resource = isMuleUrl(cfg.dynamicsUrl) ? DEFAULT_DYNAMICS_URL : cfg.dynamicsUrl;
  const tenant = cfg.tenant || DEFAULT_TENANT;
  let lastErr = 'Okta cihaz kodu alınamadı';
  for(const clientId of clientIdsFrom(cfg)){
    const got = await requestDeviceCode({
      tenant,
      clientId,
      resource,
      fetchImpl: opts.fetchImpl
    });
    if(got && got.json && got.json.user_code){
      const json = got.json;
      const pollId = crypto.randomBytes(16).toString('hex');
      const expiresIn = Number(json.expires_in || 900);
      const interval = Math.max(3, Number(json.interval || 5));
      const userCode = String(json.user_code);
      const verificationUri = String(json.verification_uri || json.verification_url || 'https://microsoft.com/devicelogin');
      const verificationUriComplete = String(json.verification_uri_complete || '');
      const row = {
        pollId,
        sessionId,
        deviceCode: String(json.device_code || json.code || ''),
        clientId,
        tenant,
        resource,
        protocol: got.protocol,
        userCode,
        verificationUri,
        verificationUriComplete,
        interval,
        expiresAt: Date.now() + expiresIn * 1000,
        message: deviceMessage(userCode, verificationUri)
      };
      pendingById.set(pollId, row);
      return publicDeviceStart(row);
    }
    lastErr = (got && got.error) || lastErr;
  }
  throw new Error(`Okta Verify başlatılamadı (${lastErr}). Rapid360 hesabınızla Microsoft girişinin açık olduğundan emin olun.`);
}

function aadErrorMessage(json){
  const code = String(json && json.error || '').toLowerCase();
  if(code === 'authorization_pending') return { pending: true };
  if(code === 'slow_down') return { pending: true, slowDown: true };
  if(code === 'authorization_declined') return { error: 'Okta Verify reddedildi. Rapid Aktar’a tekrar basın.' };
  if(code === 'expired_token' || code === 'code_expired') return { error: 'Kodun süresi doldu. Rapid Aktar’a tekrar basın.' };
  if(code === 'bad_verification_code') return { error: 'Kod geçersiz. Rapid Aktar’a tekrar basın.' };
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
    return { ok: false, error: 'Kodun süresi doldu. Rapid Aktar’a tekrar basın.' };
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

function resetPendingForTests(){
  pendingById.clear();
}

module.exports = {
  DEFAULT_DYNAMICS_URL,
  DEFAULT_TENANT,
  DEFAULT_CLIENT_IDS,
  normalizeDynamicsUrl,
  isMuleUrl,
  accountFromToken,
  configFromRapid,
  publicAuth,
  persistTokens,
  clearTokens,
  tokenFresh,
  startDeviceLogin,
  pollDeviceLogin,
  refreshAccessToken,
  ensureAccessToken,
  resetPendingForTests,
  deviceMessage
};
