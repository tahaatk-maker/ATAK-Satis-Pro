/* Personel kaydı → Kullanıcı listesi */
function slug(input){ return String(input||'').toLocaleLowerCase('tr-TR').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ı/g,'i').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,''); }
function normalizeLoginUsername(v){return String(v||'').trim().toLocaleLowerCase('tr-TR')}
function sanitizeUserUsername(raw,fallbackName){
  let u=normalizeLoginUsername(raw)
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/ı/g,'i').replace(/[^a-z0-9._-]+/g,'.')
    .replace(/^[._-]+|[._-]+$/g,'');
  if(!u||u.length<3){
    u=slug(fallbackName||'personel').replace(/-/g,'.')||'personel';
  }
  if(u.length<3)u=('per'+u).slice(0,40);
  return u.slice(0,40);
}
function uniqueUserUsername(s,desired,ignoreId){
  const used=new Set((s.users||[])
    .filter(x=>String(x.id)!==String(ignoreId||''))
    .map(x=>normalizeLoginUsername(x.username)));
  let cand=desired||'personel',i=2;
  while(used.has(cand)){
    const suf=String(i++);
    cand=((desired||'personel').slice(0,Math.max(1,40-suf.length-1))+'.'+suf).slice(0,40);
  }
  return cand;
}
function findUserForStaff(s,st){
  const uname=normalizeLoginUsername(st.username);
  if(uname){
    const byUser=s.users.find(x=>normalizeLoginUsername(x.username)===uname);
    if(byUser)return byUser;
  }
  if(st.userId){
    const byLink=s.users.find(x=>String(x.id)===String(st.userId));
    if(byLink)return byLink;
  }
  if(st.id){
    const byId=s.users.find(x=>String(x.id)===String(st.id));
    if(byId)return byId;
  }
  const nname=String(st.name||'').trim().toLocaleLowerCase('tr-TR');
  if(nname){
    const matches=(s.users||[]).filter(x=>String(x.name||'').trim().toLocaleLowerCase('tr-TR')===nname);
    if(matches.length===1)return matches[0];
  }
  return null;
}
function promoteStaffToUsers(s){
  s.users=Array.isArray(s.users)?s.users:[];
  s.staff=Array.isArray(s.staff)?s.staff:[];
  let n=0;
  for(const st of s.staff){
    if(!st||(!String(st.name||'').trim()&&!String(st.username||'').trim()))continue;
    let u=findUserForStaff(s,st);
    if(u){st.userId=u.id;continue}
    const username=uniqueUserUsername(s,sanitizeUserUsername(st.username,st.name));
    u={id:String(st.id||'u-'+username),name:st.name||username,username,role:'sales',storeId:st.storeId||'',passwordHash:st.passwordHash||''};
    s.users.push(u);st.userId=u.id;n++;
  }
  return n;
}
function assert(cond,msg){if(!cond)throw new Error(msg)}

assert(sanitizeUserUsername('emir','Emir Atak')==='emir','emir korunur');
assert(sanitizeUserUsername('','Emir Atak')==='emir.atak','adsız personelden kullanıcı adı');
assert(sanitizeUserUsername('','Emine Yakışır')==='emine.yakisir','türkçe karakter');
assert(sanitizeUserUsername('','Halil İbrahim Atak')==='halil.ibrahim.atak','halil');

const s={
  users:[{id:'admin',name:'Admin',username:'admin'}],
  staff:[
    {id:'s1',name:'Emir Atak',username:'emir',storeId:'beko',passwordHash:'x'},
    {id:'s2',name:'Emine Yakışır',username:'',storeId:'istikbal'},
    {id:'s3',name:'Halil İbrahim Atak',username:'halil',storeId:'beko'}
  ]
};
assert(promoteStaffToUsers(s)===3,'üç personel kullanıcı olur');
assert(s.users.some(u=>u.username==='emir'&&u.name==='Emir Atak'),'emir listede');
assert(s.users.some(u=>u.username==='emine.yakisir'),'emine listede');
assert(s.users.some(u=>u.username==='halil'),'halil listede');
assert(promoteStaffToUsers(s)===0,'ikinci kez eklemez');
assert(s.users.filter(u=>u.username==='emir').length===1,'emir tek');

console.log('OK promote-staff-users tests passed');
