'use strict';

const crypto=require('crypto');

function hashToken(token){
  return crypto.createHash('sha256').update(String(token||'')).digest('hex');
}

function foldKey(value){
  return String(value||'').trim()
    .replace(/İ/g,'i').replace(/I/g,'i')
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g,'i');
}

function findResetUser(store, key){
  const k=foldKey(key);
  if(!k)return null;
  const user=(store.users||[]).find(u=>u.active!==false&&(
    foldKey(u.username)===k||
    foldKey(u.email)===k
  ));
  if(!user)return null;
  return user;
}

function resetEmailOf(user){
  return String(user&&user.email||'').trim();
}

function portalForUser(user){
  const role=String(user&&user.role||'').toLowerCase();
  if(['owner','admin','super_admin'].includes(role))return 'admin';
  return 'staff';
}

function issueResetToken(store, user, now=Date.now()){
  const token=crypto.randomBytes(32).toString('hex');
  const tokenHash=hashToken(token);
  const expiresAt=new Date(now+60*60*1000).toISOString();
  store.passwordResets=Array.isArray(store.passwordResets)?store.passwordResets:[];
  store.passwordResets=store.passwordResets.filter(r=>
    String(r.userId)!==String(user.id)&&new Date(r.expiresAt).getTime()>now
  );
  store.passwordResets.push({
    id:crypto.randomUUID(),
    userId:user.id,
    tokenHash,
    expiresAt,
    createdAt:new Date(now).toISOString(),
    used:false,
    portal:portalForUser(user)
  });
  return {token,expiresAt,portal:portalForUser(user)};
}

function consumeResetToken(store, token, password, hashPassword, now=Date.now()){
  const pwd=String(password||'');
  if(!String(token||'').trim()||pwd.length<6){
    throw new Error('Yeni şifre en az 6 karakter olmalı');
  }
  const tokenHash=hashToken(token);
  const row=(store.passwordResets||[]).find(r=>!r.used&&r.tokenHash===tokenHash);
  if(!row)throw new Error('Link geçersiz veya kullanılmış');
  if(new Date(row.expiresAt).getTime()<now){
    throw new Error('Linkin süresi dolmuş. Tekrar “Şifremi unuttum” deyin.');
  }
  const user=(store.users||[]).find(u=>String(u.id)===String(row.userId));
  if(!user||user.active===false)throw new Error('Kullanıcı bulunamadı');
  user.passwordHash=hashPassword(pwd);
  user.updatedAt=new Date(now).toISOString();
  row.used=true;
  row.usedAt=new Date(now).toISOString();
  return user;
}

module.exports={
  foldKey,
  hashToken,
  findResetUser,
  resetEmailOf,
  portalForUser,
  issueResetToken,
  consumeResetToken
};
