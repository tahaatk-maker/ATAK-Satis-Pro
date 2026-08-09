'use strict';

const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const compression = require('compression');
const multer = require('multer');
const XLSX = require('xlsx');
const { parse } = require('csv-parse/sync');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { runBekoSync } = require('./lib/beko-sync');
const qnbSolist = require('./qnb-solist-adapter');

const app = express();
const ROOT = __dirname;
function loadEnvFile(){
  const p=path.join(ROOT,'.env');
  if(!fs.existsSync(p))return;
  for(const line of fs.readFileSync(p,'utf8').split(/\n/)){
    const t=String(line||'').trim();
    if(!t||t.startsWith('#'))continue;
    const i=t.indexOf('='); if(i<1)continue;
    const key=t.slice(0,i).trim();
    if(!/^[A-Z0-9_]+$/.test(key) || process.env[key]!=null)continue;
    let val=t.slice(i+1).trim();
    if((val.startsWith('"')&&val.endsWith('"'))||(val.startsWith("'")&&val.endsWith("'")))val=val.slice(1,-1);
    process.env[key]=val;
  }
}
loadEnvFile();
const PORT = Number(process.env.PORT || 3100);
const STORE_PATH = path.join(ROOT, 'data', 'store.json');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
const dynamicsUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
const COMMERCE_SYNC_URL = process.env.COMMERCE_SYNC_URL || 'http://127.0.0.1:3200/api/sync/beko';
/** Varsayılan: sadece sahip erişir. Personeli açmak için .env içinde ATAK_OWNER_ONLY=0 */
function ownerOnlyEnabled(){ return String(process.env.ATAK_OWNER_ONLY ?? '1').trim() !== '0'; }
function ownerUsernames(){
  return String(process.env.ATAK_OWNER_USERNAMES || 'admin,taha')
    .split(/[,;\s]+/).map(x=>x.trim().toLocaleLowerCase('tr-TR')).filter(Boolean);
}
function adminPassword(){ return String(process.env.ADMIN_PASSWORD || 'AtakHome2026!'); }
function allowedIps(){
  return String(process.env.ATAK_ALLOWED_IPS || '')
    .split(/[,;\s]+/).map(x=>x.trim()).filter(Boolean);
}
function clientIp(req){
  const xf=String(req.headers['x-forwarded-for']||'').split(',')[0].trim();
  return String(xf||req.ip||req.socket?.remoteAddress||'').replace(/^::ffff:/,'');
}
function ipAllowed(req){
  const list=allowedIps();
  if(!list.length)return true;
  const ip=clientIp(req);
  return list.some(a=>a==='*'||a===ip);
}
function isOwnerUsername(username=''){
  const u=String(username||'').trim().toLocaleLowerCase('tr-TR');
  if(!u)return false;
  return ownerUsernames().includes(u) || u==='admin';
}
function isOwnerActor(req){
  if(req.session?.systemOwner===true)return true;
  const u=req.session?.user || req.session?.staffUser;
  if(!u)return false;
  if(String(u.id||'')==='system-owner')return true;
  if(String(u.role||'').toLowerCase()==='owner')return true;
  return isOwnerUsername(u.username);
}
function ownerLockMessage(){
  return 'Sistem şu an sadece yöneticiye açıktır. Erişim engellendi.';
}
const loginFailMap=new Map();
function loginRateLimited(key=''){
  const k=String(key||'unknown');
  const now=Date.now();
  let row=loginFailMap.get(k);
  if(!row||now-row.t>15*60*1000)row={n:0,t:now};
  row.n+=1; row.t=row.t||now;
  loginFailMap.set(k,row);
  return row.n>10;
}
function clearLoginFails(key=''){ loginFailMap.delete(String(key||'unknown')); }

/** KDV: beyaz eşya %20; X30 TR / yazar kasa %10; İstikbal mobilya %10 */
function resolveVatRate(p={}){
  const cat=String(p.category||'').toLocaleLowerCase('tr-TR');
  const brand=String(p.brand||'').toLocaleLowerCase('tr-TR');
  const text=`${p.code||''} ${p.name||''} ${p.searchName||''} ${p.itemCode||''} ${p.barcode||''} ${p.dynamicsName||''}`
    .toLocaleLowerCase('tr-TR')
    .replace(/\s+/g,' ')
    .trim();
  const compact=text.replace(/\s/g,'');
  // Yazar kasa / X30 TR → %10
  if(cat==='yazar-kasa' || cat==='yazarkasa') return 10;
  if(/\bx30\s*tr\b/.test(text) || compact.includes('x30tr') || /yazar\s*kasa/.test(text) || compact.includes('yazarkasa')) return 10;
  // İstikbal mobilya → %10
  if(cat==='mobilya') return 10;
  if(brand.includes('istikbal')) return 10;
  // Beyaz eşya ve diğer tüm ürünler → %20
  return 20;
}

function ensureStore(store) {
  store.settings ||= { siteName:'Atak Home', tagline:'Eviniz için her şey', whatsapp:'905433585060', phone:'02122232871', email:'tarabyabeko@gmail.com', address:'Sarıyer / İstanbul' };
  store.categories = Array.isArray(store.categories) ? store.categories : [];
  store.products = Array.isArray(store.products) ? store.products : [];
  store.campaigns = Array.isArray(store.campaigns) ? store.campaigns : [];
  store.banners = Array.isArray(store.banners) ? store.banners : [];
  store.syncLogs = Array.isArray(store.syncLogs) ? store.syncLogs : [];
  store.auditLogs = Array.isArray(store.auditLogs) ? store.auditLogs : [];
  store.users = Array.isArray(store.users) ? store.users : [];
  store.brands = Array.isArray(store.brands) ? store.brands : [];
  store.sales = Array.isArray(store.sales) ? store.sales : [];
  store.orders = Array.isArray(store.orders) ? store.orders : [];
  store.stores = Array.isArray(store.stores) ? store.stores : [];
  store.staff = Array.isArray(store.staff) ? store.staff : [];
  store.turnovers = Array.isArray(store.turnovers) ? store.turnovers : [];
  store.announcements = Array.isArray(store.announcements) ? store.announcements : [];
  store.announcementReads = Array.isArray(store.announcementReads) ? store.announcementReads : [];
  store.warehouses = Array.isArray(store.warehouses) ? store.warehouses : [];
  store.stockMovements = Array.isArray(store.stockMovements) ? store.stockMovements : [];
  store.productStocks = Array.isArray(store.productStocks) ? store.productStocks : [];
  store.financeAccounts = Array.isArray(store.financeAccounts) ? store.financeAccounts : [];
  store.customers = Array.isArray(store.customers) ? store.customers : [];
  store.financeTransactions = Array.isArray(store.financeTransactions) ? store.financeTransactions : [];
  store.receivables = Array.isArray(store.receivables) ? store.receivables : [];
  store.promissoryNotes = Array.isArray(store.promissoryNotes) ? store.promissoryNotes : [];
  store.promissorySettings ||= {creditorName:store.settings?.siteName||'Atak Pazarlama',paymentPlace:'İstanbul',issuePlace:'İstanbul',prefix:'ATAK',defaultInstallments:1,firstDueDays:30,intervalMonths:1,copies:1,footer:''};
  store.invoiceIntegration ||= {provider:'qnb-solist',environment:'test',enabled:false,companyVkn:'',companyTitle:'',senderAlias:'',webServiceUrl:'',username:'',password:'',draftMode:true,autoDetectType:true,gbAlias:'',pkAlias:''};
  if(store.invoiceIntegration && !store.invoiceIntegration.provider)store.invoiceIntegration.provider='qnb-solist';

  store.dealerSettings ||= [
    {id:'atak-beko',name:'Atak Beko',marginDividePct:25,commissionPct:0.50,cashMaxDiscountPct:10,cardMaxDiscountPct:5,active:true},
    {id:'atak-istikbal',name:'Atak İstikbal',marginDividePct:35,commissionPct:0.50,cashMaxDiscountPct:10,cardMaxDiscountPct:5,active:true}
  ];

  store.cancellationRequests = Array.isArray(store.cancellationRequests) ? store.cancellationRequests : [];
  store.invoiceQueue = Array.isArray(store.invoiceQueue) ? store.invoiceQueue : [];
  store.invoiceInbox = Array.isArray(store.invoiceInbox) ? store.invoiceInbox : [];
  store.invoiceAppResponses = Array.isArray(store.invoiceAppResponses) ? store.invoiceAppResponses : [];
  if(!store.financeAccounts.length){
    store.financeAccounts.push(
      {id:'merkez-kasa',name:'Merkez Kasa',type:'cash',storeId:store.stores[0]?.id||'',active:true,openingBalance:0,createdAt:new Date().toISOString()},
      {id:'qnb-banka',name:'QNB Banka',type:'bank',storeId:'',active:true,openingBalance:0,createdAt:new Date().toISOString()}
    );
  }

  if(!store.warehouses.length){
    const firstStore=store.stores[0];
    store.warehouses.push({id:'ana-depo',name:'Ana Depo',code:'ANA',storeId:firstStore?.id||'',active:true,createdAt:new Date().toISOString()});
  }

  if(!store.stores.length) store.stores.push({id:'atak-tarabya',name:'Atak Tarabya',code:'TRB',active:true,address:'Sarıyer / İstanbul',createdAt:new Date().toISOString()});

  // KDV kuralları için temel kategoriler / markalar
  const ensureCat=(id,name,sort)=>{
    if(!(store.categories||[]).some(c=>c.id===id||String(c.name||'').toLocaleLowerCase('tr-TR')===name.toLocaleLowerCase('tr-TR'))){
      store.categories.push({id,name,active:true,sort,description:''});
    }
  };
  ensureCat('yazar-kasa','Yazar Kasa',90);
  ensureCat('mobilya','Mobilya',50);
  ensureCat('beyaz-esya','Beyaz Eşya',10);
  if(!(store.brands||[]).some(b=>/istikbal/i.test(b.name||''))){
    store.brands.push({id:'istikbal',name:'İstikbal',active:true,sort:(store.brands||[]).length,logo:''});
  }
  store.categories = store.categories.map((c,i)=>({ id:c.id||slug(c.name)||crypto.randomUUID(), name:c.name||'Kategori', active:c.active!==false, sort:Number(c.sort??i), description:c.description||'' }));
  store.brands = store.brands.map((b,i)=>({ id:b.id||slug(b.name)||crypto.randomUUID(), name:b.name||'Marka', active:b.active!==false, sort:Number(b.sort??i), logo:b.logo||'' }));
  store.products = store.products.map(p=>{
    const row={
      tags:[], campaignId:'', barcode:'', purchasePrice:0, listPrice:Number(p.oldPrice||p.bekoPrice||0),
      cashPrice:Number(p.salePrice||0), cardPrice:Number(p.salePrice||0), minimumSalePrice:0,
      ...p
    };
    row.vatRate=resolveVatRate(row);
    return row;
  });
  store.campaigns = store.campaigns.map((c,i)=>({ id:c.id||crypto.randomUUID(), title:c.title||'Kampanya', subtitle:c.subtitle||'', label:c.label||'FIRSAT', startDate:c.startDate||'', endDate:c.endDate||'', active:c.active!==false, homepage:c.homepage!==false, sort:Number(c.sort??i), productIds:Array.isArray(c.productIds)?c.productIds:[] }));
  if (!store.banners.length) store.banners.push({ id:crypto.randomUUID(), headline:'Evinizi sadece döşemeyin. Yaşatın.', subheadline:'Beko ürünleri, mobilya, klima, TV ve ev yaşam çözümleri Atak Home’da.', ctaText:'Ürünleri keşfet', ctaUrl:'#products', desktopImage:'', mobileImage:'', active:true, sort:0 });
  return store;
}
function readStore(){ return ensureStore(JSON.parse(fs.readFileSync(STORE_PATH,'utf8'))); }
function writeStore(store){ const t=`${STORE_PATH}.tmp`; fs.writeFileSync(t,JSON.stringify(ensureStore(store),null,2),'utf8'); fs.renameSync(t,STORE_PATH); }
function normalizeNumber(value){
  if(value===null||value===undefined||value==='') return 0;
  const raw=String(value).trim().replace(/\s/g,'').replace(/₺/g,'');
  if(/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(raw)) return Number(raw.replace(/\./g,'').replace(',','.'))||0;
  return Number(raw.replace(',','.'))||0;
}
function slug(input){ return String(input||'').toLocaleLowerCase('tr-TR').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ı/g,'i').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,''); }
function calculateSalePrice(p){ const base=Number(p.bekoPrice||0),v=Number(p.priceValue||0); if(p.priceMode==='percent_down')return Math.max(0,Math.round(base*(1-v/100))); if(p.priceMode==='percent_up')return Math.max(0,Math.round(base*(1+v/100))); if(p.priceMode==='fixed_down')return Math.max(0,Math.round(base-v)); if(p.priceMode==='fixed_up')return Math.max(0,Math.round(base+v)); if(p.priceMode==='manual')return Math.max(0,Math.round(v||p.salePrice||base)); return Math.max(0,Math.round(base)); }
function sanitizeProduct(row,current={}){
  const p={...current};
  p.id=current.id||crypto.randomUUID();
  p.code=String(row.code??current.code??'').trim(); p.name=String(row.name??current.name??'').trim();
  p.itemCode=String(row.itemCode??current.itemCode??'').trim();
  p.searchName=String(row.searchName??current.searchName??'').trim();
  p.dynamicsName=String(row.dynamicsName??current.dynamicsName??'').trim();
  p.dynamicsProductId=String(row.dynamicsProductId??current.dynamicsProductId??'').trim();
  p.brand=String(row.brand??current.brand??'Beko').trim(); p.category=slug(row.category??current.category??'diger');
  p.barcode=String(row.barcode??current.barcode??'').trim();
  p.purchasePrice=normalizeNumber(row.purchasePrice??current.purchasePrice??0);
  p.listPrice=normalizeNumber(row.listPrice??current.listPrice??row.oldPrice??current.oldPrice??row.bekoPrice??current.bekoPrice??0);
  p.cashPrice=normalizeNumber(row.cashPrice??current.cashPrice??row.salePrice??current.salePrice??0);
  p.cardPrice=normalizeNumber(row.cardPrice??current.cardPrice??row.salePrice??current.salePrice??0);
  p.minimumSalePrice=normalizeNumber(row.minimumSalePrice??current.minimumSalePrice??0);
  p.vatRate=resolveVatRate(p);
  p.bekoPrice=normalizeNumber(row.bekoPrice??current.bekoPrice); p.oldPrice=normalizeNumber(row.oldPrice??current.oldPrice??p.bekoPrice);
  p.priceMode=String(row.priceMode??current.priceMode??'same'); p.priceValue=normalizeNumber(row.priceValue??current.priceValue??0);
  p.stock=Math.max(0,Math.round(normalizeNumber(row.stock??current.stock))); p.active=row.active===undefined?(current.active??true):Boolean(row.active);
  p.featured=row.featured===undefined?(current.featured??false):Boolean(row.featured); p.image=String(row.image??current.image??'');
  p.images=Array.isArray(row.images)?row.images.filter(Boolean):(current.images||[]);
  p.description=String(row.description??current.description??'');
  p.specifications=Array.isArray(row.specifications)?row.specifications:(current.specifications||[]);
  p.documents=Array.isArray(row.documents)?row.documents:(current.documents||[]);
  p.sourceUrl=String(row.sourceUrl??current.sourceUrl??'');
  p.tags=Array.isArray(row.tags)?row.tags.map(String):Array.isArray(current.tags)?current.tags:[];
  p.campaignId=String(row.campaignId??current.campaignId??''); p.updatedAt=new Date().toISOString();
  p.salePrice=calculateSalePrice(p);
  if(!p.cashPrice) p.cashPrice=p.salePrice;
  if(!p.cardPrice) p.cardPrice=p.salePrice;
  return p;
}
function audit(store,action,entity,details={}){ store.auditLogs.unshift({id:crypto.randomUUID(),date:new Date().toISOString(),actor:'Yönetici',action,entity,details}); store.auditLogs=store.auditLogs.slice(0,300); }
function isCampaignLive(c){ const now=new Date(); if(!c.active)return false; if(c.startDate&&new Date(c.startDate)>now)return false; if(c.endDate&&new Date(c.endDate+'T23:59:59')<now)return false; return true; }


function normalizeImportPrice(value){
  let n=normalizeNumber(value);
  if(Number.isFinite(n)&&n>=1000000&&Math.round(n)%100===0)n=n/100;
  return Math.round((Number(n)||0)*100)/100;
}
function cleanImportDocuments(items){
  const allow=/kullanım kılavuzu|kullanma kılavuzu|enerji etiketi|ürün bilgi formu|ürün belgesi|teknik föy|teknik katalog/i;
  const block=/çerez|cookie|kvkk|gizlilik|aydınlatma|hizmet talebi|buradan|руководство|bedienungsanleitung|user guide/i;
  const seen=new Set();
  return(Array.isArray(items)?items:[]).map(x=>({title:String(x?.title||'Ürün Belgesi').trim(),url:String(x?.url||'').trim()}))
  .filter(x=>x.url&&allow.test(x.title)&&!block.test(x.title))
  .filter(x=>{if(seen.has(x.url))return false;seen.add(x.url);return true}).slice(0,15);
}
function deriveImportCode(product){
  const current=String(product?.code||'').trim();
  if(current&&!/^\d{8,}$/.test(current))return current;
  const text=String(product?.name||'').toUpperCase();
  for(const pattern of [/\b([A-Z]{1,7}\s+\d{3,7}\s+[A-Z])\b/,/\b([A-Z]{1,7}\s+\d{3,7})\b/]){
    const m=text.match(pattern);if(m)return m[1].replace(/\s+/g,' ').trim();
  }
  return current;
}
function normalizeImportedProduct(product){
  const images=[...new Set((Array.isArray(product?.images)?product.images:[]).filter(Boolean))].slice(0,20);
  const price=normalizeImportPrice(product?.price??product?.bekoPrice);
  return{...product,code:deriveImportCode(product),brand:String(product?.brand||'Beko').trim(),name:String(product?.name||'').trim(),category:String(product?.category||'').trim(),bekoPrice:price,oldPrice:price,listPrice:price,cashPrice:price,cardPrice:price,price,images,image:images[0]||String(product?.image||''),specifications:(Array.isArray(product?.specifications)?product.specifications:[]).filter(x=>x?.name&&x?.value).slice(0,250),documents:cleanImportDocuments(product?.documents),description:String(product?.description||'').trim(),sourceUrl:String(product?.sourceUrl||'').trim()};
}
async function fetchImportedBekoProduct(url){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),100000);
  try{
    const response=await fetch(COMMERCE_SYNC_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url}),signal:controller.signal});
    const text=await response.text();let data;
    try{data=JSON.parse(text)}catch{throw new Error('Beko veri servisi JSON yerine geçersiz cevap verdi')}
    if(!response.ok||!data.success)throw new Error(data.error||`Beko veri servisi HTTP ${response.status}`);
    return normalizeImportedProduct(data.product||{});
  }finally{clearTimeout(timer)}
}


const ROLE_PRESETS={
  owner:{name:'Sahip / Tam Yetki',permissions:['*']},
  admin:{name:'Yönetici',permissions:['dashboard_view','products_manage','marketing_manage','finance_manage','sync_manage','users_manage']},
  super_admin:{name:'Süper Admin',permissions:['*']},
  sales:{name:'Satış Personeli',permissions:['dashboard_view','products_view','orders_manage','customers_manage','finance_view']},
  warehouse:{name:'Depo',permissions:['dashboard_view','products_view','stock_manage','orders_view']},
  accounting:{name:'Muhasebe',permissions:['dashboard_view','finance_manage','orders_view','finance_view']},
  service:{name:'Servis',permissions:['dashboard_view','orders_view','service_manage']},
  viewer:{name:'Sadece Görüntüleme',permissions:['dashboard_view','products_view','orders_view']}
};
function hashPassword(password,salt=crypto.randomBytes(16).toString('hex')){
  return`${salt}:${crypto.scryptSync(String(password),salt,64).toString('hex')}`;
}
function verifyPassword(password,stored){
  const [salt,hash]=String(stored||'').split(':');
  if(!salt||!hash)return false;
  const calculated=crypto.scryptSync(String(password),salt,64),expected=Buffer.from(hash,'hex');
  return expected.length===calculated.length&&crypto.timingSafeEqual(expected,calculated);
}
function currentSessionUser(req){
  if(req.session?.systemOwner===true)return{id:'system-owner',name:'Sistem Yöneticisi',username:'admin',role:'owner',roleName:'Sahip / Tam Yetki',permissions:['*'],active:true};
  return req.session?.user||null;
}
function hasPermission(req,permission){
  const permissions=currentSessionUser(req)?.permissions||[];
  return permissions.includes('*')||permissions.includes(permission);
}
function requirePermission(permission){
  return(req,res,next)=>{
    if(req.session?.admin!==true)return res.status(401).json({error:'Oturum gerekli'});
    if(hasPermission(req,permission))return next();
    return res.status(403).json({error:'Bu işlem için yetkiniz yok'});
  };
}
function currentActor(req){
  if(req.session?.systemOwner===true){
    return {id:'system-owner',name:'Sistem Yöneticisi',username:'admin',role:'owner',permissions:['*']};
  }
  if(req.session?.user) return req.session.user;
  if(req.session?.staffUser) return req.session.staffUser;
  return null;
}

function actorHasPermission(req,permission){
  const actor=currentActor(req);
  if(!actor)return false;
  const permissions=Array.isArray(actor.permissions)?actor.permissions:[];
  return permissions.includes('*') || permissions.includes(permission);
}

function denyIfOwnerLocked(req,res){
  if(!ownerOnlyEnabled())return false;
  if(isOwnerActor(req))return false;
  if(req.session){
    try{
      delete req.session.admin;
      delete req.session.systemOwner;
      delete req.session.user;
      delete req.session.staffUser;
    }catch(_){}
  }
  res.status(403).json({error:ownerLockMessage(),ownerOnly:true});
  return true;
}
function requireAdminOrStaff(permission){
  return (req,res,next)=>{
    if(req.session?.admin===true){
      if(denyIfOwnerLocked(req,res))return;
      return next();
    }
    if(!req.session?.staffUser)return res.status(401).json({error:'Oturum gerekli'});
    if(denyIfOwnerLocked(req,res))return;
    if(!actorHasPermission(req,permission))
      return res.status(403).json({error:'Bu işlem için yetkiniz yok'});
    next();
  };
}
function requireAdminOrStaffAny(...permissions){
  return (req,res,next)=>{
    if(req.session?.admin===true){
      if(denyIfOwnerLocked(req,res))return;
      return next();
    }
    if(!req.session?.staffUser)return res.status(401).json({error:'Oturum gerekli'});
    if(denyIfOwnerLocked(req,res))return;
    if(permissions.some(p=>actorHasPermission(req,p)))
      return next();
    return res.status(403).json({error:'Bu işlem için yetkiniz yok'});
  };
}
function actorIsManager(req){
  const a=currentActor(req);
  if(!a)return Boolean(req.session?.systemOwner===true);
  if(req.session?.systemOwner===true)return true;
  const role=String(a.role||'').toLowerCase();
  if(['owner','admin','super_admin'].includes(role))return true;
  const perms=Array.isArray(a.permissions)?a.permissions:[];
  return perms.includes('*')||perms.includes('finance_manage')||perms.includes('users_manage');
}
function txBelongsToActor(tx,actor){
  if(!tx||!actor)return false;
  const id=String(actor.id||'');
  const name=String(actor.name||'').trim().toLocaleLowerCase('tr-TR');
  const username=String(actor.username||'').trim().toLocaleLowerCase('tr-TR');
  if(id&&(String(tx.salespersonId||'')===id||String(tx.createdById||'')===id||String(tx.createdBy||'')===id))return true;
  const by=String(tx.createdBy||'').trim().toLocaleLowerCase('tr-TR');
  const sp=String(tx.salespersonName||'').trim().toLocaleLowerCase('tr-TR');
  if(name&&(by===name||sp===name||by.includes(name)||sp.includes(name)))return true;
  if(username&&(by===username||sp===username))return true;
  return false;
}
function dealerBrandKey(dealerId=''){
  const d=String(dealerId||'').toLowerCase();
  if(d.includes('istikbal'))return 'istikbal';
  if(d.includes('beko'))return 'beko';
  return 'other';
}
function buildSalesCiro(salesRows){
  const brand={beko:0,istikbal:0,other:0,total:0,count:0};
  const byPerson=new Map();
  for(const t of salesRows||[]){
    const amount=Number(t.total||t.grossTotal||0);
    const key=dealerBrandKey(t.dealerId);
    brand[key]=(brand[key]||0)+amount;
    brand.total+=amount;
    brand.count+=1;
    const pid=String(t.salespersonId||t.salespersonName||t.createdBy||'unknown');
    const pname=String(t.salespersonName||t.createdBy||'Personel');
    if(!byPerson.has(pid))byPerson.set(pid,{id:pid,name:pname,beko:0,istikbal:0,other:0,total:0,count:0});
    const row=byPerson.get(pid);
    row[key]=(row[key]||0)+amount;
    row.total+=amount;
    row.count+=1;
  };
  const round=n=>Math.round(Number(n||0)*100)/100;
  return{
    brand:{beko:round(brand.beko),istikbal:round(brand.istikbal),other:round(brand.other),total:round(brand.total),count:brand.count},
    personnel:[...byPerson.values()].map(x=>({...x,beko:round(x.beko),istikbal:round(x.istikbal),other:round(x.other),total:round(x.total)})).sort((a,b)=>b.total-a.total)
  };
}
function monthBounds(month=''){
  const m=String(month||'').trim();
  if(!/^\d{4}-\d{2}$/.test(m)){
    const d=new Date();
    const fallback=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    return monthBounds(fallback);
  }
  const [y,mo]=m.split('-').map(Number);
  const from=`${m}-01`;
  const last=new Date(y,mo,0).getDate();
  const to=`${m}-${String(last).padStart(2,'0')}`;
  return{month:m,from,to};
}
function buildMonthSalesPrim(salesRows=[],pendingMap=new Map()){
  const round=n=>Math.round(Number(n||0)*100)/100;
  let gross=0,grossCount=0,cancelled=0,cancelledCount=0,returned=0,returnedCount=0,net=0,netCount=0,prim=0,primLost=0;
  const rows=(salesRows||[]).map(t=>{
    const amount=Number(t.total||0);
    const commission=Number(t.commissionAmount||0);
    const isCancelled=Boolean(t.cancelled);
    const cancelKind=String(t.cancelKind||t.requestKind||'').toLowerCase()==='return'?'return':'cancel';
    const pend=pendingMap.get(String(t.id))||null;
    gross+=amount;grossCount+=1;
    if(isCancelled){
      if(cancelKind==='return'){returned+=amount;returnedCount+=1}else{cancelled+=amount;cancelledCount+=1}
      primLost+=Number(t.cancelledCommissionAmount!=null?t.cancelledCommissionAmount:commission);
    }else{
      net+=amount;netCount+=1;prim+=commission;
    }
    return{
      id:t.id,
      reference:t.reference||'',
      date:(t.date||'').slice(0,10),
      customerId:t.customerId||'',
      customerName:t.customerName||'',
      dealerId:t.dealerId||'',
      dealerName:t.dealerName||'',
      salespersonId:t.salespersonId||'',
      salespersonName:t.salespersonName||t.createdBy||'',
      total:round(amount),
      commissionPct:Number(t.commissionPct||0),
      commissionAmount:round(commission),
      cancelled:isCancelled,
      cancelKind:isCancelled?cancelKind:'',
      cancelReason:t.cancelReason||'',
      cancelledAt:t.cancelledAt||'',
      pendingRequest:pend?{id:pend.id,requestKind:pend.requestKind||pend.targetType||'cancel',reason:pend.reason||'',requestedAt:pend.requestedAt||'',requestedByName:pend.requestedByName||''}:null
    };
  }).sort((a,b)=>String(b.date).localeCompare(String(a.date)));
  return{
    summary:{
      grossSales:round(gross),
      grossCount,
      cancelledSales:round(cancelled),
      cancelledCount,
      returnedSales:round(returned),
      returnedCount,
      deductedSales:round(cancelled+returned),
      deductedCount:cancelledCount+returnedCount,
      netSales:round(net),
      netCount,
      primEarned:round(prim),
      primLost:round(primLost),
      primNet:round(prim)
    },
    rows
  };
}

function publicUser(user){
  return{id:user.id,name:user.name,username:user.username,role:user.role,roleName:ROLE_PRESETS[user.role]?.name||user.role,permissions:user.permissions||[],active:user.active!==false,createdAt:user.createdAt||'',updatedAt:user.updatedAt||''};
}


function staffSession(req){return req.session?.staffUser||null}
function cleanMoney(v){return Math.max(0,Math.round(normalizeNumber(v)*100)/100)}
function publicStaff(x,store){
  const branch=store.stores.find(s=>s.id===x.storeId);
  return{id:x.id,name:x.name,username:x.username,role:x.role||'staff',storeId:x.storeId,storeName:branch?.name||'Mağaza',active:x.active!==false};
}
function todayISO(){return new Date().toISOString().slice(0,10)}
function foundationSummary(s,date=todayISO()){
  const rows=s.turnovers.filter(x=>x.date===date);
  const total=rows.reduce((a,x)=>a+Number(x.netAmount||0),0);
  const completed=new Set(rows.map(x=>x.storeId));
  return{
    date,totalTurnover:total,entryCount:rows.length,
    storeCount:s.stores.filter(x=>x.active!==false).length,
    completedStores:completed.size,
    missingStores:s.stores.filter(x=>x.active!==false&&!completed.has(x.id)).map(x=>({id:x.id,name:x.name}))
  };
}


function stockKey(productCode,warehouseId){return`${String(productCode).trim().toLocaleUpperCase('tr-TR')}::${warehouseId}`}
function currentStock(s,productCode,warehouseId){
  const key=stockKey(productCode,warehouseId);
  return s.productStocks.find(x=>x.key===key)||null;
}
function setStock(s,productCode,warehouseId,quantity){
  const code=String(productCode||'').trim().toLocaleUpperCase('tr-TR');
  const key=stockKey(code,warehouseId),now=new Date().toISOString();
  let row=s.productStocks.find(x=>x.key===key);
  if(row){row.quantity=Math.max(0,Math.round(Number(quantity)||0));row.updatedAt=now}
  else{row={id:crypto.randomUUID(),key,productCode:code,warehouseId,quantity:Math.max(0,Math.round(Number(quantity)||0)),reserved:0,createdAt:now,updatedAt:now};s.productStocks.push(row)}
  return row;
}
function addStockMovement(s,{productCode,warehouseId,type,quantity,reference='',note='',user='Admin'}){
  const code=String(productCode||'').trim().toLocaleUpperCase('tr-TR');
  const current=currentStock(s,code,warehouseId);
  const before=Number(current?.quantity||0);
  const delta=Math.round(Number(quantity)||0);
  const after=Math.max(0,before+delta);
  const stock=setStock(s,code,warehouseId,after);
  const movement={id:crypto.randomUUID(),productCode:code,warehouseId,type,quantity:delta,before,after,reference:String(reference||''),note:String(note||''),user,createdAt:new Date().toISOString()};
  s.stockMovements.unshift(movement);
  return{stock,movement};
}


function accountBalance(s,accountId){
  const account=s.financeAccounts.find(x=>x.id===accountId);
  const opening=Number(account?.openingBalance||0);
  const movement=s.financeTransactions.reduce((sum,t)=>{
    if(t.accountId===accountId)sum+=Number(t.amount||0);
    if(t.counterAccountId===accountId)sum-=Number(t.amount||0);
    return sum;
  },0);
  return Math.round((opening+movement)*100)/100;
}
function customerBalance(s,customerId){
  return Math.round(s.financeTransactions.filter(x=>x.customerId===customerId).reduce((sum,t)=>sum+Number(t.customerDelta||0),0)*100)/100;
}
function financeSnapshot(s){
  const accounts=s.financeAccounts.filter(x=>x.active!==false).map(x=>({...x,balance:accountBalance(s,x.id)}));
  const cash=accounts.filter(x=>x.type==='cash').reduce((a,x)=>a+x.balance,0);
  const bank=accounts.filter(x=>x.type==='bank').reduce((a,x)=>a+x.balance,0);
  const receivable=s.customers.filter(x=>x.active!==false).reduce((a,x)=>a+Math.max(0,customerBalance(s,x.id)),0);
  const today=todayISO();
  const todayIncome=s.financeTransactions.filter(x=>x.date===today&&x.amount>0&&x.kind!=='transfer').reduce((a,x)=>a+Number(x.amount||0),0);
  const todayExpense=s.financeTransactions.filter(x=>x.date===today&&x.amount<0).reduce((a,x)=>a+Math.abs(Number(x.amount||0)),0);
  return{cash,bank,total:cash+bank,receivable,todayIncome,todayExpense,accounts};
}
function financeTx(s,data){
  const row={id:crypto.randomUUID(),date:String(data.date||todayISO()).slice(0,10),kind:String(data.kind||'income'),
    accountId:String(data.accountId||''),counterAccountId:String(data.counterAccountId||''),customerId:String(data.customerId||''),
    amount:Math.round(Number(data.amount||0)*100)/100,customerDelta:Math.round(Number(data.customerDelta||0)*100)/100,
    category:String(data.category||''),description:String(data.description||''),reference:String(data.reference||''),
    createdBy:String(data.createdBy||'Admin'),createdAt:new Date().toISOString()};
  s.financeTransactions.unshift(row); return row;
}

app.set('trust proxy',1); app.use(helmet({contentSecurityPolicy:false})); app.use(compression()); app.use(express.json({limit:'2mb'})); app.use(express.urlencoded({extended:true}));
app.use(session({
  name:'atakhome.sid',
  secret:process.env.SESSION_SECRET||'CHANGE-ME-SET-IN-ENV',
  resave:false,
  saveUninitialized:false,
  cookie:{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:12*60*60*1000}
}));
app.use((req,res,next)=>{
  if(req.path==='/health')return next();
  if(!ipAllowed(req)){
    const wantsHtml=String(req.headers.accept||'').includes('text/html');
    if(wantsHtml)return res.status(403).type('html').send('<!doctype html><meta charset="utf-8"><title>Erişim Engeli</title><body style="font-family:Arial;padding:40px"><h1>Erişim engellendi</h1><p>Bu panel yalnızca yetkili IP üzerinden açılır.</p></body>');
    return res.status(403).json({error:'IP erişimi engellendi'});
  }
  next();
});
function requireAdmin(req,res,next){
  if(req.session?.admin!==true)return res.status(401).json({error:'Oturum gerekli'});
  if(denyIfOwnerLocked(req,res))return;
  next();
}
function requireStaff(req,res,next){
  if(!staffSession(req))return res.status(401).json({error:'Personel oturumu gerekli'});
  if(denyIfOwnerLocked(req,res))return;
  next();
}
app.use('/assets',express.static(path.join(ROOT,'public','assets'),{maxAge:'7d',fallthrough:true}));
app.use('/web-admin-assets',express.static(path.join(ROOT,'public','assets'),{maxAge:'7d',fallthrough:true}));
app.get('/health',(req,res)=>res.json({
  ok:true,
  service:'atakhome-erp-v2',
  version:'6.3.4-owner-lock',
  ownerOnly:ownerOnlyEnabled(),
  time:new Date().toISOString()
}));
app.get('/web-api/public',(req,res)=>{ const s=readStore(); res.json({settings:s.settings,categories:s.categories.filter(c=>c.active).sort((a,b)=>a.sort-b.sort),products:s.products.filter(p=>p.active).map(p=>({...p,salePrice:calculateSalePrice(p)})),campaigns:s.campaigns.filter(isCampaignLive).sort((a,b)=>a.sort-b.sort),banners:s.banners.filter(b=>b.active).sort((a,b)=>a.sort-b.sort)}); });
app.post('/web-api/login',(req,res)=>{
  const username=String(req.body.username||'').trim().toLocaleLowerCase('tr-TR'),password=String(req.body.password||'');
  const failKey=`admin:${clientIp(req)}:${username||'admin'}`;
  if(loginRateLimited(failKey))return res.status(429).json({error:'Çok fazla deneme. 15 dk sonra tekrar deneyin.'});
  if((!username||username==='admin')&&password===adminPassword()){
    clearLoginFails(failKey);
    req.session.admin=true;req.session.systemOwner=true;delete req.session.user;delete req.session.staffUser;
    return res.json({ok:true,user:currentSessionUser(req),ownerOnly:ownerOnlyEnabled()});
  }
  const s=readStore(),user=(s.users||[]).find(x=>x.active!==false&&String(x.username||'').toLocaleLowerCase('tr-TR')===username);
  if(!user||!verifyPassword(password,user.passwordHash))return res.status(401).json({error:'Kullanıcı adı veya şifre yanlış'});
  if(ownerOnlyEnabled() && !isOwnerUsername(user.username) && String(user.role||'').toLowerCase()!=='owner'){
    return res.status(403).json({error:ownerLockMessage(),ownerOnly:true});
  }
  clearLoginFails(failKey);
  const preset=ROLE_PRESETS[user.role]||ROLE_PRESETS.viewer;
  req.session.admin=true;req.session.systemOwner=String(user.role||'').toLowerCase()==='owner';
  req.session.user={...publicUser(user),permissions:user.permissions?.length?user.permissions:preset.permissions};
  delete req.session.staffUser;
  res.json({ok:true,user:req.session.user,ownerOnly:ownerOnlyEnabled()});
});
app.post('/web-api/logout',(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get('/web-api/me',(req,res)=>{
  const authed=req.session?.admin===true;
  if(authed && ownerOnlyEnabled() && !isOwnerActor(req)){
    delete req.session.admin; delete req.session.systemOwner; delete req.session.user;
    return res.json({authenticated:false,user:null,ownerOnly:true});
  }
  res.json({authenticated:authed,user:currentSessionUser(req),ownerOnly:ownerOnlyEnabled()});
});
app.get('/web-api/admin/store',requireAdmin,(req,res)=>{const s=readStore();res.json({...s,users:hasPermission(req,'users_manage')?(s.users||[]).map(publicUser):[],security:{ownerOnly:ownerOnlyEnabled(),ownerUsernames:ownerUsernames()}});});



app.get('/web-api/admin/roles',requireAdmin,(req,res)=>res.json({roles:Object.entries(ROLE_PRESETS).map(([id,x])=>({id,name:x.name,permissions:x.permissions}))}));
app.post('/web-api/admin/user',requirePermission('users_manage'),(req,res)=>{
  const s=readStore(),x=req.body||{},username=String(x.username||'').trim().toLocaleLowerCase('tr-TR'),name=String(x.name||'').trim(),role=ROLE_PRESETS[x.role]?String(x.role):'viewer';
  if(!username||!name)return res.status(400).json({error:'Ad ve kullanıcı adı zorunludur'});
  if(!/^[a-z0-9._-]{3,40}$/.test(username))return res.status(400).json({error:'Kullanıcı adı uygun değil'});
  if((s.users||[]).some(u=>u.id!==x.id&&String(u.username).toLocaleLowerCase('tr-TR')===username))return res.status(409).json({error:'Bu kullanıcı adı zaten kullanılıyor'});
  let user=(s.users||[]).find(u=>String(u.id)===String(x.id));const now=new Date().toISOString();
  if(user){user.name=name;user.username=username;user.role=role;user.active=x.active!==false;user.permissions=ROLE_PRESETS[role].permissions;if(String(x.password||'').trim())user.passwordHash=hashPassword(x.password);user.updatedAt=now}
  else{if(!String(x.password||'').trim())return res.status(400).json({error:'Yeni kullanıcı için şifre zorunludur'});user={id:crypto.randomUUID(),name,username,role,permissions:ROLE_PRESETS[role].permissions,active:x.active!==false,passwordHash:hashPassword(x.password),createdAt:now,updatedAt:now};s.users.push(user)}
  audit(s,x.id?'Kullanıcı güncellendi':'Kullanıcı eklendi',username,{role});writeStore(s);res.json({ok:true,user:publicUser(user)});
});
app.delete('/web-api/admin/user/:id',requirePermission('users_manage'),(req,res)=>{
  const s=readStore(),user=(s.users||[]).find(x=>x.id===req.params.id);if(!user)return res.status(404).json({error:'Kullanıcı bulunamadı'});
  user.active=false;user.updatedAt=new Date().toISOString();audit(s,'Kullanıcı pasife alındı',user.username,{role:user.role});writeStore(s);res.json({ok:true});
});


// ===== ATAK HOME PLATFORM V3.0 FOUNDATION =====
app.get('/foundation-api/public',(req,res)=>{
  const s=readStore();
  res.json({siteName:s.settings.siteName,stores:s.stores.filter(x=>x.active!==false).map(x=>({id:x.id,name:x.name}))});
});
app.post('/foundation-api/login',(req,res)=>{
  const s=readStore(),username=String(req.body?.username||'').trim().toLocaleLowerCase('tr-TR'),password=String(req.body?.password||'');
  const failKey=`staff:${clientIp(req)}:${username||'admin'}`;
  if(loginRateLimited(failKey))return res.status(429).json({error:'Çok fazla deneme. 15 dk sonra tekrar deneyin.'});

  const user=(s.users||[]).find(x=>
    x.active!==false &&
    String(x.username||'').trim().toLocaleLowerCase('tr-TR')===username
  );

  // Önce gerçek kullanıcı şifresi; yoksa admin şifresiyle sahip girişi
  if(user && verifyPassword(password,user.passwordHash)){
    // aşağıda normal personel oturumu kurulur
  }else if((!username||username==='admin') && password===adminPassword()){
    clearLoginFails(failKey);
    const branch=(s.stores||[]).find(x=>x.active!==false)||(s.stores||[])[0];
    req.session.staffUser={
      id:'system-owner',name:'Sistem Yöneticisi',username:'admin',role:'owner',roleName:'Sahip / Tam Yetki',
      permissions:['*'],storeId:branch?.id||'',storeName:branch?.name||'Mağaza',active:true
    };
    req.session.admin=true;req.session.systemOwner=true;delete req.session.user;
    return res.json({ok:true,user:req.session.staffUser,ownerOnly:ownerOnlyEnabled()});
  }else if(!user||!verifyPassword(password,user.passwordHash)){
    return res.status(401).json({error:'Kullanıcı adı veya şifre yanlış'});
  }
  if(ownerOnlyEnabled() && !isOwnerUsername(user.username) && String(user.role||'').toLowerCase()!=='owner'){
    return res.status(403).json({error:ownerLockMessage(),ownerOnly:true});
  }

  const branch=(s.stores||[]).find(x=>String(x.id)===String(user.storeId||'')) ||
               (s.stores||[]).find(x=>x.active!==false) ||
               (s.stores||[])[0];

  clearLoginFails(failKey);
  req.session.staffUser={
    id:user.id,
    name:user.name,
    username:user.username,
    role:user.role||'staff',
    roleName:(typeof ROLE_PRESETS!=='undefined' && ROLE_PRESETS[user.role]?.name)||user.role||'Personel',
    permissions:Array.isArray(user.permissions)?user.permissions:(ROLE_PRESETS[user.role]?.permissions||[]),
    storeId:user.storeId||branch?.id||'',
    storeName:branch?.name||'Mağaza',
    active:user.active!==false
  };

  res.json({ok:true,user:req.session.staffUser,ownerOnly:ownerOnlyEnabled()});
});
app.post('/foundation-api/logout',(req,res)=>{delete req.session.staffUser;res.json({ok:true})});
app.get('/foundation-api/me',(req,res)=>{
  if(staffSession(req) && ownerOnlyEnabled() && !isOwnerActor(req)){
    delete req.session.staffUser;
    return res.json({authenticated:false,user:null,ownerOnly:true});
  }
  res.json({authenticated:Boolean(staffSession(req)),user:staffSession(req),ownerOnly:ownerOnlyEnabled()});
});
app.get('/foundation-api/dashboard',requireStaff,(req,res)=>{
  const s=readStore(),u=staffSession(req),date=todayISO();
  const own=s.turnovers.filter(x=>x.staffId===u.id).sort((a,b)=>String(b.date).localeCompare(String(a.date))).slice(0,14);
  const announcements=s.announcements.filter(x=>x.active!==false&&(!x.storeId||x.storeId===u.storeId)&&(!x.endDate||x.endDate>=date))
    .map(x=>({...x,read:s.announcementReads.some(r=>r.announcementId===x.id&&r.staffId===u.id)}))
    .sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
  res.json({user:u,today:own.find(x=>x.date===date)||null,history:own,announcements});
});
app.post('/foundation-api/turnover',requireStaff,(req,res)=>{
  const s=readStore(),u=staffSession(req),date=String(req.body?.date||todayISO()).slice(0,10);
  const gross=cleanMoney(req.body?.grossAmount),returns=cleanMoney(req.body?.returnAmount),orders=Math.max(0,Math.round(normalizeNumber(req.body?.orderCount)));
  if(!gross&&orders===0)return res.status(400).json({error:'Ciro veya sipariş adedi girilmelidir'});
  const existing=s.turnovers.find(x=>x.staffId===u.id&&x.storeId===u.storeId&&x.date===date);
  const row={id:existing?.id||crypto.randomUUID(),date,staffId:u.id,staffName:u.name,storeId:u.storeId,storeName:u.storeName,grossAmount:gross,returnAmount:returns,netAmount:Math.max(0,gross-returns),orderCount:orders,note:String(req.body?.note||'').slice(0,500),updatedAt:new Date().toISOString()};
  if(existing)Object.assign(existing,row);else s.turnovers.unshift(row);
  audit(s,existing?'Personel ciro güncelledi':'Personel ciro girdi',u.name,{store:u.storeName,date,netAmount:row.netAmount});
  writeStore(s);res.json({ok:true,row});
});
app.post('/foundation-api/announcement/:id/read',requireStaff,(req,res)=>{
  const s=readStore(),u=staffSession(req);
  if(!s.announcementReads.some(x=>x.announcementId===req.params.id&&x.staffId===u.id))s.announcementReads.unshift({id:crypto.randomUUID(),announcementId:req.params.id,staffId:u.id,readAt:new Date().toISOString()});
  writeStore(s);res.json({ok:true});
});

app.get('/web-api/admin/foundation',requireAdmin,(req,res)=>{
  const s=readStore();
  res.json({stores:s.stores,staff:s.staff.map(x=>publicStaff(x,s)),turnovers:s.turnovers,announcements:s.announcements,announcementReads:s.announcementReads,summary:foundationSummary(s)});
});
app.post('/web-api/admin/store-location',requireAdmin,(req,res)=>{
  const s=readStore(),x=req.body||{},name=String(x.name||'').trim();
  if(!name)return res.status(400).json({error:'Mağaza adı zorunludur'});
  let row=s.stores.find(v=>v.id===x.id);
  const data={name,code:String(x.code||'').trim().toUpperCase(),address:String(x.address||''),active:x.active!==false,updatedAt:new Date().toISOString()};
  if(row)Object.assign(row,data);else{row={id:slug(name)||crypto.randomUUID(),createdAt:new Date().toISOString(),...data};if(s.stores.some(v=>v.id===row.id))row.id=`${row.id}-${Date.now()}`;s.stores.push(row)}
  audit(s,'Mağaza kaydedildi',row.name);writeStore(s);res.json({ok:true,row});
});
app.post('/web-api/admin/staff-member',requireAdmin,(req,res)=>{
  const s=readStore(),x=req.body||{},name=String(x.name||'').trim(),username=String(x.username||'').trim().toLocaleLowerCase('tr-TR');
  if(!name||!username||!x.storeId)return res.status(400).json({error:'Ad, kullanıcı adı ve mağaza zorunludur'});
  if(s.staff.some(v=>v.id!==x.id&&String(v.username).toLocaleLowerCase('tr-TR')===username))return res.status(409).json({error:'Kullanıcı adı kullanımda'});
  let row=s.staff.find(v=>v.id===x.id);
  if(!row&&!String(x.password||'').trim())return res.status(400).json({error:'Yeni personel için şifre zorunludur'});
  const data={name,username,storeId:String(x.storeId),role:String(x.role||'staff'),active:x.active!==false,updatedAt:new Date().toISOString()};
  if(row){Object.assign(row,data);if(String(x.password||'').trim())row.passwordHash=hashPassword(x.password)}
  else{row={id:crypto.randomUUID(),createdAt:new Date().toISOString(),passwordHash:hashPassword(x.password),...data};s.staff.push(row)}
  audit(s,'Personel kaydedildi',row.name,{storeId:row.storeId});writeStore(s);res.json({ok:true,row:publicStaff(row,s)});
});
app.post('/web-api/admin/announcement',requireAdmin,(req,res)=>{
  const s=readStore(),x=req.body||{},title=String(x.title||'').trim(),message=String(x.message||'').trim();
  if(!title||!message)return res.status(400).json({error:'Başlık ve mesaj zorunludur'});
  let row=s.announcements.find(v=>v.id===x.id);
  const data={title,message,type:String(x.type||'info'),storeId:String(x.storeId||''),endDate:String(x.endDate||''),active:x.active!==false,updatedAt:new Date().toISOString()};
  if(row)Object.assign(row,data);else{row={id:crypto.randomUUID(),createdAt:new Date().toISOString(),...data};s.announcements.unshift(row)}
  audit(s,'Duyuru kaydedildi',row.title);writeStore(s);res.json({ok:true,row});
});
app.delete('/web-api/admin/announcement/:id',requireAdmin,(req,res)=>{
  const s=readStore();s.announcements=s.announcements.filter(x=>x.id!==req.params.id);s.announcementReads=s.announcementReads.filter(x=>x.announcementId!==req.params.id);writeStore(s);res.json({ok:true});
});
app.get('/web-api/admin/backup',requireAdmin,(req,res)=>{
  const raw=fs.readFileSync(STORE_PATH);
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  res.setHeader('Content-Type','application/json');
  res.setHeader('Content-Disposition',`attachment; filename="atakhome-foundation-backup-${stamp}.json"`);
  res.send(raw);
});


// ===== V3.1 STOK & DEPO =====

app.delete('/web-api/admin/warehouse/:id',requireAdmin,(req,res)=>{
  const s=readStore(),row=s.warehouses.find(w=>w.id===req.params.id&&!w.deletedAt);
  if(!row)return res.status(404).json({error:'Depo bulunamadı'});
  const related=(s.productStocks||[]).filter(x=>x.warehouseId===row.id);
  const physical=related.reduce((a,x)=>a+Number(x.quantity||0),0);
  const reserved=related.reduce((a,x)=>a+Number(x.reserved||0),0);
  if(physical>0||reserved>0)return res.status(400).json({error:`${row.name} silinemez. Depoda ${physical} fiziksel, ${reserved} rezerve stok var. Önce stokları başka depoya aktarın.`});
  row.active=false;row.deletedAt=new Date().toISOString();row.updatedAt=row.deletedAt;
  audit(s,'Depo silindi',row.name,{warehouseId:row.id});writeStore(s);res.json({ok:true,row});
});


app.get('/web-api/admin/sales-catalog',requireAdminOrStaff('orders_manage'),(req,res)=>{
  const s=readStore();
  const products=(s.products||[])
    .filter(p=>p.active!==false)
    .map(p=>{
      const cash=Number(p.cashPrice||0),card=Number(p.cardPrice||0),sale=Number(p.salePrice||p.price||0);
      const list=Number(p.listPrice||p.bekoPrice||p.oldPrice||0);
      const price=cash||sale||card||list||0;
      return{
        code:p.code,
        name:p.name||p.code,
        itemCode:p.itemCode||'',
        searchName:p.searchName||p.code||'',
        brand:p.brand||'',
        category:p.category||'',
        cashPrice:cash||price,
        cardPrice:card||price,
        listPrice:list||price,
        salePrice:sale||price,
        price,
        image:p.image||''
      };
    });
  const categories=(s.categories||[])
    .filter(c=>c.active!==false)
    .map(c=>({id:c.id,name:c.name}))
    .sort((a,b)=>String(a.name).localeCompare(String(b.name),'tr'));
  // Personel satışında müşteri/hesap boş kalmasın (yeni personel de satabilsin)
  const customers=(s.customers||[]).filter(c=>c.active!==false).map(c=>({
    id:c.id,name:c.name,phone:c.phone||'',taxNo:c.taxNo||'',city:c.city||'',balance:customerBalance(s,c.id),active:true
  })).sort((a,b)=>String(a.name).localeCompare(String(b.name),'tr'));
  const accounts=(s.financeAccounts||[]).filter(a=>a.active!==false).map(a=>({
    id:a.id,name:a.name,type:a.type,storeId:a.storeId||'',active:true
  }));
  res.json({ok:true,products,categories,dealerSettings:s.dealerSettings||[],customers,accounts});
});

app.get('/web-api/admin/stock-center',requireAdminOrStaff('stock_manage'),(req,res)=>{
  const s=readStore();
  const products=(s.products||[]).map(p=>({code:p.code,name:p.name,itemCode:p.itemCode||'',searchName:p.searchName||'',brand:p.brand,category:p.category,image:p.image,active:p.active!==false}));
  const stocks=s.productStocks.map(x=>{
    const product=products.find(p=>String(p.code).toLocaleUpperCase('tr-TR')===String(x.productCode).toLocaleUpperCase('tr-TR'));
    const warehouse=s.warehouses.find(w=>w.id===x.warehouseId);
    return{...x,productName:product?.name||x.productCode,warehouseName:warehouse?.name||'Depo',available:Math.max(0,Number(x.quantity||0)-Number(x.reserved||0))};
  });
  res.json({warehouses:s.warehouses,products,stocks,movements:s.stockMovements.slice(0,500)});
});
app.post('/web-api/admin/warehouse',requireAdmin,(req,res)=>{
  const s=readStore(),x=req.body||{},name=String(x.name||'').trim();
  if(!name)return res.status(400).json({error:'Depo adı zorunludur'});
  let row=s.warehouses.find(v=>v.id===x.id);
  const data={name,code:String(x.code||'').trim().toUpperCase(),storeId:String(x.storeId||''),active:x.active!==false,updatedAt:new Date().toISOString()};
  if(row)Object.assign(row,data);else{row={id:slug(name)||crypto.randomUUID(),createdAt:new Date().toISOString(),...data};if(s.warehouses.some(v=>v.id===row.id))row.id=`${row.id}-${Date.now()}`;s.warehouses.push(row)}
  audit(s,'Depo kaydedildi',row.name,{storeId:row.storeId});writeStore(s);res.json({ok:true,row});
});
app.post('/web-api/admin/stock-adjust',requireAdmin,(req,res)=>{
  const s=readStore(),x=req.body||{},productCode=String(x.productCode||'').trim(),warehouseId=String(x.warehouseId||'');
  if(!productCode||!warehouseId)return res.status(400).json({error:'Ürün ve depo zorunludur'});
  const target=Math.max(0,Math.round(normalizeNumber(x.quantity)));
  const current=Number(currentStock(s,productCode,warehouseId)?.quantity||0);
  const delta=target-current;
  const result=addStockMovement(s,{productCode,warehouseId,type:'adjustment',quantity:delta,reference:String(x.reference||'Manuel düzeltme'),note:String(x.note||''),user:currentActor(req)?.name||'Admin'});
  audit(s,'Stok düzeltildi',productCode,{warehouseId,before:current,after:target});writeStore(s);res.json({ok:true,...result});
});
app.post('/web-api/admin/stock-transfer',requireAdmin,(req,res)=>{
  const s=readStore(),x=req.body||{},productCode=String(x.productCode||'').trim(),from=String(x.fromWarehouseId||''),to=String(x.toWarehouseId||''),qty=Math.max(1,Math.round(normalizeNumber(x.quantity)));
  if(!productCode||!from||!to||from===to)return res.status(400).json({error:'Ürün, kaynak depo ve farklı hedef depo zorunludur'});
  const source=Number(currentStock(s,productCode,from)?.quantity||0);
  if(source<qty)return res.status(400).json({error:`Kaynak depoda yalnızca ${source} adet var`});
  const ref=`TR-${Date.now()}`;
  addStockMovement(s,{productCode,warehouseId:from,type:'transfer_out',quantity:-qty,reference:ref,note:String(x.note||''),user:currentActor(req)?.name||'Admin'});
  addStockMovement(s,{productCode,warehouseId:to,type:'transfer_in',quantity:qty,reference:ref,note:String(x.note||''),user:currentActor(req)?.name||'Admin'});
  audit(s,'Depolar arası transfer',productCode,{from,to,qty,ref});writeStore(s);res.json({ok:true,reference:ref});
});
app.post('/web-api/admin/stock-import',requireAdmin,upload.single('file'),(req,res)=>{
  try{
    if(!req.file)return res.status(400).json({error:'CSV dosyası seçilmedi'});
    const warehouseId=String(req.body?.warehouseId||'');
    if(!warehouseId)return res.status(400).json({error:'Depo seçilmelidir'});
    const text=req.file.buffer.toString('utf8').replace(/^\uFEFF/,'');
    const lines=text.split(/\r?\n/).filter(Boolean);
    if(lines.length<2)return res.status(400).json({error:'CSV dosyasında veri bulunamadı'});
    const delimiter=(lines[0].match(/;/g)||[]).length>=(lines[0].match(/,/g)||[]).length?';':',';
    const header=lines[0].split(delimiter).map(x=>x.trim().toLocaleLowerCase('tr-TR'));
    const codeIndex=header.findIndex(x=>/ürün.?kodu|urun.?kodu|kod|product.?code/.test(x));
    const qtyIndex=header.findIndex(x=>/adet|stok|quantity|qty/.test(x));
    if(codeIndex<0||qtyIndex<0)return res.status(400).json({error:'CSV içinde Ürün Kodu ve Adet/Stok sütunları bulunmalı'});
    const s=readStore();let imported=0,skipped=0;
    for(const line of lines.slice(1)){
      const cols=line.split(delimiter).map(x=>x.trim().replace(/^"|"$/g,''));
      const code=String(cols[codeIndex]||'').trim(),qty=Math.max(0,Math.round(normalizeNumber(cols[qtyIndex])));
      if(!code){skipped++;continue}
      const current=Number(currentStock(s,code,warehouseId)?.quantity||0);
      addStockMovement(s,{productCode:code,warehouseId,type:'import',quantity:qty-current,reference:'CSV Stok Aktarımı',note:'Toplu stok aktarımı',user:currentActor(req)?.name||'Admin'});
      imported++;
    }
    audit(s,'CSV stok aktarımı',warehouseId,{imported,skipped});writeStore(s);res.json({ok:true,imported,skipped});
  }catch(error){res.status(500).json({error:error.message||'Stok aktarımı başarısız'})}
});


// ===== V3.2 FINANS & CARI =====

app.get('/web-api/admin/web-orders',requireAdmin,(req,res)=>{
  const store=readStore();
  const rows=(store.orders||[]).map((o,index)=>{
    const customer=o.customer||{};
    const items=Array.isArray(o.items)?o.items:(Array.isArray(o.products)?o.products:[]);
    const total=cleanMoney(o.totalAmount??o.total??o.grandTotal??o.amount);
    return {
      id:String(o.id||o.orderId||o.number||`web-${index+1}`),
      number:String(o.orderNumber||o.number||o.id||`WEB-${index+1}`),
      date:String(o.createdAt||o.orderDate||o.date||''),
      customerName:String(o.customerName||customer.name||customer.fullName||'-'),
      phone:String(o.phone||customer.phone||''),
      email:String(o.email||customer.email||''),
      items:items.map(i=>({name:String(i.name||i.productName||i.title||i.code||'Ürün'),quantity:Number(i.quantity||i.qty||1),price:cleanMoney(i.price||i.unitPrice||0)})),
      paymentMethod:String(o.paymentMethod||o.paymentType||o.payment?.method||'-'),
      paymentStatus:String(o.paymentStatus||o.payment?.status||''),
      total,
      status:String(o.status||'new'),
      rawStatus:String(o.status||'new')
    };
  });
  res.json({orders:rows});
});
app.patch('/web-api/admin/web-orders/:id/status',requireAdmin,(req,res)=>{
  const allowed=new Set(['new','preparing','service','shipped','completed','cancelled','returned']);
  const status=String(req.body?.status||'');
  if(!allowed.has(status))return res.status(400).json({error:'Geçersiz sipariş durumu'});
  const store=readStore();
  const row=(store.orders||[]).find((o,index)=>String(o.id||o.orderId||o.number||`web-${index+1}`)===req.params.id);
  if(!row)return res.status(404).json({error:'Sipariş bulunamadı'});
  row.status=status;row.updatedAt=new Date().toISOString();
  audit(store,'Web sipariş durumu değiştirildi',String(row.orderNumber||row.number||row.id||req.params.id),{status});
  writeStore(store);res.json({ok:true,status});
});

app.get('/web-api/admin/finance-center',requireAdminOrStaffAny('finance_manage','finance_view','orders_manage','customers_manage'),(req,res)=>{
  const s=readStore();
  const actor=currentActor(req);
  const canManage=actorIsManager(req);
  // Personel portalı oturumu: kapsam uygula. /web-admin oturumu: klasik tam finans.
  const staffPortal=Boolean(req.session?.staffUser) && req.session?.admin!==true;
  const salespersonId=String(req.query.salespersonId||'');
  const dealerFilter=String(req.query.dealerId||'');
  const accounts=s.financeAccounts.map(x=>({...x,balance:accountBalance(s,x.id)}));
  const customerMap=new Map((s.customers||[]).map(c=>[String(c.id),c]));

  let sales=(s.financeTransactions||[]).filter(t=>t.kind==='sale'&&!t.cancelled);
  let txs=(s.financeTransactions||[]).filter(t=>!t.cancelled);

  if(staffPortal && !canManage){
    sales=sales.filter(t=>txBelongsToActor(t,actor));
    const saleCustomerIds=new Set(sales.map(t=>String(t.customerId||'')).filter(Boolean));
    txs=txs.filter(t=>txBelongsToActor(t,actor) || (t.kind==='collection'&&saleCustomerIds.has(String(t.customerId||''))));
  }else if(staffPortal && canManage){
    if(salespersonId){
      const people=salesPeople(s,req);
      const person=people.find(p=>String(p.id)===salespersonId);
      const fakeActor={id:salespersonId,name:person?.name||'',username:''};
      sales=sales.filter(t=>txBelongsToActor(t,fakeActor)||String(t.salespersonId||'')===salespersonId);
      txs=txs.filter(t=>txBelongsToActor(t,fakeActor)||String(t.salespersonId||'')===salespersonId||String(t.createdById||'')===salespersonId);
    }
    if(dealerFilter){
      sales=sales.filter(t=>String(t.dealerId||'')===dealerFilter);
      const saleCustomerIds=new Set(sales.map(t=>String(t.customerId||'')).filter(Boolean));
      txs=txs.filter(t=>t.kind==='sale' ? String(t.dealerId||'')===dealerFilter : (t.kind==='collection'&&saleCustomerIds.has(String(t.customerId||''))));
    }
  }

  const ownCustomerIds=new Set(txs.map(t=>String(t.customerId||'')).filter(Boolean));
  const customers=((staffPortal && (!canManage || salespersonId || dealerFilter))
    ? (s.customers||[]).filter(c=>ownCustomerIds.has(String(c.id)))
    : (s.customers||[])
  ).map(x=>({...x,balance:customerBalance(s,x.id)}));

  const transactions=txs.slice(0,1000).map(x=>({
    ...x,
    accountName:accounts.find(a=>a.id===x.accountId)?.name||'',
    counterAccountName:accounts.find(a=>a.id===x.counterAccountId)?.name||'',
    customerName:customerMap.get(String(x.customerId||''))?.name||''
  }));

  const saleRows=(staffPortal?transactions.filter(t=>t.kind==='sale'):sales).map(x=>({
    ...x,
    customerName:customerMap.get(String(x.customerId||''))?.name||x.customerName||''
  }));
  const ciro=buildSalesCiro(saleRows);
  const ownNet=Math.round(saleRows.reduce((a,t)=>a+Number(t.total||0),0)*100)/100;
  const ownCount=saleRows.length;
  const ownCollect=Math.round(transactions.filter(t=>t.kind==='collection').reduce((a,t)=>a+Number(t.amount||0),0)*100)/100;
  const fullSummary=financeSnapshot(s);
  const summary=(staffPortal && (!canManage || salespersonId || dealerFilter))
    ? {
        cash:canManage?fullSummary.cash:0,
        bank:canManage?fullSummary.bank:0,
        receivable:Math.round(customers.reduce((a,c)=>a+Math.max(0,Number(c.balance||0)),0)*100)/100,
        todayExpense:0,
        mySalesTotal:ownNet,
        mySalesCount:ownCount,
        myCollections:ownCollect
      }
    : fullSummary;

  res.json({
    summary,
    accounts, // satış ödemesi için hesap listesi personelde de gerekli
    customers,
    transactions,
    sales:saleRows,
    stores:s.stores,
    canManage:staffPortal?canManage:true,
    ciro,
    people:(staffPortal && canManage)?salesPeople(s,req):[],
    filters:{salespersonId,dealerId:dealerFilter},
    scope:staffPortal?(canManage?(salespersonId||dealerFilter?'filtered':'all'):'own'):'admin'
  });
});
app.post('/web-api/admin/finance-account',requireAdmin,(req,res)=>{
  const s=readStore(),x=req.body||{},name=String(x.name||'').trim(),type=['cash','bank'].includes(x.type)?x.type:'cash';
  if(!name)return res.status(400).json({error:'Hesap adı zorunludur'});
  let row=s.financeAccounts.find(v=>v.id===x.id);
  const data={name,type,storeId:String(x.storeId||''),openingBalance:cleanMoney(x.openingBalance),active:x.active!==false,updatedAt:new Date().toISOString()};
  if(row)Object.assign(row,data);else{row={id:slug(name)||crypto.randomUUID(),createdAt:new Date().toISOString(),...data};if(s.financeAccounts.some(v=>v.id===row.id))row.id=`${row.id}-${Date.now()}`;s.financeAccounts.push(row)}
  audit(s,'Finans hesabı kaydedildi',row.name,{type});writeStore(s);res.json({ok:true,row:{...row,balance:accountBalance(s,row.id)}});
});
function customerSnapshot(c={}){
  return {
    name:c.name||'',phone:c.phone||'',email:c.email||'',taxNo:c.taxNo||'',tckn:c.tckn||'',
    city:c.city||'',district:c.district||'',address:c.address||'',
    deliverySameAsBilling:c.deliverySameAsBilling!==false,deliveryCity:c.deliveryCity||'',
    deliveryDistrict:c.deliveryDistrict||'',deliveryAddress:c.deliveryAddress||'',
    invoiceType:c.invoiceType==='corporate'?'corporate':'individual',
    companyName:c.companyName||'',taxOffice:c.taxOffice||'',note:c.note||'',
    active:c.active!==false
  };
}
function parseCustomerPayload(x={}){
  const name=String(x.name||'').trim();
  const phone=String(x.phone||'').trim();
  const city=String(x.city||'').trim();
  const district=String(x.district||'').trim();
  const address=String(x.address||'').trim();
  const invoiceType=String(x.invoiceType||'individual')==='corporate'?'corporate':'individual';
  const deliverySame=x.deliverySameAsBilling!==false&&x.deliverySameAsBilling!=='false';
  const deliveryCity=String(x.deliveryCity||'').trim();
  const deliveryDistrict=String(x.deliveryDistrict||'').trim();
  const deliveryAddress=String(x.deliveryAddress||'').trim();
  const companyName=String(x.companyName||'').trim();
  const taxOffice=String(x.taxOffice||'').trim();
  const taxNo=String(x.taxNo||x.corporateTaxNo||x.tckn||'').trim();
  if(!name)throw new Error('Müşteri adı zorunludur');
  if(!phone)throw new Error('Telefon zorunludur');
  if(!city||!district||!address)throw new Error('Fatura adresi (il, ilçe, açık adres) zorunludur');
  if(!deliverySame&&(!deliveryCity||!deliveryDistrict||!deliveryAddress)){
    throw new Error('Teslimat adresi fatura adresinden farklıysa il, ilçe ve açık adres zorunludur');
  }
  if(invoiceType==='corporate'){
    if(!companyName)throw new Error('Kurumsal faturada firma ünvanı zorunludur');
    if(!taxOffice)throw new Error('Kurumsal faturada vergi dairesi zorunludur');
    if(!taxNo||taxNo.replace(/\D/g,'').length<10)throw new Error('Kurumsal faturada geçerli VKN zorunludur');
  }
  return {
    name,phone,
    email:String(x.email||'').trim(),
    taxNo,
    tckn:invoiceType==='individual'?String(x.tckn||taxNo||'').trim():'',
    city,district,address,
    deliverySameAsBilling:deliverySame,
    deliveryCity:deliverySame?city:deliveryCity,
    deliveryDistrict:deliverySame?district:deliveryDistrict,
    deliveryAddress:deliverySame?address:deliveryAddress,
    invoiceType,
    companyName:invoiceType==='corporate'?companyName:'',
    taxOffice:invoiceType==='corporate'?taxOffice:'',
    note:String(x.note||'').trim(),
    active:x.active!==false&&x.active!=='false',
    updatedAt:new Date().toISOString()
  };
}
function applyCustomerData(row,data){Object.assign(row,data);return row}
app.post('/web-api/admin/customer',requireAdminOrStaff('customers_manage'),(req,res)=>{
  const s=readStore(),x=req.body||{};
  let data;
  try{data=parseCustomerPayload(x)}catch(e){return res.status(400).json({error:e.message})}
  let row=s.customers.find(v=>v.id===x.id);
  // Yeni müşteri: doğrudan kaydet
  if(!row){
    row={id:crypto.randomUUID(),createdAt:new Date().toISOString(),...data};
    s.customers.push(row);
    audit(s,'Müşteri kaydedildi',row.name);writeStore(s);
    return res.json({ok:true,row:{...row,balance:customerBalance(s,row.id)}});
  }
  // Düzenleme: yönetici değilse onay kuyruğuna
  if(!isSystemManager(req)){
    if((s.cancellationRequests||[]).some(r=>r.status==='pending'&&r.targetType==='customer_edit'&&String(r.targetId)===String(row.id)))
      return res.status(409).json({error:'Bu müşteri için bekleyen düzenleme onayı var'});
    const u=currentSessionUser(req);
    const reqRow={
      id:crypto.randomUUID(),targetType:'customer_edit',targetId:String(row.id),
      targetReference:row.name||row.id,reason:String(x.reason||'Müşteri bilgisi düzenleme').trim()||'Müşteri bilgisi düzenleme',
      status:'pending',requestedById:u?.id||'',requestedByName:u?.name||'Personel',
      requestedAt:new Date().toISOString(),reviewedBy:'',reviewedAt:'',reviewNote:'',
      payload:{before:customerSnapshot(row),after:customerSnapshot({...data,active:data.active})}
    };
    s.cancellationRequests.unshift(reqRow);
    audit(s,'Müşteri düzenleme onayı istendi',row.name,{personel:reqRow.requestedByName});
    writeStore(s);
    return res.json({ok:true,pendingApproval:true,row:reqRow});
  }
  applyCustomerData(row,data);
  audit(s,'Müşteri kaydedildi',row.name);writeStore(s);
  res.json({ok:true,row:{...row,balance:customerBalance(s,row.id)}});
});
app.post('/web-api/admin/finance-transaction',requireAdminOrStaff('finance_manage'),(req,res)=>{
  const s=readStore(),x=req.body||{},kind=String(x.kind||''),amount=cleanMoney(x.amount);
  if(!amount)return res.status(400).json({error:'Tutar sıfırdan büyük olmalıdır'});
  const accountId=String(x.accountId||''),customerId=String(x.customerId||'');
  if(!accountId)return res.status(400).json({error:'Kasa veya banka seçilmelidir'});
  let signedAmount=amount,customerDelta=0;
  if(kind==='expense'||kind==='payment')signedAmount=-amount;
  if(kind==='sale')customerDelta=amount;
  if(kind==='collection')customerDelta=-amount;
  const row=financeTx(s,{date:x.date,kind,accountId,customerId,amount:signedAmount,customerDelta,category:x.category,description:x.description,reference:x.reference,createdBy:currentActor(req)?.name||'Admin'});
  audit(s,'Finans hareketi',kind,{amount:signedAmount,accountId,customerId});writeStore(s);res.json({ok:true,row});
});
app.post('/web-api/admin/finance-transfer',requireAdminOrStaff('finance_manage'),(req,res)=>{
  const s=readStore(),x=req.body||{},from=String(x.fromAccountId||''),to=String(x.toAccountId||''),amount=cleanMoney(x.amount);
  if(!from||!to||from===to)return res.status(400).json({error:'Farklı kaynak ve hedef hesap seçilmelidir'});
  if(accountBalance(s,from)<amount)return res.status(400).json({error:'Kaynak hesap bakiyesi yetersiz'});
  const ref=`FT-${Date.now()}`;
  financeTx(s,{date:x.date,kind:'transfer',accountId:to,counterAccountId:from,amount,description:x.description,reference:ref,createdBy:currentActor(req)?.name||'Admin'});
  audit(s,'Hesaplar arası transfer',ref,{from,to,amount});writeStore(s);res.json({ok:true,reference:ref});
});


app.get('/web-api/admin/customer-detail/:id',requireAdmin,(req,res)=>{
  const s=readStore(),customer=s.customers.find(x=>x.id===req.params.id);
  if(!customer)return res.status(404).json({error:'Müşteri bulunamadı'});
  const transactions=s.financeTransactions
    .filter(x=>x.customerId===customer.id)
    .sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))||String(b.createdAt||'').localeCompare(String(a.createdAt||'')))
    .map(x=>{
      const items=Array.isArray(x.items)?x.items:[];
      const net=Number(x.total!=null?x.total:(x.kind==='sale'||x.kind==='sale_cancel'?Math.abs(Number(x.customerDelta||0)):Number(x.amount||0)));
      const displayAmount=x.kind==='sale'||x.kind==='sale_cancel'
        ?Number(x.total!=null?x.total:Math.abs(Number(x.customerDelta||0)))
        :Number(x.amount||0);
      return{
        ...x,
        items,
        accountName:s.financeAccounts.find(a=>a.id===x.accountId)?.name||'',
        receiptUrl:`/web-api/admin/receipt/${x.id}`,
        displayAmount,
        itemSummary:items.map(i=>`${i.quantity||1}× ${i.productName||i.materialCode||i.productCode||'Ürün'}`).join(', ')
      };
    });
  const pendingEdit=(s.cancellationRequests||[]).find(r=>r.status==='pending'&&r.targetType==='customer_edit'&&String(r.targetId)===String(customer.id))||null;
  res.json({
    customer:{...customer,balance:customerBalance(s,customer.id)},
    transactions,
    pendingEdit,
    canManage:isSystemManager(req),
    accounts:s.financeAccounts.filter(x=>x.active!==false).map(x=>({...x,balance:accountBalance(s,x.id)})),
    products:(s.products||[]).filter(x=>x.active!==false).map(x=>({code:x.code,name:x.name,price:Number(x.cashPrice||x.salePrice||x.price||0),cardPrice:Number(x.cardPrice||x.cashPrice||x.salePrice||0),brand:x.brand||''})),
    warehouses:(s.warehouses||[]).filter(x=>x.active!==false),
    promissoryNotes:(s.promissoryNotes||[]).filter(n=>n.customerId===customer.id).sort((a,b)=>String(a.dueDate).localeCompare(String(b.dueDate)))
  });
});


app.get('/web-api/admin/uninvoiced-sales',requireAdmin,(req,res)=>{
  const s=readStore();
  const customerMap=new Map((s.customers||[]).map(c=>[String(c.id),c]));
  const rows=(s.financeTransactions||[])
    .filter(t=>t.kind==='sale' && !t.cancelled && (t.invoiceStatus||'pending')!=='issued')
    .map(t=>({
      id:t.id,
      reference:t.reference||'',
      date:t.date||'',
      customerId:t.customerId||'',
      customerName:customerMap.get(String(t.customerId))?.name||'',
      total:Number(t.total||0),
      paymentMethod:t.paymentMethod||'',
      items:t.items||[],
      invoiceStatus:t.invoiceStatus||'pending'
    }))
    .sort((a,b)=>String(b.date).localeCompare(String(a.date)));
  res.json({ok:true,rows,count:rows.length});
});

app.post('/web-api/admin/sale/:id/mark-invoiced',requireAdmin,(req,res)=>{
  const s=readStore(),x=req.body||{};
  const sale=(s.financeTransactions||[]).find(t=>String(t.id)===String(req.params.id)&&t.kind==='sale');
  if(!sale)return res.status(404).json({error:'Satış bulunamadı'});
  const invoiceNumber=String(x.invoiceNumber||'').trim();
  const invoiceDate=String(x.invoiceDate||sale.date||'').trim();
  if(!invoiceNumber)return res.status(400).json({error:'Fatura numarası zorunlu'});
  sale.invoiceStatus='issued';
  sale.invoiceNumber=invoiceNumber;
  sale.invoiceDate=invoiceDate;
  sale.invoiceIssuedAt=new Date().toISOString();
  const iq=(s.invoiceQueue||[]).find(r=>r.saleId===sale.id);if(iq){iq.status='issued';iq.invoiceNumber=invoiceNumber;iq.invoiceDate=invoiceDate;iq.updatedAt=new Date().toISOString()}
  audit(s,'Satış faturası işlendi',sale.reference||sale.id,{invoiceNumber,invoiceDate});
  writeStore(s);
  res.json({ok:true,sale});
});

app.post('/web-api/admin/customer-sale',requireAdminOrStaff('orders_manage'),(req,res)=>{
  const s=readStore(),x=req.body||{};
  const actor=currentActor(req);
  // Personel portalında satış her zaman kendi adına yazılır
  if(!actorIsManager(req) && actor){
    x.salespersonId=actor.id;
    x.salespersonName=actor.name;
  }
  const dealer=(s.dealerSettings||[]).find(d=>String(d.id)===String(x.dealerId)&&d.active!==false);
  if(!dealer)return res.status(400).json({error:'Geçerli satış bayisi seçilmelidir'});
  const people=salesPeople(s,req);
  const salesperson=people.find(p=>String(p.id)===String(x.salespersonId)) || people.find(p=>String(p.name).toLocaleLowerCase('tr-TR')===String(x.salespersonName||'').toLocaleLowerCase('tr-TR')) || (actor?{id:actor.id,name:actor.name}:null);
  if(!salesperson)return res.status(400).json({error:'Satış personeli seçilmelidir'});
  const customer=s.customers.find(c=>c.id===x.customerId);
  if(!customer)return res.status(404).json({error:'Müşteri bulunamadı'});
  const items=Array.isArray(x.items)?x.items.filter(i=>String(i.productCode||'').trim()&&Number(i.quantity)>0):[];
  if(!items.length)return res.status(400).json({error:'En az bir ürün eklenmelidir'});
  let total=0;
  const cleanItems=items.map(i=>{
    const qty=Math.max(1,Math.round(Number(i.quantity)||1));
    const unitPrice=cleanMoney(i.unitPrice);
    total+=qty*unitPrice;
    const productCode=String(i.productCode||'').trim();
    const product=(s.products||[]).find(p=>String(p.code)===productCode);
    const itemCode=String(i.itemCode||product?.itemCode||'').trim();
    const materialCode=String(i.materialCode||product?.searchName||product?.code||i.productName||productCode).trim();
    return{productCode,itemCode,materialCode,productName:materialCode,quantity:qty,unitPrice,total:qty*unitPrice};
  });
  total=Math.round(total*100)/100;
  const grossTotal=total;
  // İskonto nakit/kart fark etmeksizin serbest uygulanır (üst sınır yok).
  const discountPct=Math.min(100,Math.max(0,Number(x.discountPct)||0));
  total=Math.round((grossTotal*(1-discountPct/100))*100)/100;
  const commissionPct=Number(dealer.commissionPct||0);
  const commissionAmount=Math.round((total*commissionPct/100)*100)/100;
  const impliedCost=Math.round((grossTotal/(1+Number(dealer.marginDividePct||0)/100))*100)/100;

  // Çoklu ödeme: [{method, amount, accountId}]
  let payments=Array.isArray(x.payments)?x.payments:[];
  if(!payments.length && (cleanMoney(x.paidAmount)>0 || x.paymentMethod)){
    payments=[{method:String(x.paymentMethod||'Nakit'),amount:cleanMoney(x.paidAmount),accountId:String(x.accountId||'')}];
  }
  const promissoryIn=x.promissory&&typeof x.promissory==='object'?x.promissory:null;
  const promissoryAmount=promissoryIn?cleanMoney(promissoryIn.amount):0;
  const normalizedPayments=payments.map(p=>({
    method:String(p.method||'').trim(),
    amount:cleanMoney(p.amount),
    accountId:String(p.accountId||'')
  })).filter(p=>p.amount>0&&p.method);
  const allocated=Math.round((normalizedPayments.reduce((a,p)=>a+p.amount,0)+promissoryAmount)*100)/100;
  if(total>0 && Math.abs(allocated-total)>0.009){
    return res.status(400).json({error:`Ödeme dağılımı net tutara eşit olmalı. Net: ${total}, Dağıtılan: ${allocated}`});
  }
  for(const p of normalizedPayments){
    if(['Nakit','Kredi Kartı','Havale'].includes(p.method)){
      if(!p.accountId)return res.status(400).json({error:`${p.method} için kasa/banka seçilmelidir`});
      if(!s.financeAccounts.some(a=>a.id===p.accountId&&a.active!==false))return res.status(400).json({error:`${p.method} hesabı geçersiz`});
    }
  }
  if(promissoryAmount>0){
    if(!promissoryIn.firstDueDate)return res.status(400).json({error:'Senet için ilk vade tarihi zorunludur'});
    const first=new Date(String(promissoryIn.firstDueDate)+'T12:00:00');
    if(Number.isNaN(first.getTime()))return res.status(400).json({error:'Senet ilk vade tarihi geçersiz'});
  }
  const paid=Math.round(normalizedPayments.filter(p=>['Nakit','Kredi Kartı','Havale'].includes(p.method)).reduce((a,p)=>a+p.amount,0)*100)/100;
  const paymentMethod=normalizedPayments.map(p=>p.method).concat(promissoryAmount>0?['Senet']:[]).join(' + ')||String(x.paymentMethod||'Karma');

  const deductStock=x.deductStock===true||String(x.deductStock)==='true';
  const warehouseId=String(x.warehouseId||'');
  if(deductStock){
    if(!warehouseId)return res.status(400).json({error:'Stoktan düşmek için satış deposu seçilmelidir'});
    if(!s.warehouses.some(w=>w.id===warehouseId&&w.active!==false))return res.status(400).json({error:'Geçerli satış deposu seçilmelidir'});
    for(const item of cleanItems){
      const stockRow=currentStock(s,item.productCode,warehouseId);
      const available=Number(stockRow?.quantity||0)-Number(stockRow?.reserved||0);
      if(available<item.quantity)return res.status(400).json({error:`${item.productCode} için seçilen depoda yalnızca ${Math.max(0,available)} adet satılabilir stok var`});
    }
  }
  const ref=`SAT-${Date.now()}`;
  const sale=financeTx(s,{
    date:x.date,kind:'sale',accountId:'',customerId:customer.id,amount:0,customerDelta:total,
    category:'Ürün Satışı',description:String(x.description||'Müşteri satışı'),reference:ref,createdBy:currentActor(req)?.name||'Admin'
  });
  sale.items=cleanItems;
  sale.grossTotal=grossTotal;
  sale.discountPct=discountPct;
  sale.discountAmount=Math.round((grossTotal-total)*100)/100;
  sale.total=total;
  sale.dealerId=dealer.id;
  sale.dealerName=dealer.name;
  sale.marginDividePct=Number(dealer.marginDividePct||0);
  sale.impliedCost=impliedCost;
  sale.commissionPct=commissionPct;
  sale.commissionAmount=commissionAmount;
  sale.salespersonId=salesperson.id;
  sale.salespersonName=salesperson.name;
  sale.deliveryStatus=String(x.deliveryStatus||'order_received');
  sale.deliveryNote=String(x.deliveryNote||'');
  sale.paymentMethod=paymentMethod;
  sale.payments=normalizedPayments.concat(promissoryAmount>0?[{method:'Senet',amount:promissoryAmount,accountId:''}]:[]);
  sale.warehouseId=deductStock?warehouseId:'';
  sale.deductStock=deductStock;
  sale.invoiceStatus=String(x.invoiceStatus||'pending')==='issued'?'issued':'pending';
  sale.invoiceNumber=sale.invoiceStatus==='issued'?String(x.invoiceNumber||'').trim():'';
  sale.invoiceDate=sale.invoiceStatus==='issued'?String(x.invoiceDate||x.date||''):'';
  sale.invoiceIssuedAt=sale.invoiceStatus==='issued'?new Date().toISOString():'';
  const invCfg=s.invoiceIntegration||{};
  const invoiceRecord={id:crypto.randomUUID(),saleId:sale.id,reference:ref,customerId:customer.id,customer:{name:customer.name||'',phone:customer.phone||'',email:customer.email||'',taxNumber:customer.taxNumber||customer.taxNo||customer.vkn||customer.tckn||'',taxOffice:customer.taxOffice||'',address:customer.address||''},items:cleanItems.map(i=>({...i,vatRate:Number((s.products||[]).find(p=>String(p.code)===String(i.productCode))?.vatRate||20)})),total,status:sale.invoiceStatus==='issued'?'issued':'pending',invoiceType:'auto',provider:invCfg.provider||'qnb-solist',providerDocumentId:'',uuid:crypto.randomUUID(),invoiceNumber:sale.invoiceNumber||'',invoiceDate:sale.invoiceDate||'',error:'',ublXml:'',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
  s.invoiceQueue.push(invoiceRecord);
  sale.invoiceQueueId=invoiceRecord.id;

  if(deductStock){
    for(const item of cleanItems){
      addStockMovement(s,{productCode:item.productCode,warehouseId,type:'sale',quantity:-item.quantity,reference:ref,note:`${customer.name} satışı`,user:currentActor(req)?.name||'Admin'});
    }
  }
  const collections=[];
  for(const p of normalizedPayments){
    if(!['Nakit','Kredi Kartı','Havale'].includes(p.method))continue;
    const collection=financeTx(s,{
      date:x.date,kind:'collection',accountId:p.accountId,customerId:customer.id,amount:p.amount,customerDelta:-p.amount,
      category:p.method,description:`${ref} satış tahsilatı · ${p.method}`,reference:`TAH-${Date.now()}-${collections.length+1}`,createdBy:currentActor(req)?.name||'Admin'
    });
    collections.push(collection);
  }
  if(collections[0])sale.collectionId=collections[0].id;
  sale.collectionIds=collections.map(c=>c.id);

  let promissoryResult=null;
  if(promissoryAmount>0){
    const settings=s.promissorySettings||{};
    const count=Math.min(36,Math.max(1,Math.round(Number(promissoryIn.installments)||settings.defaultInstallments||1)));
    const interval=Math.min(12,Math.max(1,Math.round(Number(promissoryIn.intervalMonths)||settings.intervalMonths||1)));
    const first=new Date(String(promissoryIn.firstDueDate)+'T12:00:00');
    const base=Math.floor((promissoryAmount/count)*100)/100;
    let remaining=Math.round(promissoryAmount*100)/100;
    const planId=crypto.randomUUID(),notes=[];
    for(let i=0;i<count;i++){
      const due=new Date(first);due.setMonth(due.getMonth()+i*interval);
      const amount=i===count-1?Math.round(remaining*100)/100:base;
      remaining=Math.round((remaining-amount)*100)/100;
      notes.push({
        id:crypto.randomUUID(),planId,
        serial:`${settings.prefix||'ATAK'}-${Date.now().toString().slice(-8)}-${String(i+1).padStart(2,'0')}`,
        customerId:customer.id,saleId:sale.id,saleReference:ref,
        amount,dueDate:due.toISOString().slice(0,10),
        issueDate:String(x.date||todayISO()),status:'open',
        createdAt:new Date().toISOString(),
        description:String(promissoryIn.description||`${ref} satış senedi`)
      });
    }
    s.promissoryNotes.push(...notes);
    sale.promissoryPlanId=planId;
    sale.promissoryAmount=promissoryAmount;
    promissoryResult={planId,notes,printUrl:`/web-api/admin/promissory-plan/${planId}/print`};
    audit(s,'Satış senet planı oluşturuldu',customer.name,{planId,total:promissoryAmount,count,ref});
  }

  audit(s,'Müşteriye satış yapıldı',customer.name,{total,grossTotal,discountPct,dealer:dealer.name,salesperson:salesperson.name,commissionAmount,paid,payments:sale.payments,promissoryAmount,ref,items:cleanItems.length});
  writeStore(s);
  res.json({
    ok:true,sale,collections,collection:collections[0]||null,promissory:promissoryResult,
    docsUrl:`/web-api/admin/sale/${sale.id}/print-docs`,
    balance:customerBalance(s,customer.id)
  });
});

app.post('/web-api/admin/customer-collection',requireAdmin,(req,res)=>{
  const s=readStore(),x=req.body||{},customer=s.customers.find(c=>c.id===x.customerId);
  if(!customer)return res.status(404).json({error:'Müşteri bulunamadı'});
  const amount=cleanMoney(x.amount);
  if(!amount)return res.status(400).json({error:'Tahsilat tutarı zorunludur'});
  if(!x.accountId)return res.status(400).json({error:'Kasa veya banka seçilmelidir'});
  const row=financeTx(s,{
    date:x.date,kind:'collection',accountId:String(x.accountId),customerId:customer.id,amount,customerDelta:-amount,
    category:String(x.paymentMethod||'Tahsilat'),description:String(x.description||'Cari tahsilat'),reference:`TAH-${Date.now()}`,createdBy:currentActor(req)?.name||'Admin'
  });
  audit(s,'Müşteri tahsilatı',customer.name,{amount,accountId:x.accountId});
  writeStore(s);
  res.json({ok:true,row,balance:customerBalance(s,customer.id)});
});




function isSystemManager(req){
  return actorIsManager(req);
}
function salesPeople(s,req){
  const out=[],seen=new Set();
  const add=(id,name,source,active=true,storeId='')=>{
    name=String(name||'').trim(); if(!active||!name)return;
    const key=name.toLocaleLowerCase('tr-TR'); if(seen.has(key))return; seen.add(key);
    out.push({id:String(id||key),name,source,storeId:String(storeId||'')});
  };
  (s.staff||[]).forEach(x=>add(x.id,x.name,'staff',x.active!==false,x.storeId));
  (s.users||[]).forEach(x=>add(x.id,x.name,'user',x.active!==false,''));
  const current=currentActor(req); if(current)add(current.id,current.name,'session',true,current.storeId||'');
  return out.sort((a,b)=>a.name.localeCompare(b.name,'tr'));
}
function cancelCollectionInStore(s,collection,actor,reason=''){
  if(!collection||collection.kind!=='collection')throw new Error('Tahsilat bulunamadı');
  if(collection.cancelled)return null;
  const reversal=financeTx(s,{
    date:todayISO(),kind:'collection_cancel',accountId:collection.accountId,customerId:collection.customerId,
    amount:-Number(collection.amount||0),customerDelta:-Number(collection.customerDelta||0),
    category:'Tahsilat İptali',description:`${collection.reference||collection.id} tahsilat iptali${reason?' · '+reason:''}`,
    reference:`IPT-${Date.now()}-${String(collection.id).slice(0,5)}`,createdBy:actor
  });
  reversal.originalTransactionId=collection.id;
  collection.cancelled=true;collection.cancelledAt=new Date().toISOString();collection.cancelledBy=actor;collection.cancelReason=reason;
  return reversal;
}
function relatedSaleCollections(s,sale){
  const ids=new Set([String(sale.collectionId||''),...((sale.collectionIds||[]).map(String))].filter(Boolean));
  return (s.financeTransactions||[]).filter(t=>t.kind==='collection'&&!t.cancelled&&(
    ids.has(String(t.id)) ||
    (sale.reference && String(t.description||'').includes(String(sale.reference)))
  ));
}
function cancelSaleInStore(s,sale,actor,reason=''){
  if(!sale||sale.kind!=='sale')throw new Error('Satış bulunamadı');
  if(sale.cancelled)return {already:true};
  const related=relatedSaleCollections(s,sale);
  related.forEach(c=>cancelCollectionInStore(s,c,actor,`Satış iptali: ${reason}`));
  const reversal=financeTx(s,{
    date:todayISO(),kind:'sale_cancel',customerId:sale.customerId,amount:0,
    customerDelta:-Number(sale.customerDelta||sale.total||0),category:'Satış İptali',
    description:`${sale.reference||sale.id} satış iptali${reason?' · '+reason:''}`,
    reference:`IPT-${sale.reference||Date.now()}`,createdBy:actor
  });
  reversal.originalTransactionId=sale.id;
  if(sale.deductStock&&sale.warehouseId){
    (sale.items||[]).forEach(item=>addStockMovement(s,{
      productCode:item.productCode,warehouseId:sale.warehouseId,type:'sale_cancel',
      quantity:Number(item.quantity||0),reference:reversal.reference,note:`${sale.reference||''} satış iptali`,user:actor
    }));
  }
  sale.cancelled=true;sale.cancelledAt=new Date().toISOString();sale.cancelledBy=actor;sale.cancelReason=reason;
  sale.commissionCancelled=true;sale.cancelledCommissionAmount=Number(sale.commissionAmount||0);
  const iq=(s.invoiceQueue||[]).find(x=>String(x.saleId)===String(sale.id));
  if(iq&&iq.status!=='issued'){iq.status='cancelled';iq.error='Satış iptal edildi';iq.updatedAt=new Date().toISOString()}
  return {already:false,linkedCollections:related.length,stockRestored:Boolean(sale.deductStock&&sale.warehouseId)};
}
function normalizeSaleEditItems(s,items){
  const clean=(Array.isArray(items)?items:[]).filter(i=>String(i.productCode||'').trim()&&Number(i.quantity)>0).map(i=>{
    const qty=Math.max(1,Math.round(Number(i.quantity)||1));
    const unitPrice=cleanMoney(i.unitPrice);
    const productCode=String(i.productCode||'').trim();
    const product=(s.products||[]).find(p=>String(p.code)===productCode);
    const itemCode=String(i.itemCode||product?.itemCode||'').trim();
    const materialCode=String(i.materialCode||product?.searchName||product?.code||i.productName||productCode).trim();
    return{productCode,itemCode,materialCode,productName:materialCode,quantity:qty,unitPrice,total:Math.round(qty*unitPrice*100)/100};
  });
  if(!clean.length)throw new Error('En az bir ürün gerekli');
  return clean;
}
function applySaleEditInStore(s,sale,patch={},actor='Yönetici',reason=''){
  if(!sale||sale.kind!=='sale')throw new Error('Satış bulunamadı');
  if(sale.cancelled)throw new Error('İptal edilmiş satış düzenlenemez');
  const before={
    items:JSON.parse(JSON.stringify(sale.items||[])),
    grossTotal:Number(sale.grossTotal||sale.total||0),
    discountPct:Number(sale.discountPct||0),
    discountAmount:Number(sale.discountAmount||0),
    total:Number(sale.total||0),
    customerDelta:Number(sale.customerDelta||sale.total||0),
    commissionPct:Number(sale.commissionPct||0),
    commissionAmount:Number(sale.commissionAmount||0),
    payments:JSON.parse(JSON.stringify(sale.payments||[])),
    description:sale.description||'',
    paymentMethod:sale.paymentMethod||''
  };
  const cleanItems=normalizeSaleEditItems(s,patch.items!=null?patch.items:sale.items);
  let grossTotal=Math.round(cleanItems.reduce((a,i)=>a+i.total,0)*100)/100;
  const discountPct=Math.min(100,Math.max(0,Number(patch.discountPct!=null?patch.discountPct:sale.discountPct)||0));
  const total=Math.round((grossTotal*(1-discountPct/100))*100)/100;
  const discountAmount=Math.round((grossTotal-total)*100)/100;
  const commissionPct=Number(sale.commissionPct||0);
  const commissionAmount=Math.round((total*commissionPct/100)*100)/100;

  let payments=Array.isArray(patch.payments)?patch.payments:null;
  if(!payments){
    payments=(sale.payments||[]).map(p=>({method:String(p.method||''),amount:cleanMoney(p.amount),accountId:String(p.accountId||'')}));
  }else{
    payments=payments.map(p=>({method:String(p.method||'').trim(),amount:cleanMoney(p.amount),accountId:String(p.accountId||'')})).filter(p=>p.amount>0&&p.method);
  }
  const allocated=Math.round(payments.reduce((a,p)=>a+p.amount,0)*100)/100;
  if(total>0 && Math.abs(allocated-total)>0.009){
    throw new Error(`Ödeme dağılımı net tutara eşit olmalı. Net: ${total}, Dağıtılan: ${allocated}`);
  }
  for(const p of payments){
    if(['Nakit','Kredi Kartı','Havale'].includes(p.method)){
      if(!p.accountId)throw new Error(`${p.method} için kasa/banka seçilmelidir`);
      if(!s.financeAccounts.some(a=>a.id===p.accountId&&a.active!==false))throw new Error(`${p.method} hesabı geçersiz`);
    }
  }

  // Stok farkı
  if(sale.deductStock&&sale.warehouseId){
    const oldMap=new Map(),newMap=new Map();
    (before.items||[]).forEach(i=>oldMap.set(String(i.productCode),(oldMap.get(String(i.productCode))||0)+Number(i.quantity||0)));
    cleanItems.forEach(i=>newMap.set(String(i.productCode),(newMap.get(String(i.productCode))||0)+Number(i.quantity||0)));
    const codes=new Set([...oldMap.keys(),...newMap.keys()]);
    for(const code of codes){
      const diff=(newMap.get(code)||0)-(oldMap.get(code)||0); // + means more sold → stock down
      if(!diff)continue;
      if(diff>0){
        const stockRow=currentStock(s,code,sale.warehouseId);
        const available=Number(stockRow?.quantity||0)-Number(stockRow?.reserved||0);
        if(available<diff)throw new Error(`${code} için depoda yalnızca ${Math.max(0,available)} adet satılabilir stok var`);
        addStockMovement(s,{productCode:code,warehouseId:sale.warehouseId,type:'sale',quantity:-diff,reference:sale.reference||sale.id,note:`Satış düzenleme · ${reason}`,user:actor});
      }else{
        addStockMovement(s,{productCode:code,warehouseId:sale.warehouseId,type:'sale_cancel',quantity:-diff,reference:sale.reference||sale.id,note:`Satış düzenleme iade · ${reason}`,user:actor});
      }
    }
  }

  // Eski tahsilatları iptal et, yeni nakit/kart/havale tahsilatlarını oluştur
  const oldCollections=relatedSaleCollections(s,sale);
  oldCollections.forEach(c=>cancelCollectionInStore(s,c,actor,`Satış düzenleme: ${reason}`));
  const collections=[];
  for(const p of payments){
    if(!['Nakit','Kredi Kartı','Havale'].includes(p.method))continue;
    const collection=financeTx(s,{
      date:sale.date||todayISO(),kind:'collection',accountId:p.accountId,customerId:sale.customerId,
      amount:p.amount,customerDelta:-p.amount,category:p.method,
      description:`${sale.reference||sale.id} satış tahsilatı · ${p.method} (düzenleme)`,
      reference:`TAH-${Date.now()}-${collections.length+1}`,createdBy:actor
    });
    collections.push(collection);
  }

  // Cari: satışın customerDelta'sı güncellenir (bakiye toplamı bundan hesaplanır).
  // Eski tahsilat iptali + yeni tahsilatlar kasa/banka ve cariyi dengeler.
  sale.items=cleanItems;
  sale.grossTotal=grossTotal;
  sale.discountPct=discountPct;
  sale.discountAmount=discountAmount;
  sale.total=total;
  sale.customerDelta=total;
  sale.commissionPct=commissionPct;
  sale.commissionAmount=commissionAmount;
  sale.payments=payments;
  sale.paymentMethod=payments.map(p=>p.method).join(' + ')||sale.paymentMethod||'';
  sale.description=String(patch.description!=null?patch.description:sale.description||'');
  sale.collectionId=collections[0]?.id||'';
  sale.collectionIds=collections.map(c=>c.id);
  sale.editedAt=new Date().toISOString();
  sale.editedBy=actor;
  sale.editReason=reason;
  sale.editHistory=Array.isArray(sale.editHistory)?sale.editHistory:[];
  sale.editHistory.unshift({at:sale.editedAt,by:actor,reason,before:{total:before.total,items:before.items.length,payments:before.payments},after:{total,items:cleanItems.length,payments:payments.length}});

  const iq=(s.invoiceQueue||[]).find(x=>String(x.saleId)===String(sale.id));
  if(iq&&iq.status!=='issued'){
    iq.items=cleanItems.map(i=>({...i,vatRate:Number((s.products||[]).find(p=>String(p.code)===String(i.productCode))?.vatRate||20)}));
    iq.total=total;iq.updatedAt=new Date().toISOString();
  }
  return {before,after:{items:cleanItems,grossTotal,discountPct,discountAmount,total,commissionAmount,payments,description:sale.description},collections:collections.length};
}



app.post('/web-api/admin/customer/:id/note',requireAdmin,(req,res)=>{
  const s=readStore(),row=(s.customers||[]).find(c=>String(c.id)===String(req.params.id));
  if(!row)return res.status(404).json({error:'Müşteri bulunamadı'});
  row.note=String(req.body?.note||'').slice(0,2000);row.updatedAt=new Date().toISOString();
  audit(s,'Müşteri notu güncellendi',row.name,{note:row.note});writeStore(s);
  res.json({ok:true,row:{...row,balance:customerBalance(s,row.id)}});
});


app.get('/web-api/admin/sales-tracking',requireAdmin,(req,res)=>{
  const s=readStore();
  const customerMap=new Map((s.customers||[]).map(c=>[String(c.id),c]));
  const rows=(s.financeTransactions||[])
    .filter(t=>t.kind==='sale'&&!t.cancelled)
    .map(t=>{
      const c=customerMap.get(String(t.customerId))||{};
      return {
        id:t.id,reference:t.reference||'',date:t.date||'',dealerId:t.dealerId||'',dealerName:t.dealerName||'',
        salespersonId:t.salespersonId||'',salespersonName:t.salespersonName||t.createdBy||'',
        customerId:t.customerId||'',customerName:c.name||'',customerPhone:c.phone||'',customerNote:c.note||'',
        total:Number(t.total||0),items:t.items||[],deliveryStatus:t.deliveryStatus||'order_received',
        deliveryNote:t.deliveryNote||'',invoiceStatus:t.invoiceStatus||'pending',deductStock:Boolean(t.deductStock),
        warehouseId:t.warehouseId||'',createdAt:t.createdAt||''
      }
    })
    .sort((a,b)=>String(b.createdAt||b.date).localeCompare(String(a.createdAt||a.date)));
  res.json({ok:true,rows});
});
app.post('/web-api/admin/sale/:id/delivery-status',requireAdmin,(req,res)=>{
  const s=readStore(),sale=(s.financeTransactions||[]).find(t=>String(t.id)===String(req.params.id)&&t.kind==='sale');
  if(!sale)return res.status(404).json({error:'Satış bulunamadı'});
  if(sale.cancelled)return res.status(400).json({error:'İptal edilmiş satış güncellenemez'});
  const allowed=['order_received','preparing','ready','shipped','delivered'];
  const status=String(req.body?.status||'');
  if(!allowed.includes(status))return res.status(400).json({error:'Geçersiz teslimat durumu'});
  sale.deliveryStatus=status;sale.deliveryNote=String(req.body?.note||sale.deliveryNote||'').slice(0,1000);sale.deliveryUpdatedAt=new Date().toISOString();
  audit(s,'Satış teslimat durumu güncellendi',sale.reference||sale.id,{status,note:sale.deliveryNote});writeStore(s);
  res.json({ok:true,sale});
});

app.get('/web-api/admin/salespeople',requireAdminOrStaff('orders_manage'),(req,res)=>{
  const s=readStore();
  res.json({ok:true,rows:salesPeople(s,req),currentUser:currentSessionUser(req),canManage:isSystemManager(req)});
});
app.get('/web-api/admin/sale/:id',requireAdmin,(req,res)=>{
  const s=readStore(),sale=(s.financeTransactions||[]).find(t=>String(t.id)===String(req.params.id)&&t.kind==='sale');
  if(!sale)return res.status(404).json({error:'Satış bulunamadı'});
  const customer=s.customers.find(c=>c.id===sale.customerId)||null;
  const collections=relatedSaleCollections(s,sale).map(c=>({
    id:c.id,date:c.date,amount:c.amount,accountId:c.accountId,
    accountName:s.financeAccounts.find(a=>a.id===c.accountId)?.name||'',category:c.category,reference:c.reference
  }));
  const pending=(s.cancellationRequests||[]).filter(r=>r.status==='pending'&&String(r.targetId)===String(sale.id));
  res.json({
    ok:true,sale,customer,collections,
    accounts:s.financeAccounts.filter(a=>a.active!==false),
    products:(s.products||[]).filter(p=>p.active!==false).map(p=>({code:p.code,name:p.name,itemCode:p.itemCode||'',searchName:p.searchName||'',cashPrice:Number(p.cashPrice||p.salePrice||p.price||0)})),
    pending,canManage:isSystemManager(req)
  });
});
function buildSalesPrimBoard(s,req,{period='day',date='',month='',salespersonId='',dealerId=''}={}){
  const u=currentSessionUser(req)||currentActor(req);
  const canManage=isSystemManager(req)||actorIsManager(req);
  const round=n=>Math.round(Number(n||0)*100)/100;
  let from,to,label;
  if(period==='month'){
    const mb=monthBounds(month);
    from=mb.from;to=mb.to;label=mb.month;
  }else{
    const d=String(date||todayISO()).slice(0,10);
    from=to=d;label=d;period='day';
  }
  const customerMap=new Map((s.customers||[]).map(c=>[String(c.id),c]));
  let all=(s.financeTransactions||[]).filter(t=>t.kind==='sale' && String(t.date||'').slice(0,10)>=from && String(t.date||'').slice(0,10)<=to);
  if(!canManage){
    all=all.filter(t=>txBelongsToActor(t,u)||String(t.salespersonId||'')===String(u?.id||''));
  }else if(salespersonId){
    all=all.filter(t=>String(t.salespersonId||'')===salespersonId);
  }
  if(dealerId)all=all.filter(t=>String(t.dealerId||'')===dealerId);

  const byPerson=new Map();
  let gross=0,grossCount=0,net=0,netCount=0,cancelled=0,cancelledCount=0,discount=0,commission=0,primLost=0;
  for(const t of all){
    const amount=Number(t.total||0);
    const g=Number(t.grossTotal||t.total||0);
    const comm=Number(t.commissionAmount||0);
    const pid=String(t.salespersonId||t.salespersonName||t.createdBy||'unknown');
    const pname=String(t.salespersonName||t.createdBy||'Personel');
    if(!byPerson.has(pid))byPerson.set(pid,{id:pid,name:pname,gross:0,net:0,count:0,cancelled:0,cancelledCount:0,commission:0,primLost:0,discount:0});
    const row=byPerson.get(pid);
    gross+=g;grossCount+=1;discount+=Math.max(0,g-amount);
    if(t.cancelled){
      cancelled+=amount;cancelledCount+=1;
      row.cancelled+=amount;row.cancelledCount+=1;
      const lost=Number(t.cancelledCommissionAmount!=null?t.cancelledCommissionAmount:comm);
      primLost+=lost;row.primLost+=lost;
    }else{
      net+=amount;netCount+=1;commission+=comm;
      row.gross+=g;row.net+=amount;row.count+=1;row.commission+=comm;row.discount+=Math.max(0,g-amount);
    }
  }
  const ranking=[...byPerson.values()].map(x=>({
    ...x,
    gross:round(x.gross),net:round(x.net),cancelled:round(x.cancelled),
    commission:round(x.commission),primLost:round(x.primLost),discount:round(x.discount)
  })).sort((a,b)=>b.net-a.net||b.count-a.count||a.name.localeCompare(b.name,'tr'));

  const pendingByTarget=new Map();
  (s.cancellationRequests||[]).filter(r=>r.status==='pending').forEach(r=>pendingByTarget.set(`${r.targetType}:${r.targetId}`,r));
  const rows=all.filter(t=>!t.cancelled).map(t=>{
    const c=customerMap.get(String(t.customerId));
    const pendCancel=pendingByTarget.get(`sale:${t.id}`);
    const pendEdit=pendingByTarget.get(`sale_edit:${t.id}`);
    return{
      id:t.id,date:t.date,reference:t.reference||'',dealerId:t.dealerId||'',dealerName:t.dealerName||'',
      salespersonId:t.salespersonId||'',salespersonName:t.salespersonName||t.createdBy||'',
      customerName:c?.name||'',grossTotal:Number(t.grossTotal||t.total||0),total:Number(t.total||0),
      discountPct:Number(t.discountPct||0),commissionAmount:Number(t.commissionAmount||0),
      pendingCancel:Boolean(pendCancel),pendingEdit:Boolean(pendEdit),
      pendingReason:pendCancel?.reason||pendEdit?.reason||''
    };
  }).sort((a,b)=>String(b.date).localeCompare(String(a.date)));

  return{
    ok:true,canManage,period,label,from,to,
    summary:{
      count:netCount,
      gross:round(gross),
      net:round(net),
      cancelled:round(cancelled),
      cancelledCount,
      discount:round(discount),
      commission:round(commission),
      primLost:round(primLost)
    },
    ranking,
    rows,
    people:salesPeople(s,req)
  };
}
app.get('/web-api/admin/sales-prim-board',requireAdmin,(req,res)=>{
  const s=readStore();
  const board=buildSalesPrimBoard(s,req,{
    period:String(req.query.period||'day'),
    date:String(req.query.date||''),
    month:String(req.query.month||''),
    salespersonId:String(req.query.salespersonId||''),
    dealerId:String(req.query.dealerId||'')
  });
  res.json(board);
});
app.get('/web-api/admin/sales-performance',requireAdmin,(req,res)=>{
  const s=readStore();
  const from=String(req.query.from||'');
  const to=String(req.query.to||'');
  let period='day',date='',month='';
  if(from && to && from.slice(0,7)===to.slice(0,7) && from.endsWith('-01') && to===monthBounds(from.slice(0,7)).to){
    period='month';month=from.slice(0,7);
  }else if(from&&to&&from===to){
    period='day';date=from;
  }else if(from||to){
    // custom range: reuse board day logic via filter after
    period='day';date=from||to||todayISO();
  }
  const board=buildSalesPrimBoard(s,req,{
    period:req.query.month?'month':(from&&to&&from!==to?'day':period),
    date:from||date,
    month:req.query.month||month||(from?String(from).slice(0,7):''),
    salespersonId:String(req.query.salespersonId||''),
    dealerId:String(req.query.dealerId||'')
  });
  // If custom from-to spanning days, re-filter from all active sales in range
  let rows,summary,ranking=board.ranking;
  if(from&&to&&!(from===to) && !(req.query.month)){
    const u=currentSessionUser(req)||currentActor(req);
    const canManage=board.canManage;
    const customerMap=new Map((s.customers||[]).map(c=>[String(c.id),c]));
    const pendingByTarget=new Map();
    (s.cancellationRequests||[]).filter(r=>r.status==='pending').forEach(r=>pendingByTarget.set(`${r.targetType}:${r.targetId}`,r));
    let all=(s.financeTransactions||[]).filter(t=>t.kind==='sale'&&!t.cancelled&&String(t.date||'')>=from&&String(t.date||'')<=to);
    if(!canManage)all=all.filter(t=>txBelongsToActor(t,u));
    if(req.query.salespersonId)all=all.filter(t=>String(t.salespersonId||'')===String(req.query.salespersonId));
    if(req.query.dealerId)all=all.filter(t=>String(t.dealerId||'')===String(req.query.dealerId));
    rows=all.map(t=>{
      const c=customerMap.get(String(t.customerId));
      const pendCancel=pendingByTarget.get(`sale:${t.id}`);
      const pendEdit=pendingByTarget.get(`sale_edit:${t.id}`);
      return{...t,customerName:c?.name||'',pendingCancel:Boolean(pendCancel),pendingEdit:Boolean(pendEdit),pendingReason:pendCancel?.reason||pendEdit?.reason||''};
    }).sort((a,b)=>String(b.createdAt||b.date).localeCompare(String(a.createdAt||a.date)));
    summary={
      count:rows.length,
      gross:Math.round(rows.reduce((a,x)=>a+Number(x.grossTotal||x.total||0),0)*100)/100,
      net:Math.round(rows.reduce((a,x)=>a+Number(x.total||0),0)*100)/100,
      discount:Math.round(rows.reduce((a,x)=>a+(Number(x.grossTotal||x.total||0)-Number(x.total||0)),0)*100)/100,
      commission:Math.round(rows.reduce((a,x)=>a+Number(x.commissionAmount||0),0)*100)/100
    };
    const byPerson=new Map();
    for(const t of rows){
      const pid=String(t.salespersonId||t.salespersonName||t.createdBy||'unknown');
      const pname=String(t.salespersonName||t.createdBy||'Personel');
      if(!byPerson.has(pid))byPerson.set(pid,{id:pid,name:pname,gross:0,net:0,count:0,commission:0,cancelled:0,cancelledCount:0,primLost:0,discount:0});
      const r=byPerson.get(pid);
      r.gross+=Number(t.grossTotal||t.total||0);r.net+=Number(t.total||0);r.count+=1;r.commission+=Number(t.commissionAmount||0);
    }
    ranking=[...byPerson.values()].map(x=>({...x,gross:Math.round(x.gross*100)/100,net:Math.round(x.net*100)/100,commission:Math.round(x.commission*100)/100})).sort((a,b)=>b.net-a.net);
  }else{
    rows=board.rows;
    summary={count:board.summary.count,gross:board.summary.gross,net:board.summary.net,discount:board.summary.discount,commission:board.summary.commission,cancelled:board.summary.cancelled};
  }
  const customerMap=new Map((s.customers||[]).map(c=>[String(c.id),c]));
  const accountMap=new Map((s.financeAccounts||[]).map(a=>[String(a.id),a.name]));
  const pendingByTarget=new Map();
  (s.cancellationRequests||[]).filter(r=>r.status==='pending').forEach(r=>pendingByTarget.set(`${r.targetType}:${r.targetId}`,r));
  const collections=(s.financeTransactions||[]).filter(t=>t.kind==='collection'&&!t.cancelled).map(t=>({
    ...t,
    customerName:customerMap.get(String(t.customerId))?.name||'',
    accountName:accountMap.get(String(t.accountId))||'',
    pendingCancel:Boolean(pendingByTarget.get(`collection:${t.id}`))
  }));
  res.json({ok:true,canManage:board.canManage,summary,rows,collections,people:board.people,ranking,period:board.period,label:board.label,from:board.from,to:board.to});
});
app.get('/web-api/admin/staff-sales-month',requireAdminOrStaffAny('finance_manage','finance_view','orders_manage','customers_manage'),(req,res)=>{
  const s=readStore();
  const actor=currentActor(req);
  const canManage=actorIsManager(req);
  const staffPortal=Boolean(req.session?.staffUser) && req.session?.admin!==true;
  const {month,from,to}=monthBounds(req.query.month);
  const salespersonId=String(req.query.salespersonId||'');
  const customerMap=new Map((s.customers||[]).map(c=>[String(c.id),c]));
  let sales=(s.financeTransactions||[]).filter(t=>t.kind==='sale' && String(t.date||'').slice(0,10)>=from && String(t.date||'').slice(0,10)<=to);
  if(staffPortal && !canManage){
    sales=sales.filter(t=>txBelongsToActor(t,actor));
  }else if(staffPortal && canManage && salespersonId){
    const people=salesPeople(s,req);
    const person=people.find(p=>String(p.id)===salespersonId);
    const fakeActor={id:salespersonId,name:person?.name||'',username:''};
    sales=sales.filter(t=>txBelongsToActor(t,fakeActor)||String(t.salespersonId||'')===salespersonId);
  }else if(!staffPortal && !canManage){
    sales=sales.filter(t=>txBelongsToActor(t,actor));
  }else if(!staffPortal && salespersonId){
    sales=sales.filter(t=>String(t.salespersonId||'')===salespersonId);
  }
  sales=sales.map(t=>({...t,customerName:customerMap.get(String(t.customerId||''))?.name||''}));
  const pendingMap=new Map();
  (s.cancellationRequests||[]).filter(r=>r.status==='pending'&&['sale','sale_return'].includes(r.targetType)).forEach(r=>{
    pendingMap.set(String(r.targetId),r);
  });
  const built=buildMonthSalesPrim(sales,pendingMap);
  const myRequests=(s.cancellationRequests||[]).filter(r=>{
    if(!['sale','sale_return','collection'].includes(r.targetType))return false;
    if(canManage)return true;
    return String(r.requestedById)===String(actor?.id||'')||String(r.requestedByName)===String(actor?.name||'');
  }).slice(0,80);
  res.json({
    ok:true,
    month,from,to,
    canManage,
    summary:built.summary,
    rows:built.rows,
    requests:myRequests,
    people:(canManage||!staffPortal)?salesPeople(s,req):[],
    warning:'İptal ve iade talepleri yönetici onayına düşer. Onaylanmadan satış ve prim düşmez.'
  });
});
app.post('/web-api/admin/cancellation-request',requireAdminOrStaffAny('finance_manage','finance_view','orders_manage','customers_manage'),(req,res)=>{
  const s=readStore(),x=req.body||{},u=currentActor(req),canManage=actorIsManager(req);
  let targetType=String(x.targetType||'');
  const requestKind=String(x.requestKind||x.kind||'').toLowerCase()==='return'?'return':'cancel';
  if(targetType==='sale_return'){targetType='sale'}
  const targetId=String(x.targetId||''),reason=String(x.reason||'').trim();
  if(!['sale','collection','sale_edit'].includes(targetType))return res.status(400).json({error:'Geçersiz işlem türü'});
  if(!reason || reason.length<3)return res.status(400).json({error:'Sebep zorunludur (en az 3 karakter). Yönetici bu sebebi görür.'});
  const target=(s.financeTransactions||[]).find(t=>String(t.id)===targetId);
  if(!target)return res.status(404).json({error:'İşlem bulunamadı'});
  if(target.cancelled)return res.status(400).json({error:'İşlem zaten iptal/iade edilmiş'});
  if(!canManage && !txBelongsToActor(target,u))
    return res.status(403).json({error:'Yalnız kendi satışlarınız için iptal/iade talebi açabilirsiniz'});
  if((s.cancellationRequests||[]).some(r=>r.status==='pending'&&['sale','sale_return','sale_edit','collection'].includes(r.targetType)&&String(r.targetId)===targetId))
    return res.status(409).json({error:'Bu işlem için bekleyen onay talebi var'});

  if(targetType==='sale_edit'){
    let preview;
    try{
      const clone=JSON.parse(JSON.stringify(s));
      const saleClone=(clone.financeTransactions||[]).find(t=>String(t.id)===targetId);
      preview=applySaleEditInStore(clone,saleClone,x.payload||{},u?.name||'Personel',reason);
    }catch(e){return res.status(400).json({error:e.message})}
    const row={
      id:crypto.randomUUID(),targetType:'sale_edit',targetId,targetReference:target.reference||'',
      reason,status:'pending',requestedById:u?.id||'',requestedByName:u?.name||'Personel',
      requestedAt:new Date().toISOString(),reviewedBy:'',reviewedAt:'',reviewNote:'',
      payload:{after:x.payload||{},preview:{beforeTotal:preview.before.total,afterTotal:preview.after.total,itemCount:preview.after.items.length}}
    };
    s.cancellationRequests.unshift(row);
    audit(s,'Satış düzenleme onayı istendi',target.reference||target.id,{reason,personel:row.requestedByName});
    writeStore(s);return res.json({ok:true,direct:false,pendingApproval:true,row,managerWarning:true});
  }

  // İptal / iade her zaman yönetici onayına düşer — satıcı sebebini yazar, yönetici uyarılır
  const storedType=targetType==='sale'?(requestKind==='return'?'sale_return':'sale'):targetType;
  const row={
    id:crypto.randomUUID(),targetType:storedType,targetId,targetReference:target.reference||'',
    requestKind:targetType==='sale'?requestKind:'cancel',
    reason,status:'pending',
    requestedById:u?.id||'',requestedByName:u?.name||'Personel',
    requestedAt:new Date().toISOString(),reviewedBy:'',reviewedAt:'',reviewNote:'',
    saleTotal:Number(target.total||0),commissionAmount:Number(target.commissionAmount||0),
    customerName:(s.customers||[]).find(c=>String(c.id)===String(target.customerId||''))?.name||'',
    managerAlert:true
  };
  if(!Array.isArray(s.cancellationRequests))s.cancellationRequests=[];
  s.cancellationRequests.unshift(row);
  const label=requestKind==='return'?'İade talebi oluşturuldu':'İptal talebi oluşturuldu';
  audit(s,label,target.reference||target.id,{targetType:storedType,requestKind,reason,personel:row.requestedByName,commissionAmount:row.commissionAmount});
  writeStore(s);
  res.json({
    ok:true,direct:false,pendingApproval:true,row,
    managerWarning:true,
    message:requestKind==='return'
      ?'İade talebi yöneticiye gönderildi. Onaylanmadan satış ve prim düşmez.'
      :'İptal talebi yöneticiye gönderildi. Onaylanmadan satış ve prim düşmez.'
  });
});
app.get('/web-api/admin/cancellation-requests',requireAdminOrStaffAny('finance_manage','finance_view','orders_manage','customers_manage'),(req,res)=>{
  const s=readStore(),u=currentActor(req),canManage=actorIsManager(req);
  let rows=s.cancellationRequests||[];
  if(!canManage)rows=rows.filter(r=>String(r.requestedById)===String(u?.id||'')||String(r.requestedByName)===String(u?.name||''));
  res.json({ok:true,canManage,rows,managerAlert:canManage&&rows.some(r=>r.status==='pending')});
});
app.post('/web-api/admin/cancellation-request/:id/review',requireAdminOrStaffAny('finance_manage','finance_view','orders_manage','users_manage'),(req,res)=>{
  if(!actorIsManager(req))return res.status(403).json({error:'Yönetici onayı gerekli'});
  const s=readStore(),row=(s.cancellationRequests||[]).find(r=>String(r.id)===String(req.params.id));
  if(!row)return res.status(404).json({error:'İptal/iade talebi bulunamadı'});
  if(row.status!=='pending')return res.status(400).json({error:'Talep daha önce sonuçlandırılmış'});
  const action=String(req.body?.action||''),note=String(req.body?.note||''),actor=currentActor(req)?.name||'Yönetici';
  if(action==='reject'){
    row.status='rejected';row.reviewedBy=actor;row.reviewedAt=new Date().toISOString();row.reviewNote=note;
    const rejectLabel=row.targetType==='customer_edit'?'Müşteri düzenleme reddedildi':row.targetType==='sale_edit'?'Satış düzenleme reddedildi':(row.requestKind==='return'||row.targetType==='sale_return')?'İade talebi reddedildi':'İptal talebi reddedildi';
    audit(s,rejectLabel,row.targetReference||row.targetId,{note});
    writeStore(s);return res.json({ok:true,row});
  }
  if(action!=='approve')return res.status(400).json({error:'Geçersiz işlem'});
  if(row.targetType==='customer_edit'){
    const customer=(s.customers||[]).find(c=>String(c.id)===String(row.targetId));
    if(!customer)return res.status(404).json({error:'Müşteri bulunamadı'});
    try{
      const data=parseCustomerPayload({...(row.payload?.after||{}),id:customer.id});
      applyCustomerData(customer,data);
      row.status='approved';row.reviewedBy=actor;row.reviewedAt=new Date().toISOString();row.reviewNote=note;
      audit(s,'Müşteri düzenleme onaylandı',customer.name,{reason:row.reason,personel:row.requestedByName});
      writeStore(s);return res.json({ok:true,row,customer:{...customer,balance:customerBalance(s,customer.id)}});
    }catch(e){return res.status(400).json({error:e.message})}
  }
  if(row.targetType==='sale_edit'){
    const sale=(s.financeTransactions||[]).find(t=>String(t.id)===String(row.targetId)&&t.kind==='sale');
    if(!sale)return res.status(404).json({error:'Satış bulunamadı'});
    try{
      const result=applySaleEditInStore(s,sale,row.payload?.after||{},actor,row.reason);
      row.status='approved';row.reviewedBy=actor;row.reviewedAt=new Date().toISOString();row.reviewNote=note;
      audit(s,'Satış düzenleme onaylandı',sale.reference||sale.id,{reason:row.reason,personel:row.requestedByName,total:result.after.total});
      writeStore(s);return res.json({ok:true,row,result});
    }catch(e){return res.status(400).json({error:e.message})}
  }
  const target=(s.financeTransactions||[]).find(t=>String(t.id)===String(row.targetId));
  if(!target)return res.status(404).json({error:'Bağlı işlem bulunamadı'});
  try{
    const isSaleCancel=row.targetType==='sale'||row.targetType==='sale_return';
    const result=isSaleCancel?cancelSaleInStore(s,target,actor,row.reason):cancelCollectionInStore(s,target,actor,row.reason);
    if(isSaleCancel && target){
      target.cancelKind=(row.requestKind==='return'||row.targetType==='sale_return')?'return':'cancel';
    }
    row.status='approved';row.reviewedBy=actor;row.reviewedAt=new Date().toISOString();row.reviewNote=note;
    const okLabel=(row.requestKind==='return'||row.targetType==='sale_return')?'İade talebi onaylandı':'İptal talebi onaylandı';
    audit(s,okLabel,row.targetReference||row.targetId,{targetType:row.targetType,reason:row.reason,commissionCancelled:target.cancelledCommissionAmount||0});
    writeStore(s);res.json({ok:true,row,result});
  }catch(e){res.status(400).json({error:e.message})}
});

app.get('/web-api/admin/dealer-settings',requireAdmin,(req,res)=>{
  const s=readStore();
  res.json({ok:true,rows:s.dealerSettings||[]});
});
app.post('/web-api/admin/dealer-settings',requireAdmin,(req,res)=>{
  const s=readStore(),rows=Array.isArray(req.body?.rows)?req.body.rows:[];
  const clean=rows.map(r=>({
    id:String(r.id||'').trim(),
    name:String(r.name||'').trim(),
    marginDividePct:Math.max(0,Number(r.marginDividePct)||0),
    commissionPct:Math.max(0,Number(r.commissionPct)||0),
    cashMaxDiscountPct:Math.max(0,Number(r.cashMaxDiscountPct)||0),
    cardMaxDiscountPct:Math.max(0,Number(r.cardMaxDiscountPct)||0),
    active:r.active!==false
  })).filter(r=>r.id&&r.name);
  if(!clean.length)return res.status(400).json({error:'En az bir bayi ayarı olmalıdır'});
  s.dealerSettings=clean;
  audit(s,'Bayi kâr / prim / iskonto ayarları güncellendi','Bayi Ayarları');
  writeStore(s);res.json({ok:true,rows:clean});
});

app.get('/web-api/admin/invoice-integration',requireAdmin,(req,res)=>{
  const s=readStore(),cfg=s.invoiceIntegration||{};
  res.json({settings:{...cfg,password:cfg.password?'********':''},queueCount:(s.invoiceQueue||[]).filter(x=>!['issued','cancelled'].includes(x.status)).length});
});
app.post('/web-api/admin/invoice-integration',requireAdmin,(req,res)=>{
  const s=readStore(),x=req.body||{},old=s.invoiceIntegration||{};
  const env=['test','live'].includes(String(x.environment))?String(x.environment):'test';
  const provider=['qnb-solist','qnb-esolutions','qnb-efinans'].includes(String(x.provider))?String(x.provider):'qnb-solist';
  s.invoiceIntegration={
    provider,environment:env,
    enabled:x.enabled===true||String(x.enabled)==='true',
    companyVkn:String(x.companyVkn||'').trim(),
    companyTitle:String(x.companyTitle||'').trim(),
    senderAlias:String(x.senderAlias||'').trim(),
    gbAlias:String(x.gbAlias||x.senderAlias||'').trim(),
    pkAlias:String(x.pkAlias||'').trim(),
    webServiceUrl:String(x.webServiceUrl||'').trim(),
    username:String(x.username||'').trim(),
    password:String(x.password||'')==='********'?String(old.password||''):String(x.password||''),
    draftMode:x.draftMode!==false&&String(x.draftMode)!=='false',
    autoDetectType:x.autoDetectType!==false&&String(x.autoDetectType)!=='false'
  };
  audit(s,'QNB Solist entegrasyon ayarları güncellendi','Fatura Entegrasyonu',{environment:env,enabled:s.invoiceIntegration.enabled,provider});writeStore(s);res.json({ok:true});
});
app.post('/web-api/admin/invoice-integration/test',requireAdmin,(req,res)=>{
  const s=readStore(),c=s.invoiceIntegration||{};
  const checks=qnbSolist.readinessChecks(c);
  const ep=qnbSolist.defaultEndpoints(c.environment||'test');
  res.json({ok:checks.every(x=>x.ok),mode:c.environment||'test',checks,endpoints:ep,note:'Dış servise belge göndermez. QNB Solist WSDL/kullanıcı gelince SOAP gönderim açılır.'});
});
app.get('/web-api/admin/invoice-queue',requireAdmin,(req,res)=>{const s=readStore();res.json({rows:(s.invoiceQueue||[]).slice().sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)))})});
/** e-Fatura Merkezi özet: QNB kutusu klasör sayıları + kuyruk + gelen (placeholder) */
app.get('/web-api/admin/invoice-center',requireAdmin,(req,res)=>{
  const s=readStore();
  const cfg=s.invoiceIntegration||{};
  const queue=(s.invoiceQueue||[]).slice().sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
  const inbox=(s.invoiceInbox||[]).slice().sort((a,b)=>String(b.invoiceDate||b.createdAt||'').localeCompare(String(a.invoiceDate||a.createdAt||'')));
  const responses=(s.invoiceAppResponses||[]).slice();
  const customerMap=new Map((s.customers||[]).map(c=>[String(c.id),c]));
  const salesPending=(s.financeTransactions||[])
    .filter(t=>t.kind==='sale'&&!t.cancelled&&(t.invoiceStatus||'pending')!=='issued')
    .map(t=>({
      id:t.id,reference:t.reference||'',date:t.date||'',customerId:t.customerId||'',
      customerName:customerMap.get(String(t.customerId))?.name||'',total:Number(t.total||0),
      paymentMethod:t.paymentMethod||'',invoiceStatus:t.invoiceStatus||'pending',
      invoiceQueueId:t.invoiceQueueId||''
    }))
    .sort((a,b)=>String(b.date).localeCompare(String(a.date)));
  const isSent=r=>['issued','draft_sent','queued_remote','queued'].includes(String(r.status||''));
  const isPending=r=>['pending','ready'].includes(String(r.status||''))||!r.status;
  const isError=r=>String(r.status||'')==='error';
  const isArch=r=>['cancelled','archived'].includes(String(r.status||''));
  const isEf=r=>{const t=String(r.docType||r.invoiceType||'').toLowerCase();return t==='efatura'||t==='temelfatura'||t==='ticarifatura'||!t||t==='auto'};
  const isEa=r=>String(r.docType||r.invoiceType||'').toLowerCase()==='earsiv';
  const inboxEf=inbox.filter(r=>String(r.docType||r.profile||'efatura').toLowerCase()!=='earsiv');
  const inboxEa=inbox.filter(r=>String(r.docType||r.profile||'').toLowerCase()==='earsiv');
  const ef=queue.filter(isEf),ea=queue.filter(isEa);
  const counts={
    sales_pending:salesPending.length,
    ef_out_pending:ef.filter(isPending).length,
    ef_out_sent:ef.filter(isSent).length,
    ef_out_error:ef.filter(isError).length,
    ef_out_archive:ef.filter(isArch).length,
    ef_in_incoming:inboxEf.filter(r=>r.status!=='archived').length,
    ef_in_responses:responses.length,
    ef_in_archive:inboxEf.filter(r=>r.status==='archived').length,
    ea_out_pending:ea.filter(isPending).length,
    ea_out_sent:ea.filter(isSent).length,
    ea_out_error:ea.filter(isError).length,
    ea_out_archive:ea.filter(isArch).length,
    ea_in_incoming:inboxEa.filter(r=>r.status!=='archived').length,
    ea_in_archive:inboxEa.filter(r=>r.status==='archived').length
  };
  res.json({
    ok:true,
    settings:{provider:cfg.provider||'qnb-solist',environment:cfg.environment||'test',enabled:!!cfg.enabled,companyTitle:cfg.companyTitle||'',companyVkn:cfg.companyVkn||'',senderAlias:cfg.senderAlias||cfg.gbAlias||'',pkAlias:cfg.pkAlias||''},
    counts,queue,inbox,responses,salesPending,
    note:'Gelen kutusu QNB portal senkronu bağlanınca dolar. Giden kutu yerel kuyruk + UBL taslağıdır.'
  });
});
app.post('/web-api/admin/invoice-center/portal-query',requireAdmin,async(req,res)=>{
  const s=readStore(),cfg=s.invoiceIntegration||{};
  const checks=qnbSolist.readinessChecks(cfg);
  const ready=checks.filter(c=>['Firma VKN','WSDL / servis URL','Kullanıcı','Şifre'].includes(c.name)).every(c=>c.ok)&&cfg.enabled;
  if(!ready){
    return res.json({
      ok:true,mode:'local_only',synced:0,
      message:'QNB portal sorgusu henüz açık değil. WSDL + kullanıcı + “etkin” gelince Gelen Kutusu portaldan dolacak. Şimdilik yerel kuyruk yenilendi.',
      checks
    });
  }
  // SOAP: QNB gelen fatura listesi buraya bağlanır.
  res.json({
    ok:true,mode:'stub',synced:0,
    message:'Portal sorgu noktası hazır (SOAP stub). QNB Çözüm Merkezi WSDL metodunu bağlayınca canlı çekim başlar.',
    checks
  });
});
app.post('/web-api/admin/invoice-queue/:id/retry',requireAdmin,async(req,res)=>{
  const s=readStore(),r=(s.invoiceQueue||[]).find(x=>x.id===req.params.id);
  if(!r)return res.status(404).json({error:'Fatura kaydı bulunamadı'});
  const sale=(s.financeTransactions||[]).find(t=>String(t.id)===String(r.saleId)&&t.kind==='sale');
  const customer=(s.customers||[]).find(c=>String(c.id)===String(r.customerId||sale?.customerId))||{};
  const cfg=s.invoiceIntegration||{};
  try{
    const out=await qnbSolist.sendOrQueueInvoice({record:r,sale:sale||r,customer,cfg});
    r.status=out.status||'ready';
    r.docType=out.docType||r.docType;
    r.ublXml=out.ublXml||r.ublXml;
    r.providerMessage=out.message||'';
    r.error='';
    r.updatedAt=new Date().toISOString();
    writeStore(s);
    res.json({ok:true,row:r,result:out});
  }catch(e){
    r.status='error';r.error=e.message;r.updatedAt=new Date().toISOString();writeStore(s);
    res.status(500).json({error:e.message});
  }
});
app.post('/web-api/admin/sale/:id/issue-invoice',requireAdminOrStaff('orders_manage'),async(req,res)=>{
  const s=readStore();
  const sale=(s.financeTransactions||[]).find(t=>String(t.id)===String(req.params.id)&&t.kind==='sale'&&!t.cancelled);
  if(!sale)return res.status(404).json({error:'Satış bulunamadı'});
  const customer=(s.customers||[]).find(c=>String(c.id)===String(sale.customerId));
  if(!customer)return res.status(400).json({error:'Satış müşterisi bulunamadı'});
  if(!customer.email&&!customer.taxNo&&!customer.tckn){
    return res.status(400).json({error:'Fatura için müşteride e-posta veya VKN/TCKN olmalı'});
  }
  const cfg=s.invoiceIntegration||{};
  let record=(s.invoiceQueue||[]).find(x=>String(x.saleId)===String(sale.id));
  if(!record){
    record={
      id:crypto.randomUUID(),saleId:sale.id,reference:sale.reference||'',customerId:customer.id,
      customer:{name:customer.name||'',phone:customer.phone||'',email:customer.email||'',taxNumber:customer.taxNo||customer.tckn||'',taxOffice:customer.taxOffice||'',address:customer.address||''},
      items:(sale.items||[]).map(i=>({...i})),total:Number(sale.total||0),
      status:'pending',invoiceType:'auto',provider:cfg.provider||'qnb-solist',
      providerDocumentId:'',uuid:crypto.randomUUID(),invoiceNumber:'',invoiceDate:todayISO(),
      error:'',ublXml:'',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()
    };
    s.invoiceQueue.push(record);
    sale.invoiceQueueId=record.id;
  }
  const out=await qnbSolist.sendOrQueueInvoice({record,sale,customer,cfg});
  record.status=out.status||'ready';
  record.docType=out.docType;
  record.ublXml=out.ublXml;
  record.providerMessage=out.message||'';
  record.updatedAt=new Date().toISOString();
  sale.invoiceStatus=out.status==='issued'?'issued':'queued';
  sale.invoiceType=out.docType;
  sale.invoiceUuid=record.uuid;
  sale.updatedAt=new Date().toISOString();
  audit(s,'Fatura kes / QNB kuyruğa alındı',customer.name,{saleId:sale.id,status:record.status,docType:out.docType});
  writeStore(s);
  res.json({ok:true,record,result:out,sale:{id:sale.id,invoiceStatus:sale.invoiceStatus,invoiceType:sale.invoiceType}});
});

function htmlEsc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function moneyTR(v){return Number(v||0).toLocaleString('tr-TR',{style:'currency',currency:'TRY'})}
function printDocShell(title,body,opts={}){
  const auto=opts.autoPrint!==false;
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${htmlEsc(title)}</title>
<style>
@page{size:A4;margin:12mm}
*{box-sizing:border-box}
body{margin:0;background:#d9e2ec;color:#13233f;font:13px/1.45 "Segoe UI",Arial,sans-serif}
.toolbar{position:sticky;top:0;z-index:5;display:flex;flex-wrap:wrap;gap:8px;justify-content:center;align-items:center;padding:12px;background:#0b2a55;color:#fff;box-shadow:0 6px 20px #0004}
.toolbar b{margin-right:8px}
.toolbar button,.toolbar a{appearance:none;border:0;border-radius:8px;padding:10px 14px;font-weight:800;cursor:pointer;text-decoration:none;color:#0b2a55;background:#fff}
.toolbar button.primary{background:#dda20c;color:#1a1300}
.sheet{width:210mm;min-height:297mm;margin:16px auto;background:#fff;padding:14mm 14mm 12mm;box-shadow:0 10px 30px #0002;page-break-after:always}
.sheet:last-child,.sheet.a4-one{page-break-after:auto}
.sheet.a4-one{min-height:auto;padding:8mm;margin:8px auto}
@media print{body{background:#fff}.toolbar{display:none}.sheet,.sheet.a4-one{margin:0;box-shadow:none;width:auto;min-height:auto}}
.doc-head{display:flex;justify-content:space-between;gap:16px;border-bottom:3px solid #0b2a55;padding-bottom:12px;margin-bottom:14px}
.brand{font-size:22px;font-weight:900;color:#0b2a55;letter-spacing:.02em}
.brand small{display:block;font-size:11px;font-weight:600;color:#66768d;margin-top:3px}
.doc-meta{text-align:right;font-size:12px;color:#4b5b73}
.doc-meta b{display:block;font-size:16px;color:#0b2a55;margin-bottom:4px}
h2.doc-title{margin:0 0 12px;font-size:18px;color:#0b2a55}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:12px 0}
.box{border:1px solid #d7e2ef;border-radius:8px;padding:10px 12px;background:#f8fafc}
.box small{display:block;color:#66768d;font-size:11px;margin-bottom:3px}
.box b{font-size:13px}
table.items{width:100%;border-collapse:collapse;margin:14px 0}
table.items th,table.items td{border-bottom:1px solid #e3ebf4;padding:8px 6px;text-align:left;vertical-align:top}
table.items th{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#66768d;border-bottom:2px solid #0b2a55}
table.items td.num,table.items th.num{text-align:right;white-space:nowrap}
.totals{width:320px;margin-left:auto;margin-top:8px}
.totals div{display:flex;justify-content:space-between;gap:12px;padding:6px 0;border-bottom:1px solid #e8eef5}
.totals .net{font-size:16px;font-weight:900;color:#0b2a55;border-bottom:0;padding-top:10px}
.note-line{margin-top:12px;padding:10px 12px;border:1px solid #f0d48a;background:#fff8e8;border-radius:8px;font-size:12px}
.terms{margin-top:16px;font-size:11px;color:#4b5b73}
.terms ol{margin:6px 0 0;padding-left:18px}
.signs{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:36px}
.signs .sig{border-top:1px solid #9aa8bc;padding-top:8px;text-align:center;min-height:70px}
.signs small{display:block;color:#66768d;margin-bottom:28px}
.senet .top{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0b2a55;padding-bottom:10px}
.senet .top b{font-size:26px;color:#0b2a55}
.senet .amount{font-size:34px;font-weight:900;color:#0b2a55;margin:18px 0 8px}
.senet .words{font-size:12px;color:#4b5b73;margin-bottom:14px}
.senet .body{font-size:13px;margin:12px 0 16px}
.senet .footer{font-size:11px;color:#66768d;margin-top:14px}
.hint{font-size:11px;color:#8a96a8;margin-top:8px}
@media print{
  body{background:#fff}
  .toolbar{display:none!important}
  .sheet{margin:0;box-shadow:none;width:auto;min-height:auto;padding:0}
}
</style></head><body>
<div class="toolbar"><b>${htmlEsc(title)}</b><button class="primary" onclick="window.print()">Yazdır / PDF Kaydet</button><button onclick="window.close()">Kapat</button><span style="opacity:.85;font-size:12px">Yazdır → “PDF olarak kaydet” seçebilirsiniz</span></div>
${body}
${auto?`<script>window.addEventListener('load',()=>setTimeout(()=>{try{window.focus()}catch(e){}},200));<\/script>`:''}
</body></html>`;
}
function amountToTrWords(n){
  n=Math.round(Number(n||0)*100)/100;
  const ones=['','bir','iki','üç','dört','beş','altı','yedi','sekiz','dokuz'];
  const tens=['','on','yirmi','otuz','kırk','elli','altmış','yetmiş','seksen','doksan'];
  const scales=[['',''] ,['bin','bin'],['milyon','milyon'],['milyar','milyar']];
  const chunk=x=>{
    x=Math.floor(x);if(!x)return '';
    const yuz=Math.floor(x/100),on=Math.floor((x%100)/10),bir=x%10;
    return (yuz?(yuz===1?'yüz':ones[yuz]+' yüz'):'')+(tens[on]?((yuz||bir)?' ':'')+tens[on]:'')+(bir?(on||yuz?' ':'')+ones[bir]:'');
  };
  const whole=Math.floor(n),kurus=Math.round((n-whole)*100);
  if(!whole&&!kurus)return 'sıfır Türk Lirası';
  let out='',rest=whole,i=0;
  if(!whole)out='sıfır';
  else{
    const parts=[];
    while(rest>0&&i<scales.length){
      const c=rest%1000;
      if(c){
        let w=chunk(c);
        if(i===1&&c===1)w='bin';
        else if(i>0)w=(w?(w+' '):'')+scales[i][1];
        parts.unshift(w);
      }
      rest=Math.floor(rest/1000);i++;
    }
    out=parts.join(' ');
  }
  out=`${out} Türk Lirası`;
  if(kurus)out+=` ${chunk(kurus)} Kuruş`;
  return out.replace(/\s+/g,' ').trim();
}
function buildSenetCardsHtml(notes,customer,cfg){
  // Geriye uyumluluk: tek sayfa birleşik çıktıya yönlendir
  return buildCombinedContractSenetA4Html({items:[],payments:[],promissoryAmount:(notes||[]).reduce((a,n)=>a+Number(n.amount||0),0),date:notes?.[0]?.issueDate},customer,cfg,{},notes);
}
function buildSaleContractHtml(sale,customer,cfg,settings){
  const notes=[];
  return buildCombinedContractSenetA4Html(sale,customer,cfg,settings,notes);
}
/** Sözleşme + Senet tek A4 sayfada */
function buildCombinedContractSenetA4Html(sale,customer,cfg,settings,notes){
  const items=Array.isArray(sale.items)?sale.items:[];
  const rows=items.slice(0,12).map(i=>`<tr><td>${htmlEsc(i.itemCode||i.productCode||'-')}</td><td>${htmlEsc(i.productName||i.materialCode||i.productCode||'')}</td><td class="num">${Number(i.quantity||1)}</td><td class="num">${moneyTR(i.unitPrice)}</td><td class="num">${moneyTR(i.total!=null?i.total:Number(i.quantity||1)*Number(i.unitPrice||0))}</td></tr>`).join('');
  const pays=(sale.payments||[]).map(p=>`${htmlEsc(p.method||'')}: ${moneyTR(p.amount)}`).join(' · ');
  const gross=Number(sale.grossTotal!=null?sale.grossTotal:sale.total||0);
  const net=Number(sale.total||0);
  const disc=Number(sale.discountAmount!=null?sale.discountAmount:Math.max(0,gross-net));
  const site=settings?.siteName||cfg.creditorName||'ATAK PAZARLAMA';
  const noteList=Array.isArray(notes)?notes:[];
  const senetTotal=noteList.length?noteList.reduce((a,n)=>a+Number(n.amount||0),0):Number(sale.promissoryAmount||0);
  const scheduleRows=noteList.length
    ? noteList.map((n,idx)=>`<tr><td>${idx+1}</td><td>${htmlEsc(n.serial||'-')}</td><td>${htmlEsc(n.dueDate||'')}</td><td class="num">${moneyTR(n.amount)}</td></tr>`).join('')
    : '';
  const addr=[customer?.address,customer?.district,customer?.city].filter(Boolean).join(', ')||'-';
  return `<section class="sheet a4-one">
<style>
.a4-one{padding:8mm!important;font-size:11px;line-height:1.35}
.a4-one .doc-head{padding-bottom:6px;margin-bottom:8px;border-bottom-width:2px}
.a4-one .brand{font-size:16px}.a4-one .brand small{font-size:10px}
.a4-one .doc-meta{font-size:10px}.a4-one .doc-meta b{font-size:13px;margin-bottom:2px}
.a4-one h2{font-size:13px;margin:0 0 6px}
.a4-one .grid2{gap:6px;margin:6px 0}
.a4-one .box{padding:6px 8px;border-radius:6px}
.a4-one .box small{font-size:9px;margin-bottom:1px}
.a4-one .box b{font-size:11px}
.a4-one table.items{margin:6px 0;font-size:10px}
.a4-one table.items th,.a4-one table.items td{padding:3px 4px}
.a4-one .totals{width:260px;margin-top:4px;font-size:10px}
.a4-one .totals div{padding:3px 0}
.a4-one .totals .net{font-size:12px;padding-top:4px}
.a4-one .terms{margin-top:6px;font-size:9px}
.a4-one .terms ol{margin:3px 0 0;padding-left:14px}
.a4-one .signs{gap:20px;margin-top:10px}
.a4-one .signs .sig{min-height:42px}
.a4-one .signs small{margin-bottom:16px;font-size:9px}
.a4-one .split{display:grid;grid-template-columns:1.15fr .85fr;gap:8px;margin-top:8px;border-top:2px solid #0b2a55;padding-top:8px}
.a4-one .senet-box{border:1px solid #0b2a55;border-radius:8px;padding:8px}
.a4-one .senet-box h3{margin:0 0 4px;font-size:13px;color:#0b2a55}
.a4-one .senet-box .amount{font-size:18px;font-weight:900;color:#0b2a55;margin:4px 0}
.a4-one .senet-box .words{font-size:9px;color:#4b5b73;margin-bottom:4px}
.a4-one .senet-box p{margin:4px 0;font-size:9px}
.a4-one table.sched{width:100%;border-collapse:collapse;font-size:9px;margin-top:4px}
.a4-one table.sched th,.a4-one table.sched td{border-bottom:1px solid #e3ebf4;padding:2px 3px;text-align:left}
.a4-one table.sched .num{text-align:right}
.a4-one .payline{font-size:10px;margin-top:4px;color:#4b5b73}
@media print{.a4-one{page-break-after:avoid!important;min-height:auto!important}}
</style>
    <div class="doc-head"><div class="brand">${htmlEsc(site)}<small>Sözleşme + Senet · Tek A4</small></div>
      <div class="doc-meta"><b>${htmlEsc(sale.reference||'SATIŞ')}</b><div>Tarih: ${htmlEsc(sale.date||'')}</div><div>Bayi: ${htmlEsc(sale.dealerName||'')}</div><div>Satıcı: ${htmlEsc(sale.salespersonName||sale.createdBy||'')}</div></div></div>
    <h2 class="doc-title">SATIŞ SÖZLEŞMESİ</h2>
    <div class="grid2">
      <div class="box"><small>Müşteri / Alıcı</small><b>${htmlEsc(customer?.name||'')}</b><div>${htmlEsc(customer?.phone||'')}</div></div>
      <div class="box"><small>VKN / TCKN</small><b>${htmlEsc(customer?.taxNo||customer?.tckn||'-')}</b></div>
      <div class="box" style="grid-column:1/-1"><small>Adres</small><b>${htmlEsc(addr)}</b></div>
    </div>
    <table class="items"><thead><tr><th>Kod</th><th>Ürün</th><th class="num">Adet</th><th class="num">Birim</th><th class="num">Tutar</th></tr></thead><tbody>${rows||'<tr><td colspan="5">Ürün yok</td></tr>'}${items.length>12?`<tr><td colspan="5">… +${items.length-12} kalem</td></tr>`:''}</tbody></table>
    <div class="totals">
      <div><span>Brüt</span><b>${moneyTR(gross)}</b></div>
      <div><span>İskonto</span><b>-${moneyTR(disc)}</b></div>
      <div class="net"><span>Net</span><b>${moneyTR(net)}</b></div>
    </div>
    <div class="payline"><b>Ödeme:</b> ${htmlEsc(sale.paymentMethod||'-')}${pays?` · ${pays}`:''}</div>
    <div class="terms"><b>Şartlar</b><ol>
      <li>Ürün bedeli yukarıdaki ödeme planına göre tahsil edilir.</li>
      <li>Müşteri ürünleri teslim sırasında kontrol eder.</li>
      <li>Senetler bu sözleşmenin eki ve ayrılmaz parçasıdır.</li>
      <li>Bu belge mali fatura yerine geçmez.</li>
    </ol></div>
    <div class="split">
      <div>
        <div class="signs" style="margin-top:8px"><div class="sig"><small>Satıcı Kaşe / İmza</small>${htmlEsc(site)}</div><div class="sig"><small>Müşteri İmza</small>${htmlEsc(customer?.name||'')}</div></div>
      </div>
      <div class="senet-box">
        <h3>SENET</h3>
        ${senetTotal>0?`
          <div class="amount">${moneyTR(senetTotal)}</div>
          <div class="words">Yalnız: ${htmlEsc(amountToTrWords(senetTotal))}</div>
          <p>İşbu senet mukabilinde <b>${htmlEsc(cfg.creditorName||site)}</b> veya emrine bedeli vadesinde kayıtsız şartsız ödemeyi taahhüt ederim.</p>
          <div class="grid2" style="margin:4px 0">
            <div class="box"><small>Borçlu</small><b>${htmlEsc(customer?.name||'')}</b></div>
            <div class="box"><small>Ödeme yeri</small><b>${htmlEsc(cfg.paymentPlace||cfg.issuePlace||'-')}</b></div>
          </div>
          ${scheduleRows?`<table class="sched"><thead><tr><th>#</th><th>Seri</th><th>Vade</th><th class="num">Tutar</th></tr></thead><tbody>${scheduleRows}</tbody></table>`:''}
          <p style="margin-top:6px">${htmlEsc(cfg.footer||'TTK hükümlerine tabidir.')}</p>
          <div class="signs" style="margin-top:8px;gap:12px"><div class="sig"><small>Keşideci</small>${htmlEsc(customer?.name||'')}</div><div class="sig"><small>Lehtar</small>${htmlEsc(cfg.creditorName||site)}</div></div>
        `:`<p>Bu satışta senet tutarı yok.</p>`}
      </div>
    </div>
  </section>`;
}

app.get('/web-api/admin/promissory-settings',requireAdmin,(req,res)=>{const s=readStore();res.json({settings:s.promissorySettings||{}})});
app.post('/web-api/admin/promissory-settings',requireAdmin,(req,res)=>{const s=readStore(),x=req.body||{};s.promissorySettings={creditorName:String(x.creditorName||s.settings?.siteName||'Atak Pazarlama'),paymentPlace:String(x.paymentPlace||'İstanbul'),issuePlace:String(x.issuePlace||'İstanbul'),prefix:String(x.prefix||'ATAK').replace(/[^A-Za-z0-9_-]/g,'').slice(0,12)||'ATAK',defaultInstallments:Math.min(36,Math.max(1,Math.round(Number(x.defaultInstallments)||1))),firstDueDays:Math.min(365,Math.max(0,Math.round(Number(x.firstDueDays)||30))),intervalMonths:Math.min(12,Math.max(1,Math.round(Number(x.intervalMonths)||1))),copies:Math.min(3,Math.max(1,Math.round(Number(x.copies)||1))),footer:String(x.footer||'')};audit(s,'Senet ayarları güncellendi','Ayarlar');writeStore(s);res.json({ok:true,settings:s.promissorySettings})});
app.post('/web-api/admin/promissory-plan',requireAdminOrStaff('orders_manage'),(req,res)=>{
 const s=readStore(),x=req.body||{},customer=s.customers.find(c=>c.id===x.customerId);if(!customer)return res.status(404).json({error:'Müşteri bulunamadı'});
 const total=cleanMoney(x.totalAmount),count=Math.min(36,Math.max(1,Math.round(Number(x.installments)||1)));if(total<=0)return res.status(400).json({error:'Senet toplamı sıfırdan büyük olmalıdır'});
 const settings=s.promissorySettings||{};const interval=Math.min(12,Math.max(1,Math.round(Number(x.intervalMonths)||settings.intervalMonths||1)));
 const first=x.firstDueDate?new Date(x.firstDueDate+'T12:00:00'):new Date(Date.now()+Number(settings.firstDueDays||30)*86400000);if(Number.isNaN(first.getTime()))return res.status(400).json({error:'İlk vade tarihi geçersiz'});
 const base=Math.floor((total/count)*100)/100;let remaining=Math.round(total*100)/100;const planId=crypto.randomUUID(),notes=[];
 for(let i=0;i<count;i++){const due=new Date(first);due.setMonth(due.getMonth()+i*interval);const amount=i===count-1?Math.round(remaining*100)/100:base;remaining=Math.round((remaining-amount)*100)/100;notes.push({id:crypto.randomUUID(),planId,serial:`${settings.prefix||'ATAK'}-${Date.now().toString().slice(-8)}-${String(i+1).padStart(2,'0')}`,customerId:customer.id,amount,dueDate:due.toISOString().slice(0,10),issueDate:String(x.issueDate||todayISO()),status:'open',createdAt:new Date().toISOString(),description:String(x.description||'')})}
 s.promissoryNotes.push(...notes);audit(s,'Senet planı oluşturuldu',customer.name,{planId,total,count,interval});writeStore(s);res.json({ok:true,planId,notes,printUrl:`/web-api/admin/promissory-plan/${planId}/print`})
});
app.get('/web-api/admin/promissory-plan/:planId/print',requireAdminOrStaff('orders_manage'),(req,res)=>{
  const s=readStore(),notes=(s.promissoryNotes||[]).filter(n=>n.planId===req.params.planId).sort((a,b)=>String(a.dueDate).localeCompare(String(b.dueDate)));
  if(!notes.length)return res.status(404).send('Senet planı bulunamadı');
  const customer=s.customers.find(c=>c.id===notes[0].customerId),cfg=s.promissorySettings||{};
  const body=buildSenetCardsHtml(notes,customer,cfg);
  res.type('html').send(printDocShell(`Senet Planı · ${customer?.name||''}`,body));
});
app.get('/web-api/admin/sale/:id/print-docs',requireAdminOrStaff('orders_manage'),(req,res)=>{
  const s=readStore(),sale=(s.financeTransactions||[]).find(t=>String(t.id)===String(req.params.id)&&t.kind==='sale');
  if(!sale)return res.status(404).send('Satış bulunamadı');
  const customer=s.customers.find(c=>c.id===sale.customerId)||{};
  const cfg=s.promissorySettings||{};
  const settings=s.settings||{};
  const notes=(s.promissoryNotes||[]).filter(n=>n.saleId===sale.id||n.planId===sale.promissoryPlanId).sort((a,b)=>String(a.dueDate).localeCompare(String(b.dueDate)));
  const body=buildCombinedContractSenetA4Html(sale,customer,cfg,settings,notes);
  res.type('html').send(printDocShell(`Sözleşme & Senet · ${sale.reference||''}`,body,{autoPrint:true}));
});
app.get('/web-api/admin/self-test',requireAdmin,(req,res)=>{
 try{
  const original=readStore(),s=JSON.parse(JSON.stringify(original));ensureStore(s);const checks=[];
  const customer={id:'__test_customer__',name:'Sistem Test Müşteri',active:true};s.customers.push(customer);const account={id:'__test_cash__',name:'Test Kasa',type:'cash',openingBalance:1000,active:true};s.financeAccounts.push(account);const warehouse={id:'__test_wh__',name:'Test Depo',active:true};s.warehouses.push(warehouse);const product={id:'__test_product__',code:'TEST-001',name:'Test Ürün',cashPrice:1000,salePrice:1000,active:true};s.products.push(product);addStockMovement(s,{productCode:'TEST-001',warehouseId:warehouse.id,type:'opening',quantity:5,reference:'SELFTEST'});
  const before=customerBalance(s,customer.id);const sale=financeTx(s,{date:todayISO(),kind:'sale',accountId:'',customerId:customer.id,amount:0,customerDelta:2000,category:'Test',description:'Self-test satış',reference:'TEST-SALE'});addStockMovement(s,{productCode:'TEST-001',warehouseId:warehouse.id,type:'sale',quantity:-2,reference:'TEST-SALE'});const afterSale=customerBalance(s,customer.id);const collection=financeTx(s,{date:todayISO(),kind:'collection',accountId:account.id,customerId:customer.id,amount:500,customerDelta:-500,category:'Nakit',description:'Self-test tahsilat',reference:'TEST-COL'});const afterCollection=customerBalance(s,customer.id),stock=currentStock(s,'TEST-001',warehouse.id)?.quantity||0,accountBal=accountBalance(s,account.id);
  checks.push({name:'Müşteri cari satış',ok:before===0&&afterSale===2000,detail:`0 → ${afterSale}`});checks.push({name:'Tahsilat cari düşümü',ok:afterCollection===1500,detail:`${afterSale} → ${afterCollection}`});checks.push({name:'Stok düşümü',ok:stock===3,detail:`5 → ${stock}`});checks.push({name:'Kasa artışı',ok:accountBal===1500,detail:`1000 → ${accountBal}`});checks.push({name:'Makbuz bağlantısı',ok:Boolean(collection.id),detail:collection.id});
  const adminHtml=fs.readFileSync(path.join(ROOT,'public','admin.html'),'utf8');const tabs=[...adminHtml.matchAll(/data-tab="([^"]+)"/g)].map(m=>m[1]);const sections=new Set([...adminHtml.matchAll(/<section[^>]*\sid="([^"]+)"/g)].map(m=>m[1]));const missing=[...new Set(tabs)].filter(t=>!sections.has(t));checks.push({name:'Admin menü butonları',ok:missing.length===0,detail:missing.length?`Eksik hedef: ${missing.join(', ')}`:'Tüm menü hedefleri mevcut'});res.json({ok:checks.every(c=>c.ok),checks,note:'Test yalnızca bellekte çalışır; canlı veri değiştirilmez.'})
 }catch(e){res.status(500).json({ok:false,error:e.message})}
});

app.get('/web-api/admin/receipt/:id',requireAdmin,(req,res)=>{
  const s=readStore(),t=s.financeTransactions.find(x=>x.id===req.params.id);
  if(!t)return res.status(404).send('Makbuz hareketi bulunamadı');
  const customer=s.customers.find(x=>x.id===t.customerId);
  const account=s.financeAccounts.find(x=>x.id===t.accountId);
  const settings=s.settings||{};
  const title=t.kind==='collection'?'TAHSİLAT MAKBUZU':t.kind==='payment'?'ÖDEME MAKBUZU':'İŞLEM MAKBUZU';
  const amount=Math.abs(Number(t.amount||0)).toLocaleString('tr-TR',{style:'currency',currency:'TRY'});
  const esc=v=>String(v||'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]));
  res.type('html').send(`<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{font-family:Arial,sans-serif;background:#eef2f7;margin:0;padding:24px;color:#17233a}.paper{max-width:760px;margin:auto;background:#fff;padding:34px;border-radius:16px;box-shadow:0 12px 35px #16395c22}.head{display:flex;justify-content:space-between;gap:20px;border-bottom:2px solid #0a5ca8;padding-bottom:18px}.head h1{margin:0;color:#0a5ca8;font-size:24px}.head p{margin:4px 0;color:#65748a}.number{text-align:right}.amount{font-size:32px;font-weight:900;color:#0a5ca8;margin:28px 0}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.box{border:1px solid #dce4ee;border-radius:10px;padding:13px}.box small{display:block;color:#6c788b;margin-bottom:5px}.foot{margin-top:28px;border-top:1px solid #dce4ee;padding-top:16px;color:#68758a;font-size:12px}.actions{text-align:center;margin-top:20px}.actions button{padding:12px 20px;border:0;border-radius:9px;background:#0a5ca8;color:#fff;font-weight:800}@media print{body{background:#fff;padding:0}.paper{box-shadow:none;border-radius:0;max-width:none}.actions{display:none}}</style></head><body><div class="paper"><div class="head"><div><h1>${esc(settings.siteName||'ATAK HOME')}</h1><p>${esc(settings.address||'')}</p><p>${esc(settings.phone||'')} · ${esc(settings.email||'')}</p></div><div class="number"><b>${title}</b><p>No: ${esc(t.reference||t.id.slice(0,8).toUpperCase())}</p><p>Tarih: ${esc(t.date)}</p></div></div><div class="amount">${amount}</div><div class="grid"><div class="box"><small>Müşteri</small><b>${esc(customer?.name||'Belirtilmedi')}</b></div><div class="box"><small>Kasa / Banka</small><b>${esc(account?.name||'')}</b></div><div class="box"><small>İşlem</small><b>${esc(t.kind)}</b></div><div class="box"><small>Kategori</small><b>${esc(t.category||'-')}</b></div></div><div class="box" style="margin-top:12px"><small>Açıklama</small><b>${esc(t.description||'')}</b></div><div class="foot">Bu belge Atak Home Platform üzerinden oluşturulmuş işlem makbuzudur. Mali fatura yerine geçmez.</div><div class="actions"><button onclick="window.print()">Makbuzu Yazdır</button></div></div></body></html>`);
});

app.post('/web-api/admin/finance-reverse/:id',requireAdmin,(req,res)=>{
  const s=readStore(),original=s.financeTransactions.find(x=>x.id===req.params.id);
  if(!original)return res.status(404).json({error:'Hareket bulunamadı'});
  if(original.reversedBy)return res.status(400).json({error:'Bu hareket daha önce ters kayda alınmış'});
  const row=financeTx(s,{date:todayISO(),kind:'reversal',accountId:original.accountId,counterAccountId:original.counterAccountId,customerId:original.customerId,amount:-Number(original.amount||0),customerDelta:-Number(original.customerDelta||0),category:'Ters Kayıt',description:`${original.reference||original.id} hareketinin ters kaydı`,reference:`REV-${Date.now()}`,createdBy:currentActor(req)?.name||'Admin'});
  original.reversedBy=row.id;original.reversedAt=new Date().toISOString();audit(s,'Finans hareketi ters kayıt',original.id,{reversalId:row.id});writeStore(s);res.json({ok:true,row});
});

app.post('/web-api/admin/product-import/preview',requireAdmin,async(req,res)=>{
  try{
    const url=String(req.body?.url||'').trim();
    if(!url)return res.status(400).json({error:'Beko ürün bağlantısı zorunludur'});
    res.json({ok:true,product:await fetchImportedBekoProduct(url)});
  }catch(error){console.error('[PRODUCT IMPORT]',error);res.status(500).json({error:error?.message||'Ürün getirilemedi'})}
});
app.post('/web-api/admin/product-import/save',requireAdmin,(req,res)=>{
  const incoming=normalizeImportedProduct(req.body?.product||{});
  if(!incoming.code||!incoming.name)return res.status(400).json({error:'Ürün kodu ve adı zorunludur'});
  const s=readStore();
  const i=s.products.findIndex(p=>String(p.code||'').toLocaleLowerCase('tr-TR')===incoming.code.toLocaleLowerCase('tr-TR'));
  const payload={...incoming,stock:normalizeNumber(incoming.stock||0),vatRate:normalizeNumber(incoming.vatRate||20),priceMode:String(incoming.priceMode||'same'),priceValue:normalizeNumber(incoming.priceValue||0),active:incoming.active!==false,featured:Boolean(incoming.featured)};
  const product=sanitizeProduct(payload,i>=0?s.products[i]:{});
  if(i>=0)s.products[i]=product;else s.products.unshift(product);
  audit(s,i>=0?'Beko ürünü güncellendi':'Beko ürünü eklendi',product.code,{name:product.name});writeStore(s);
  res.json({ok:true,created:i<0,product});
});


function normKey(v){return String(v||'').trim().toLocaleUpperCase('tr-TR').replace(/\s+/g,' ')}
function dynamicsCategory(searchName='',dynamicsName=''){
  const s=normKey(`${searchName} ${dynamicsName}`).replace(/^BEKO\s+/,'');
  const rules=[
    [/\bX30\s*TR\b|YAZAR\s*KASA/i,'Yazar Kasa'],
    [/ISTIKBAL|İSTİKBAL|KOLTUK|YATAK|DOLAP|BAZA|KANEPE|MOB[İI]LYA/i,'Mobilya'],
    [/^(CMX|CM)\s*\d/i,'Çamaşır Makinesi'],
    [/^BM\s*\d/i,'Bulaşık Makinesi'],
    [/^(KMX|KM)\s*\d/i,'Kurutma Makinesi'],
    [/^BMF\s*\d/i,'Mini Fırın'],
    [/^BKS\s*\d/i,'Süpürge'],
    [/^HD\s*\d/i,'Saç Kurutma Makinesi'],
    [/^HS\s*\d/i,'Saç Şekillendirici'],
    [/\bKL[İI]MA\b|\bBTU\b/i,'Klima'],
    [/\bTV\b|GOOGLE TV|SMART TV/i,'Televizyon'],
    [/BUZDOLABI|NO FROST|NFB\b/i,'Buzdolabı'],
    [/DER[İI]N DONDURUCU|DONDURUCU/i,'Derin Dondurucu']
  ];
  for(const [rx,name] of rules)if(rx.test(s))return name;
  return 'Diğer';
}
function dynamicsBrand(searchName='',dynamicsName=''){
  const blob=`${searchName} ${dynamicsName}`;
  if(/GRUNDIG/i.test(blob))return 'Grundig';
  if(/İSTİKBAL|ISTIKBAL/i.test(blob))return 'İstikbal';
  return 'Beko';
}
function dynamicsReadableCode(searchName,itemCode){
  let s=String(searchName||'').trim().replace(/^BEKO\s*/i,'').replace(/^GRUNDIG\s*/i,'');
  s=s.replace(/\s+/g,' ');
  if(!s)return String(itemCode||'').trim();
  return s;
}
function parseDynamicsWorkbook(buffer){
  const wb=XLSX.read(buffer,{type:'buffer',cellDates:false});
  const ws=wb.Sheets[wb.SheetNames[0]];if(!ws)throw new Error('Excel içinde çalışma sayfası bulunamadı');
  const rows=XLSX.utils.sheet_to_json(ws,{defval:'',raw:false});
  const required=['Madde kodu','Arama adı'];
  const headers=rows.length?Object.keys(rows[0]):[];
  const missing=required.filter(h=>!headers.includes(h));if(missing.length)throw new Error('Eksik Excel sütunu: '+missing.join(', '));
  return rows.map((r,index)=>({
    rowNo:index+2,
    itemCode:String(r['Madde kodu']||'').trim(),
    dynamicsName:String(r['Ürün adı']||'').trim(),
    searchName:String(r['Arama adı']||'').trim(),
    physicalStock:normalizeNumber(r['Fiziksel stok']||0),
    reservedStock:normalizeNumber(r['Fiziksel rezerve miktar']||0),
    availableStock:normalizeNumber(r['Kullanılabilir fiziksel miktar']||0),
    unit:String(r['Stok birimi']||'Adet').trim(),
    dynamicsProductId:String(r['Ürün kimliği']||r['Madde kodu']||'').trim()
  })).filter(r=>r.itemCode||r.searchName);
}
function dynamicsExistingProduct(s,row){
  const item=normKey(row.itemCode),search=normKey(row.searchName),pid=normKey(row.dynamicsProductId);
  return (s.products||[]).find(p=>
    (item && normKey(p.itemCode)===item) ||
    (search && (normKey(p.searchName)===search || normKey(p.code)===search)) ||
    (pid && normKey(p.dynamicsProductId)===pid)
  )||null;
}
function ensureDynamicsCategory(s,name){
  const id=slug(name)||'diger';let c=(s.categories||[]).find(x=>x.id===id||normKey(x.name)===normKey(name));
  if(!c){c={id,name,active:true,sort:(s.categories||[]).length,description:'Dynamics Excel otomatik kategori'};s.categories.push(c)}
  return c.id;
}


function categoryNorm(v){
  return String(v||'').trim().toLocaleLowerCase('tr-TR')
    .replace(/ı/g,'i').replace(/ş/g,'s').replace(/ğ/g,'g')
    .replace(/ü/g,'u').replace(/ö/g,'o').replace(/ç/g,'c')
    .replace(/\s+/g,' ');
}
function ensureCategoryByName(s,name,aliases=[]){
  const wanted=[name,...aliases].map(categoryNorm);
  let c=(s.categories||[]).find(x=>wanted.includes(categoryNorm(x.name)));
  if(!c){
    c={
      id:slug(name)||crypto.randomUUID(),
      name,
      active:true,
      sort:(s.categories||[]).length,
      description:'Dynamics otomatik kategori'
    };
    s.categories.push(c);
  }else if(c.active===false){
    c.active=true;
  }
  return c.id;
}
function ensureDynamicsCoreCategories(s){
  const ids={
    camasir:ensureCategoryByName(s,'Çamaşır Makinesi',['Camasir Makinesi']),
    bulasik:ensureCategoryByName(s,'Bulaşık Makinesi',['Bulasik Makinesi']),
    buzdolabi:ensureCategoryByName(s,'Buzdolabı',['Buzdolabi']),
    pisiriciler:ensureCategoryByName(s,'Pişiriciler',['Pisiriciler','Pişirici','Pisirici']),
    dondurucu:ensureCategoryByName(s,'Dondurucu',['Derin Dondurucu']),
    mobilya:ensureCategoryByName(s,'Mobilya',['İstikbal Mobilya']),
    yazarKasa:ensureCategoryByName(s,'Yazar Kasa',['Yazarkasa','X30 TR']),
    beyazEsya:ensureCategoryByName(s,'Beyaz Eşya',['Beyaz Esya']),
    diger:ensureCategoryByName(s,'Diğer',['Diger'])
  };
  return ids;
}
function dynamicsSuggestedCategoryId(s,searchName=''){
  const ids=ensureDynamicsCoreCategories(s);
  const original=String(searchName||'').trim();
  let code=original.toLocaleUpperCase('tr-TR')
    .replace(/\s+/g,' ')
    .trim();

  // Yazar kasa X30 TR → %10 KDV kategorisi
  if(/\bX30\s*TR\b|X30TR|YAZAR\s*KASA/.test(code)) return ids.yazarKasa;
  // İstikbal / mobilya → %10 KDV
  if(/ISTIKBAL|İSTİKBAL|MOB[İI]LYA|KOLTUK|YATAK|BAZA|KANEPE|DOLAP/.test(code)) return ids.mobilya;

  // "BEKO C...", "BEKOC...", "Beko BM...", "BEKOBM..." hepsini aynı forma getir.
  code=code.replace(/^BEKO[\s\-_]*/,'').trim();

  // 1) Bulaşık: BM... veya BEKO BM...
  if(/^BM(?:[\s\-_]|\d|[A-Z]|$)/.test(code)) return ids.bulasik;

  // 2) Pişiriciler: BFC... / BFM...
  if(/^(BFC|BFM)(?:[\s\-_]|\d|[A-Z]|$)/.test(code)) return ids.pisiriciler;

  // 3) Çamaşır: C ile başlayan bütün satış kodları.
  // CM, CMX, CMXD, CMI vb. dahil.
  if(/^C/.test(code)) return ids.camasir;

  // 4) Dondurucu: Arama adında açıkça dondurucu ifadesi varsa.
  if(/DONDURUCU/.test(code)) return ids.dondurucu;

  // 5) Buzdolabı: doğrudan 9 / 6 / 8 ile başlayan sayısal satış kodları.
  // Örn: 970477 MB, 970406 MB, 670..., 890...
  if(/^[968]\d/.test(code)) return ids.buzdolabi;

  // Ek buzdolabı işaretleri.
  if(/BUZDOLABI|NO[\s-]*FROST|\bNFB\b|\bMB\b/.test(code) && /\d/.test(code))
    return ids.buzdolabi;

  // Sistem bulamazsa Diğer.
  return ids.diger;
}

app.post('/web-api/admin/dynamics-excel-preview',requireAdmin,dynamicsUpload.single('file'),(req,res)=>{
  try{
    if(!req.file)return res.status(400).json({error:'Excel dosyası seçilmelidir'});
    const s=readStore(),rows=parseDynamicsWorkbook(req.file.buffer);
    ensureDynamicsCoreCategories(s);writeStore(s);
    let newCount=0,existingCount=0,invalidCount=0;
    const preview=rows.map(r=>{
      const existing=dynamicsExistingProduct(s,r);
      const valid=Boolean(String(r.searchName||'').trim());
      if(!valid)invalidCount++;else if(existing)existingCount++;else newCount++;
      return{
        itemCode:r.itemCode,
        searchName:r.searchName,
        status:!valid?'invalid':existing?'existing':'new',
        existingCode:existing?.code||'',
        suggestedCategoryId:valid&&!existing?dynamicsSuggestedCategoryId(s,r.searchName):''
      };
    });
    const categories=(s.categories||[])
      .filter(c=>c.active!==false)
      .map(c=>({id:c.id,name:c.name}))
      .sort((a,b)=>{
        if(String(a.name).toLocaleLowerCase('tr-TR')==='diğer')return 1;
        if(String(b.name).toLocaleLowerCase('tr-TR')==='diğer')return -1;
        return String(a.name).localeCompare(String(b.name),'tr');
      });
    res.json({
      ok:true,total:rows.length,newCount,existingCount,invalidCount,
      preview:preview.slice(0,500),truncated:preview.length>500,categories
    });
  }catch(e){
    res.status(400).json({error:e.message||'Excel okunamadı'})
  }
});
app.post('/web-api/admin/dynamics-excel-import',requireAdmin,dynamicsUpload.single('file'),(req,res)=>{
  try{
    if(!req.file)return res.status(400).json({error:'Excel dosyası seçilmelidir'});
    const s=readStore(),rows=parseDynamicsWorkbook(req.file.buffer);
    let categoryMap={};
    try{categoryMap=JSON.parse(String(req.body?.categoryMap||'{}'))||{}}
    catch(_){return res.status(400).json({error:'Kategori seçimleri okunamadı'})}

    let added=0,skipped=0,invalid=0,categoryMissing=0;
    for(const r of rows){
      const searchName=String(r.searchName||'').trim();
      if(!searchName){invalid++;continue}
      const existing=dynamicsExistingProduct(s,r);
      if(existing){skipped++;continue}

      const selected=String(categoryMap[r.itemCode]||categoryMap[searchName]||'').trim();
      const cat=(s.categories||[]).find(c=>String(c.id)===selected&&c.active!==false);
      if(!cat){categoryMissing++;continue}

      const brand=dynamicsBrand(r.searchName,r.dynamicsName);
      const p=sanitizeProduct({
        code:searchName,
        name:searchName,
        itemCode:r.itemCode,
        searchName,
        dynamicsName:r.dynamicsName,
        dynamicsProductId:r.dynamicsProductId,
        brand,
        category:cat.id,
        stock:0,
        active:true,
        tags:['dynamics-excel','sales-code']
      });
      s.products.unshift(p);added++;
    }
    audit(s,'Dynamics Arama adı ürün aktarımı','Excel',{added,skipped,invalid,categoryMissing});
    writeStore(s);
    res.json({ok:true,added,skipped,invalid,categoryMissing,stockUpdated:0});
  }catch(e){
    res.status(400).json({error:e.message||'Excel aktarılamadı'})
  }
});

app.post('/web-api/admin/product',requireAdmin,(req,res)=>{ const s=readStore(),x=req.body||{}; if(!x.code||!x.name)return res.status(400).json({error:'Ürün kodu ve adı zorunlu'}); const i=s.products.findIndex(p=>String(p.id)===String(x.id)||String(p.code).toLowerCase()===String(x.code).toLowerCase()); const p=sanitizeProduct(x,i>=0?s.products[i]:{}); if(i>=0)s.products[i]=p;else s.products.unshift(p); audit(s,i>=0?'Ürün güncellendi':'Ürün eklendi',p.code,{name:p.name}); writeStore(s); res.json({ok:true,product:p}); });
app.delete('/web-api/admin/product/:id',requireAdmin,(req,res)=>{ const s=readStore(),p=s.products.find(x=>x.id===req.params.id); if(!p)return res.status(404).json({error:'Ürün bulunamadı'}); p.active=false; audit(s,'Ürün pasife alındı',p.code); writeStore(s); res.json({ok:true}); });
app.post('/web-api/admin/bulk-products',requireAdmin,(req,res)=>{ const s=readStore(); const ids=new Set(Array.isArray(req.body.ids)?req.body.ids:[]); const action=String(req.body.action||''); const value=req.body.value; let count=0; for(const p of s.products){ if(ids.size&&!ids.has(p.id))continue; if(!ids.size&&req.body.category&&req.body.category!=='all'&&p.category!==req.body.category)continue; if(action==='active')p.active=Boolean(value); else if(action==='featured')p.featured=Boolean(value); else if(action==='category')p.category=slug(value); else if(action==='tag_add'){p.tags=[...new Set([...(p.tags||[]),String(value)])];} else if(action==='tag_remove'){p.tags=(p.tags||[]).filter(t=>t!==String(value));} else if(action==='price'){p.priceMode=String(req.body.mode||'same');p.priceValue=normalizeNumber(req.body.amount||0);p.salePrice=calculateSalePrice(p);} else continue; p.updatedAt=new Date().toISOString(); count++; } audit(s,'Toplu ürün işlemi','Ürünler',{action,count}); writeStore(s); res.json({ok:true,count}); });


app.post('/web-api/admin/brand',requireAdmin,(req,res)=>{
  const s=readStore(),x=req.body||{};
  if(!x.name)return res.status(400).json({error:'Marka adı zorunlu'});
  let b=s.brands.find(v=>v.id===x.id);
  const data={name:String(x.name),active:x.active!==false,sort:Number(x.sort||0),logo:String(x.logo||'')};
  if(b)Object.assign(b,data);else{b={id:slug(x.name)||crypto.randomUUID(),...data};if(s.brands.some(v=>v.id===b.id))b.id=`${b.id}-${Date.now()}`;s.brands.push(b);}
  audit(s,'Marka kaydedildi',b.name);writeStore(s);res.json({ok:true,brand:b});
});
app.delete('/web-api/admin/brand/:id',requireAdmin,(req,res)=>{
  const s=readStore(),b=s.brands.find(x=>x.id===req.params.id);
  if(!b)return res.status(404).json({error:'Marka bulunamadı'});
  if(s.products.some(p=>slug(p.brand)===b.id))return res.status(409).json({error:'Bu markaya bağlı ürün var'});
  s.brands=s.brands.filter(x=>x.id!==b.id);audit(s,'Marka silindi',b.name);writeStore(s);res.json({ok:true});
});


function dateOnly(v){ return String(v||'').slice(0,10); }
function rangesOverlap(aStart,aEnd,bStart,bEnd){ return aStart<=bEnd && bStart<=aEnd; }
function atakHomeRevenue(store,startDate,endDate){
  const accepted=new Set(['paid','processing','prepared','shipped','delivered','completed','tamamlandi','hazirlaniyor','kargoda','teslim-edildi']);
  const excluded=new Set(['cancelled','canceled','refunded','returned','iptal','iade']);
  let gross=0,returns=0,orderCount=0;
  for(const o of (store.orders||[])){
    const d=dateOnly(o.completedAt||o.paidAt||o.createdAt||o.date);
    if(!d||d<startDate||d>endDate)continue;
    const status=String(o.status||'').toLocaleLowerCase('tr-TR');
    const amount=normalizeNumber(o.total??o.amount??o.grandTotal??0);
    if(excluded.has(status)){ returns+=amount; continue; }
    if(accepted.has(status)){ gross+=amount; orderCount+=1; }
  }
  return {grossAmount:gross,returnAmount:returns,netAmount:Math.max(0,gross-returns),orderCount};
}

app.get('/web-api/admin/revenue-summary',requireAdmin,(req,res)=>{
  const s=readStore();
  const startDate=dateOnly(req.query.startDate||new Date().toISOString().slice(0,10));
  const endDate=dateOnly(req.query.endDate||startDate);
  const manual={beko:0,istikbal:0,hepsiburada:0};
  const counts={beko:0,istikbal:0,hepsiburada:0};
  for(const x of (s.sales||[])){
    if(x.source==='automatic'||x.channel==='atakhome')continue;
    if(!rangesOverlap(dateOnly(x.startDate||x.date),dateOnly(x.endDate||x.date),startDate,endDate))continue;
    const ch=String(x.channel);
    if(manual[ch]===undefined)continue;
    manual[ch]+=normalizeNumber(x.amount??x.netAmount??0);
    counts[ch]+=Math.max(0,Math.round(normalizeNumber(x.orderCount||0)));
  }
  const atakhome=atakHomeRevenue(s,startDate,endDate);
  res.json({startDate,endDate,channels:{
    beko:{amount:manual.beko,orderCount:counts.beko,source:'manual'},
    istikbal:{amount:manual.istikbal,orderCount:counts.istikbal,source:'manual'},
    atakhome:{amount:atakhome.netAmount,orderCount:atakhome.orderCount,source:'automatic',grossAmount:atakhome.grossAmount,returnAmount:atakhome.returnAmount},
    hepsiburada:{amount:manual.hepsiburada,orderCount:counts.hepsiburada,source:'manual'}
  }});
});

app.post('/web-api/admin/sale',requireAdmin,(req,res)=>{
  const s=readStore(),x=req.body||{};
  const channel=String(x.channel||'');
  if(!['beko','istikbal','hepsiburada'].includes(channel))return res.status(400).json({error:'Sadece Beko, İstikbal ve Hepsiburada manuel girilebilir'});
  const startDate=dateOnly(x.startDate),endDate=dateOnly(x.endDate||x.startDate);
  if(!startDate||!endDate)return res.status(400).json({error:'Başlangıç ve bitiş tarihi zorunlu'});
  if(startDate>endDate)return res.status(400).json({error:'Bitiş tarihi başlangıçtan önce olamaz'});
  const editingId=String(x.id||'');
  const overlap=(s.sales||[]).find(v=>v.id!==editingId&&v.channel===channel&&v.source!=='automatic'&&rangesOverlap(dateOnly(v.startDate||v.date),dateOnly(v.endDate||v.date),startDate,endDate));
  if(overlap&&!x.replaceOverlap)return res.status(409).json({error:'Bu kanal için çakışan bir dönem kaydı var',code:'REVENUE_OVERLAP',overlap});
  if(overlap&&x.replaceOverlap)s.sales=s.sales.filter(v=>v.id!==overlap.id);
  const grossAmount=normalizeNumber(x.grossAmount??x.amount);
  const returnAmount=Math.max(0,normalizeNumber(x.returnAmount||0));
  const sale={
    id:editingId||crypto.randomUUID(),startDate,endDate,channel,
    grossAmount,returnAmount,amount:Math.max(0,grossAmount-returnAmount),
    orderCount:Math.max(0,Math.round(normalizeNumber(x.orderCount))),
    note:String(x.note||''),source:'manual',updatedAt:new Date().toISOString()
  };
  const idx=s.sales.findIndex(v=>v.id===sale.id);
  if(idx>=0)s.sales[idx]=sale;else s.sales.unshift(sale);
  audit(s,idx>=0?'Ciro kaydı güncellendi':'Ciro kaydı eklendi',channel,{startDate,endDate,amount:sale.amount});
  writeStore(s);res.json({ok:true,sale,replaced:overlap?.id||null});
});
app.delete('/web-api/admin/sale/:id',requireAdmin,(req,res)=>{
  const s=readStore(),sale=s.sales.find(x=>x.id===req.params.id);
  if(!sale)return res.status(404).json({error:'Ciro kaydı bulunamadı'});
  if(sale.source==='automatic'||sale.channel==='atakhome')return res.status(400).json({error:'AtakHome otomatik cirosu silinemez'});
  s.sales=s.sales.filter(x=>x.id!==sale.id);audit(s,'Ciro kaydı silindi',sale.channel,{amount:sale.amount});writeStore(s);res.json({ok:true});
});

app.post('/web-api/admin/category',requireAdmin,(req,res)=>{ const s=readStore(),x=req.body||{}; if(!x.name)return res.status(400).json({error:'Kategori adı zorunlu'}); let c=s.categories.find(v=>v.id===x.id); if(c)Object.assign(c,{name:String(x.name),active:Boolean(x.active),sort:Number(x.sort||0),description:String(x.description||'')}); else {c={id:slug(x.name)||crypto.randomUUID(),name:String(x.name),active:x.active!==false,sort:Number(x.sort||s.categories.length),description:String(x.description||'')}; if(s.categories.some(v=>v.id===c.id))c.id=`${c.id}-${Date.now()}`;s.categories.push(c);} audit(s,'Kategori kaydedildi',c.name); writeStore(s); res.json({ok:true,category:c}); });
app.delete('/web-api/admin/category/:id',requireAdmin,(req,res)=>{ const s=readStore(),c=s.categories.find(x=>x.id===req.params.id); if(!c)return res.status(404).json({error:'Kategori bulunamadı'}); if(s.products.some(p=>p.category===c.id))return res.status(409).json({error:'Bu kategoride ürün var; önce ürünleri başka kategoriye taşıyın'}); s.categories=s.categories.filter(x=>x.id!==c.id); audit(s,'Kategori silindi',c.name); writeStore(s);res.json({ok:true}); });

app.post('/web-api/admin/campaign',requireAdmin,(req,res)=>{ const s=readStore(),x=req.body||{}; if(!x.title)return res.status(400).json({error:'Kampanya adı zorunlu'}); let c=s.campaigns.find(v=>v.id===x.id); const data={title:String(x.title),subtitle:String(x.subtitle||''),label:String(x.label||'FIRSAT'),startDate:String(x.startDate||''),endDate:String(x.endDate||''),active:Boolean(x.active),homepage:Boolean(x.homepage),sort:Number(x.sort||0),productIds:Array.isArray(x.productIds)?x.productIds:[]}; if(c)Object.assign(c,data);else {c={id:crypto.randomUUID(),...data};s.campaigns.push(c);} audit(s,'Kampanya kaydedildi',c.title); writeStore(s);res.json({ok:true,campaign:c}); });
app.delete('/web-api/admin/campaign/:id',requireAdmin,(req,res)=>{ const s=readStore(),c=s.campaigns.find(x=>x.id===req.params.id); if(!c)return res.status(404).json({error:'Kampanya bulunamadı'}); s.campaigns=s.campaigns.filter(x=>x.id!==c.id); for(const p of s.products)if(p.campaignId===c.id)p.campaignId='';audit(s,'Kampanya silindi',c.title);writeStore(s);res.json({ok:true}); });


app.post('/web-api/admin/banner/upload',requireAdmin,upload.single('file'),(req,res)=>{
  if(!req.file)return res.status(400).json({error:'Görsel dosyası seçilmedi'});
  const allowed=new Set(['image/jpeg','image/png','image/webp']);
  if(!allowed.has(req.file.mimetype))return res.status(400).json({error:'Yalnızca JPG, PNG veya WEBP yükleyebilirsiniz'});
  const type=String(req.body?.type||'desktop')==='mobile'?'mobile':'desktop';
  const ext=req.file.mimetype==='image/png'?'.png':req.file.mimetype==='image/webp'?'.webp':'.jpg';
  const uploadDir=path.join(ROOT,'public','uploads','banners');
  fs.mkdirSync(uploadDir,{recursive:true});
  const filename=`banner-${type}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
  fs.writeFileSync(path.join(uploadDir,filename),req.file.buffer);
  res.json({ok:true,url:`/uploads/banners/${filename}`,type});
});

app.post('/web-api/admin/banner',requireAdmin,(req,res)=>{ const s=readStore(),x=req.body||{}; if(!x.headline)return res.status(400).json({error:'Banner başlığı zorunlu'}); let b=s.banners.find(v=>v.id===x.id); const data={headline:String(x.headline),subheadline:String(x.subheadline||''),ctaText:String(x.ctaText||'İncele'),ctaUrl:String(x.ctaUrl||'#products'),desktopImage:String(x.desktopImage||''),mobileImage:String(x.mobileImage||''),active:Boolean(x.active),sort:Number(x.sort||0)}; if(b)Object.assign(b,data);else {b={id:crypto.randomUUID(),...data};s.banners.push(b);} audit(s,'Banner kaydedildi',b.headline);writeStore(s);res.json({ok:true,banner:b}); });
app.delete('/web-api/admin/banner/:id',requireAdmin,(req,res)=>{ const s=readStore(),b=s.banners.find(x=>x.id===req.params.id);if(!b)return res.status(404).json({error:'Banner bulunamadı'});s.banners=s.banners.filter(x=>x.id!==b.id);audit(s,'Banner silindi',b.headline);writeStore(s);res.json({ok:true}); });

app.get('/web-api/admin/beko-sync/status',requireAdmin,(req,res)=>{const s=readStore();res.json(s.syncState||{running:false});});
app.post('/web-api/admin/beko-sync/start',requireAdmin,async(req,res)=>{const s=readStore();if(s.syncState?.running)return res.status(409).json({error:'Senkronizasyon zaten çalışıyor'});res.status(202).json({ok:true,message:'Beko senkronizasyonu başlatıldı'});setImmediate(async()=>{try{await runBekoSync({maxProducts:req.body?.maxProducts||1200,log:m=>console.log('[BEKO SYNC]',m)});}catch(e){console.error('[BEKO SYNC ERROR]',e);}});});

app.post('/web-api/admin/import-csv',requireAdmin,upload.single('file'),(req,res)=>{if(!req.file)return res.status(400).json({error:'CSV dosyası seçilmedi'});let rows;try{rows=parse(req.file.buffer.toString('utf8'),{columns:true,skip_empty_lines:true,bom:true,trim:true});}catch(e){return res.status(400).json({error:`CSV okunamadı: ${e.message}`});}const s=readStore();let added=0,updated=0,skipped=0;for(const r of rows){const brand=String(r.brand||r.marka||r['Marka']||'Beko').trim(),cat=String(r.category||r.kategori||r['Kategori']||'');if(!(brand.toLowerCase()==='beko'||(brand.toLowerCase()==='grundig'&&/kişisel|kisisel/i.test(cat)))){skipped++;continue;}const code=String(r.code||r.urun_kodu||r['Ürün Kodu']||'').trim(),name=String(r.name||r.urun_adi||r['Ürün Adı']||'').trim();if(!code||!name){skipped++;continue;}const i=s.products.findIndex(p=>p.code.toLowerCase()===code.toLowerCase());const p=sanitizeProduct({...r,code,name},i>=0?s.products[i]:{});if(i>=0){s.products[i]=p;updated++;}else{s.products.push(p);added++;}}s.syncLogs.unshift({id:crypto.randomUUID(),date:new Date().toISOString(),source:'csv',added,updated,skipped});audit(s,'CSV ürün aktarımı','Ürünler',{added,updated,skipped});writeStore(s);res.json({ok:true,added,updated,skipped});});
app.get('/web-api/admin/export-csv',requireAdmin,(req,res)=>{const s=readStore(),h=['code','barcode','brand','name','category','vatRate','purchasePrice','listPrice','cashPrice','cardPrice','minimumSalePrice','bekoPrice','oldPrice','salePrice','priceMode','priceValue','stock','active','featured','tags','image','description','sourceUrl'];const esc=v=>`"${String(Array.isArray(v)?v.join('|'):(v??'')).replace(/"/g,'""')}"`;const lines=[h.join(',')].concat(s.products.map(p=>h.map(k=>esc(p[k])).join(',')));res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition','attachment; filename="atakhome-products.csv"');res.send('\ufeff'+lines.join('\n'));});

app.get('/web-admin',(req,res)=>res.sendFile(path.join(ROOT,'public','admin.html')));app.get('/web-admin/*',(req,res)=>res.sendFile(path.join(ROOT,'public','admin.html')));app.get('/web-admin-v5',(req,res)=>res.redirect('/web-admin'));app.get('/web-admin-legacy',(req,res)=>res.sendFile(path.join(ROOT,'public','admin-v5.html')));app.get('/personel',(req,res)=>res.sendFile(path.join(ROOT,'public','personel.html')));app.get('/personel/*',(req,res)=>res.sendFile(path.join(ROOT,'public','personel.html')));app.get('/',(req,res)=>res.redirect('/personel'));
app.get('/assets/*',(req,res)=>res.status(404).type('text').send('Not found'));
app.get('/web-admin-assets/*',(req,res)=>res.status(404).type('text').send('Not found'));
app.get('/web-api/*',(req,res)=>res.status(404).json({error:'Bulunamadı'}));
app.get('/foundation-api/*',(req,res)=>res.status(404).json({error:'Bulunamadı'}));
app.get('*',(req,res)=>res.redirect('/personel'));
app.use((err,req,res,next)=>{console.error(err);res.status(500).json({error:'Sunucu hatası'});});
ensureStore(readStore()); writeStore(readStore());
app.listen(PORT,'127.0.0.1',()=>{
  console.log(`Atak Home ERP V2 http://127.0.0.1:${PORT}`);
  console.log(`[SECURITY] ownerOnly=${ownerOnlyEnabled()} owners=${ownerUsernames().join(',')} ipLock=${allowedIps().length?allowedIps().join(','):'off'}`);
});
