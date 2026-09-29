'use strict';

const fs = require('fs');
const path = require('path');

const FILE_RE = /^store-\d{8}-\d{6}-(daily|hourly|startup|manual|auto)\.json$/;
const REASONS = new Set(['daily', 'hourly', 'startup', 'manual', 'auto']);

function istanbulParts(d = new Date()){
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23'
  });
  const p = Object.fromEntries(fmt.formatToParts(d).map(x => [x.type, x.value]));
  return {
    year: p.year,
    month: p.month,
    day: p.day,
    hour: Number(p.hour),
    minute: Number(p.minute),
    second: Number(p.second),
    ymd: `${p.year}${p.month}${p.day}`,
    stamp: `${p.year}${p.month}${p.day}-${p.hour}${p.minute}${p.second}`
  };
}

function sizeLabel(n){
  const b = Number(n || 0);
  if(b < 1024) return `${b} B`;
  if(b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

function safeName(raw){
  const name = path.basename(String(raw || ''));
  return FILE_RE.test(name) ? name : '';
}

function create(opts = {}){
  const storePath = String(opts.storePath || '');
  const backupDir = String(opts.backupDir || '');
  const keepDays = Math.max(1, Number(opts.keepDays || 14) || 14);
  const keepMin = Math.max(1, Number(opts.keepMin || 7) || 7);
  const hourlyMs = Math.max(60 * 1000, Number(opts.hourlyMs || 6 * 60 * 60 * 1000) || 6 * 60 * 60 * 1000);
  const tickMs = Math.max(30 * 1000, Number(opts.tickMs || 10 * 60 * 1000) || 10 * 60 * 1000);
  let timer = null;

  function ensureDir(){
    if(!backupDir) throw new Error('yedek klasörü yok');
    fs.mkdirSync(backupDir, { recursive: true });
    return backupDir;
  }

  function parseFile(name, full){
    const m = String(name).match(/^store-(\d{8})-(\d{6})-(daily|hourly|startup|manual|auto)\.json$/);
    if(!m) return null;
    let st = { size: 0, mtimeMs: 0 };
    try{ st = fs.statSync(full); }catch{ return null; }
    if(!st.isFile() || st.size < 200) return null;
    return {
      file: name,
      reason: m[3],
      stamp: `${m[1]}-${m[2]}`,
      day: m[1],
      at: new Date(st.mtimeMs).toISOString(),
      mtimeMs: st.mtimeMs,
      size: st.size,
      sizeLabel: sizeLabel(st.size)
    };
  }

  function list(){
    if(!backupDir || !fs.existsSync(backupDir)) return [];
    let names = [];
    try{ names = fs.readdirSync(backupDir); }catch{ return []; }
    const out = [];
    for(const name of names){
      const row = parseFile(name, path.join(backupDir, name));
      if(row) out.push(row);
    }
    out.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return out;
  }

  function prune(nowMs = Date.now()){
    const rows = list();
    const cutoff = nowMs - keepDays * 24 * 60 * 60 * 1000;
    const keep = new Set(rows.slice(0, keepMin).map(r => r.file));
    let removed = 0;
    for(const row of rows){
      if(keep.has(row.file)) continue;
      if(row.mtimeMs >= cutoff) continue;
      try{
        fs.unlinkSync(path.join(backupDir, row.file));
        removed++;
      }catch{}
    }
    return { removed, kept: list().length };
  }

  function take({ reason = 'auto', force = false, now = new Date(), minAgeMs = 0 } = {}){
    const why = REASONS.has(reason) ? reason : 'auto';
    if(!storePath || !fs.existsSync(storePath)){
      return { ok: false, error: 'store.json yok' };
    }
    let st;
    try{ st = fs.statSync(storePath); }catch(e){
      return { ok: false, error: e.message || 'store.json okunamadı' };
    }
    if(!st.isFile() || st.size < 200){
      return { ok: false, error: 'store.json boş veya çok küçük' };
    }
    const rows = list();
    const last = rows[0];
    if(!force && minAgeMs > 0 && last && (now.getTime() - last.mtimeMs) < minAgeMs){
      return { ok: true, skipped: true, reason: 'fresh', file: last.file, at: last.at, size: last.size };
    }
    ensureDir();
    const stamp = istanbulParts(now).stamp;
    const file = `store-${stamp}-${why}.json`;
    const dest = path.join(backupDir, file);
    const tmp = dest + '.tmp';
    fs.copyFileSync(storePath, tmp);
    try{
      JSON.parse(fs.readFileSync(tmp, 'utf8'));
    }catch(e){
      try{ fs.unlinkSync(tmp); }catch{}
      return { ok: false, error: 'yedek JSON geçersiz: ' + (e.message || '') };
    }
    fs.renameSync(tmp, dest);
    try{ fs.utimesSync(dest, now, now); }catch(_){}
    const size = fs.statSync(dest).size;
    prune(now.getTime());
    return { ok: true, skipped: false, reason: why, file, at: now.toISOString(), size, sizeLabel: sizeLabel(size) };
  }

  function tick(now = new Date()){
    const parts = istanbulParts(now);
    const rows = list();
    const hasDailyToday = rows.some(r => r.reason === 'daily' && r.day === parts.ymd);
    if(parts.hour >= 3 && !hasDailyToday){
      return take({ reason: 'daily', force: true, now });
    }
    const last = rows[0];
    if(!last || (now.getTime() - last.mtimeMs) >= hourlyMs){
      return take({ reason: last ? 'hourly' : 'startup', force: true, now });
    }
    return { ok: true, skipped: true, reason: 'fresh', file: last.file, at: last.at, size: last.size };
  }

  function status(){
    const rows = list();
    const last = rows[0] || null;
    const ageMs = last ? Date.now() - last.mtimeMs : null;
    return {
      ok: Boolean(last) && ageMs != null && ageMs < hourlyMs * 2,
      dir: backupDir,
      count: rows.length,
      keepDays,
      hourlyHours: Math.round(hourlyMs / 3600000),
      lastAt: last?.at || '',
      lastFile: last?.file || '',
      lastReason: last?.reason || '',
      lastSize: last?.size || 0,
      lastAgeMs: ageMs
    };
  }

  function start(){
    if(timer) return status();
    try{ tick(new Date()); }catch(e){ console.error('[backup]', e.message || e); }
    timer = setInterval(() => {
      try{ tick(new Date()); }catch(e){ console.error('[backup]', e.message || e); }
    }, tickMs);
    if(typeof timer.unref === 'function') timer.unref();
    console.log('[backup] otomatik yedek açık', backupDir, `her ${Math.round(hourlyMs / 3600000)} saat · gece 03:00 · ${keepDays} gün`);
    return status();
  }

  function stop(){
    if(timer) clearInterval(timer);
    timer = null;
  }

  function filePath(name){
    const safe = safeName(name);
    if(!safe || !backupDir) return '';
    const root = path.resolve(backupDir);
    const full = path.resolve(root, safe);
    if(full !== path.join(root, safe)) return '';
    return fs.existsSync(full) ? full : '';
  }

  return { ensureDir, list, take, tick, prune, status, start, stop, filePath, safeName };
}

module.exports = {
  FILE_RE,
  istanbulParts,
  sizeLabel,
  safeName,
  create
};
