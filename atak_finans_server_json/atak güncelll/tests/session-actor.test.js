'use strict';
const assert = require('assert');
const actor = require('../lib/session-actor');

const halil = { id: 'u-halil', name: 'Halil', username: 'halil', role: 'owner', permissions: ['*'] };

assert.strictEqual(actor.currentActor({
  session: { admin: true, systemOwner: true, user: halil }
}).name, 'Halil', 'owner oturumunda karar veren Halil olmalı');
assert.strictEqual(actor.currentSessionUser({
  session: { admin: true, systemOwner: true, user: halil }
}).name, 'Halil');

assert.strictEqual(actor.currentActor({
  session: { admin: true, systemOwner: true }
}).name, 'Sistem Yöneticisi', 'env admin şifresi hâlâ genel ad');

assert.strictEqual(actor.currentActor({
  session: { staffUser: { id: 's1', name: 'Emine Yakışır' } }
}).name, 'Emine Yakışır');

assert.strictEqual(actor.currentActor({
  session: {
    staffUser: { id: 'system-owner', name: 'Sistem Yöneticisi' },
    systemOwner: true
  }
}).name, 'Sistem Yöneticisi');

assert.strictEqual(actor.actorDisplayName(halil, 'Yönetici'), 'Halil');

const store = { users: [halil, { id: 'u2', name: 'Emine Yakışır', role: 'sales', active: true }] };
assert.strictEqual(actor.resolveReviewedBy(store, {
  reviewedBy: 'Sistem Yöneticisi',
  status: 'rejected'
}), 'Halil', 'eski owner kaydı tek sahipse Halil gösterilsin');
assert.strictEqual(actor.resolveReviewedBy(store, {
  reviewedBy: 'Sistem Yöneticisi',
  reviewedById: 'u-halil'
}), 'Halil');
assert.strictEqual(actor.resolveReviewedBy(store, {
  reviewedBy: 'Taha Atak'
}), 'Taha Atak');

const twoOwners = {
  users: [halil, { id: 'u-taha', name: 'Taha', role: 'owner', active: true }]
};
assert.strictEqual(actor.resolveReviewedBy(twoOwners, {
  reviewedBy: 'Sistem Yöneticisi'
}), 'Sistem Yöneticisi', 'birden fazla sahip varsa tahmin etme');

const fs = require('fs');
const path = require('path');
const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
assert.match(server, /require\('\.\/lib\/session-actor'\)/);
assert.match(server, /function applyReviewActor/);
assert.match(server, /sessionActor\.resolveReviewedBy/);
assert.match(server, /6\.3\.27/);
assert.doesNotMatch(server, /if\(req\.session\?\.systemOwner===true\)return\{id:'system-owner',name:'Sistem Yöneticisi'/);

const adminJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'assets', 'admin.js'), 'utf8');
assert.match(adminJs, /function fillAdminChip/);
assert.match(adminJs, /ATAK_ADMIN_BUILD=fix-v27/);

console.log('session-actor.test.js ok');
