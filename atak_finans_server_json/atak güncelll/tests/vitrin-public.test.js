'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'public', 'vitrin');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const js = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const deploy = fs.readFileSync(path.join(__dirname, '..', 'public', 'assets', 'vps-deploy-vitrin.sh'), 'utf8');

assert.match(html, /Atak Home/);
assert.match(html, /Evinizi sadece döşemeyin/);
assert.doesNotMatch(html, /href="\/personel"/);
assert.doesNotMatch(html, /web-admin/);
assert.match(css, /--blue:#0a4d94/);
assert.match(js, /web-api\/public/);
const link = fs.readFileSync(path.join(__dirname, '..', 'public', 'assets', 'vps-personel-link.sh'), 'utf8');
const drop = fs.readFileSync(path.join(__dirname, '..', 'public', 'assets', 'vps-drop-public-admin.sh'), 'utf8');
assert.match(deploy, /Do not copy ERP/);
assert.match(deploy, /location \^~ \/web-admin/);
assert.match(deploy, /return 302 https:\/\/atakhome\.com\.tr\//);
assert.match(link, /panel\.atakhome\.com\.tr\/personel/);
assert.match(drop, /atakhome\.com\.tr\/web-admin/);
assert.match(drop, /return 302 https:\/\/atakhome\.com\.tr\//);
assert.doesNotMatch(deploy, /rsync/);
assert.doesNotMatch(deploy, /pm2 restart atakhome-commerce/);
assert.doesNotMatch(deploy, /vps-fix\.sh/);
console.log('vitrin-public.test.js ok');
