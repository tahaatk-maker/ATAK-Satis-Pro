'use strict';

/** Owner (Halil) oturumunda systemOwner bayrağı yetki içindir; görünen ad session.user'dan gelir. */

const GENERIC_SYSTEM_OWNER = {
  id: 'system-owner',
  name: 'Sistem Yöneticisi',
  username: 'admin',
  role: 'owner',
  roleName: 'Sahip / Tam Yetki',
  permissions: ['*'],
  active: true
};

function isGenericSystemActorName(name){
  const n = String(name || '').trim().toLocaleLowerCase('tr-TR');
  return !n || n === 'sistem yöneticisi' || n === 'yönetici' || n === 'yonetici';
}

function currentSessionUser(req){
  if(req?.session?.user) return req.session.user;
  if(req?.session?.systemOwner === true) return { ...GENERIC_SYSTEM_OWNER };
  return null;
}

function currentActor(req){
  if(req?.session?.staffUser) return req.session.staffUser;
  if(req?.session?.user) return req.session.user;
  if(req?.session?.systemOwner === true) return { ...GENERIC_SYSTEM_OWNER };
  return null;
}

function actorDisplayName(actor, fallback){
  const name = String(actor?.name || '').trim();
  if(name) return name;
  const username = String(actor?.username || '').trim();
  if(username && username.toLowerCase() !== 'admin') return username;
  return fallback || 'Yönetici';
}

function namedOwnerUsers(store){
  return (store?.users || []).filter(u =>
    u && u.active !== false &&
    String(u.id || '') !== 'system-owner' &&
    String(u.role || '').toLowerCase() === 'owner' &&
    String(u.name || '').trim() &&
    !isGenericSystemActorName(u.name)
  );
}

function resolveReviewedBy(store, row){
  const stored = String(row?.reviewedBy || '').trim();
  const id = String(row?.reviewedById || '').trim();
  if(id && id !== 'system-owner'){
    const u = (store?.users || []).find(x => String(x.id) === id);
    if(u && String(u.name || '').trim()) return String(u.name).trim();
    const st = (store?.staff || []).find(x => String(x.id) === id || String(x.userId) === id);
    if(st && String(st.name || '').trim()) return String(st.name).trim();
  }
  if(stored && !isGenericSystemActorName(stored)) return stored;
  const owners = namedOwnerUsers(store);
  if(owners.length === 1) return String(owners[0].name).trim();
  return stored;
}

module.exports = {
  GENERIC_SYSTEM_OWNER,
  isGenericSystemActorName,
  currentSessionUser,
  currentActor,
  actorDisplayName,
  namedOwnerUsers,
  resolveReviewedBy
};
