'use strict';

const DEFAULT_DOMAIN='atakhome.com.tr';

function normalizeDomain(value){
  let d=String(value||'').trim().toLocaleLowerCase('tr-TR')
    .replace(/^mailto:/,'').replace(/^@/,'').replace(/\/.*$/,'').replace(/\s+/g,'');
  d=d.replace(/ı/g,'i');
  if(!d)return DEFAULT_DOMAIN;
  if(!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(d))return DEFAULT_DOMAIN;
  return d;
}

function asciiLocal(value){
  return String(value||'')
    .replace(/İ/g,'i').replace(/I/g,'i')
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g,'i')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-z0-9]+/g,'.')
    .replace(/^\.+|\.+$/g,'')
    .slice(0,40);
}

function localPart(user={}){
  const fromUser=asciiLocal(user.username);
  if(fromUser&&fromUser.length>=2)return fromUser;
  const fromName=asciiLocal(user.name);
  if(fromName&&fromName.length>=2)return fromName;
  return 'personel';
}

function uniqueEmail(local, domain, taken){
  const base=local||'personel';
  let n=0, cand=`${base}@${domain}`;
  while(taken.has(cand)){
    n+=1;
    cand=`${base}${n}@${domain}`;
  }
  taken.add(cand);
  return cand;
}

function isCompanyEmail(email, domain){
  const e=String(email||'').trim().toLocaleLowerCase('tr-TR');
  const d=normalizeDomain(domain);
  return e.endsWith('@'+d);
}

function preview(users, domain){
  const d=normalizeDomain(domain);
  const taken=new Set();
  for(const u of users||[]){
    const e=String(u.email||'').trim().toLocaleLowerCase('tr-TR');
    if(e)taken.add(e);
  }
  return (users||[]).filter(u=>u&&u.active!==false).map(u=>{
    const current=String(u.email||'').trim();
    const suggested=current && isCompanyEmail(current,d)
      ? current
      : uniqueEmail(localPart(u),d,taken);
    return{
      id:u.id,
      name:u.name||'',
      username:u.username||'',
      role:u.role||'',
      email:current,
      suggested,
      missing:!current
    };
  });
}

function applyAssignments(store, {domain, fillMissing, items}={}){
  const d=normalizeDomain(domain||store.settings?.mailDomain);
  if(!store.settings||typeof store.settings!=='object')store.settings={};
  store.settings.mailDomain=d;
  const users=store.users||[];
  const byId=new Map(users.map(u=>[String(u.id),u]));
  const taken=new Set(users.map(u=>String(u.email||'').trim().toLocaleLowerCase('tr-TR')).filter(Boolean));
  let updated=0;
  const assign=(user, email)=>{
    const e=String(email||'').trim().toLocaleLowerCase('tr-TR');
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))throw new Error(`E-posta geçersiz: ${email||'?'}`);
    const other=users.find(x=>x.id!==user.id&&String(x.email||'').toLocaleLowerCase('tr-TR')===e);
    if(other)throw new Error(`${e} başka kullanıcıda kayıtlı (${other.username||other.name})`);
    if(String(user.email||'').trim().toLocaleLowerCase('tr-TR')===e)return;
    user.email=e;
    user.updatedAt=new Date().toISOString();
    taken.add(e);
    updated+=1;
  };
  for(const row of Array.isArray(items)?items:[]){
    const user=byId.get(String(row.id||''));
    if(!user)continue;
    if(!String(row.email||'').trim())continue;
    assign(user, row.email);
  }
  if(fillMissing){
    const rows=preview(users,d);
    for(const row of rows){
      if(!row.missing)continue;
      const user=byId.get(String(row.id));
      if(!user)continue;
      assign(user, row.suggested);
    }
  }
  return {updated,domain:d};
}

module.exports={
  DEFAULT_DOMAIN,
  normalizeDomain,
  asciiLocal,
  localPart,
  uniqueEmail,
  isCompanyEmail,
  preview,
  applyAssignments
};
