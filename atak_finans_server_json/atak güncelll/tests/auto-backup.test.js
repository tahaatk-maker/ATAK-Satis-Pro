'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const backup = require('../lib/auto-backup');

function assert(cond, msg){
  if(!cond) throw new Error(msg);
}

assert(backup.safeName('store-20260819-030015-daily.json') === 'store-20260819-030015-daily.json', 'safe ok');
assert(backup.safeName('../store.json') === '', 'path escape yok');
assert(backup.safeName('store.json') === '', 'canlı dosya adı reddedilir');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atak-yedek-'));
const storePath = path.join(dir, 'store.json');
const backupDir = path.join(dir, 'backups');
fs.writeFileSync(storePath, JSON.stringify({ customers: [1, 2, 3], products: [], pad: 'x'.repeat(250) }, null, 2));

const b = backup.create({
  storePath,
  backupDir,
  keepDays: 14,
  keepMin: 2,
  hourlyMs: 6 * 60 * 60 * 1000
});

const first = b.take({ reason: 'startup', force: true, now: new Date('2026-08-19T00:10:00+03:00') });
assert(first.ok && first.file.includes('startup'), 'startup yedek');
assert(fs.existsSync(path.join(backupDir, first.file)), 'dosya var');

const skip = b.take({ reason: 'hourly', force: false, minAgeMs: 6 * 60 * 60 * 1000, now: new Date('2026-08-19T00:20:00+03:00') });
assert(skip.skipped === true, 'taze yedek atlanır');

const daily = b.tick(new Date('2026-08-19T03:05:00+03:00'));
assert(daily.ok && daily.reason === 'daily' && !daily.skipped, '03:00 günlük yedek');

const fresh = b.tick(new Date('2026-08-19T04:00:00+03:00'));
assert(fresh.skipped === true, 'günlükten hemen sonra hourly yok');

const hourly = b.tick(new Date('2026-08-19T10:00:00+03:00'));
assert(hourly.ok && hourly.reason === 'hourly' && !hourly.skipped, '6 saat sonra hourly');

const listed = b.list();
assert(listed.length >= 3, 'liste');
assert(listed[0].mtimeMs >= listed[1].mtimeMs, 'yeniler üstte');

const manual = b.take({ reason: 'manual', force: true, now: new Date('2026-08-19T12:00:00+03:00') });
assert(manual.reason === 'manual', 'elle yedek');
assert(b.filePath(manual.file).endsWith(manual.file), 'filePath');
assert(b.filePath('../etc/passwd') === '', 'kaçış yok');

// prune: keepMin=2, eski dosyaları sil
const old = path.join(backupDir, 'store-20260101-030000-daily.json');
fs.writeFileSync(old, JSON.stringify({ old: true, pad: 'x'.repeat(250) }));
const oldTime = Date.now() - 30 * 24 * 60 * 60 * 1000;
fs.utimesSync(old, new Date(oldTime), new Date(oldTime));
const pr = b.prune(Date.now());
assert(!fs.existsSync(old), '30 günlük silindi');
assert(pr.kept >= 2, 'minimum kopya durur');

const st = b.status();
assert(st.count >= 2, 'status count');
assert(st.lastFile, 'son yedek adı');

fs.rmSync(dir, { recursive: true, force: true });
console.log('auto-backup.test.js ok');
