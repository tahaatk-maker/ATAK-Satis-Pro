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
/** Resmi satıcı bilgileri — senet + satış sözleşmesinde sabit */
const ATAK_COMPANY = {
  legalName: 'ATAK EV GEREÇLERİ PAZ. TİC. LTD. ŞTİ.',
  shortName: 'ATAK EV GEREÇLERİ',
  taxOffice: 'Sarıyer',
  taxNo: '0940148218',
  address: 'Ferahevler Mah. Adnan Kahveci Cad. No:109 Sarıyer / İstanbul'
};
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
  store.settings ||= { siteName:'Atak Home', tagline:'Eviniz için her şey', whatsapp:'905433585060', phone:'02122232871', email:'tarabyabeko@gmail.com', address:ATAK_COMPANY.address };
  // Resmi şirket bilgileri (senet + sözleşme)
  store.settings.companyLegalName = ATAK_COMPANY.legalName;
  store.settings.taxOffice = ATAK_COMPANY.taxOffice;
  store.settings.taxNo = ATAK_COMPANY.taxNo;
  if(!String(store.settings.address||'').trim() || /Tarabya/i.test(String(store.settings.address||'')) || String(store.settings.address||'').trim()==='Sarıyer / İstanbul'){
    store.settings.address = ATAK_COMPANY.address;
  }
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
  store.promissorySettings ||= {creditorName:ATAK_COMPANY.legalName,paymentPlace:'İstanbul',issuePlace:'İstanbul',prefix:'ATAK',defaultInstallments:1,firstDueDays:30,intervalMonths:1,copies:1,footer:''};
  // Senet/sözleşmede "Atak Home" yasak — her zaman resmi ünvan
  store.promissorySettings.creditorName = ATAK_COMPANY.legalName;
  store.invoiceIntegration ||= {provider:'qnb-solist',environment:'test',enabled:false,companyVkn:ATAK_COMPANY.taxNo,companyTitle:ATAK_COMPANY.legalName,senderAlias:'',webServiceUrl:'',username:'',password:'',draftMode:true,autoDetectType:true,gbAlias:'',pkAlias:'',efaturaSeries:'ATK',earsivSeries:'ATA',efaturaNext:1,earsivNext:1};
  if(store.invoiceIntegration && !store.invoiceIntegration.provider)store.invoiceIntegration.provider='qnb-solist';
  if(!String(store.invoiceIntegration.companyVkn||'').trim())store.invoiceIntegration.companyVkn=ATAK_COMPANY.taxNo;
  if(!String(store.invoiceIntegration.companyTitle||'').trim())store.invoiceIntegration.companyTitle=ATAK_COMPANY.legalName;
  // Seri: e-Fatura = ATK, e-Arşiv = ATA (GIB 3 harf + yıl + 9 hane)
  if(!String(store.invoiceIntegration.efaturaSeries||'').trim())store.invoiceIntegration.efaturaSeries='ATK';
  if(!String(store.invoiceIntegration.earsivSeries||'').trim())store.invoiceIntegration.earsivSeries='ATA';
  if(!Number.isFinite(Number(store.invoiceIntegration.efaturaNext))||Number(store.invoiceIntegration.efaturaNext)<1)store.invoiceIntegration.efaturaNext=1;
  if(!Number.isFinite(Number(store.invoiceIntegration.earsivNext))||Number(store.invoiceIntegration.earsivNext)<1)store.invoiceIntegration.earsivNext=1;

  store.dealerSettings ||= [
    {id:'atak-beko',name:'Atak Beko',marginDividePct:25,commissionPct:0.50,cashMaxDiscountPct:10,cardMaxDiscountPct:5,active:true},
    {id:'atak-istikbal',name:'Atak İstikbal',marginDividePct:35,commissionPct:0.50,cashMaxDiscountPct:10,cardMaxDiscountPct:5,active:true}
  ];

  store.cancellationRequests = Array.isArray(store.cancellationRequests) ? store.cancellationRequests : [];
  store.invoiceQueue = Array.isArray(store.invoiceQueue) ? store.invoiceQueue : [];
  store.invoiceInbox = Array.isArray(store.invoiceInbox) ? store.invoiceInbox : [];
  store.invoiceAppResponses = Array.isArray(store.invoiceAppResponses) ? store.invoiceAppResponses : [];
  store.purchaseInvoices = Array.isArray(store.purchaseInvoices) ? store.purchaseInvoices : [];
  store.suppliers = Array.isArray(store.suppliers) ? store.suppliers : [];
  if(!store.suppliers.length){
    store.suppliers.push(
      {id:'arcelik',name:'Arçelik A.Ş.',active:true},
      {id:'istikbal-tedarik',name:'İstikbal / Doğtaş',active:true},
      {id:'diger-tedarik',name:'Diğer Tedarikçi',active:true}
    );
  }
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
  // İstikbal ürünleri yanlışlıkla "Diğer"de kaldıysa → Mobilya
  const mobilyaCat=(store.categories||[]).find(c=>c.id==='mobilya'||String(c.name||'').toLocaleLowerCase('tr-TR')==='mobilya');
  const mobilyaId=mobilyaCat?.id||'mobilya';
  if(!mobilyaCat)store.categories.push({id:'mobilya',name:'Mobilya',active:true,sort:50,description:''});
  let istikbalFixed=0;
  store.products = store.products.map(p=>{
    const row={
      tags:[], campaignId:'', barcode:'', purchasePrice:0, listPrice:Number(p.oldPrice||p.bekoPrice||0),
      cashPrice:Number(p.salePrice||0), cardPrice:Number(p.salePrice||0), minimumSalePrice:0,
      ...p
    };
    const brand=String(row.brand||'').toLocaleLowerCase('tr-TR');
    const tags=(row.tags||[]).map(t=>String(t).toLocaleLowerCase('tr-TR'));
    const isIstikbal=/istikbal/.test(brand)||tags.includes('istikbal');
    if(isIstikbal&&row.category!==mobilyaId){
      row.category=mobilyaId;
      row.vatRate=10;
      istikbalFixed++;
    }
    row.vatRate=resolveVatRate(row);
    return row;
  });
  if(istikbalFixed>0)store.__istikbalCategoryFixed=istikbalFixed;
  store.campaigns = store.campaigns.map((c,i)=>({ id:c.id||crypto.randomUUID(), title:c.title||'Kampanya', subtitle:c.subtitle||'', label:c.label||'FIRSAT', startDate:c.startDate||'', endDate:c.endDate||'', active:c.active!==false, homepage:c.homepage!==false, sort:Number(c.sort??i), productIds:Array.isArray(c.productIds)?c.productIds:[] }));
  if (!store.banners.length) store.banners.push({ id:crypto.randomUUID(), headline:'Evinizi sadece döşemeyin. Yaşatın.', subheadline:'Beko ürünleri, mobilya, klima, TV ve ev yaşam çözümleri Atak Home’da.', ctaText:'Ürünleri keşfet', ctaUrl:'#products', desktopImage:'', mobileImage:'', active:true, sort:0 });
  return store;
}
function readStore(){
  const s=ensureStore(JSON.parse(fs.readFileSync(STORE_PATH,'utf8')));
  if(s.__istikbalCategoryFixed){
    const n=s.__istikbalCategoryFixed;
    delete s.__istikbalCategoryFixed;
    try{
      const t=`${STORE_PATH}.tmp`;
      fs.writeFileSync(t,JSON.stringify(s,null,2),'utf8');
      fs.renameSync(t,STORE_PATH);
      console.log(`[istikbal] ${n} ürün Mobilya kategorisine taşındı`);
    }catch(e){console.error('[istikbal] kategori kaydı yazılamadı',e.message)}
  }
  return s;
}
function writeStore(store){
  const clean={...ensureStore(store)};
  delete clean.__istikbalCategoryFixed;
  const t=`${STORE_PATH}.tmp`;
  fs.writeFileSync(t,JSON.stringify(clean,null,2),'utf8');
  fs.renameSync(t,STORE_PATH);
}
function normalizeNumber(value){
  if(value===null||value===undefined||value==='') return 0;
  if(typeof value==='number') return Number.isFinite(value)?value:0;
  let raw=String(value).trim()
    .replace(/[\u200b\u200c\u200d\ufeff]/g,'')
    .replace(/\s/g,'')
    .replace(/[₺]/g,'')
    .replace(/(TRY|TL|USD|EUR|\$)/gi,'');
  if(!raw) return 0;
  // Muhasebe negatif: (1.234,56)
  let neg=false;
  if(/^\(.*\)$/.test(raw)){neg=true;raw=raw.slice(1,-1)}
  // TR: 8.853,51  |  US/Excel raw:false: 8,853.51  |  sade: 8853,51 / 8853.51
  if(/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(raw)){
    const n=Number(raw.replace(/\./g,'').replace(',','.'));
    return (Number.isFinite(n)?n:0)*(neg?-1:1);
  }
  if(/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(raw)){
    const n=Number(raw.replace(/,/g,''));
    return (Number.isFinite(n)?n:0)*(neg?-1:1);
  }
  if(raw.includes(',')&&raw.includes('.')){
    // Son ayırıcı ondalık kabul et
    const lastComma=raw.lastIndexOf(','), lastDot=raw.lastIndexOf('.');
    const n=lastComma>lastDot
      ?Number(raw.replace(/\./g,'').replace(',','.'))
      :Number(raw.replace(/,/g,''));
    return (Number.isFinite(n)?n:0)*(neg?-1:1);
  }
  const n=Number(raw.replace(',','.'));
  return (Number.isFinite(n)?n:0)*(neg?-1:1);
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


const STAFF_DEFAULT_SCREENS=[
  'screen_finance','screen_uninvoiced','screen_customer_payments','screen_customers',
  'screen_sales_center','screen_sales_tracking','screen_my_sales','screen_invoice_center'
];
const PERMISSION_CATALOG=[
  {id:'dashboard_view',name:'Dashboard görüntüle',group:'Genel'},
  {id:'screen_finance',name:'Finans & Cari (ana)',group:'Finans & Cari'},
  {id:'screen_uninvoiced',name:'Kesilmeyen Faturalar',group:'e-Fatura'},
  {id:'screen_customer_payments',name:'Müşteri Ödemeleri',group:'Finans & Cari'},
  {id:'screen_customers',name:'Müşteriler',group:'Finans & Cari'},
  {id:'screen_sales_center',name:'Satış Merkezi',group:'Finans & Cari'},
  {id:'screen_sales_tracking',name:'Satış Takibi',group:'Finans & Cari'},
  {id:'screen_my_sales',name:'Satışlarım & Primim',group:'Finans & Cari'},
  {id:'screen_staff_sales_report',name:'Personel Satış Raporu',group:'Finans & Cari'},
  {id:'screen_manager_approvals',name:'Yönetici Onayları',group:'Finans & Cari'},
  {id:'screen_profit',name:'Kâr & Maliyet',group:'Finans & Cari'},
  {id:'screen_reports',name:'Raporlar',group:'Finans & Cari'},
  {id:'screen_invoice_center',name:'e-Fatura Merkezi',group:'Finans & Cari'},
  {id:'orders_manage',name:'Satış kaydı yap (POS API)',group:'Satış işlemleri'},
  {id:'sale_docs',name:'Sözleşme / Senet bas',group:'Satış işlemleri'},
  {id:'sale_offer',name:'Teklif WhatsApp / PDF',group:'Satış işlemleri'},
  {id:'sale_invoice_qnb',name:'Fatura kes (QNB)',group:'Satış işlemleri'},
  {id:'sale_deduct_stock',name:'Satışta stok düş',group:'Satış işlemleri'},
  {id:'products_view',name:'Ürün görüntüle',group:'Ürün & Stok'},
  {id:'products_manage',name:'Ürün yönet',group:'Ürün & Stok'},
  {id:'stock_view',name:'Stok görüntüle',group:'Ürün & Stok'},
  {id:'stock_manage',name:'Stok yönet',group:'Ürün & Stok'},
  {id:'customers_manage',name:'Müşteri kartı düzenle',group:'Finans işlemleri'},
  {id:'finance_view',name:'Finans verisi görüntüle',group:'Finans işlemleri'},
  {id:'finance_manage',name:'Finans yönet (tahsilat/masraf)',group:'Finans işlemleri'},
  {id:'invoices_manage',name:'Fatura kuyruğu yönet',group:'Finans işlemleri'},
  {id:'orders_view',name:'Sipariş görüntüle',group:'Diğer'},
  {id:'marketing_manage',name:'Pazarlama yönet',group:'Diğer'},
  {id:'sync_manage',name:'Senkron yönet',group:'Sistem'},
  {id:'users_manage',name:'Kullanıcı / yetki yönet',group:'Sistem'},
  {id:'settings_manage',name:'Ayarlar',group:'Sistem'},
  {id:'reports_view',name:'Ciro kanalları / rapor',group:'Sistem'},
  {id:'foundation_manage',name:'Foundation yönetimi',group:'Sistem'},
  {id:'web_manage',name:'Web sitesi yönet',group:'Sistem'}
];
const ROLE_PRESETS={
  owner:{name:'Sahip / Tam Yetki',permissions:['*']},
  admin:{name:'Yönetici',permissions:[
    'dashboard_view','products_manage','marketing_manage','finance_manage','sync_manage','users_manage',
    'orders_manage','sale_docs','sale_offer','sale_invoice_qnb','sale_deduct_stock','customers_manage','invoices_manage',
    ...STAFF_DEFAULT_SCREENS,'screen_staff_sales_report','screen_manager_approvals','screen_profit','screen_reports','stock_manage','foundation_manage','settings_manage','reports_view'
  ]},
  super_admin:{name:'Süper Admin',permissions:['*']},
  sales:{name:'Satış Personeli',permissions:[
    'dashboard_view','products_view','orders_manage','customers_manage','finance_view',
    'sale_docs','sale_offer',
    ...STAFF_DEFAULT_SCREENS
    // Personel Satış Raporu + Yönetici Onayları varsayılan KAPALI — istenirse kullanıcı kartından açılır
  ]},
  warehouse:{name:'Depo',permissions:['dashboard_view','products_view','stock_manage','stock_view','orders_view','screen_sales_tracking']},
  accounting:{name:'Muhasebe',permissions:[
    'dashboard_view','finance_manage','finance_view','orders_view','invoices_manage','sale_invoice_qnb',
    'screen_finance','screen_uninvoiced','screen_customer_payments','screen_customers','screen_invoice_center','screen_my_sales','screen_profit','screen_reports'
  ]},
  service:{name:'Servis',permissions:['dashboard_view','orders_view','screen_sales_tracking']},
  viewer:{name:'Sadece Görüntüleme',permissions:['dashboard_view','products_view','orders_view']}
};
function sanitizePermissions(list,role){
  const preset=ROLE_PRESETS[role]?.permissions||ROLE_PRESETS.viewer.permissions;
  if(!Array.isArray(list)||!list.length)return preset.slice();
  if(list.includes('*'))return ['*'];
  const allowed=new Set(PERMISSION_CATALOG.map(p=>p.id));
  const cleaned=[...new Set(list.map(String).filter(p=>allowed.has(p)))];
  return cleaned.length?cleaned:preset.slice();
}
function staffCanInvoice(req){
  return actorHasPermission(req,'sale_invoice_qnb')||actorHasPermission(req,'finance_manage')||actorHasPermission(req,'invoices_manage');
}
function staffCanDeductStock(req){
  return actorHasPermission(req,'sale_deduct_stock')||actorHasPermission(req,'stock_manage');
}
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
  // Personel oturumu varsa onu kullan — admin paneli cookie/bayrağı personel kimliğini ezmesin
  if(req.session?.staffUser) return req.session.staffUser;
  if(req.session?.systemOwner===true){
    return {id:'system-owner',name:'Sistem Yöneticisi',username:'admin',role:'owner',permissions:['*']};
  }
  if(req.session?.user) return req.session.user;
  return null;
}
/** Satış tutarı: total yoksa customerDelta / amount */
function saleAmount(tx={}){
  if(tx.total!=null && tx.total!==''){
    const n=Number(tx.total);
    if(Number.isFinite(n))return n;
  }
  const cd=Number(tx.customerDelta);
  if(Number.isFinite(cd) && cd!==0)return Math.abs(cd);
  const a=Number(tx.amount);
  return Number.isFinite(a)?Math.abs(a):0;
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
  const role=String(a.role||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,'_');
  if(['owner','admin','super_admin','superadmin','yonetici','manager'].includes(role))return true;
  const roleName=String(a.roleName||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  if(roleName.includes('owner')||roleName.includes('admin')||roleName.includes('yonetici')||roleName.includes('sahip'))return true;
  const perms=Array.isArray(a.permissions)?a.permissions:[];
  // Yönetici Onayları yetkisi de yönetici sayılır
  return perms.includes('*')
    ||perms.includes('finance_manage')
    ||perms.includes('users_manage')
    ||perms.includes('customers_manage')
    ||perms.includes('screen_manager_approvals')
    ||perms.includes('cancellations_approve');
}
function actorCanSeeAllStaffSales(req){
  return actorIsManager(req)
    ||actorHasPermission(req,'screen_staff_sales_report')
    ||actorHasPermission(req,'sales_reports_view');
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
function dealerBrandKey(dealerOrTx=''){
  // id / name / satış kaydı — İstikbal / Beko ayrımı
  let blob='';
  if(dealerOrTx && typeof dealerOrTx==='object'){
    blob=[
      dealerOrTx.dealerId,dealerOrTx.dealerName,dealerOrTx.dealer,
      ...(Array.isArray(dealerOrTx.items)?dealerOrTx.items.map(i=>`${i.brand||''} ${i.productName||''} ${i.productCode||''}`):[])
    ].join(' ');
  }else{
    blob=String(dealerOrTx||'');
  }
  const d=blob.toLocaleLowerCase('tr-TR');
  if(d.includes('istikbal'))return 'istikbal';
  if(d.includes('beko'))return 'beko';
  return 'other';
}
function buildSalesCiro(salesRows){
  const brand={beko:0,istikbal:0,other:0,total:0,count:0};
  const byPerson=new Map();
  for(const t of salesRows||[]){
    const amount=saleAmount(t);
    const key=dealerBrandKey(t);
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
/** Satış tarihi: date yoksa createdAt; TR formatını da ISO'ya çevir */
function txDateKey(tx){
  const raw=String(tx?.date||tx?.createdAt||'').trim();
  if(!raw)return '';
  const iso=raw.slice(0,10);
  if(/^\d{4}-\d{2}-\d{2}$/.test(iso))return iso;
  const tr=raw.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/);
  if(tr)return `${tr[3]}-${tr[2].padStart(2,'0')}-${tr[1].padStart(2,'0')}`;
  const d=new Date(raw);
  if(!Number.isNaN(d.getTime())){
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  return '';
}
function isStaffPortalReq(req){
  // Personel girişi varsa personel portalıdır (admin=true owner bypass'ı staffPortal'ı bozmasın)
  return Boolean(req.session?.staffUser);
}
function buildMonthSalesPrim(salesRows=[],pendingMap=new Map()){
  const round=n=>Math.round(Number(n||0)*100)/100;
  let gross=0,grossCount=0,cancelled=0,cancelledCount=0,returned=0,returnedCount=0,net=0,netCount=0,prim=0,primLost=0;
  const rows=(salesRows||[]).map(t=>{
    const amount=saleAmount(t);
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
      date:txDateKey(t)||String(t.date||'').slice(0,10),
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
/** Satışı yapan personelden mağazayı bul — ciro artık elle girilmiyor, satıştan türetiliyor */
function resolveSaleStore(s,tx){
  const staffList=s.staff||[];
  const byId=String(tx.salespersonId||'')||String(tx.createdById||'');
  let member=byId?staffList.find(x=>String(x.id)===byId):null;
  if(!member)member=staffList.find(x=>txBelongsToActor(tx,x));
  if(member){
    const branch=(s.stores||[]).find(v=>String(v.id)===String(member.storeId));
    return{storeId:member.storeId||'',storeName:branch?.name||'Mağaza atanmamış',staffId:member.id,staffName:member.name};
  }
  return{
    storeId:'',
    storeName:'Mağaza atanmamış',
    staffId:String(tx.salespersonId||tx.createdById||''),
    staffName:String(tx.salespersonName||tx.createdBy||'Bilinmiyor')
  };
}
/** Gün + mağaza + personel bazında otomatik ciro satırları (POS satışlarından) */
function buildAutoTurnovers(s,{days=30}={}){
  const round=n=>Math.round(Number(n||0)*100)/100;
  const today=todayISO();
  const from=new Date(`${today}T12:00:00`);
  from.setDate(from.getDate()-(Math.max(1,days)-1));
  const fromKey=from.toISOString().slice(0,10);
  const map=new Map();
  for(const t of (s.financeTransactions||[])){
    if(t.kind!=='sale'||t.cancelled)continue;
    const date=txDateKey(t);
    if(!date||date<fromKey||date>today)continue;
    const who=resolveSaleStore(s,t);
    const key=`${date}::${who.storeId}::${who.staffId||who.staffName}`;
    if(!map.has(key)){
      map.set(key,{
        id:key,date,storeId:who.storeId,storeName:who.storeName,
        staffId:who.staffId,staffName:who.staffName,
        grossAmount:0,returnAmount:0,netAmount:0,orderCount:0,
        beko:0,istikbal:0,other:0,source:'auto'
      });
    }
    const row=map.get(key);
    const amount=saleAmount(t);
    const gross=Number(t.grossTotal!=null&&t.grossTotal!==''?t.grossTotal:amount)||0;
    row.grossAmount+=gross;
    row.netAmount+=amount;
    row.orderCount+=1;
    row[dealerBrandKey(t)]+=amount;
  }
  return [...map.values()].map(r=>({
    ...r,
    grossAmount:round(r.grossAmount),
    netAmount:round(r.netAmount),
    beko:round(r.beko),istikbal:round(r.istikbal),other:round(r.other)
  })).sort((a,b)=>String(b.date).localeCompare(String(a.date))||String(a.storeName).localeCompare(String(b.storeName),'tr'));
}
function foundationSummary(s,date=todayISO()){
  const round=n=>Math.round(Number(n||0)*100)/100;
  let total=0,count=0,beko=0,istikbal=0;
  const soldStores=new Set();
  for(const t of (s.financeTransactions||[])){
    if(t.kind!=='sale'||t.cancelled)continue;
    if(txDateKey(t)!==date)continue;
    const amount=saleAmount(t);
    total+=amount;count+=1;
    const b=dealerBrandKey(t);
    if(b==='beko')beko+=amount;else if(b==='istikbal')istikbal+=amount;
    const who=resolveSaleStore(s,t);
    if(who.storeId)soldStores.add(who.storeId);
  }
  const activeStores=s.stores.filter(x=>x.active!==false);
  return{
    date,
    totalTurnover:round(total),
    saleCount:count,
    entryCount:count,
    beko:round(beko),
    istikbal:round(istikbal),
    storeCount:activeStores.length,
    completedStores:soldStores.size,
    source:'auto',
    missingStores:activeStores.filter(x=>!soldStores.has(x.id)).map(x=>({id:x.id,name:x.name}))
  };
}


function stockKey(productCode,warehouseId){return`${String(productCode).trim().toLocaleUpperCase('tr-TR')}::${warehouseId}`}
function findStockRow(s,productCode,warehouseId){
  const code=String(productCode||'').trim().toLocaleUpperCase('tr-TR');
  const wh=String(warehouseId||'');
  const key=stockKey(code,wh);
  let row=(s.productStocks||[]).find(x=>x.key===key);
  if(row)return row;
  // Eski kayıtlar "KOD|depo" veya küçük harf key kullanmış olabilir
  row=(s.productStocks||[]).find(x=>
    String(x.productCode||'').trim().toLocaleUpperCase('tr-TR')===code &&
    String(x.warehouseId||'')===wh
  )||null;
  if(row)row.key=key;
  return row;
}
function currentStock(s,productCode,warehouseId){
  return findStockRow(s,productCode,warehouseId);
}
function setStock(s,productCode,warehouseId,quantity){
  const code=String(productCode||'').trim().toLocaleUpperCase('tr-TR');
  const key=stockKey(code,warehouseId),now=new Date().toISOString();
  let row=findStockRow(s,code,warehouseId);
  if(row){row.key=key;row.productCode=code;row.quantity=Math.max(0,Math.round(Number(quantity)||0));row.updatedAt=now}
  else{row={id:crypto.randomUUID(),key,productCode:code,warehouseId,quantity:Math.max(0,Math.round(Number(quantity)||0)),reserved:0,createdAt:now,updatedAt:now};s.productStocks.push(row)}
  return row;
}
function ensureStockRow(s,productCode,warehouseId){
  return currentStock(s,productCode,warehouseId)||setStock(s,productCode,warehouseId,0);
}
function availableStockQty(s,productCode,warehouseId){
  const row=currentStock(s,productCode,warehouseId);
  return Math.max(0,Number(row?.quantity||0)-Number(row?.reserved||0));
}
function adjustReserved(s,{productCode,warehouseId,quantity,type='reserve',reference='',note='',user='Admin'}){
  const code=String(productCode||'').trim().toLocaleUpperCase('tr-TR');
  const delta=Math.round(Number(quantity)||0);
  if(!delta)return null;
  const row=ensureStockRow(s,code,warehouseId);
  const beforeReserved=Number(row.reserved||0);
  const afterReserved=Math.max(0,beforeReserved+delta);
  if(delta>0){
    const available=Number(row.quantity||0)-beforeReserved;
    if(available<delta)throw new Error(`${code} için seçilen depoda yalnızca ${Math.max(0,available)} adet satılabilir stok var`);
  }
  row.reserved=afterReserved;
  row.updatedAt=new Date().toISOString();
  const movement={
    id:crypto.randomUUID(),productCode:code,warehouseId,type,quantity:0,
    before:Number(row.quantity||0),after:Number(row.quantity||0),
    reservedBefore:beforeReserved,reservedAfter:afterReserved,reservedDelta:delta,
    reference:String(reference||''),note:String(note||''),user,createdAt:new Date().toISOString()
  };
  s.stockMovements.unshift(movement);
  return{stock:row,movement};
}
function consumeReservedToSale(s,{productCode,warehouseId,quantity,reference='',note='',user='Admin'}){
  const qty=Math.max(0,Math.round(Number(quantity)||0));
  if(!qty)return null;
  const row=ensureStockRow(s,productCode,warehouseId);
  const reserved=Number(row.reserved||0);
  const release=Math.min(reserved,qty);
  if(release>0){
    adjustReserved(s,{productCode,warehouseId,quantity:-release,type:'reserve_consume',reference,note:note||'Rezerv teslimatta düşüldü',user});
  }
  return addStockMovement(s,{productCode,warehouseId,type:'sale',quantity:-qty,reference,note,user});
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
    createdBy:String(data.createdBy||'Admin'),createdById:String(data.createdById||''),createdAt:new Date().toISOString()};
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
app.use('/assets',express.static(path.join(ROOT,'public','assets'),{
  maxAge:0,etag:true,lastModified:true,fallthrough:true,
  setHeaders(res,filePath){
    if(/\.(js|css|html)$/i.test(filePath)){
      res.setHeader('Cache-Control','no-store, no-cache, must-revalidate, max-age=0');
      res.setHeader('Pragma','no-cache');
    }
  }
}));
app.use('/web-admin-assets',express.static(path.join(ROOT,'public','assets'),{
  maxAge:0,etag:true,lastModified:true,fallthrough:true,
  setHeaders(res,filePath){
    if(/\.(js|css|html)$/i.test(filePath)){
      res.setHeader('Cache-Control','no-store, no-cache, must-revalidate, max-age=0');
      res.setHeader('Pragma','no-cache');
    }
  }
}));
app.use('/docs',express.static(path.join(ROOT,'public','docs'),{maxAge:'1h',fallthrough:true}));
app.get('/health',(req,res)=>res.json({
  ok:true,
  service:'atakhome-erp-v2',
  version:'6.3.69-senet-orphan-fix',
  build:'fix-v68',
  ownerOnly:ownerOnlyEnabled(),
  company:ATAK_COMPANY.legalName,
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



app.get('/web-api/admin/roles',requireAdmin,(req,res)=>res.json({
  roles:Object.entries(ROLE_PRESETS).map(([id,x])=>({id,name:x.name,permissions:x.permissions})),
  permissions:PERMISSION_CATALOG
}));
app.post('/web-api/admin/user',requirePermission('users_manage'),(req,res)=>{
  const s=readStore(),x=req.body||{},username=String(x.username||'').trim().toLocaleLowerCase('tr-TR'),name=String(x.name||'').trim(),role=ROLE_PRESETS[x.role]?String(x.role):'viewer';
  if(!username||!name)return res.status(400).json({error:'Ad ve kullanıcı adı zorunludur'});
  if(!/^[a-z0-9._-]{3,40}$/.test(username))return res.status(400).json({error:'Kullanıcı adı uygun değil'});
  if((s.users||[]).some(u=>u.id!==x.id&&String(u.username).toLocaleLowerCase('tr-TR')===username))return res.status(409).json({error:'Bu kullanıcı adı zaten kullanılıyor'});
  let user=(s.users||[]).find(u=>String(u.id)===String(x.id));const now=new Date().toISOString();
  const permissions=sanitizePermissions(x.permissions,role);
  if(user){user.name=name;user.username=username;user.role=role;user.active=x.active!==false;user.permissions=permissions;if(String(x.password||'').trim())user.passwordHash=hashPassword(x.password);user.updatedAt=now}
  else{if(!String(x.password||'').trim())return res.status(400).json({error:'Yeni kullanıcı için şifre zorunludur'});user={id:crypto.randomUUID(),name,username,role,permissions,active:x.active!==false,passwordHash:hashPassword(x.password),createdAt:now,updatedAt:now};s.users.push(user)}
  audit(s,x.id?'Kullanıcı güncellendi':'Kullanıcı eklendi',username,{role,permissions});writeStore(s);res.json({ok:true,user:publicUser(user)});
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
  // Personel girişi admin paneli oturum bayraklarını temizler (özet/prim kapsamı bozulmasın)
  delete req.session.admin;
  delete req.session.systemOwner;
  delete req.session.user;
  const role=String(user.role||'staff');
  const presetPerms=ROLE_PRESETS[role]?.permissions||[];
  const rawPerms=Array.isArray(user.permissions)?user.permissions:[];
  let permissions=rawPerms.length?rawPerms.slice():presetPerms.slice();
  // Eski personel: ekran/işlem yetkileri yoksa satış personeli varsayılanlarını ekle (rapor+onay hariç)
  if(permissions.includes('orders_manage') || permissions.includes('screen_sales_center')){
    if(!permissions.some(p=>String(p).startsWith('sale_'))){
      permissions=[...new Set([...permissions,'sale_docs','sale_offer'])];
    }
    if(!permissions.some(p=>String(p).startsWith('screen_'))){
      permissions=[...new Set([...permissions, ...STAFF_DEFAULT_SCREENS])];
    }
  }
  req.session.staffUser={
    id:user.id,
    name:user.name,
    username:user.username,
    role:role||'staff',
    roleName:(typeof ROLE_PRESETS!=='undefined' && ROLE_PRESETS[role]?.name)||role||'Personel',
    permissions,
    storeId:user.storeId||branch?.id||'',
    storeName:branch?.name||'Mağaza',
    active:user.active!==false
  };

  res.json({ok:true,user:req.session.staffUser,ownerOnly:ownerOnlyEnabled()});
});
app.post('/foundation-api/logout',(req,res)=>{
  delete req.session.staffUser;
  delete req.session.admin;
  delete req.session.systemOwner;
  delete req.session.user;
  res.json({ok:true});
});
app.get('/foundation-api/me',(req,res)=>{
  if(staffSession(req) && ownerOnlyEnabled() && !isOwnerActor(req)){
    delete req.session.staffUser;
    return res.json({authenticated:false,user:null,ownerOnly:true});
  }
  res.json({authenticated:Boolean(staffSession(req)),user:staffSession(req),ownerOnly:ownerOnlyEnabled()});
});
app.get('/foundation-api/dashboard',requireStaff,(req,res)=>{
  const s=readStore(),u=staffSession(req),date=todayISO();
  // Ciro elle girilmiyor: personelin kendi satışlarından hesaplanır
  const own=buildAutoTurnovers(s,{days:30})
    .filter(x=>String(x.staffId)===String(u.id))
    .slice(0,14);
  const announcements=s.announcements.filter(x=>x.active!==false&&(!x.storeId||x.storeId===u.storeId)&&(!x.endDate||x.endDate>=date))
    .map(x=>({...x,read:s.announcementReads.some(r=>r.announcementId===x.id&&r.staffId===u.id)}))
    .sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
  res.json({user:u,today:own.find(x=>x.date===date)||null,history:own,announcements,turnoverSource:'auto'});
});
/** Elle ciro girişi kaldırıldı — satışlar POS'tan giriliyor, ciro otomatik hesaplanıyor */
app.post('/foundation-api/turnover',requireStaff,(req,res)=>{
  res.status(410).json({
    error:'Ciro girişi kaldırıldı. Satışı Satış Merkezi’nden girin; ciro ve prim otomatik hesaplanır.',
    turnoverSource:'auto'
  });
});
app.post('/foundation-api/announcement/:id/read',requireStaff,(req,res)=>{
  const s=readStore(),u=staffSession(req);
  if(!s.announcementReads.some(x=>x.announcementId===req.params.id&&x.staffId===u.id))s.announcementReads.unshift({id:crypto.randomUUID(),announcementId:req.params.id,staffId:u.id,readAt:new Date().toISOString()});
  writeStore(s);res.json({ok:true});
});

app.get('/web-api/admin/foundation',requireAdmin,(req,res)=>{
  const s=readStore();
  const days=Math.min(180,Math.max(1,Math.round(Number(req.query.days)||30)));
  res.json({
    stores:s.stores,
    staff:s.staff.map(x=>publicStaff(x,s)),
    turnovers:buildAutoTurnovers(s,{days}),
    turnoverSource:'auto',
    turnoverDays:days,
    announcements:s.announcements,
    announcementReads:s.announcementReads,
    summary:foundationSummary(s)
  });
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
  // Küçük cari listelerinde satış ekranı fallback araması için (10k+ ise boş)
  const allCustomers=(s.customers||[]).filter(c=>c.active!==false);
  const customers=allCustomers.length<=500?allCustomers.map(c=>({
    id:c.id,name:c.name,phone:c.phone||'',taxNo:c.taxNo||'',tckn:c.tckn||'',
    companyName:c.companyName||'',taxOffice:c.taxOffice||'',city:c.city||'',
    district:c.district||'',address:c.address||'',
    email:c.email||'',balance:customerBalance(s,c.id),active:true,
    guarantor:normalizeGuarantor(c.guarantor)
  })).sort((a,b)=>String(a.name).localeCompare(String(b.name),'tr')):[];
  const accounts=(s.financeAccounts||[]).filter(a=>a.active!==false).map(a=>({
    id:a.id,name:a.name,type:a.type,storeId:a.storeId||'',active:true
  }));
  res.json({ok:true,products,categories,dealerSettings:s.dealerSettings||[],customers,customerTotal:allCustomers.length,accounts});
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
  const available=availableStockQty(s,productCode,from);
  if(available<qty)return res.status(400).json({error:`Kaynak depoda yalnızca ${available} adet satılabilir stok var`});
  const ref=`TR-${Date.now()}`;
  addStockMovement(s,{productCode,warehouseId:from,type:'transfer_out',quantity:-qty,reference:ref,note:String(x.note||''),user:currentActor(req)?.name||'Admin'});
  addStockMovement(s,{productCode,warehouseId:to,type:'transfer_in',quantity:qty,reference:ref,note:String(x.note||''),user:currentActor(req)?.name||'Admin'});
  audit(s,'Depolar arası transfer',productCode,{from,to,qty,ref});writeStore(s);res.json({ok:true,reference:ref});
});
/** Tüm (veya bir deponun) fiziksel stoklarını 0 yap — hareket kaydı bırakır */
app.post('/web-api/admin/stock-zero',requireAdmin,(req,res)=>{
  try{
    if(String(req.body?.confirm||'')!=='ZERO'){
      return res.status(400).json({error:'Onay için confirm=ZERO gönderin'});
    }
    const s=readStore();
    const warehouseId=String(req.body?.warehouseId||'').trim();
    const actor=currentActor(req)?.name||'Admin';
    let cleared=0,units=0,reservedCleared=0;
    for(const row of (s.productStocks||[])){
      if(warehouseId&&String(row.warehouseId)!==warehouseId)continue;
      const qty=Number(row.quantity||0);
      const reserved=Number(row.reserved||0);
      if(qty>0){
        addStockMovement(s,{
          productCode:row.productCode,warehouseId:row.warehouseId,type:'inventory_zero',
          quantity:-qty,reference:'STOK-SIFIR',note:'Toplu stok sıfırlama',user:actor
        });
        cleared++;units+=qty;
      }
      if(reserved>0){
        row.reserved=0;row.updatedAt=new Date().toISOString();
        reservedCleared+=reserved;
      }
    }
    if(!warehouseId){
      for(const p of (s.products||[])){
        if(Number(p.stock||0)!==0){p.stock=0;p.updatedAt=new Date().toISOString()}
      }
    }
    audit(s,'Stoklar sıfırlandı',warehouseId||'Tümü',{cleared,units,reservedCleared});
    writeStore(s);
    res.json({ok:true,cleared,units,reservedCleared,warehouseId:warehouseId||null});
  }catch(e){
    res.status(400).json({error:e.message||'Stok sıfırlanamadı'});
  }
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

app.get('/web-api/admin/finance-center',requireAdminOrStaffAny('finance_manage','finance_view','orders_manage','customers_manage','screen_finance','screen_my_sales'),(req,res)=>{
  const s=readStore();
  const actor=currentActor(req);
  const canApprove=actorIsManager(req);
  const canManage=actorCanSeeAllStaffSales(req);
  // Personel portalı oturumu: kapsam uygula. /web-admin oturumu: klasik tam finans.
  const staffPortal=isStaffPortalReq(req);
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
  // Satış ekranı gibi yerlerde 10k+ müşteri listesini gönderme (customers=0 / light=1)
  const omitCustomers=['0','false','no'].includes(String(req.query.customers||'').toLowerCase())
    || ['1','true','yes'].includes(String(req.query.light||'').toLowerCase());
  // Müşteriler ekranı ile Satış Merkezi aynı havuzu görsün:
  // - Yönetici / customers_manage → tüm aktif müşteriler
  // - Sadece kendi satışı olan personel → işlem yaptığı müşteriler
  // - Finans filtreleri (salespersonId/dealerId) açıksa yine kapsamlı liste
  const financeScoped=Boolean(salespersonId||dealerFilter);
  const canListAllCustomers=!staffPortal || canManage || actorHasPermission(req,'customers_manage');
  const customers=omitCustomers?[]:((staffPortal && (!canListAllCustomers || financeScoped))
    ? (s.customers||[]).filter(c=>ownCustomerIds.has(String(c.id)))
    : (s.customers||[])
  ).filter(c=>c.active!==false&&!c.deletedAt).map(x=>({...x,balance:customerBalance(s,x.id)}));
  const customerTotal=(s.customers||[]).filter(c=>c.active!==false&&!c.deletedAt).length;

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
  // Üst kartlar: personel portalında her zaman oturumdaki kişinin kendi satışı
  const ownSaleRows=(staffPortal && actor)
    ? (s.financeTransactions||[]).filter(t=>t.kind==='sale'&&!t.cancelled&&txBelongsToActor(t,actor))
    : saleRows;
  const ownNet=Math.round(ownSaleRows.reduce((a,t)=>a+saleAmount(t),0)*100)/100;
  const ownCount=ownSaleRows.length;
  const ownCollect=Math.round(
    (staffPortal && actor
      ? (s.financeTransactions||[]).filter(t=>!t.cancelled&&t.kind==='collection'&&(txBelongsToActor(t,actor)||ownSaleRows.some(sale=>String(sale.customerId||'')===String(t.customerId||''))))
      : transactions.filter(t=>t.kind==='collection')
    ).reduce((a,t)=>a+Math.abs(Number(t.amount||0)),0)*100
  )/100;
  const fullSummary=financeSnapshot(s);
  // Personel portalında her zaman satış/prim özet alanlarını doldur
  const summary=staffPortal
    ? {
        cash:canManage?fullSummary.cash:0,
        bank:canManage?fullSummary.bank:0,
        receivable:omitCustomers?0:Math.round(customers.reduce((a,c)=>a+Math.max(0,Number(c.balance||0)),0)*100)/100,
        todayExpense:canManage?(fullSummary.todayExpense||0):0,
        mySalesTotal:ownNet,
        mySalesCount:ownCount,
        myCollections:ownCollect,
        totalCash:canManage?fullSummary.cash:0,
        totalBank:canManage?fullSummary.bank:0
      }
    : fullSummary;

  res.json({
    summary,
    accounts, // satış ödemesi için hesap listesi personelde de gerekli
    customers,
    customerTotal,
    customersOmitted:omitCustomers,
    transactions,
    sales:saleRows,
    stores:s.stores,
    canManage:staffPortal?canManage:true,
    canApprove:staffPortal?canApprove:true,
    ciro,
    people:(staffPortal && canManage)?salesPeople(s,req):[],
    filters:{salespersonId,dealerId:dealerFilter},
    scope:staffPortal?(canManage?(salespersonId||dealerFilter?'filtered':'all'):'own'):'admin',
    staffPortal
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
    guarantor:normalizeGuarantor(c.guarantor),
    active:c.active!==false
  };
}
function normalizeGuarantor(g){
  if(!g||typeof g!=='object')return null;
  const name=String(g.name||'').trim();
  if(!name)return null;
  return {
    name,
    tckn:String(g.tckn||g.taxNo||'').trim(),
    phone:String(g.phone||g.gsm||'').trim(),
    workPhone:String(g.workPhone||'').trim(),
    homePhone:String(g.homePhone||'').trim(),
    homeAddress:String(g.homeAddress||g.address||'').trim(),
    workAddress:String(g.workAddress||'').trim()
  };
}
function parseGuarantorPayload(x,required=false){
  const g=normalizeGuarantor(x);
  if(!g){
    if(required)throw new Error('Kefil adı zorunludur');
    return null;
  }
  const digits=String(g.tckn||'').replace(/\D/g,'');
  if(digits&&digits.length!==11)throw new Error('Kefil TCKN 11 hane olmalıdır');
  return g;
}
function customerHasCorporateBilling(c={}){
  const vkn=String(c.taxNo||c.corporateTaxNo||'').replace(/\D/g,'');
  return Boolean(String(c.companyName||'').trim()&&vkn.length>=10);
}
/** Fatura tarafı: kurumsal varsa şirket, yoksa şahıs. Senet her zaman şahıs (name+tckn). */
function resolveCustomerInvoiceParty(customer={},prefer=''){
  const want=prefer==='corporate'||prefer==='individual'
    ?prefer
    :(customer.invoiceType==='corporate'?'corporate':'individual');
  const useCorp=want==='corporate'&&customerHasCorporateBilling(customer);
  return {
    partyType:useCorp?'corporate':'individual',
    invoiceType:useCorp?'corporate':'individual',
    name:useCorp?(customer.companyName||customer.name||''):(customer.name||''),
    taxNumber:useCorp?String(customer.taxNo||'').trim():String(customer.tckn||'').trim(),
    taxNo:useCorp?String(customer.taxNo||'').trim():String(customer.tckn||'').trim(),
    tckn:useCorp?'':String(customer.tckn||'').trim(),
    taxOffice:useCorp?String(customer.taxOffice||'').trim():'',
    companyName:useCorp?String(customer.companyName||'').trim():'',
    phone:customer.phone||'',
    email:customer.email||'',
    address:customer.address||'',
    city:customer.city||'',
    district:customer.district||''
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
  // taxNo = kurumsal VKN; tckn = şahıs (ikisi birden saklanır)
  const taxNo=String(x.taxNo||x.corporateTaxNo||'').trim();
  const tckn=String(x.tckn||x.individualTaxNo||'').trim();
  if(!name)throw new Error('Şahıs / müşteri adı zorunludur');
  if(!phone)throw new Error('Telefon zorunludur');
  if(!city||!district||!address)throw new Error('Fatura adresi (il, ilçe, açık adres) zorunludur');
  if(!deliverySame&&(!deliveryCity||!deliveryDistrict||!deliveryAddress)){
    throw new Error('Teslimat adresi fatura adresinden farklıysa il, ilçe ve açık adres zorunludur');
  }
  if(invoiceType==='corporate'){
    if(!companyName)throw new Error('Kurumsal fatura için firma ünvanı zorunludur');
    if(!taxOffice)throw new Error('Kurumsal fatura için vergi dairesi zorunludur');
    if(!taxNo||taxNo.replace(/\D/g,'').length<10)throw new Error('Kurumsal fatura için geçerli VKN (10 hane) zorunludur');
  }
  if(tckn&&tckn.replace(/\D/g,'').length!==11)throw new Error('TCKN girildiyse 11 hane olmalıdır');
  const out={
    name,phone,
    email:String(x.email||'').trim(),
    taxNo:invoiceType==='corporate'?taxNo:'',
    tckn:tckn||'',
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
  if(Object.prototype.hasOwnProperty.call(x,'guarantor'))out.guarantor=parseGuarantorPayload(x.guarantor);
  return out;
}
function applyCustomerData(row,data){Object.assign(row,data);return row}
function customerSearchHandler(req,res){
  const s=readStore();
  const q=String(req.query.q||req.query.query||'').trim().toLocaleLowerCase('tr-TR');
  const limit=Math.min(200,Math.max(1,Number(req.query.limit)||40));
  const id=String(req.query.id||'').trim();
  const listAll=['1','true','yes'].includes(String(req.query.list||'').toLowerCase());
  const all=(s.customers||[]).filter(c=>c.active!==false&&!c.deletedAt);
  let rows=all;
  if(id){
    rows=rows.filter(c=>String(c.id)===id);
  }else if(q.length>=1){
    // 1+ karakter: satış ekranında "a" / "atak" ile bulunsun
    const digits=q.replace(/\D+/g,'');
    rows=rows.filter(c=>{
      const hay=`${c.name||''} ${c.phone||''} ${c.taxNo||''} ${c.tckn||''} ${c.companyName||''} ${c.email||''} ${c.city||''} ${c.district||''}`.toLocaleLowerCase('tr-TR');
      if(hay.includes(q))return true;
      if(digits.length>=3){
        const phoneDigits=String(c.phone||'').replace(/\D+/g,'');
        const taxDigits=`${c.taxNo||''}${c.tckn||''}`.replace(/\D+/g,'');
        if(phoneDigits.includes(digits)||taxDigits.includes(digits))return true;
      }
      return false;
    });
  }else if(!listAll){
    // Boş aramada tüm listeyi yollama — 10k+ kayıt için güvenli
    return res.json({ok:true,total:all.length,rows:[],needQuery:true});
  }
  const total=rows.length;
  rows=rows
    .sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'tr'))
    .slice(0,limit)
    .map(c=>({
      id:c.id,name:c.name||'',phone:c.phone||'',email:c.email||'',
      taxNo:c.taxNo||'',tckn:c.tckn||'',city:c.city||'',district:c.district||'',
      address:c.address||'',companyName:c.companyName||'',taxOffice:c.taxOffice||'',
      invoiceType:c.invoiceType==='corporate'?'corporate':'individual',
      hasCorporate:customerHasCorporateBilling(c),note:c.note||'',
      guarantor:normalizeGuarantor(c.guarantor),
      balance:customerBalance(s,c.id),
      active:c.active!==false
    }));
  res.json({ok:true,total,rows,needQuery:false,limit});
}
app.get('/web-api/admin/customers/search',requireAdminOrStaffAny('customers_manage','orders_manage','finance_view','finance_manage'),customerSearchHandler);
// Alias — bazı proxy/yönlendirmelerde /customers/search takılırsa
app.get('/web-api/admin/customer-search',requireAdminOrStaffAny('customers_manage','orders_manage','finance_view','finance_manage'),customerSearchHandler);
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


function applyPaymentToNotes(s,customerId,amount,collectionId){
  let left=Math.round(Number(amount||0)*100)/100;
  const notes=(s.promissoryNotes||[])
    .filter(n=>String(n.customerId)===String(customerId) && !['paid','cancelled'].includes(String(n.status||'open')))
    .sort((a,b)=>String(a.dueDate||'').localeCompare(String(b.dueDate||'')));
  const updated=[];
  for(const n of notes){
    if(left<=0.009)break;
    const noteAmt=Math.round(Number(n.amount||0)*100)/100;
    const already=Math.round(Number(n.paidAmount||0)*100)/100;
    const remain=Math.max(0,Math.round((noteAmt-already)*100)/100);
    if(remain<=0.009){n.status='paid';n.paidAmount=noteAmt;continue}
    const pay=Math.min(left,remain);
    n.paidAmount=Math.round((already+pay)*100)/100;
    n.paidAt=new Date().toISOString();
    n.lastCollectionId=collectionId;
    n.status=n.paidAmount>=noteAmt-0.009?'paid':'partial';
    left=Math.round((left-pay)*100)/100;
    updated.push({id:n.id,serial:n.serial,dueDate:n.dueDate,amount:noteAmt,paidAmount:n.paidAmount,status:n.status,applied:pay});
  }
  return{updated,remaining:left};
}
function buildCustomerPaymentsBoard(s,{filter='open',q=''}={}){
  const today=todayISO();
  const month=today.slice(0,7);
  const round=n=>Math.round(Number(n||0)*100)/100;
  const customerMap=new Map((s.customers||[]).map(c=>[String(c.id),c]));
  const notesByCustomer=new Map();
  for(const n of (s.promissoryNotes||[])){
    const cid=String(n.customerId||'');
    if(!cid)continue;
    if(!notesByCustomer.has(cid))notesByCustomer.set(cid,[]);
    notesByCustomer.get(cid).push(n);
  }
  const rows=[];
  const seen=new Set();
  const pushCustomer=(cid)=>{
    if(seen.has(cid))return;
    seen.add(cid);
    const c=customerMap.get(cid); if(!c||c.active===false)return;
    const bal=round(customerBalance(s,cid));
    const notes=(notesByCustomer.get(cid)||[]).slice().sort((a,b)=>String(a.dueDate).localeCompare(String(b.dueDate)));
    const openNotes=notes.filter(n=>!['paid','cancelled'].includes(String(n.status||'open')));
    const paidNotes=notes.filter(n=>n.status==='paid');
    const overdueNotes=openNotes.filter(n=>String(n.dueDate||'')<today);
    const dueMonthNotes=openNotes.filter(n=>String(n.dueDate||'').slice(0,7)===month);
    const openInstallment=round(openNotes.reduce((a,n)=>a+Math.max(0,Number(n.amount||0)-Number(n.paidAmount||0)),0));
    const overdueAmount=round(overdueNotes.reduce((a,n)=>a+Math.max(0,Number(n.amount||0)-Number(n.paidAmount||0)),0));
    const dueMonthAmount=round(dueMonthNotes.reduce((a,n)=>a+Math.max(0,Number(n.amount||0)-Number(n.paidAmount||0)),0));
    const nextDue=openNotes[0]?.dueDate||'';
    let bucket='paid';
    if(overdueAmount>0.009)bucket='overdue';
    else if(dueMonthAmount>0.009||(bal>0.009&&dueMonthNotes.length))bucket='due';
    else if(bal>0.009||openInstallment>0.009)bucket='open';
    rows.push({
      customerId:cid,customerName:c.name||'',customerPhone:c.phone||'',
      balance:bal,openInstallment,overdueAmount,dueMonthAmount,
      openCount:openNotes.length,overdueCount:overdueNotes.length,paidCount:paidNotes.length,
      nextDue,bucket,
      notes:notes.map(n=>({
        id:n.id,serial:n.serial||'',planId:n.planId||'',saleReference:n.saleReference||'',
        amount:round(n.amount),paidAmount:round(n.paidAmount||0),
        remain:round(Math.max(0,Number(n.amount||0)-Number(n.paidAmount||0))),
        dueDate:n.dueDate||'',status:n.status||'open',
        overdue:String(n.status||'open')!=='paid'&&String(n.dueDate||'')<today
      }))
    });
  };
  for(const cid of notesByCustomer.keys())pushCustomer(cid);
  for(const c of (s.customers||[])){
    if(c.active===false)continue;
    const bal=customerBalance(s,c.id);
    if(bal>0.009)pushCustomer(String(c.id));
  }
  const term=String(q||'').trim().toLocaleLowerCase('tr-TR');
  let out=rows;
  if(term)out=out.filter(r=>`${r.customerName} ${r.customerPhone}`.toLocaleLowerCase('tr-TR').includes(term));
  if(filter==='overdue')out=out.filter(r=>r.bucket==='overdue');
  else if(filter==='due')out=out.filter(r=>r.bucket==='due'||r.bucket==='overdue');
  else if(filter==='open')out=out.filter(r=>r.balance>0.009||r.openInstallment>0.009);
  else if(filter==='paid')out=out.filter(r=>r.bucket==='paid'&&r.paidCount>0);
  out.sort((a,b)=>{
    const rank={overdue:0,due:1,open:2,paid:3};
    const d=(rank[a.bucket]??9)-(rank[b.bucket]??9);
    if(d)return d;
    return String(a.nextDue||'9999').localeCompare(String(b.nextDue||'9999'))||b.balance-a.balance;
  });
  const recentPaid=(s.financeTransactions||[])
    .filter(t=>t.kind==='collection'&&!t.cancelled)
    .sort((a,b)=>String(b.createdAt||b.date).localeCompare(String(a.createdAt||a.date)))
    .slice(0,40)
    .map(t=>({
      id:t.id,date:t.date,amount:Number(t.amount||0),
      customerId:t.customerId||'',
      customerName:customerMap.get(String(t.customerId||''))?.name||'',
      method:t.category||'',reference:t.reference||'',
      receiptUrl:`/web-api/admin/receipt/${t.id}?size=a5`,
      description:t.description||''
    }));
  const summary={
    overdueCustomers:rows.filter(r=>r.bucket==='overdue').length,
    overdueAmount:round(rows.reduce((a,r)=>a+r.overdueAmount,0)),
    dueMonthCustomers:rows.filter(r=>r.dueMonthAmount>0.009).length,
    dueMonthAmount:round(rows.reduce((a,r)=>a+r.dueMonthAmount,0)),
    openBalance:round(rows.reduce((a,r)=>a+Math.max(0,r.balance),0)),
    openCustomers:rows.filter(r=>r.balance>0.009||r.openInstallment>0.009).length
  };
  return{ok:true,filter,summary,rows:out,recentPaid,accounts:(s.financeAccounts||[]).filter(a=>a.active!==false)};
}

app.get('/web-api/admin/customer-payments-board',requireAdminOrStaffAny('finance_manage','finance_view','orders_manage','customers_manage'),(req,res)=>{
  const s=readStore();
  res.json(buildCustomerPaymentsBoard(s,{filter:String(req.query.filter||'open'),q:String(req.query.q||'')}));
});

app.get('/web-api/admin/customer-detail/:id',requireAdminOrStaffAny('finance_manage','finance_view','orders_manage','customers_manage'),(req,res)=>{
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
  const pendingDelete=(s.cancellationRequests||[]).find(r=>r.status==='pending'&&r.targetType==='customer_delete'&&String(r.targetId)===String(customer.id))||null;
  res.json({
    customer:{...customer,balance:customerBalance(s,customer.id)},
    transactions,
    pendingEdit,
    pendingDelete,
    canManage:isSystemManager(req),
    accounts:s.financeAccounts.filter(x=>x.active!==false).map(x=>({...x,balance:accountBalance(s,x.id)})),
    products:(s.products||[]).filter(x=>x.active!==false).map(x=>({code:x.code,name:x.name,price:Number(x.cashPrice||x.salePrice||x.price||0),cardPrice:Number(x.cardPrice||x.cashPrice||x.salePrice||0),brand:x.brand||''})),
    warehouses:(s.warehouses||[]).filter(x=>x.active!==false),
    promissoryNotes:(s.promissoryNotes||[])
      .filter(n=>n.customerId===customer.id)
      .sort((a,b)=>String(a.dueDate).localeCompare(String(b.dueDate)))
      .map(n=>enrichPromissoryNote(s,n)),
    orphanNotesCount:(s.promissoryNotes||[]).filter(n=>n.customerId===customer.id&&!['paid','cancelled'].includes(String(n.status||'open'))&&!n.saleId&&!n.saleReference).length
  });
});

app.post('/web-api/admin/customer/:id/delete-request',requireAdminOrStaff('customers_manage'),(req,res)=>{
  const s=readStore(),customer=(s.customers||[]).find(c=>String(c.id)===String(req.params.id));
  if(!customer)return res.status(404).json({error:'Müşteri bulunamadı'});
  if(customer.active===false||customer.deletedAt)return res.status(400).json({error:'Müşteri zaten pasif / silinmiş'});
  const reason=String(req.body?.reason||'').trim();
  if(!reason||reason.length<3)return res.status(400).json({error:'Silme sebebi zorunludur (en az 3 karakter). Yönetici bu sebebi görür.'});
  if(!Array.isArray(s.cancellationRequests))s.cancellationRequests=[];
  if(s.cancellationRequests.some(r=>r.status==='pending'&&r.targetType==='customer_delete'&&String(r.targetId)===String(customer.id)))
    return res.status(409).json({error:'Bu müşteri için bekleyen silme onayı var'});
  if(s.cancellationRequests.some(r=>r.status==='pending'&&r.targetType==='customer_edit'&&String(r.targetId)===String(customer.id)))
    return res.status(409).json({error:'Bekleyen düzenleme onayı varken silme talebi açılamaz'});
  const u=currentSessionUser(req)||currentActor(req);
  const bal=customerBalance(s,customer.id);
  const row={
    id:crypto.randomUUID(),
    targetType:'customer_delete',
    targetId:String(customer.id),
    targetReference:customer.name||customer.id,
    reason,
    status:'pending',
    requestedById:u?.id||'',
    requestedByName:u?.name||'Personel',
    requestedAt:new Date().toISOString(),
    reviewedBy:'',reviewedAt:'',reviewNote:'',
    managerAlert:true,
    payload:{
      before:customerSnapshot(customer),
      balance:bal,
      phone:customer.phone||'',
      tckn:customer.tckn||'',
      companyName:customer.companyName||''
    }
  };
  s.cancellationRequests.unshift(row);
  audit(s,'Müşteri silme onayı istendi',customer.name,{reason,personel:row.requestedByName,balance:bal});
  writeStore(s);
  res.json({
    ok:true,pendingApproval:true,row,
    message:'Silme talebi yöneticiye gönderildi. Onaylanmadan müşteri silinmez.'
  });
});


function saleNeedsInvoice(status){
  const st=String(status||'pending').toLowerCase();
  return st==='pending'||st==='queued'||st==='queue_qnb';
}
function normalizeSaleInvoiceStatus(raw){
  const st=String(raw||'not_required').toLowerCase().trim();
  if(st==='issued')return 'issued';
  if(st==='pending'||st==='queued'||st==='queue_qnb')return 'pending';
  return 'not_required';
}
app.get('/web-api/admin/uninvoiced-sales',requireAdminOrStaffAny('screen_uninvoiced','invoices_manage','finance_manage'),(req,res)=>{
  const s=readStore();
  const customerMap=new Map((s.customers||[]).map(c=>[String(c.id),c]));
  const actor=currentActor(req);
  const canAll=actorIsManager(req)||!isStaffPortalReq(req);
  let rows=(s.financeTransactions||[])
    .filter(t=>t.kind==='sale' && !t.cancelled && saleNeedsInvoice(t.invoiceStatus));
  if(!canAll)rows=rows.filter(t=>txBelongsToActor(t,actor));
  rows=rows.map(t=>({
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
app.post('/web-api/admin/sale/:id/mark-no-invoice',requireAdmin,(req,res)=>{
  const s=readStore();
  const sale=(s.financeTransactions||[]).find(t=>String(t.id)===String(req.params.id)&&t.kind==='sale');
  if(!sale)return res.status(404).json({error:'Satış bulunamadı'});
  sale.invoiceStatus='not_required';
  sale.invoiceNumber='';
  sale.invoiceDate='';
  sale.invoiceIssuedAt='';
  const iq=(s.invoiceQueue||[]).find(r=>r.saleId===sale.id);
  if(iq){iq.status='not_required';iq.updatedAt=new Date().toISOString()}
  audit(s,'Satış fatura gerekmiyor',sale.reference||sale.id,{});
  writeStore(s);
  res.json({ok:true,sale});
});

app.post('/web-api/admin/customer-sale',requireAdminOrStaff('orders_manage'),(req,res)=>{
  const s=readStore(),x=req.body||{};
  const actor=currentActor(req);
  // Personel portalundan gelen satışta satıcı boşsa oturumdaki kişi yazılır
  if(isStaffPortalReq(req) && actor){
    if(!String(x.salespersonId||'').trim())x.salespersonId=actor.id;
    if(!String(x.salespersonName||'').trim())x.salespersonName=actor.name;
  }else if(!actorIsManager(req) && actor){
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
    // Maliyet ve KDV satış anında sabitlenir; ürün kartı sonradan değişse geçmiş kâr bozulmaz
    const unitCost=normalizeNumber(product?.purchasePrice||0);
    const vatRate=Number(product?.vatRate!=null?product.vatRate:20)||20;
    return{
      productCode,itemCode,materialCode,productName:materialCode,
      brand:String(i.brand||product?.brand||'').trim(),
      quantity:qty,unitPrice,total:qty*unitPrice,
      vatRate,
      unitCost,
      costTotal:Math.round(qty*unitCost*100)/100,
      costMissing:unitCost<=0
    };
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

  let stockMode=String(x.stockMode||'').toLowerCase().trim();
  if(!stockMode){
    if(x.reserveStock===true||String(x.reserveStock)==='true')stockMode='reserve';
    else if(x.deductStock===true||String(x.deductStock)==='true')stockMode='deduct';
    else stockMode='none';
  }
  if(stockMode==='yes')stockMode='deduct';
  if(!['none','reserve','deduct'].includes(stockMode))stockMode='none';
  const deductStock=stockMode==='deduct';
  const reserveStock=stockMode==='reserve';
  const warehouseId=String(x.warehouseId||'');
  if(isStaffPortalReq(req) && deductStock && !staffCanDeductStock(req)){
    return res.status(403).json({error:'Stok düşme yetkiniz yok — yöneticiden “Satışta stok düş” yetkisini açın'});
  }
  const invWant=String(x.invoiceStatus||'').toLowerCase().trim();
  if(isStaffPortalReq(req) && (invWant==='queue_qnb'||invWant==='issued') && !staffCanInvoice(req)){
    return res.status(403).json({error:'Fatura kesme yetkiniz yok — yöneticiden “Fatura kes (QNB)” yetkisini açın'});
  }
  if(deductStock||reserveStock){
    if(!warehouseId)return res.status(400).json({error:reserveStock?'Rezerve etmek için satış deposu seçilmelidir':'Stoktan düşmek için satış deposu seçilmelidir'});
    if(!s.warehouses.some(w=>w.id===warehouseId&&w.active!==false))return res.status(400).json({error:'Geçerli satış deposu seçilmelidir'});
    for(const item of cleanItems){
      const available=availableStockQty(s,item.productCode,warehouseId);
      if(available<item.quantity)return res.status(400).json({error:`${item.productCode} için seçilen depoda yalnızca ${Math.max(0,available)} adet satılabilir stok var`});
    }
  }
  const ref=`SAT-${Date.now()}`;
  const actorName=actor?.name||currentActor(req)?.name||'Admin';
  const actorId=actor?.id||currentActor(req)?.id||'';
  const sale=financeTx(s,{
    date:x.date,kind:'sale',accountId:'',customerId:customer.id,amount:0,customerDelta:total,
    category:'Ürün Satışı',description:String(x.description||'Müşteri satışı'),reference:ref,
    createdBy:actorName,createdById:actorId
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
  sale.warehouseId=(deductStock||reserveStock)?warehouseId:'';
  sale.deductStock=deductStock;
  sale.reserveStock=reserveStock;
  sale.stockMode=stockMode;
  sale.invoiceStatus=normalizeSaleInvoiceStatus(x.invoiceStatus);
  sale.invoiceNumber=sale.invoiceStatus==='issued'?String(x.invoiceNumber||'').trim():'';
  sale.invoiceDate=sale.invoiceStatus==='issued'?String(x.invoiceDate||x.date||''):'';
  sale.invoiceIssuedAt=sale.invoiceStatus==='issued'?new Date().toISOString():'';
  // Kurumsal bilgisi varsa varsayılan kurumsal; aksi halde bireysel
  const hasCorp=customerHasCorporateBilling(customer);
  const billingRaw=String(x.billingParty||'').trim();
  let billingPartyPrefer=billingRaw==='corporate'?'corporate':billingRaw==='individual'?'individual':(hasCorp&&String(customer.invoiceType||'')==='corporate'?'corporate':'individual');
  if(billingPartyPrefer==='corporate'&&!hasCorp){
    return res.status(400).json({error:'Kurumsal fatura seçildi ancak müşteride firma / VKN bilgisi yok. Müşteri kartına kurumsal bilgileri ekleyin.'});
  }
  // Kurumsal müşteride seçim yoksa otomatik kurumsal
  if(!billingRaw && hasCorp)billingPartyPrefer='corporate';
  sale.billingParty=billingPartyPrefer;
  const invoiceParty=resolveCustomerInvoiceParty(customer,billingPartyPrefer);
  sale.invoicePartyType=invoiceParty.partyType;
  sale.invoicePartyName=invoiceParty.name;
  const invCfg=s.invoiceIntegration||{};
  if(saleNeedsInvoice(sale.invoiceStatus)||sale.invoiceStatus==='issued'){
    const docTypeHint=qnbSolist.detectDocumentType(invoiceParty,invCfg);
    const alloc=allocateInvoiceNumber(invCfg,docTypeHint,sale.invoiceNumber||'');
    s.invoiceIntegration=invCfg;
    sale.invoiceNumber=alloc.number;
    sale.invoiceType=docTypeHint;
    const invoiceRecord={id:crypto.randomUUID(),saleId:sale.id,reference:ref,customerId:customer.id,customer:{name:invoiceParty.name,phone:invoiceParty.phone,email:invoiceParty.email,taxNumber:invoiceParty.taxNumber,taxNo:invoiceParty.taxNo,tckn:invoiceParty.tckn,taxOffice:invoiceParty.taxOffice,companyName:invoiceParty.companyName,invoiceType:invoiceParty.invoiceType,address:invoiceParty.address,city:invoiceParty.city,district:invoiceParty.district},items:cleanItems.map(i=>({...i,vatRate:Number((s.products||[]).find(p=>String(p.code)===String(i.productCode))?.vatRate||20)})),total,status:sale.invoiceStatus==='issued'?'issued':'pending',invoiceType:'auto',docType:docTypeHint,provider:invCfg.provider||'qnb-solist',providerDocumentId:'',uuid:crypto.randomUUID(),invoiceNumber:alloc.number,invoiceDate:sale.invoiceDate||'',error:'',ublXml:'',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
    s.invoiceQueue.push(invoiceRecord);
    sale.invoiceQueueId=invoiceRecord.id;
  }else{
    sale.invoiceQueueId='';
  }

  if(deductStock){
    for(const item of cleanItems){
      addStockMovement(s,{productCode:item.productCode,warehouseId,type:'sale',quantity:-item.quantity,reference:ref,note:`${customer.name} satışı`,user:currentActor(req)?.name||'Admin'});
    }
  }else if(reserveStock){
    for(const item of cleanItems){
      adjustReserved(s,{
        productCode:item.productCode,warehouseId,quantity:item.quantity,type:'reserve',
        reference:ref,note:`${customer.name} satışı · rezerv`,user:currentActor(req)?.name||'Admin'
      });
    }
  }
  const collections=[];
  for(const p of normalizedPayments){
    if(!['Nakit','Kredi Kartı','Havale'].includes(p.method))continue;
    const collection=financeTx(s,{
      date:x.date,kind:'collection',accountId:p.accountId,customerId:customer.id,amount:p.amount,customerDelta:-p.amount,
      category:p.method,description:`${ref} satış tahsilatı · ${p.method}`,reference:`TAH-${Date.now()}-${collections.length+1}`,
      createdBy:actorName,createdById:actorId
    });
    collection.salespersonId=salesperson.id;
    collection.salespersonName=salesperson.name;
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

  // Senet kefili: yalnızca istemci açıkça gönderdiyse satışa yaz (müşteri kartından otomatik doldurulmaz)
  try{
    const g=parseGuarantorPayload(x.guarantor);
    if(g)sale.guarantor=g;
  }catch(err){return res.status(400).json({error:err.message||'Kefil bilgisi geçersiz'})}

  audit(s,'Müşteriye satış yapıldı',customer.name,{total,grossTotal,discountPct,dealer:dealer.name,salesperson:salesperson.name,commissionAmount,paid,payments:sale.payments,promissoryAmount,ref,items:cleanItems.length,hasGuarantor:Boolean(sale.guarantor)});
  writeStore(s);
  res.json({
    ok:true,sale,collections,collection:collections[0]||null,promissory:promissoryResult,
    docsUrl:`/web-api/admin/sale/${sale.id}/print-docs`,
    balance:customerBalance(s,customer.id)
  });
});

app.post('/web-api/admin/customer-collection',requireAdminOrStaffAny('finance_manage','orders_manage','customers_manage'),(req,res)=>{
  const s=readStore(),x=req.body||{},customer=s.customers.find(c=>c.id===x.customerId);
  if(!customer)return res.status(404).json({error:'Müşteri bulunamadı'});
  const amount=cleanMoney(x.amount);
  if(!amount)return res.status(400).json({error:'Tahsilat tutarı zorunludur'});
  if(!x.accountId)return res.status(400).json({error:'Kasa veya banka seçilmelidir'});
  if(!s.financeAccounts.some(a=>a.id===x.accountId&&a.active!==false))return res.status(400).json({error:'Geçersiz kasa/banka'});
  const method=String(x.paymentMethod||'Nakit').trim()||'Nakit';
  const desc=String(x.description||`Aylık ödeme tahsilatı · ${method}`).slice(0,500);
  const row=financeTx(s,{
    date:x.date||todayISO(),kind:'collection',accountId:String(x.accountId),customerId:customer.id,amount,customerDelta:-amount,
    category:method,description:desc,reference:`TAH-${Date.now()}`,createdBy:currentActor(req)?.name||'Personel'
  });
  row.paymentFor='customer_installment';
  // Seçili senetlere veya FIFO açık taksitlere uygula
  let allocation;
  if(Array.isArray(x.noteIds)&&x.noteIds.length){
    let left=amount;
    const updated=[];
    for(const nid of x.noteIds.map(String)){
      if(left<=0.009)break;
      const n=(s.promissoryNotes||[]).find(nn=>String(nn.id)===nid&&String(nn.customerId)===String(customer.id));
      if(!n||n.status==='paid')continue;
      const noteAmt=Number(n.amount||0),already=Number(n.paidAmount||0),remain=Math.max(0,noteAmt-already);
      const pay=Math.min(left,remain);
      n.paidAmount=Math.round((already+pay)*100)/100;
      n.paidAt=new Date().toISOString();
      n.lastCollectionId=row.id;
      n.status=n.paidAmount>=noteAmt-0.009?'paid':'partial';
      left=Math.round((left-pay)*100)/100;
      updated.push({id:n.id,serial:n.serial,dueDate:n.dueDate,amount:noteAmt,paidAmount:n.paidAmount,status:n.status,applied:pay});
    }
    allocation={updated,remaining:left};
  }else{
    allocation=applyPaymentToNotes(s,customer.id,amount,row.id);
  }
  row.appliedNotes=allocation.updated;
  audit(s,'Müşteri tahsilatı',customer.name,{amount,accountId:x.accountId,method,notes:allocation.updated.length});
  writeStore(s);
  res.json({
    ok:true,row,
    balance:customerBalance(s,customer.id),
    appliedNotes:allocation.updated,
    receiptUrl:`/web-api/admin/receipt/${row.id}?size=a5`
  });
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
function noteRemaining(n){
  return Math.max(0,Math.round((Number(n.amount||0)-Number(n.paidAmount||0))*100)/100);
}
function cancelPromissoryNoteInStore(n,actor,reason=''){
  if(!n||['paid','cancelled'].includes(String(n.status||'')))return false;
  n.status='cancelled';
  n.cancelledAt=new Date().toISOString();
  n.cancelledBy=actor||'';
  n.cancelReason=String(reason||'').slice(0,500);
  return true;
}
function linkedPromissoryNotes(s,sale){
  if(!sale)return[];
  const saleId=String(sale.id||'');
  const planId=String(sale.promissoryPlanId||'');
  return(s.promissoryNotes||[]).filter(n=>
    (saleId&&String(n.saleId||'')===saleId)||
    (planId&&String(n.planId||'')===planId)||
    (sale.reference&&String(n.saleReference||'')===String(sale.reference))
  );
}
function cancelPromissoryNotesForSale(s,sale,actor,reason=''){
  let count=0;
  for(const n of linkedPromissoryNotes(s,sale)){
    if(cancelPromissoryNoteInStore(n,actor,reason||`Satış iptali ${sale.reference||sale.id||''}`))count++;
  }
  return count;
}
function enrichPromissoryNote(s,n){
  const sale=(s.financeTransactions||[]).find(t=>t.kind==='sale'&&(
    String(t.id)===String(n.saleId||'')||
    (n.planId&&String(t.promissoryPlanId||'')===String(n.planId))||
    (n.saleReference&&String(t.reference||'')===String(n.saleReference))
  ));
  const remain=noteRemaining(n);
  const orphan=!n.saleId&&!n.saleReference&&!(sale&&sale.id);
  return{
    ...n,
    remain,
    paidAmount:Number(n.paidAmount||0),
    orphan,
    saleId:n.saleId||sale?.id||'',
    saleReference:n.saleReference||sale?.reference||'',
    saleCancelled:Boolean(sale?.cancelled),
    saleTotal:sale?Number(sale.total||0):null,
    linkLabel:orphan?'Satışa bağlı değil':(sale?.cancelled?`Satış iptal · ${sale.reference||''}`:(n.saleReference||sale?.reference||'Satışa bağlı'))
  };
}
function cancelSaleInStore(s,sale,actor,reason=''){
  if(!sale||sale.kind!=='sale')throw new Error('Satış bulunamadı');
  if(sale.cancelled)return {already:true};
  const related=relatedSaleCollections(s,sale);
  related.forEach(c=>cancelCollectionInStore(s,c,actor,`Satış iptali: ${reason}`));
  const notesCancelled=cancelPromissoryNotesForSale(s,sale,actor,`Satış iptali: ${reason}`);
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
  }else if(sale.reserveStock&&sale.warehouseId){
    (sale.items||[]).forEach(item=>adjustReserved(s,{
      productCode:item.productCode,warehouseId:sale.warehouseId,quantity:-Number(item.quantity||0),
      type:'reserve_release',reference:reversal.reference,note:`${sale.reference||''} rezerv iptal`,user:actor
    }));
  }
  sale.cancelled=true;sale.cancelledAt=new Date().toISOString();sale.cancelledBy=actor;sale.cancelReason=reason;
  sale.commissionCancelled=true;sale.cancelledCommissionAmount=Number(sale.commissionAmount||0);
  const iq=(s.invoiceQueue||[]).find(x=>String(x.saleId)===String(sale.id));
  if(iq&&iq.status!=='issued'){iq.status='cancelled';iq.error='Satış iptal edildi';iq.updatedAt=new Date().toISOString()}
  return {already:false,linkedCollections:related.length,notesCancelled,stockRestored:Boolean((sale.deductStock||sale.reserveStock)&&sale.warehouseId)};
}
function normalizeSaleEditItems(s,items){
  const clean=(Array.isArray(items)?items:[]).filter(i=>String(i.productCode||'').trim()&&Number(i.quantity)>0).map(i=>{
    const qty=Math.max(1,Math.round(Number(i.quantity)||1));
    const unitPrice=cleanMoney(i.unitPrice);
    const productCode=String(i.productCode||'').trim();
    const product=(s.products||[]).find(p=>String(p.code)===productCode);
    const itemCode=String(i.itemCode||product?.itemCode||'').trim();
    const materialCode=String(i.materialCode||product?.searchName||product?.code||i.productName||productCode).trim();
    const unitCost=normalizeNumber(i.unitCost!=null?i.unitCost:(product?.purchasePrice||0));
    const vatRate=Number(i.vatRate!=null?i.vatRate:(product?.vatRate!=null?product.vatRate:20))||20;
    return{
      productCode,itemCode,materialCode,productName:materialCode,
      brand:String(i.brand||product?.brand||'').trim(),
      quantity:qty,unitPrice,total:Math.round(qty*unitPrice*100)/100,
      vatRate,
      unitCost,
      costTotal:Math.round(qty*unitCost*100)/100,
      costMissing:unitCost<=0
    };
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

  // Senet senkronu: düzenlemede senet tutarı değişince açık (ödenmemiş) senetleri güncelle
  const senetPay=Math.round(payments.filter(p=>/senet/i.test(String(p.method||''))).reduce((a,p)=>a+Number(p.amount||0),0)*100)/100;
  const linkedNotes=linkedPromissoryNotes(s,sale);
  let notesCancelled=0;
  for(const n of linkedNotes){
    if(String(n.status)==='paid')continue;
    if(cancelPromissoryNoteInStore(n,actor,`Satış düzenleme: ${reason}`))notesCancelled++;
  }
  if(senetPay>0.009){
    const settings=s.promissorySettings||{};
    const planId=sale.promissoryPlanId||crypto.randomUUID();
    const firstDue=linkedNotes.find(n=>n.dueDate)?.dueDate||new Date(Date.now()+Number(settings.firstDueDays||30)*86400000).toISOString().slice(0,10);
    const note={
      id:crypto.randomUUID(),planId,
      serial:`${settings.prefix||'ATAK'}-${Date.now().toString().slice(-8)}-01`,
      customerId:sale.customerId,saleId:sale.id,saleReference:sale.reference||'',
      amount:senetPay,dueDate:firstDue,issueDate:String(sale.date||todayISO()),
      status:'open',createdAt:new Date().toISOString(),
      description:`${sale.reference||''} satış senedi (düzenleme)`,source:'sale_edit'
    };
    s.promissoryNotes.push(note);
    sale.promissoryPlanId=planId;
    sale.promissoryAmount=senetPay;
  }else{
    sale.promissoryAmount=0;
  }

  const iq=(s.invoiceQueue||[]).find(x=>String(x.saleId)===String(sale.id));
  if(iq&&iq.status!=='issued'){
    iq.items=cleanItems.map(i=>({...i,vatRate:Number((s.products||[]).find(p=>String(p.code)===String(i.productCode))?.vatRate||20)}));
    iq.total=total;iq.updatedAt=new Date().toISOString();
  }
  return {before,after:{items:cleanItems,grossTotal,discountPct,discountAmount,total,commissionAmount,payments,description:sale.description,promissoryAmount:sale.promissoryAmount||0},collections:collections.length,notesCancelled};
}



app.post('/web-api/admin/customer/:id/note',requireAdmin,(req,res)=>{
  const s=readStore(),row=(s.customers||[]).find(c=>String(c.id)===String(req.params.id));
  if(!row)return res.status(404).json({error:'Müşteri bulunamadı'});
  row.note=String(req.body?.note||'').slice(0,2000);row.updatedAt=new Date().toISOString();
  audit(s,'Müşteri notu güncellendi',row.name,{note:row.note});writeStore(s);
  res.json({ok:true,row:{...row,balance:customerBalance(s,row.id)}});
});


app.get('/web-api/admin/sales-tracking',requireAdminOrStaffAny('screen_sales_tracking','orders_manage','screen_sales_center'),(req,res)=>{
  const s=readStore();
  const customerMap=new Map((s.customers||[]).map(c=>[String(c.id),c]));
  const actor=currentActor(req);
  const canAll=actorCanSeeAllStaffSales(req)||!isStaffPortalReq(req);
  let rows=(s.financeTransactions||[]).filter(t=>t.kind==='sale'&&!t.cancelled);
  if(!canAll)rows=rows.filter(t=>txBelongsToActor(t,actor));
  rows=rows.map(t=>{
      const c=customerMap.get(String(t.customerId))||{};
      return {
        id:t.id,reference:t.reference||'',date:t.date||'',dealerId:t.dealerId||'',dealerName:t.dealerName||'',
        salespersonId:t.salespersonId||'',salespersonName:t.salespersonName||t.createdBy||'',
        customerId:t.customerId||'',customerName:c.name||'',customerPhone:c.phone||'',customerNote:c.note||'',
        total:saleAmount(t),items:t.items||[],deliveryStatus:t.deliveryStatus||'order_received',
        deliveryNote:t.deliveryNote||'',invoiceStatus:t.invoiceStatus||'pending',deductStock:Boolean(t.deductStock),
        warehouseId:t.warehouseId||'',createdAt:t.createdAt||''
      }
    })
    .sort((a,b)=>String(b.createdAt||b.date).localeCompare(String(a.createdAt||a.date)));
  res.json({ok:true,rows});
});
app.post('/web-api/admin/sale/:id/delivery-status',requireAdminOrStaffAny('screen_sales_tracking','orders_manage','screen_sales_center'),(req,res)=>{
  const s=readStore(),sale=(s.financeTransactions||[]).find(t=>String(t.id)===String(req.params.id)&&t.kind==='sale');
  if(!sale)return res.status(404).json({error:'Satış bulunamadı'});
  if(sale.cancelled)return res.status(400).json({error:'İptal edilmiş satış güncellenemez'});
  if(isStaffPortalReq(req) && !actorCanSeeAllStaffSales(req) && !txBelongsToActor(sale,currentActor(req))){
    return res.status(403).json({error:'Bu satış için yetkiniz yok'});
  }
  const allowed=['order_received','preparing','ready','shipped','delivered'];
  const status=String(req.body?.status||'');
  if(!allowed.includes(status))return res.status(400).json({error:'Geçersiz teslimat durumu'});
  const prev=sale.deliveryStatus||'order_received';
  sale.deliveryStatus=status;sale.deliveryNote=String(req.body?.note||sale.deliveryNote||'').slice(0,1000);sale.deliveryUpdatedAt=new Date().toISOString();
  // Rezerve satış teslim edilince fiziksel stoktan düş
  if(status==='delivered'&&prev!=='delivered'&&sale.reserveStock&&sale.warehouseId&&!sale.deductStock&&!sale.stockConsumedAt){
    const actor=currentActor(req)?.name||'Admin';
    for(const item of (sale.items||[])){
      consumeReservedToSale(s,{
        productCode:item.productCode,warehouseId:sale.warehouseId,quantity:Number(item.quantity||0),
        reference:sale.reference||sale.id,note:`${sale.reference||''} teslim · rezerv düşüldü`,user:actor
      });
    }
    sale.deductStock=true;
    sale.stockMode='deduct';
    sale.stockConsumedAt=new Date().toISOString();
  }
  audit(s,'Satış teslimat durumu güncellendi',sale.reference||sale.id,{status,note:sale.deliveryNote,prev});writeStore(s);
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
  let all=(s.financeTransactions||[]).filter(t=>{
    if(t.kind!=='sale')return false;
    const key=txDateKey(t);
    return key && key>=from && key<=to;
  });
  if(!canManage){
    all=all.filter(t=>txBelongsToActor(t,u)||String(t.salespersonId||'')===String(u?.id||''));
  }else if(salespersonId){
    all=all.filter(t=>String(t.salespersonId||'')===salespersonId||txBelongsToActor(t,{id:salespersonId,name:''}));
  }
  if(dealerId)all=all.filter(t=>String(t.dealerId||'')===dealerId);

  const byPerson=new Map();
  const brand={beko:0,istikbal:0,other:0,bekoCount:0,istikbalCount:0,otherCount:0};
  let gross=0,grossCount=0,net=0,netCount=0,cancelled=0,cancelledCount=0,discount=0,commission=0,primLost=0;
  for(const t of all){
    const amount=saleAmount(t);
    const g=Number(t.grossTotal!=null && t.grossTotal!==''?t.grossTotal:amount)||0;
    const comm=Number(t.commissionAmount||0);
    const bKey=dealerBrandKey(t);
    const pid=String(t.salespersonId||t.salespersonName||t.createdBy||'unknown');
    const pname=String(t.salespersonName||t.createdBy||'Personel');
    if(!byPerson.has(pid))byPerson.set(pid,{id:pid,name:pname,gross:0,net:0,count:0,cancelled:0,cancelledCount:0,commission:0,primLost:0,discount:0,beko:0,istikbal:0,other:0});
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
      brand[bKey]=(brand[bKey]||0)+amount;
      brand[bKey+'Count']=(brand[bKey+'Count']||0)+1;
      row[bKey]=(row[bKey]||0)+amount;
    }
  }
  const ranking=[...byPerson.values()].map(x=>({
    ...x,
    gross:round(x.gross),net:round(x.net),cancelled:round(x.cancelled),
    commission:round(x.commission),primLost:round(x.primLost),discount:round(x.discount),
    beko:round(x.beko),istikbal:round(x.istikbal),other:round(x.other)
  })).sort((a,b)=>b.net-a.net||b.count-a.count||a.name.localeCompare(b.name,'tr'));

  const pendingByTarget=new Map();
  (s.cancellationRequests||[]).filter(r=>r.status==='pending').forEach(r=>pendingByTarget.set(`${r.targetType}:${r.targetId}`,r));
  const rows=all.filter(t=>!t.cancelled).map(t=>{
    const c=customerMap.get(String(t.customerId));
    const pendCancel=pendingByTarget.get(`sale:${t.id}`);
    const pendEdit=pendingByTarget.get(`sale_edit:${t.id}`);
    return{
      id:t.id,date:t.date,reference:t.reference||'',dealerId:t.dealerId||'',dealerName:t.dealerName||'',
      brand:dealerBrandKey(t),
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
      primLost:round(primLost),
      beko:round(brand.beko),
      istikbal:round(brand.istikbal),
      other:round(brand.other),
      bekoCount:brand.bekoCount||0,
      istikbalCount:brand.istikbalCount||0,
      otherCount:brand.otherCount||0
    },
    brand:{
      beko:{amount:round(brand.beko),orderCount:brand.bekoCount||0},
      istikbal:{amount:round(brand.istikbal),orderCount:brand.istikbalCount||0},
      other:{amount:round(brand.other),orderCount:brand.otherCount||0}
    },
    ranking,
    rows,
    people:salesPeople(s,req)
  };
}
/**
 * Bir satışın maliyet ve kâr dökümü.
 * Fiyatlar ve alış maliyeti KDV dahil tutulduğu için kâr KDV hariç hesaplanır.
 * İskonto kalemlere oransal dağıtılır; maliyeti girilmemiş kalemler ayrıca sayılır.
 */
function saleProfitBreakdown(s,tx){
  const round=n=>Math.round(Number(n||0)*100)/100;
  const items=Array.isArray(tx.items)?tx.items:[];
  const productByCode=new Map((s.products||[]).map(p=>[String(p.code),p]));
  const gross=Number(tx.grossTotal!=null&&tx.grossTotal!==''?tx.grossTotal:saleAmount(tx))||0;
  const net=saleAmount(tx);
  const factor=gross>0?net/gross:1;

  let revenueExVat=0,costExVat=0,vatAmount=0,itemRevenue=0;
  let missingCostCount=0,missingCostRevenue=0,estimatedCostCount=0;

  for(const it of items){
    const qty=Number(it.quantity||0);
    const lineGross=Number(it.total!=null?it.total:qty*Number(it.unitPrice||0))||0;
    const lineRevenue=round(lineGross*factor);
    itemRevenue+=lineRevenue;

    const product=productByCode.get(String(it.productCode||''));
    const vatRate=Number(it.vatRate!=null?it.vatRate:(product?.vatRate!=null?product.vatRate:20))||20;

    // Eski satışlarda maliyet yoksa ürün kartından tahmin et (işaretlenir)
    let unitCost=Number(it.unitCost||0);
    if(!(unitCost>0)&&it.unitCost==null){
      const fallback=normalizeNumber(product?.purchasePrice||0);
      if(fallback>0){unitCost=fallback;estimatedCostCount+=1}
    }
    const lineCost=unitCost>0?round(qty*unitCost):0;

    const lineRevenueExVat=round(lineRevenue/(1+vatRate/100));
    const lineCostExVat=round(lineCost/(1+vatRate/100));
    revenueExVat+=lineRevenueExVat;
    costExVat+=lineCostExVat;
    vatAmount+=round(lineRevenue-lineRevenueExVat);

    if(!(unitCost>0)){missingCostCount+=1;missingCostRevenue+=lineRevenue}
  }

  const commission=Number(tx.commissionAmount||0);
  const grossProfit=round(revenueExVat-costExVat);
  return{
    saleId:tx.id,
    date:txDateKey(tx),
    reference:tx.reference||'',
    brand:dealerBrandKey(tx),
    dealerName:tx.dealerName||'',
    salespersonName:tx.salespersonName||tx.createdBy||'',
    gross:round(gross),
    discount:round(gross-net),
    revenue:round(net),
    revenueExVat:round(revenueExVat),
    vatAmount:round(vatAmount),
    cost:round(costExVat),
    grossProfit,
    commission:round(commission),
    netProfit:round(grossProfit-commission),
    marginPct:revenueExVat>0?round(grossProfit/revenueExVat*100):0,
    itemCount:items.length,
    missingCostCount,
    missingCostRevenue:round(missingCostRevenue),
    estimatedCostCount,
    costReliable:missingCostCount===0
  };
}
/** Stok değerleme: eldeki stok × alış fiyatı (KDV hariç ve dahil) */
function inventoryValuation(s){
  const round=n=>Math.round(Number(n||0)*100)/100;
  const productByCode=new Map((s.products||[]).map(p=>[String(p.code).toLocaleUpperCase('tr-TR'),p]));
  const warehouseName=id=>(s.warehouses||[]).find(w=>String(w.id)===String(id))?.name||'Depo';
  let totalQty=0,valueIncVat=0,valueExVat=0,missingCostProducts=new Set(),missingCostQty=0;
  const byWarehouse=new Map();
  for(const row of (s.productStocks||[])){
    const qty=Number(row.quantity||0)-Number(row.reserved||0);
    if(qty<=0)continue;
    const p=productByCode.get(String(row.productCode||'').toLocaleUpperCase('tr-TR'));
    const cost=normalizeNumber(p?.purchasePrice||0);
    const vat=Number(p?.vatRate!=null?p.vatRate:20)||20;
    totalQty+=qty;
    if(!(cost>0)){missingCostProducts.add(String(row.productCode||''));missingCostQty+=qty;continue}
    const inc=round(qty*cost);
    const ex=round(inc/(1+vat/100));
    valueIncVat+=inc;valueExVat+=ex;
    const key=String(row.warehouseId||'');
    if(!byWarehouse.has(key))byWarehouse.set(key,{warehouseId:key,warehouseName:warehouseName(key),quantity:0,valueExVat:0});
    const w=byWarehouse.get(key);
    w.quantity+=qty;w.valueExVat=round(w.valueExVat+ex);
  }
  return{
    totalQuantity:totalQty,
    valueExVat:round(valueExVat),
    valueIncVat:round(valueIncVat),
    missingCostProducts:missingCostProducts.size,
    missingCostQuantity:missingCostQty,
    byWarehouse:[...byWarehouse.values()].sort((a,b)=>b.valueExVat-a.valueExVat)
  };
}
/** Kâr / maliyet raporu */
app.get('/web-api/admin/profit-report',requireAdmin,(req,res)=>{
  const s=readStore();
  const round=n=>Math.round(Number(n||0)*100)/100;
  const today=todayISO();
  const monthStart=`${today.slice(0,7)}-01`;
  const from=String(req.query.from||monthStart).slice(0,10);
  const to=String(req.query.to||today).slice(0,10);
  const dealerId=String(req.query.dealerId||'');

  const sales=(s.financeTransactions||[]).filter(t=>{
    if(t.kind!=='sale'||t.cancelled)return false;
    const key=txDateKey(t);
    if(!key||key<from||key>to)return false;
    if(dealerId&&String(t.dealerId||'')!==dealerId)return false;
    return true;
  });

  const blank=()=>({revenue:0,revenueExVat:0,cost:0,grossProfit:0,commission:0,netProfit:0,vatAmount:0,count:0});
  const sum={...blank(),gross:0,discount:0,missingCostCount:0,missingCostRevenue:0,estimatedCostCount:0};
  const byBrand={beko:blank(),istikbal:blank(),other:blank()};
  const byProduct=new Map();
  const rows=[];

  for(const t of sales){
    const b=saleProfitBreakdown(s,t);
    rows.push(b);
    sum.count+=1;
    sum.gross+=b.gross;sum.discount+=b.discount;
    sum.revenue+=b.revenue;sum.revenueExVat+=b.revenueExVat;sum.vatAmount+=b.vatAmount;
    sum.cost+=b.cost;sum.grossProfit+=b.grossProfit;
    sum.commission+=b.commission;sum.netProfit+=b.netProfit;
    sum.missingCostCount+=b.missingCostCount;
    sum.missingCostRevenue+=b.missingCostRevenue;
    sum.estimatedCostCount+=b.estimatedCostCount;

    const bucket=byBrand[b.brand]||byBrand.other;
    bucket.count+=1;bucket.revenue+=b.revenue;bucket.revenueExVat+=b.revenueExVat;
    bucket.cost+=b.cost;bucket.grossProfit+=b.grossProfit;
    bucket.commission+=b.commission;bucket.netProfit+=b.netProfit;bucket.vatAmount+=b.vatAmount;

    // Ürün bazında kâr
    const gross=b.gross>0?b.gross:1;
    const factor=b.revenue/gross;
    for(const it of (t.items||[])){
      const code=String(it.productCode||'-');
      if(!byProduct.has(code))byProduct.set(code,{productCode:code,productName:it.productName||it.materialCode||code,quantity:0,revenueExVat:0,cost:0,grossProfit:0,costMissing:false});
      const row=byProduct.get(code);
      const qty=Number(it.quantity||0);
      const lineRevenue=Number(it.total||0)*factor;
      const vat=Number(it.vatRate!=null?it.vatRate:20)||20;
      const unitCost=Number(it.unitCost||0);
      const lineRevEx=lineRevenue/(1+vat/100);
      const lineCostEx=unitCost>0?(qty*unitCost)/(1+vat/100):0;
      row.quantity+=qty;
      row.revenueExVat=round(row.revenueExVat+lineRevEx);
      row.cost=round(row.cost+lineCostEx);
      row.grossProfit=round(row.revenueExVat-row.cost);
      if(!(unitCost>0))row.costMissing=true;
    }
  }

  const finish=o=>({
    ...o,
    revenue:round(o.revenue),revenueExVat:round(o.revenueExVat),cost:round(o.cost),
    grossProfit:round(o.grossProfit),commission:round(o.commission),netProfit:round(o.netProfit),
    vatAmount:round(o.vatAmount),
    marginPct:o.revenueExVat>0?round(o.grossProfit/o.revenueExVat*100):0
  });

  res.json({
    ok:true,from,to,dealerId,
    summary:{
      ...finish(sum),
      gross:round(sum.gross),
      discount:round(sum.discount),
      missingCostCount:sum.missingCostCount,
      missingCostRevenue:round(sum.missingCostRevenue),
      estimatedCostCount:sum.estimatedCostCount,
      costReliable:sum.missingCostCount===0
    },
    byBrand:{beko:finish(byBrand.beko),istikbal:finish(byBrand.istikbal),other:finish(byBrand.other)},
    byProduct:[...byProduct.values()].sort((a,b)=>b.grossProfit-a.grossProfit).slice(0,25),
    rows:rows.sort((a,b)=>String(b.date).localeCompare(String(a.date))).slice(0,100),
    inventory:inventoryValuation(s),
    dealers:(s.dealerSettings||[]).map(d=>({id:d.id,name:d.name})),
    note:'Kâr KDV hariç hesaplanır. Maliyet, ürün kartındaki alış fiyatından satış anında sabitlenir.'
  });
});

/** Raporlar merkezi — tek ekranda satış / kâr / stok / katalog özeti */
app.get('/web-api/admin/reports-hub',requireAdmin,(req,res)=>{
  const s=readStore();
  const round=n=>Math.round(Number(n||0)*100)/100;
  const today=todayISO();
  const monthStart=`${today.slice(0,7)}-01`;
  const from=String(req.query.from||monthStart).slice(0,10);
  const to=String(req.query.to||today).slice(0,10);

  const sales=(s.financeTransactions||[]).filter(t=>{
    if(t.kind!=='sale'||t.cancelled)return false;
    const key=txDateKey(t);
    return key&&key>=from&&key<=to;
  });

  const blank=()=>({revenue:0,revenueExVat:0,cost:0,grossProfit:0,commission:0,netProfit:0,count:0});
  const sum={...blank(),missingCostCount:0};
  const byBrand={beko:blank(),istikbal:blank(),other:blank()};
  for(const t of sales){
    const b=saleProfitBreakdown(s,t);
    sum.count+=1;sum.revenue+=b.revenue;sum.revenueExVat+=b.revenueExVat;
    sum.cost+=b.cost;sum.grossProfit+=b.grossProfit;sum.commission+=b.commission;sum.netProfit+=b.netProfit;
    sum.missingCostCount+=b.missingCostCount;
    const bucket=byBrand[b.brand]||byBrand.other;
    bucket.count+=1;bucket.revenue+=b.revenue;bucket.revenueExVat+=b.revenueExVat;
    bucket.cost+=b.cost;bucket.grossProfit+=b.grossProfit;bucket.commission+=b.commission;bucket.netProfit+=b.netProfit;
  }
  const finish=o=>({
    ...o,
    revenue:round(o.revenue),revenueExVat:round(o.revenueExVat),cost:round(o.cost),
    grossProfit:round(o.grossProfit),commission:round(o.commission),netProfit:round(o.netProfit),
    marginPct:o.revenueExVat>0?round(o.grossProfit/o.revenueExVat*100):0
  });

  const cats=Object.fromEntries((s.categories||[]).map(c=>[c.id,c.name]));
  const products=s.products||[];
  const active=products.filter(p=>p.active!==false);
  const byCatMap=new Map();
  const brandCount={beko:0,istikbal:0,other:0};
  let missingPurchase=0;
  for(const p of active){
    const catId=p.category||'diger';
    if(!byCatMap.has(catId))byCatMap.set(catId,{id:catId,name:cats[catId]||catId,count:0,withCost:0});
    const row=byCatMap.get(catId);row.count+=1;
    if(normalizeNumber(p.purchasePrice)>0)row.withCost+=1; else missingPurchase+=1;
    const b=String(p.brand||'').toLocaleLowerCase('tr-TR');
    if(/istikbal/.test(b))brandCount.istikbal+=1;
    else if(/beko|grundig/.test(b))brandCount.beko+=1;
    else brandCount.other+=1;
  }

  const purchaseInvoices=(s.purchaseInvoices||[]).filter(x=>!x.reverted);
  const recentPurchases=purchaseInvoices
    .slice()
    .sort((a,b)=>String(b.date||b.createdAt||'').localeCompare(String(a.date||a.createdAt||'')))
    .slice(0,8)
    .map(x=>({
      id:x.id,date:x.date,supplierName:x.supplierName,invoiceNo:x.invoiceNo,
      total:x.total,created:x.created,priceUpdated:x.priceUpdated,itemCount:(x.items||[]).length
    }));

  res.json({
    ok:true,from,to,
    sales:finish(sum),
    byBrand:{beko:finish(byBrand.beko),istikbal:finish(byBrand.istikbal),other:finish(byBrand.other)},
    catalog:{
      total:products.length,
      active:active.length,
      missingPurchase,
      brandCount,
      byCategory:[...byCatMap.values()].sort((a,b)=>b.count-a.count).slice(0,12)
    },
    inventory:inventoryValuation(s),
    purchases:{count:purchaseInvoices.length,recent:recentPurchases},
    links:[
      {tab:'profitCenter',title:'Kâr & Maliyet',desc:'Bayi / ürün / satış kâr dökümü'},
      {tab:'staffSalesReport',title:'Personel Satış',desc:'Prim ve personel cirosu'},
      {tab:'revenue',title:'Ciro Kanalları',desc:'Beko / İstikbal / HB manuel + POS'},
      {tab:'purchaseInvoices',title:'Alış Faturaları',desc:'Maliyet ve stok aktarım geçmişi'},
      {tab:'stockCenter',title:'Stok & Depo',desc:'Depo bakiyeleri ve hareketler'}
    ]
  });
});

/** Dashboard kokpiti: tek istekte KPI + günlük seri + marka kırılımı + son satışlar */
app.get('/web-api/admin/dashboard-cockpit',requireAdmin,(req,res)=>{
  const s=readStore();
  const days=Math.min(90,Math.max(7,Math.round(Number(req.query.days)||14)));
  const round=n=>Math.round(Number(n||0)*100)/100;
  const today=todayISO();

  const dayKeys=[];
  for(let i=days-1;i>=0;i--){
    const d=new Date(`${today}T12:00:00`);
    d.setDate(d.getDate()-i);
    dayKeys.push(d.toISOString().slice(0,10));
  }
  const firstDay=dayKeys[0];
  const monthKey=today.slice(0,7);

  const blank=()=>({total:0,beko:0,istikbal:0,other:0,count:0});
  const series=new Map(dayKeys.map(k=>[k,{date:k,...blank()}]));
  const todayAgg={...blank(),commission:0};
  const monthAgg={...blank(),commission:0};

  const customerMap=new Map((s.customers||[]).map(c=>[String(c.id),c]));
  const recent=[];

  for(const t of (s.financeTransactions||[])){
    if(t.kind!=='sale'||t.cancelled)continue;
    const key=txDateKey(t);
    if(!key)continue;
    const amount=saleAmount(t);
    const brand=dealerBrandKey(t);
    const comm=Number(t.commissionAmount||0);

    if(key>=firstDay&&key<=today){
      const row=series.get(key);
      if(row){row.total+=amount;row[brand]+=amount;row.count+=1}
    }
    if(key.slice(0,7)===monthKey){
      monthAgg.total+=amount;monthAgg[brand]+=amount;monthAgg.count+=1;monthAgg.commission+=comm;
    }
    if(key===today){
      todayAgg.total+=amount;todayAgg[brand]+=amount;todayAgg.count+=1;todayAgg.commission+=comm;
    }
    recent.push({
      id:t.id,date:key,reference:t.reference||'',
      customerName:customerMap.get(String(t.customerId||''))?.name||'',
      salespersonName:t.salespersonName||t.createdBy||'',
      dealerName:t.dealerName||'',brand,
      total:round(amount),
      invoiceStatus:t.invoiceStatus||'not_required'
    });
  }
  recent.sort((a,b)=>String(b.date).localeCompare(String(a.date)));

  const fin=financeSnapshot(s);
  const pendingInvoices=(s.financeTransactions||[])
    .filter(t=>t.kind==='sale'&&!t.cancelled&&saleNeedsInvoice(t.invoiceStatus)).length;
  const overdueNotes=(s.promissoryNotes||[])
    .filter(n=>n.status==='open'&&String(n.dueDate||'')<today).length;
  const lowStock=(s.productStocks||[])
    .filter(x=>Number(x.quantity||0)-Number(x.reserved||0)<=0).length;

  const clean=o=>({total:round(o.total),beko:round(o.beko),istikbal:round(o.istikbal),other:round(o.other),count:o.count});

  res.json({
    ok:true,
    today:{...clean(todayAgg),commission:round(todayAgg.commission)},
    month:{...clean(monthAgg),commission:round(monthAgg.commission),label:monthKey},
    series:dayKeys.map(k=>clean(series.get(k))).map((v,i)=>({date:dayKeys[i],...v})),
    finance:{cash:round(fin.cash),bank:round(fin.bank),receivable:round(fin.receivable),todayExpense:round(fin.todayExpense)},
    alerts:{pendingInvoices,overdueNotes,lowStock},
    recent:recent.slice(0,8)
  });
});
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
    let all=(s.financeTransactions||[]).filter(t=>{
      if(t.kind!=='sale'||t.cancelled)return false;
      const key=txDateKey(t);
      return key && key>=from && key<=to;
    });
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
app.get('/web-api/admin/staff-sales-month',requireAdminOrStaffAny('finance_manage','finance_view','orders_manage','customers_manage','screen_my_sales','screen_staff_sales_report'),(req,res)=>{
  const s=readStore();
  const actor=currentActor(req);
  const canApprove=actorIsManager(req);
  const canManage=actorCanSeeAllStaffSales(req);
  const staffPortal=isStaffPortalReq(req);
  const {month,from,to}=monthBounds(req.query.month);
  const salespersonId=String(req.query.salespersonId||'');
  const customerMap=new Map((s.customers||[]).map(c=>[String(c.id),c]));
  let sales=(s.financeTransactions||[]).filter(t=>{
    if(t.kind!=='sale')return false;
    const key=txDateKey(t);
    return key && key>=from && key<=to;
  });
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
    sales=sales.filter(t=>String(t.salespersonId||'')===salespersonId||txBelongsToActor(t,{id:salespersonId,name:''}));
  }
  sales=sales.map(t=>({...t,date:txDateKey(t)||t.date,customerName:customerMap.get(String(t.customerId||''))?.name||''}));
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
    canApprove,
    staffPortal,
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
    const rejectLabel=row.targetType==='customer_edit'?'Müşteri düzenleme reddedildi'
      :row.targetType==='customer_delete'?'Müşteri silme reddedildi'
      :row.targetType==='sale_edit'?'Satış düzenleme reddedildi'
      :(row.requestKind==='return'||row.targetType==='sale_return')?'İade talebi reddedildi':'İptal talebi reddedildi';
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
  if(row.targetType==='customer_delete'){
    const customer=(s.customers||[]).find(c=>String(c.id)===String(row.targetId));
    if(!customer)return res.status(404).json({error:'Müşteri bulunamadı'});
    if(customer.active===false||customer.deletedAt){
      row.status='approved';row.reviewedBy=actor;row.reviewedAt=new Date().toISOString();row.reviewNote=note||'Zaten pasif';
      writeStore(s);return res.json({ok:true,row,alreadyDeleted:true});
    }
    customer.active=false;
    customer.deletedAt=new Date().toISOString();
    customer.deletedBy=actor;
    customer.deleteReason=row.reason||'';
    customer.updatedAt=new Date().toISOString();
    row.status='approved';row.reviewedBy=actor;row.reviewedAt=new Date().toISOString();row.reviewNote=note;
    audit(s,'Müşteri silme onaylandı',customer.name,{reason:row.reason,personel:row.requestedByName,balance:customerBalance(s,customer.id)});
    writeStore(s);
    return res.json({ok:true,row,customer:{...customer,balance:customerBalance(s,customer.id)}});
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

function normalizeInvoiceSeries(v,fallback){
  const s=String(v||'').toUpperCase().replace(/[^A-Z]/g,'').slice(0,3);
  return s.length===3?s:fallback;
}
function nextInvoiceSeq(n){
  const v=Math.round(Number(n)||1);
  return Math.min(999999999,Math.max(1,v));
}
/** GIB format: AAAYYYY######### — örn. ATK2026000000252 / ATA2026000000001 */
function formatGibInvoiceNumber(series,year,seq){
  return `${normalizeInvoiceSeries(series,'ATK')}${String(year)}${String(nextInvoiceSeq(seq)).padStart(9,'0')}`;
}
function allocateInvoiceNumber(cfg,docType,existing=''){
  if(String(existing||'').trim())return{number:String(existing).trim(),cfg,allocated:false};
  const year=new Date().getFullYear();
  const earsiv=String(docType||'').toLowerCase()==='earsiv';
  const series=earsiv
    ?normalizeInvoiceSeries(cfg.earsivSeries,'ATA')
    :normalizeInvoiceSeries(cfg.efaturaSeries,'ATK');
  const key=earsiv?'earsivNext':'efaturaNext';
  const seq=nextInvoiceSeq(cfg[key]);
  const number=formatGibInvoiceNumber(series,year,seq);
  cfg[key]=seq+1;
  if(earsiv)cfg.earsivSeries=series;else cfg.efaturaSeries=series;
  return{number,cfg,allocated:true,docType:earsiv?'earsiv':'efatura',series,seq};
}

app.get('/web-api/admin/invoice-integration',requireAdmin,(req,res)=>{
  const s=readStore(),cfg=s.invoiceIntegration||{};
  const year=new Date().getFullYear();
  const efSeries=normalizeInvoiceSeries(cfg.efaturaSeries,'ATK');
  const eaSeries=normalizeInvoiceSeries(cfg.earsivSeries,'ATA');
  res.json({
    settings:{
      ...cfg,
      password:cfg.password?'********':'',
      efaturaSeries:efSeries,
      earsivSeries:eaSeries,
      efaturaNext:nextInvoiceSeq(cfg.efaturaNext),
      earsivNext:nextInvoiceSeq(cfg.earsivNext),
      efaturaPreview:formatGibInvoiceNumber(efSeries,year,cfg.efaturaNext),
      earsivPreview:formatGibInvoiceNumber(eaSeries,year,cfg.earsivNext)
    },
    queueCount:(s.invoiceQueue||[]).filter(x=>!['issued','cancelled'].includes(x.status)).length
  });
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
    autoDetectType:x.autoDetectType!==false&&String(x.autoDetectType)!=='false',
    efaturaSeries:normalizeInvoiceSeries(x.efaturaSeries!=null?x.efaturaSeries:old.efaturaSeries,'ATK'),
    earsivSeries:normalizeInvoiceSeries(x.earsivSeries!=null?x.earsivSeries:old.earsivSeries,'ATA'),
    efaturaNext:nextInvoiceSeq(x.efaturaNext!=null?x.efaturaNext:old.efaturaNext),
    earsivNext:nextInvoiceSeq(x.earsivNext!=null?x.earsivNext:old.earsivNext)
  };
  audit(s,'QNB Solist entegrasyon ayarları güncellendi','Fatura Entegrasyonu',{environment:env,enabled:s.invoiceIntegration.enabled,provider,efaturaSeries:s.invoiceIntegration.efaturaSeries,earsivSeries:s.invoiceIntegration.earsivSeries});writeStore(s);res.json({ok:true,settings:{efaturaSeries:s.invoiceIntegration.efaturaSeries,earsivSeries:s.invoiceIntegration.earsivSeries,efaturaNext:s.invoiceIntegration.efaturaNext,earsivNext:s.invoiceIntegration.earsivNext}});
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
    .filter(t=>t.kind==='sale'&&!t.cancelled&&saleNeedsInvoice(t.invoiceStatus))
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
    settings:{provider:cfg.provider||'qnb-solist',environment:cfg.environment||'test',enabled:!!cfg.enabled,companyTitle:cfg.companyTitle||'',companyVkn:cfg.companyVkn||'',senderAlias:cfg.senderAlias||cfg.gbAlias||'',pkAlias:cfg.pkAlias||'',efaturaSeries:normalizeInvoiceSeries(cfg.efaturaSeries,'ATK'),earsivSeries:normalizeInvoiceSeries(cfg.earsivSeries,'ATA'),efaturaNext:nextInvoiceSeq(cfg.efaturaNext),earsivNext:nextInvoiceSeq(cfg.earsivNext)},
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
  if(isStaffPortalReq(req) && !staffCanInvoice(req)){
    return res.status(403).json({error:'Fatura kesme yetkiniz yok — yöneticiden sale_invoice_qnb açın'});
  }
  const s=readStore();
  const sale=(s.financeTransactions||[]).find(t=>String(t.id)===String(req.params.id)&&t.kind==='sale'&&!t.cancelled);
  if(!sale)return res.status(404).json({error:'Satış bulunamadı'});
  const customer=(s.customers||[]).find(c=>String(c.id)===String(sale.customerId));
  if(!customer)return res.status(400).json({error:'Satış müşterisi bulunamadı'});
  const prefer=String(req.body?.billingParty||sale.billingParty||customer.invoiceType||'individual');
  const invoiceParty=resolveCustomerInvoiceParty(customer,prefer);
  if(!customer.email&&!invoiceParty.taxNumber){
    return res.status(400).json({error:'Fatura için müşteride e-posta veya VKN/TCKN olmalı'});
  }
  if(prefer==='corporate'&&!customerHasCorporateBilling(customer)){
    return res.status(400).json({error:'Kurumsal fatura için müşteri kartına firma ünvanı ve VKN ekleyin'});
  }
  const cfg=s.invoiceIntegration||{};
  let record=(s.invoiceQueue||[]).find(x=>String(x.saleId)===String(sale.id));
  if(!record){
    record={
      id:crypto.randomUUID(),saleId:sale.id,reference:sale.reference||'',customerId:customer.id,
      customer:{name:invoiceParty.name,phone:invoiceParty.phone,email:invoiceParty.email,taxNumber:invoiceParty.taxNumber,taxNo:invoiceParty.taxNo,tckn:invoiceParty.tckn,taxOffice:invoiceParty.taxOffice,companyName:invoiceParty.companyName,invoiceType:invoiceParty.invoiceType,address:invoiceParty.address,city:invoiceParty.city,district:invoiceParty.district},
      items:(sale.items||[]).map(i=>({...i})),total:Number(sale.total||0),
      status:'pending',invoiceType:'auto',provider:cfg.provider||'qnb-solist',
      providerDocumentId:'',uuid:crypto.randomUUID(),invoiceNumber:sale.invoiceNumber||'',invoiceDate:todayISO(),
      error:'',ublXml:'',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()
    };
    s.invoiceQueue.push(record);
    sale.invoiceQueueId=record.id;
  }else{
    record.customer={name:invoiceParty.name,phone:invoiceParty.phone,email:invoiceParty.email,taxNumber:invoiceParty.taxNumber,taxNo:invoiceParty.taxNo,tckn:invoiceParty.tckn,taxOffice:invoiceParty.taxOffice,companyName:invoiceParty.companyName,invoiceType:invoiceParty.invoiceType,address:invoiceParty.address,city:invoiceParty.city,district:invoiceParty.district};
  }
  const docTypeHint=qnbSolist.detectDocumentType(invoiceParty,cfg);
  const alloc=allocateInvoiceNumber(cfg,docTypeHint,record.invoiceNumber||sale.invoiceNumber||'');
  s.invoiceIntegration=cfg;
  record.invoiceNumber=alloc.number;
  sale.invoiceNumber=alloc.number;
  const out=await qnbSolist.sendOrQueueInvoice({record,sale:{...sale,invoiceNumber:alloc.number},customer:invoiceParty,cfg});
  record.status=out.status||'ready';
  record.docType=out.docType||docTypeHint;
  record.ublXml=out.ublXml;
  record.providerMessage=out.message||'';
  record.updatedAt=new Date().toISOString();
  sale.billingParty=invoiceParty.partyType;
  sale.invoicePartyType=invoiceParty.partyType;
  sale.invoicePartyName=invoiceParty.name;
  sale.invoiceStatus=out.status==='issued'?'issued':'queued';
  sale.invoiceType=out.docType||docTypeHint;
  sale.invoiceUuid=record.uuid;
  sale.updatedAt=new Date().toISOString();
  audit(s,'Fatura kes / QNB kuyruğa alındı',invoiceParty.name,{saleId:sale.id,status:record.status,docType:record.docType,invoiceNumber:record.invoiceNumber,party:invoiceParty.partyType});
  writeStore(s);
  res.json({ok:true,record,result:out,sale:{id:sale.id,invoiceStatus:sale.invoiceStatus,invoiceType:sale.invoiceType,invoiceNumber:sale.invoiceNumber,billingParty:sale.billingParty}});
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
/** Klasik ATAK Satış Sözleşmesi + Senet — dengeli tek A4 */
function buildCombinedContractSenetA4Html(sale,customer,cfg,settings,notes){
  const items=Array.isArray(sale.items)?sale.items:[];
  const noteList=Array.isArray(notes)?notes.slice().sort((a,b)=>String(a.dueDate||'').localeCompare(String(b.dueDate||''))):[];
  const net=Number(sale.total||0);
  const site=ATAK_COMPANY.shortName;
  const companyLegal=ATAK_COMPANY.legalName;
  const companyTaxOffice=ATAK_COMPANY.taxOffice;
  const companyTaxNo=ATAK_COMPANY.taxNo;
  const address=ATAK_COMPANY.address;
  const companyTaxLine=`VD: ${companyTaxOffice} · Vergi No: ${companyTaxNo}`;
  const atakLogoSrc='/web-admin-assets/atak-header-logo.png';
  const atakLogoWhiteSrc='/web-admin-assets/atak-header-logo-white.png';
  const phone=settings?.phone||'0212 223 28 71';
  const wa=settings?.whatsapp?String(settings.whatsapp).replace(/^90/,'0'):'0543 358 50 60';
  const email=settings?.email||'tarabyabeko@gmail.com';
  const personName=customer?.name||'';
  const personTax=customer?.tckn||customer?.taxNo||'';
  const addr=[customer?.address,customer?.district,customer?.city].filter(Boolean).join(', ');
  const guarantor=(sale.guarantor&&typeof sale.guarantor==='object')?sale.guarantor:(customer?.guarantor&&typeof customer.guarantor==='object'?customer.guarantor:{});
  const cashPaid=Math.round(((sale.payments||[]).filter(p=>['Nakit','Kredi Kartı','Havale'].includes(String(p.method||''))).reduce((a,p)=>a+Number(p.amount||0),0))*100)/100;
  const sumSchedule=noteList.reduce((a,n)=>a+Number(n.amount||0),0);
  const senetTotal=Math.round((Number(sale.promissoryAmount||0)||sumSchedule||0)*100)/100;
  const downPayment=cashPaid>0?cashPaid:Math.max(0,Math.round((net-senetTotal)*100)/100);
  const balance=senetTotal>0?senetTotal:Math.max(0,Math.round((net-downPayment)*100)/100);
  const dateTR=d=>{const s=String(d||'').slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return htmlEsc(s||'');const[y,m,day]=s.split('-');return `${day}.${m}.${y}`};
  const emptyRows=Math.max(0,4-items.length);
  const productRows=(items.slice(0,4).map(i=>{const qty=Number(i.quantity||1);const total=i.total!=null?i.total:qty*Number(i.unitPrice||0);return `<tr><td class="c">${htmlEsc(i.itemCode||i.productCode||'-')}</td><td class="c">${qty}</td><td class="num">${moneyTR(i.unitPrice)}</td><td class="num">${moneyTR(total)}</td></tr>`;}).join('')||'')+Array.from({length:emptyRows},()=>'<tr><td>&nbsp;</td><td></td><td></td><td></td></tr>').join('');
  const schedShow=noteList.slice(0,12);
  const schedPad=Math.max(0,4-schedShow.length);
  const scheduleRows=(schedShow.map(n=>`<tr><td class="c">${dateTR(n.dueDate)}</td><td class="num">${moneyTR(n.amount)}</td></tr>`).join('')||'')+Array.from({length:schedPad},()=>'<tr><td>&nbsp;</td><td></td></tr>').join('')+`<tr class="tot"><td class="c">TOPLAM</td><td class="num">${moneyTR(balance||senetTotal)}</td></tr>`;
  const partyRows=(who)=>[
    ['Adı Soyadı',who.name||''],
    ['T.C. Kimlik No',who.tckn||who.taxNo||''],
    ['GSM',who.phone||who.gsm||''],
    ['İş Tel.',who.workPhone||''],
    ['Ev Tel.',who.homePhone||''],
    ['Ev Adresi',who.homeAddress||who.address||''],
    ['İş Adresi',who.workAddress||'']
  ].map(([l,v])=>`<tr><td class="lbl">${l}</td><td>${htmlEsc(v)}</td></tr>`).join('');
  const corpLine=customerHasCorporateBilling(customer)?`<div class="pay">Fatura firması: <b>${htmlEsc(customer.companyName||'')}</b> · VKN ${htmlEsc(customer.taxNo||'')} · ${htmlEsc(customer.taxOffice||'')}</div>`:'';
  // Tek senet: tutar = yazılan toplam senet; taksitler yalnızca sözleşmede
  const senetAmount=senetTotal||balance||0;
  const senetDue=noteList.length?(noteList[noteList.length-1].dueDate||noteList[0].dueDate||''):'';
  const senetNo=sale.reference?`${sale.reference}-SN`:(noteList[0]?.serial?String(noteList[0].serial).replace(/-\d{1,2}$/,''):'');
  const senetWords=senetAmount>0?amountToTrWords(senetAmount):'';
  const moreSenets=noteList.length>1?`<div class="note">Tek senet tutarı toplam bakiyedir (${moneyTR(senetAmount)}). ${noteList.length} taksitin vade planı yukarıdaki tablodadır.</div>`:'';
  const css=`<style>
.a4c{padding:7mm 8mm 6mm!important;font:8.6px/1.3 "Segoe UI",Arial,sans-serif;color:#142033;position:relative;overflow:hidden;display:flex;flex-direction:column;min-height:277mm}
.a4c *{box-sizing:border-box}
.a4c .logo-top{display:flex;justify-content:flex-start;align-items:center;margin:0 0 2px}.a4c .logo-top img{height:11mm;width:auto;object-fit:contain}.a4c .senet-side .senet-logo{display:block;width:100%;margin:0 0 6px}.a4c .senet-side .senet-logo img{width:100%;height:auto;max-height:18mm;object-fit:contain;object-position:left top;}.a4c .logo-bottom{display:flex;justify-content:center;align-items:center;margin-top:3px;padding-top:3px;border-top:1px solid #c5d0dd}.a4c .logo-bottom img{height:9mm;width:auto;object-fit:contain}.a4c .top{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:start}
.a4c .name{font-size:10.5px;font-weight:800;color:#0a2748}
.a4c .meta{margin-top:3px;color:#5a6a7b;font-size:7.5px;line-height:1.4}
.a4c .mid-head{text-align:right;padding-top:4px;align-self:center}
.a4c .pills{display:flex;gap:4px;justify-content:flex-end;margin-bottom:5px;flex-wrap:wrap}
.a4c .pill{font-size:7px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:#0a2748;border:1px solid #c5d0dd;border-radius:999px;padding:2.5px 7px;background:#f3f6fa}
.a4c .title{font-size:15px;line-height:1;font-weight:900;color:#b91c1c;letter-spacing:.1em}



.a4c .rule{height:2px;background:linear-gradient(90deg,#0a2748,#b91c1c 52%,#d4a017);margin:6px 0 7px}
.a4c .grid3{display:grid;grid-template-columns:1.3fr .68fr .74fr;gap:6px}
.a4c table{width:100%;border-collapse:collapse;table-layout:fixed}
.a4c th,.a4c td{border:1px solid #c5d0dd;padding:2.5px 4px;vertical-align:middle}
.a4c th{background:#0a2748;color:#fff;font-size:7px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;text-align:center;padding:4px 3px}
.a4c td{height:13px;font-size:8px}
.a4c .num{text-align:right;font-variant-numeric:tabular-nums}
.a4c .c{text-align:center}
.a4c .mmeta td:first-child{width:46%;background:#f3f6fa;font-weight:700;color:#5a6a7b;font-size:7.2px}
.a4c .tot td{background:#eef3f9;font-weight:800}
.a4c .parties{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:7px}
.a4c .box{border:1px solid #c5d0dd;border-radius:4px;overflow:hidden}
.a4c .box h3{background:#0a2748;color:#fff;font-size:7.8px;letter-spacing:.1em;text-align:center;padding:4px;margin:0;font-weight:700}
.a4c .box table{border:0}
.a4c .box td{border-color:#e4ebf3;height:11px}
.a4c .box td.lbl{width:34%;background:#f3f6fa;font-size:7px;font-weight:700;color:#5a6a7b}
.a4c .pay{margin:5px 0 3px;font-size:7.5px;color:#5a6a7b}
.a4c .terms h4{display:inline-block;font-size:7.8px;letter-spacing:.07em;color:#0a2748;border-bottom:1px solid #0a2748;margin:0 0 3px}
.a4c .terms p{font-size:6.5px;line-height:1.32;color:#3a4656;text-align:justify;margin:0 0 2.5px}
.a4c .signs{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-top:8px}
.a4c .sig{border-top:1px solid #9aa8b8;padding-top:3px;text-align:center;min-height:28px}
.a4c .sig b{display:block;font-size:8px;color:#0a2748;margin-bottom:2px}
.a4c .sig small{display:block;font-size:5.8px;color:#5a6a7b;line-height:1.2;margin-bottom:8px}
.a4c .sig .nm{font-size:7.5px;font-weight:700}
.a4c .grow{flex:1 1 auto;display:flex;flex-direction:column;justify-content:flex-end;margin-top:8px}
.a4c .senet{border:1.6px solid #0a2748;border-radius:6px;overflow:hidden;display:grid;grid-template-columns:24mm 1fr;min-height:62mm}
.a4c .senet-side{background:linear-gradient(180deg,#0a2748,#143a63);color:#fff;padding:7px 5px;font-size:6.6px;line-height:1.35;display:flex;flex-direction:column;gap:7px}
.a4c .senet-side strong{font-size:7.4px}
.a4c .senet-side .pill{background:#fff;color:#0a2748;border-color:#fff;padding:1.5px 5px}
.a4c .senet-main{padding:6px 8px 7px;display:flex;flex-direction:column}
.a4c .senet-bar{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:5px}
.a4c .senet-bar b{font-size:13px;color:#b91c1c;letter-spacing:.12em}
.a4c .senet-bar span{font-size:7.2px;color:#5a6a7b}
.a4c .fields{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:5px}
.a4c .fields>div{border-bottom:1.2px solid #2a3545;padding:2px 0 3px}
.a4c .fields span{display:block;font-size:6.5px;font-weight:800;color:#b91c1c;text-transform:uppercase;letter-spacing:.05em}
.a4c .fields b{display:block;font-size:9.5px;min-height:12px;margin-top:1px}
.a4c .sbody{font-size:7.2px;line-height:1.4;text-align:justify;margin:2px 0 5px}
.a4c .words{display:flex;gap:6px;align-items:baseline;background:#f3f6fa;border:1px solid #c5d0dd;border-radius:4px;padding:4px 7px;margin-bottom:5px}
.a4c .words span{font-size:7px;font-weight:800;color:#b91c1c}
.a4c .words b{font-size:8px}
.a4c .duo{display:grid;grid-template-columns:1fr 1fr;gap:6px;flex:1}
.a4c .duo>div{border:1px solid #c5d0dd;border-radius:4px;padding:5px 6px;min-height:34px}
.a4c .duo .lab{font-size:7px;font-weight:800;color:#b91c1c;letter-spacing:.05em;margin-bottom:2px}
.a4c .duo small{display:block;font-size:6.2px;color:#5a6a7b}
.a4c .duo .v{font-size:7.8px;font-weight:700;min-height:10px;margin-bottom:2px}
.a4c .signline{margin-top:6px;text-align:right;border-top:1px solid #c5d0dd;padding-top:10px;font-size:7px;color:#5a6a7b}
.a4c .note{margin-top:3px;font-size:6.2px;color:#7a8799}
.a4c .foot{margin-top:4px;text-align:center;font-size:6.2px;color:#8a97a8}
.a4c.senet-only{padding-top:12mm!important}
.a4c.senet-only .senet{margin-top:0;min-height:90mm}
@media print{.a4c{page-break-after:avoid!important}.a4c.senet-only{page-break-before:always}}
</style>`;
  return `<section class="sheet a4c">${css}
  <div class="top"><div><div class="logo-top"><img src="${atakLogoSrc}" alt="ATAK Pazarlama"/></div><div class="name">${htmlEsc(companyLegal)}</div><div class="meta">${htmlEsc(address)}<br/>${htmlEsc(phone)} · ${htmlEsc(wa)} · ${htmlEsc(email)} · ${htmlEsc(companyTaxLine)}</div></div>
  <div class="mid-head"><div class="title">SATIŞ SÖZLEŞMESİ</div></div></div>
  <div class="rule"></div>
  <div class="grid3">
    <table><thead><tr><th style="width:30%">Ürün Kodu</th><th style="width:12%">Adet</th><th style="width:29%">Birim</th><th style="width:29%">Tutar</th></tr></thead><tbody>${productRows}</tbody></table>
    <table class="mmeta"><tr><td>Satış Tarihi</td><td>${dateTR(sale.date)}</td></tr><tr><td>Satış No</td><td>${htmlEsc(sale.reference||'')}</td></tr><tr><td>Müşteri No</td><td>${htmlEsc(customer?.code||customer?.id||'')}</td></tr><tr><td>Toplam</td><td>${moneyTR(net)}</td></tr><tr><td>Peşinat</td><td>${moneyTR(downPayment)}</td></tr><tr><td>Bakiye</td><td>${moneyTR(balance)}</td></tr></table>
    <table><thead><tr><th>Vade</th><th>Taksit</th></tr></thead><tbody>${scheduleRows}</tbody></table>
  </div>${corpLine}
  <div class="parties"><div class="box"><h3>KEFİL</h3><table>${partyRows(guarantor)}</table></div><div class="box"><h3>BORÇLU</h3><table>${partyRows({name:personName,tckn:personTax,phone:customer?.phone||'',workPhone:customer?.workPhone||'',homePhone:customer?.homePhone||'',address:addr,workAddress:customer?.workAddress||''})}</table></div></div>
  <div class="pay"><b>Ödeme:</b> ${htmlEsc(sale.paymentMethod||'-')}${(sale.payments||[]).length?` · ${(sale.payments||[]).map(p=>`${htmlEsc(p.method||'')}: ${moneyTR(p.amount)}`).join(' · ')}`:''}${sale.salespersonName?` · Satıcı: ${htmlEsc(sale.salespersonName)}`:''}</div>
  <div class="terms"><h4>ANLAŞMA ŞARTLARI</h4>
  <p><b>1)</b> Alıcı / borçlu, ${htmlEsc(companyLegal)}’nden yukarıda cinsi, adedi, özellikleri ve bedeli yazılı ürünleri görüp beğenerek satın almıştır. Peşinat ve taksit tutarlarını vade tarihlerinde, satıcının şube adreslerine makbuz karşılığı ödemeyi kabul ve taahhüt eder. Senetler bu sözleşmenin eki ve ayrılmaz parçasıdır.</p>
  <p><b>2)</b> Taksitlerden herhangi birinin vadesinde ödenmemesi halinde aylık %4 gecikme faizi uygulanır. Ayrıca bakiye üzerinden %20 oranında cezai şart talep edilebilir. Bir taksitin ödenmemesi halinde kalan tüm taksitler muaccel olur; satıcı yasal takip ve tahsilat masraflarını borçludan / kefilden isteyebilir. 4077 sayılı Tüketicinin Korunması Hakkında Kanun hükümleri saklıdır.</p>
  <p><b>3)</b> Ürünlerin teslimi, satıcının alıcı hakkında yapacağı olumlu kredi / risk değerlendirmesine bağlıdır. Beyaz eşya, mobilya, mutfak ve benzeri ürünler üretici / ithalatçı garanti şartlarına tabidir. Montaj ve onarım yetkili servislerce yapılır; aksi halde garanti kapsamı dışına çıkılabilir.</p>
  <p><b>4)</b> Taraflar işbu sözleşmeyi okuyup müzakere ederek imzalamışlardır. Uyuşmazlıklarda İstanbul Mahkemeleri ve İcra Daireleri yetkilidir. Kefil, borçlu ile birlikte müteselsil sorumludur. Bu belge mali fatura yerine geçmez; 4077 sayılı Kanun ve ilgili mevzuat hükümleri uygulanır.</p></div>
  <div class="signs"><div class="sig"><b>SATICI</b><small>Kaşe / İmza</small><div class="nm">${htmlEsc(companyLegal)}</div></div><div class="sig"><b>KEFİL</b><small>İşbu anlaşmadaki yazılı bütün şartları borçlu gibi okudum ve aynen kabul ettim.</small><div class="nm">${htmlEsc(guarantor.name||'İmza')}</div></div><div class="sig"><b>BORÇLU</b><small>İşbu anlaşmadaki yazılı bütün şartları okudum ve aynen kabul ettim.</small><div class="nm">${htmlEsc(personName||'İmza')}</div></div></div>
  <div class="grow"><div class="senet"><div class="senet-side"><div class="senet-logo"><img src="${atakLogoWhiteSrc}" alt="ATAK Pazarlama"/></div><div>${htmlEsc(address)}<br/>${htmlEsc(phone)}<br/>${htmlEsc(email)}<br/>${htmlEsc(companyTaxLine)}</div></div>
  <div class="senet-main"><div class="senet-bar"><b>SENET</b><span>Emre muharrer bono · ${htmlEsc(sale.reference||'')}</span></div>
  <div class="fields"><div><span>Vade</span><b>${dateTR(senetDue)}</b></div><div><span>Hululü Vade</span><b>${dateTR(senetDue)}</b></div><div><span>Türk Lirası</span><b>${senetAmount>0?moneyTR(senetAmount):''}</b></div><div><span>No.</span><b>${htmlEsc(senetNo)}</b></div></div>
  <p class="sbody">İşbu emre muharrer bono mukabilinde <b style="color:#b91c1c">${htmlEsc(companyLegal)}</b> veya emrine <u>${dateTR(senetDue)||'........'}</u> tarihinde yukarıda yazılı bedeli kayıtsız şartsız ödemeyi taahhüt ederim. Bedeli nakden ve tamamen aldım. Taksitler satış sözleşmesindeki vade tablosuna göredir; bir taksitin ödenmemesi halinde kalan tutar muaccel olur. Uyuşmazlıklarda <b>İSTANBUL</b> Mahkemeleri yetkilidir.</p>
  <div class="words"><span>Yalnız</span><b>${htmlEsc(senetWords||'................................')}</b></div>
  <div class="duo"><div><div class="lab">Ödeyecek</div><small>İsim</small><div class="v">${htmlEsc(personName)}</div><small>Adres</small><div class="v">${htmlEsc(addr||'-')}</div></div><div><div class="lab">Müteselsil Borçlu</div><small>İsim</small><div class="v">${htmlEsc(guarantor.name||'')}</div><small>Adres</small><div class="v">${htmlEsc(guarantor.homeAddress||guarantor.address||'')}</div></div></div>
  <div class="signline">Keşideci / Borçlu İmza</div>${moreSenets}</div></div></div>
  <div class="logo-bottom"><img src="${atakLogoSrc}" alt="ATAK Pazarlama"/></div><div class="foot">${htmlEsc(site)} · Sözleşme + Senet · ${htmlEsc(sale.reference||'')} · ${dateTR(sale.date)}</div>
</section>`;
}

app.get('/web-api/admin/promissory-settings',requireAdmin,(req,res)=>{const s=readStore();res.json({settings:s.promissorySettings||{}})});
app.post('/web-api/admin/promissory-settings',requireAdmin,(req,res)=>{
  const s=readStore(),x=req.body||{};
  // Alacaklı adı sabit resmi ünvan — "Atak Home" vb. kabul edilmez
  s.promissorySettings={
    creditorName:ATAK_COMPANY.legalName,
    paymentPlace:String(x.paymentPlace||'İstanbul'),
    issuePlace:String(x.issuePlace||'İstanbul'),
    prefix:String(x.prefix||'ATAK').replace(/[^A-Za-z0-9_-]/g,'').slice(0,12)||'ATAK',
    defaultInstallments:Math.min(36,Math.max(1,Math.round(Number(x.defaultInstallments)||1))),
    firstDueDays:Math.min(365,Math.max(0,Math.round(Number(x.firstDueDays)||30))),
    intervalMonths:Math.min(12,Math.max(1,Math.round(Number(x.intervalMonths)||1))),
    copies:Math.min(3,Math.max(1,Math.round(Number(x.copies)||1))),
    footer:String(x.footer||'')
  };
  audit(s,'Senet ayarları güncellendi','Ayarlar');
  writeStore(s);
  res.json({ok:true,settings:s.promissorySettings});
});
app.post('/web-api/admin/promissory-plan',requireAdminOrStaff('orders_manage'),(req,res)=>{
  const s=readStore(),x=req.body||{},customer=s.customers.find(c=>c.id===x.customerId);
  if(!customer)return res.status(404).json({error:'Müşteri bulunamadı'});
  const total=cleanMoney(x.totalAmount),count=Math.min(36,Math.max(1,Math.round(Number(x.installments)||1)));
  if(total<=0)return res.status(400).json({error:'Senet toplamı sıfırdan büyük olmalıdır'});
  const saleId=String(x.saleId||'').trim();
  let sale=null;
  if(saleId){
    sale=(s.financeTransactions||[]).find(t=>String(t.id)===saleId&&t.kind==='sale');
    if(!sale)return res.status(404).json({error:'Bağlanacak satış bulunamadı'});
    if(sale.cancelled)return res.status(400).json({error:'İptal edilmiş satışa senet bağlanamaz'});
    if(String(sale.customerId)!==String(customer.id))return res.status(400).json({error:'Satış bu müşteriye ait değil'});
  }else{
    // Satışsız senet yalnızca yönetici + açık onay ile (eski orphan bug’ını önlemek için)
    if(!actorIsManager(req))return res.status(403).json({error:'Satışa bağlı olmayan senet yalnızca yönetici oluşturabilir'});
    if(x.allowOrphan!==true&&String(x.confirmOrphan||'')!=='ORPHAN'){
      return res.status(400).json({error:'Satışsız senet için saleId zorunlu veya allowOrphan:true + sebep girilmeli. Aksi halde tahsilat listesinde sahipsiz alacak görünür.'});
    }
    const orphanReason=String(x.reason||x.description||'').trim();
    if(orphanReason.length<5)return res.status(400).json({error:'Satışsız senet için en az 5 karakter sebep yazın'});
  }
  const settings=s.promissorySettings||{};
  const interval=Math.min(12,Math.max(1,Math.round(Number(x.intervalMonths)||settings.intervalMonths||1)));
  const first=x.firstDueDate?new Date(x.firstDueDate+'T12:00:00'):new Date(Date.now()+Number(settings.firstDueDays||30)*86400000);
  if(Number.isNaN(first.getTime()))return res.status(400).json({error:'İlk vade tarihi geçersiz'});
  const base=Math.floor((total/count)*100)/100;
  let remaining=Math.round(total*100)/100;
  const planId=crypto.randomUUID(),notes=[];
  const desc=String(x.description||(sale?`${sale.reference} satış senedi`:'Manuel senet planı')).slice(0,500);
  for(let i=0;i<count;i++){
    const due=new Date(first);due.setMonth(due.getMonth()+i*interval);
    const amount=i===count-1?Math.round(remaining*100)/100:base;
    remaining=Math.round((remaining-amount)*100)/100;
    notes.push({
      id:crypto.randomUUID(),planId,
      serial:`${settings.prefix||'ATAK'}-${Date.now().toString().slice(-8)}-${String(i+1).padStart(2,'0')}`,
      customerId:customer.id,
      saleId:sale?.id||'',
      saleReference:sale?.reference||'',
      amount,dueDate:due.toISOString().slice(0,10),
      issueDate:String(x.issueDate||todayISO()),status:'open',
      createdAt:new Date().toISOString(),description:desc,
      source:sale?'manual_linked':'manual_orphan',
      orphanReason:sale?'':String(x.reason||x.description||'')
    });
  }
  s.promissoryNotes.push(...notes);
  if(sale){sale.promissoryPlanId=planId;sale.promissoryAmount=Math.round((Number(sale.promissoryAmount||0)+total)*100)/100}
  audit(s,sale?'Satışa senet planı bağlandı':'Senet planı oluşturuldu (satışsız)',customer.name,{planId,total,count,interval,saleId:sale?.id||'',orphan:!sale});
  writeStore(s);
  res.json({ok:true,planId,notes,printUrl:`/web-api/admin/promissory-plan/${planId}/print`,orphan:!sale});
});
app.post('/web-api/admin/promissory-note/:id/cancel',requireAdminOrStaffAny('finance_manage','orders_manage','customers_manage'),(req,res)=>{
  if(!actorIsManager(req))return res.status(403).json({error:'Senet iptali için yönetici yetkisi gerekir'});
  const s=readStore(),note=(s.promissoryNotes||[]).find(n=>String(n.id)===String(req.params.id));
  if(!note)return res.status(404).json({error:'Senet bulunamadı'});
  if(String(note.status)==='cancelled')return res.status(400).json({error:'Senet zaten iptal'});
  if(String(note.status)==='paid')return res.status(400).json({error:'Ödenmiş senet iptal edilemez'});
  const reason=String(req.body?.reason||'').trim();
  if(reason.length<3)return res.status(400).json({error:'İptal sebebi zorunlu (en az 3 karakter)'});
  const actor=currentActor(req)?.name||'Yönetici';
  cancelPromissoryNoteInStore(note,actor,reason);
  const customer=(s.customers||[]).find(c=>String(c.id)===String(note.customerId));
  audit(s,'Senet iptal edildi',customer?.name||note.serial,{noteId:note.id,serial:note.serial,amount:note.amount,reason,orphan:!note.saleId});
  writeStore(s);
  res.json({ok:true,note:enrichPromissoryNote(s,note)});
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

app.get('/web-api/admin/receipt/:id',requireAdminOrStaffAny('finance_manage','finance_view','orders_manage','customers_manage'),(req,res)=>{
  const s=readStore(),t=s.financeTransactions.find(x=>x.id===req.params.id);
  if(!t)return res.status(404).send('Makbuz hareketi bulunamadı');
  const customer=s.customers.find(x=>x.id===t.customerId);
  const account=s.financeAccounts.find(x=>x.id===t.accountId);
  const settings=s.settings||{};
  const a5=String(req.query.size||'').toLowerCase()==='a5';
  const title=t.kind==='collection'?'TAHSİLAT MAKBUZU':t.kind==='payment'?'ÖDEME MAKBUZU':'İŞLEM MAKBUZU';
  const amount=Math.abs(Number(t.amount||0)).toLocaleString('tr-TR',{style:'currency',currency:'TRY'});
  const bal=customer?customerBalance(s,customer.id):0;
  const balTxt=bal.toLocaleString('tr-TR',{style:'currency',currency:'TRY'});
  const applied=Array.isArray(t.appliedNotes)?t.appliedNotes:[];
  const noteStatusTr=st=>({paid:'Ödendi',partial:'Kısmi',open:'Açık',cancelled:'İptal'}[String(st||'')]||String(st||''));
  const appliedHtml=applied.length
    ?`<div class="box" style="margin-top:8px"><small>Kapatılan / güncellenen taksitler</small>${applied.map(n=>`<div class="line"><b>${escHtml(n.serial||n.id)}</b> · vade ${escHtml(n.dueDate||'')} · ${Number(n.applied||0).toLocaleString('tr-TR',{style:'currency',currency:'TRY'})} → ${escHtml(noteStatusTr(n.status))}</div>`).join('')}</div>`
    :'';
  const pageCss=a5
    ?`@page{size:A5;margin:7mm}body{background:#fff;margin:0;padding:0}.paper{width:148mm;min-height:200mm;margin:0 auto;padding:10mm;box-shadow:none;border-radius:0}`
    :`body{background:#eef2f7;margin:0;padding:24px}.paper{max-width:760px;margin:auto;padding:34px;border-radius:16px;box-shadow:0 12px 35px #16395c22}`;
  const esc=escHtml;
  res.type('html').send(`<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>
*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#17233a}
${pageCss}
.paper{background:#fff}
.head{display:flex;justify-content:space-between;gap:12px;border-bottom:2px solid #0a5ca8;padding-bottom:10px}
.head h1{margin:0;color:#0a5ca8;font-size:${a5?'16px':'22px'}}
.head p{margin:2px 0;color:#65748a;font-size:${a5?'11px':'13px'}}
.number{text-align:right;font-size:${a5?'11px':'13px'}}
.amount{font-size:${a5?'26px':'32px'};font-weight:900;color:#0a5ca8;margin:14px 0 10px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.box{border:1px solid #dce4ee;border-radius:8px;padding:8px 10px}
.box small{display:block;color:#6c788b;margin-bottom:3px;font-size:10px;font-weight:800;text-transform:uppercase}
.box b{font-size:${a5?'12px':'14px'}}
.line{font-size:11px;margin-top:3px}
.foot{margin-top:14px;border-top:1px solid #dce4ee;padding-top:8px;color:#68758a;font-size:10px}
.signs{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:22px;text-align:center;font-size:11px;color:#445}
.signs span{display:block;border-top:1px solid #99a;margin:28px 10px 0;padding-top:6px}
.actions{text-align:center;margin-top:14px}
.actions button{padding:10px 16px;border:0;border-radius:8px;background:#0a5ca8;color:#fff;font-weight:800;cursor:pointer}
@media print{body{background:#fff!important;padding:0!important}.paper{box-shadow:none!important;border-radius:0!important}.actions{display:none!important}}
</style></head><body>
<div class="paper">
  <div class="head">
    <div><h1>ATAK PAZARLAMA</h1><p>${esc(settings.siteName||'Atak Home')}</p><p>${esc(settings.address||'')}</p><p>${esc(settings.phone||'')}</p></div>
    <div class="number"><b>${title}</b><p>No: ${esc(t.reference||t.id.slice(0,8).toUpperCase())}</p><p>Tarih: ${esc(t.date)}</p><p>${a5?'A5 Makbuz':'Makbuz'}</p></div>
  </div>
  <div class="amount">${amount}</div>
  <div class="grid">
    <div class="box"><small>Müşteri</small><b>${esc(customer?.name||'Belirtilmedi')}</b></div>
    <div class="box"><small>Telefon</small><b>${esc(customer?.phone||'-')}</b></div>
    <div class="box"><small>Kasa / Banka</small><b>${esc(account?.name||'-')}</b></div>
    <div class="box"><small>Ödeme Şekli</small><b>${esc(t.category||'-')}</b></div>
    <div class="box"><small>Kalan Cari</small><b>${balTxt}</b></div>
    <div class="box"><small>Alan Personel</small><b>${esc(t.createdBy||'-')}</b></div>
  </div>
  <div class="box" style="margin-top:8px"><small>Açıklama</small><b>${esc(t.description||'Cari tahsilat')}</b></div>
  ${appliedHtml}
  <div class="signs"><div><span>Teslim Eden</span></div><div><span>Teslim Alan</span></div></div>
  <div class="foot">Bu belge Atak Pazarlama işlem makbuzudur. e-Fatura / resmi fatura yerine geçmez. ${a5?'A5 yazdırma için sayfa boyutunu A5 seçin.':''}</div>
  <div class="actions"><button onclick="window.print()">A5 Makbuzu Yazdır</button></div>
</div>
<script>window.addEventListener('load',()=>{const u=new URL(location.href);if(u.searchParams.get('autoprint')==='1')setTimeout(()=>window.print(),250)})</script>
</body></html>`);
});
function escHtml(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

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
function dynamicsRowPick(row,aliases){
  const map=new Map();
  for(const [k,v] of Object.entries(row||{})) map.set(purchaseHeaderKey(k),v);
  for(const a of aliases){
    const key=purchaseHeaderKey(a);
    if(map.has(key)){
      const v=map.get(key);
      if(v!==null&&v!==undefined&&String(v).trim()!=='')return v;
    }
  }
  return '';
}
function parseDynamicsWorkbook(buffer){
  const wb=XLSX.read(buffer,{type:'buffer',cellDates:false});
  const ws=wb.Sheets[wb.SheetNames[0]];if(!ws)throw new Error('Excel içinde çalışma sayfası bulunamadı');
  const rows=XLSX.utils.sheet_to_json(ws,{defval:'',raw:false});
  const headers=rows.length?Object.keys(rows[0]):[];
  const headerKeys=headers.map(purchaseHeaderKey);
  const needItem=['maddekodu','itemcode','malzemekodu'];
  const needSearch=['aramaadi','urunadi','searchname','kod'];
  const hasItem=headerKeys.some(h=>needItem.includes(h)||h==='maddekodu');
  const hasSearch=headerKeys.some(h=>needSearch.includes(h)||h==='aramaadi');
  // Klasik Dynamics export: Madde kodu + Arama adı
  if(!headers.includes('Madde kodu')||!headers.includes('Arama adı')){
    if(!(hasItem&&hasSearch))throw new Error('Eksik Excel sütunu: Madde kodu, Arama adı (Dynamics ürün listesi)');
  }
  const costAliases=[
    'Birim maliyet','Maliyet','Maliyet fiyatı','Maliyet fiyati','Alış fiyatı','Alis fiyati',
    'Ortalama maliyet','Stok maliyeti','Envanter maliyeti','Unit cost','Cost price','Birim maliyet tutarı'
  ];
  const costHeaderFound=headers.some(h=>costAliases.map(purchaseHeaderKey).includes(purchaseHeaderKey(h)));
  const stockHeaderFound=headers.some(h=>['Fiziksel stok','Kullanılabilir fiziksel miktar','Kullanilabilir fiziksel miktar'].map(purchaseHeaderKey).includes(purchaseHeaderKey(h)));

  const parsed=rows.map((r,index)=>{
    const itemCode=String(dynamicsRowPick(r,['Madde kodu','Item Code','Malzeme Kodu'])||r['Madde kodu']||'').trim();
    const searchName=String(dynamicsRowPick(r,['Arama adı','Arama adi','Search name'])||r['Arama adı']||'').trim();
    const physicalStock=normalizeNumber(dynamicsRowPick(r,['Fiziksel stok','Physical inventory'])||r['Fiziksel stok']||0);
    const reservedStock=normalizeNumber(dynamicsRowPick(r,['Fiziksel rezerve miktar','Physical reserved'])||r['Fiziksel rezerve miktar']||0);
    const availableStock=normalizeNumber(dynamicsRowPick(r,['Kullanılabilir fiziksel miktar','Kullanilabilir fiziksel miktar','Available physical'])||r['Kullanılabilir fiziksel miktar']||0);
    const purchasePrice=normalizeNumber(dynamicsRowPick(r,costAliases)||0);
    const stockQty=availableStock>0||physicalStock>0?(availableStock||physicalStock):0;
    return{
      rowNo:index+2,
      itemCode,
      dynamicsName:String(dynamicsRowPick(r,['Ürün adı','Urun adi','Product name'])||r['Ürün adı']||'').trim(),
      searchName,
      physicalStock,reservedStock,availableStock,stockQty,
      purchasePrice,
      unit:String(dynamicsRowPick(r,['Stok birimi','Unit'])||r['Stok birimi']||'Adet').trim(),
      dynamicsProductId:String(dynamicsRowPick(r,['Ürün kimliği','Urun kimligi','Product id'])||r['Ürün kimliği']||itemCode).trim()
    };
  }).filter(r=>r.itemCode||r.searchName);
  parsed._meta={costHeaderFound,stockHeaderFound,headers};
  return parsed;
}
function dynamicsApplyStock(s,productCode,warehouseId,targetQty,actor='Dynamics Excel'){
  const code=String(productCode||'').trim();
  if(!code||!warehouseId)return false;
  const target=Math.max(0,Math.round(Number(targetQty)||0));
  const before=Number(currentStock(s,code,warehouseId)?.quantity||0);
  const delta=target-before;
  if(delta===0)return false;
  addStockMovement(s,{
    productCode:code,warehouseId,type:'dynamics-import',quantity:delta,
    reference:'Dynamics Excel',note:'Dynamics stok senkron',user:actor
  });
  return true;
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
    const meta=rows._meta||{};
    ensureDynamicsCoreCategories(s);writeStore(s);
    let newCount=0,existingCount=0,invalidCount=0,withCost=0,withStock=0;
    const preview=rows.map(r=>{
      const existing=dynamicsExistingProduct(s,r);
      const valid=Boolean(String(r.searchName||'').trim());
      if(!valid)invalidCount++;else if(existing)existingCount++;else newCount++;
      if(r.purchasePrice>0)withCost++;
      if(r.stockQty>0||r.physicalStock>0)withStock++;
      return{
        itemCode:r.itemCode,
        searchName:r.searchName,
        status:!valid?'invalid':existing?'existing':'new',
        existingCode:existing?.code||'',
        suggestedCategoryId:valid&&!existing?dynamicsSuggestedCategoryId(s,r.searchName):'',
        stockQty:r.stockQty,
        purchasePrice:r.purchasePrice,
        currentPurchasePrice:existing?normalizeNumber(existing.purchasePrice||0):0
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
    const warehouses=(s.warehouses||[]).filter(w=>w.active!==false).map(w=>({id:w.id,name:w.name}));
    res.json({
      ok:true,total:rows.length,newCount,existingCount,invalidCount,
      withCost,withStock,
      costHeaderFound:Boolean(meta.costHeaderFound),
      stockHeaderFound:Boolean(meta.stockHeaderFound),
      preview:preview.slice(0,500),truncated:preview.length>500,categories,warehouses,
      note:'Canlı Dynamics API bağlı değil. Excel’i Dynamics’ten indirip buraya yükleyin; stok ve maliyet sütunları varsa güncellenir.'
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

    // Tek akış: yeni ürün ekle + maliyet her zaman Excel'deki yenisi (değer varsa) + stok güncelle
    const warehouseId=String(req.body?.warehouseId||s.warehouses?.find(w=>w.active!==false)?.id||'');
    const actor=currentSessionUser(req)?.name||'Dynamics Excel';

    let added=0,skipped=0,invalid=0,categoryMissing=0,stockUpdated=0,priceUpdated=0,existingUpdated=0;
    for(const r of rows){
      const searchName=String(r.searchName||'').trim();
      if(!searchName){invalid++;continue}
      let product=dynamicsExistingProduct(s,r);

      if(!product){
        const selected=String(categoryMap[r.itemCode]||categoryMap[searchName]||'').trim();
        const cat=(s.categories||[]).find(c=>String(c.id)===selected&&c.active!==false);
        if(!cat){categoryMissing++;continue}
        const brand=dynamicsBrand(r.searchName,r.dynamicsName);
        product=sanitizeProduct({
          code:searchName,
          name:searchName,
          itemCode:r.itemCode,
          searchName,
          dynamicsName:r.dynamicsName,
          dynamicsProductId:r.dynamicsProductId,
          brand,
          category:cat.id,
          purchasePrice:r.purchasePrice>0?r.purchasePrice:0,
          stock:0,
          active:true,
          tags:['dynamics-excel','sales-code']
        });
        if(r.purchasePrice>0){
          product.purchasePriceSource='dynamics-excel';
          product.purchasePriceUpdatedAt=new Date().toISOString();
        }
        s.products.unshift(product);
        added++;
        if(r.purchasePrice>0)priceUpdated++;
      }else{
        let touched=false;
        // Yeni Excel'deki maliyet her zaman kazanır (0/boş ise eski alışa dokunma)
        if(r.purchasePrice>0){
          product.purchasePrice=r.purchasePrice;
          product.updatedAt=new Date().toISOString();
          product.purchasePriceSource='dynamics-excel';
          product.purchasePriceUpdatedAt=new Date().toISOString();
          priceUpdated++;touched=true;
        }
        if(!product.itemCode&&r.itemCode){product.itemCode=r.itemCode;touched=true}
        if(!product.searchName){product.searchName=searchName;touched=true}
        if(!product.dynamicsProductId&&r.dynamicsProductId){product.dynamicsProductId=r.dynamicsProductId;touched=true}
        if(touched)existingUpdated++;
        else skipped++;
      }

      if(warehouseId&&product){
        if(dynamicsApplyStock(s,product.code,warehouseId,r.stockQty,actor))stockUpdated++;
      }
    }
    audit(s,'Dynamics Excel tek aktarım (ürün+maliyet+stok)','Excel',{
      added,skipped,invalid,categoryMissing,stockUpdated,priceUpdated,existingUpdated
    });
    writeStore(s);
    res.json({ok:true,added,skipped,invalid,categoryMissing,stockUpdated,priceUpdated,existingUpdated});
  }catch(e){
    res.status(400).json({error:e.message||'Excel aktarılamadı'})
  }
});

/* ===== Alış Faturaları (Arçelik vb. tedarikçi) — manuel + Excel ===== */
function purchaseHeaderKey(h){
  return String(h||'').toLocaleLowerCase('tr-TR')
    .replace(/ı/g,'i').replace(/ş/g,'s').replace(/ğ/g,'g')
    .replace(/ü/g,'u').replace(/ö/g,'o').replace(/ç/g,'c')
    .replace(/[^a-z0-9]+/g,'');
}
function purchasePick(row,aliases){
  const map=new Map();
  for(const [k,v] of Object.entries(row||{})) map.set(purchaseHeaderKey(k),v);
  for(const a of aliases){
    const key=purchaseHeaderKey(a);
    if(map.has(key)){
      const v=map.get(key);
      if(v!==null&&v!==undefined&&String(v).trim()!=='')return v;
    }
  }
  return '';
}
function findProductForPurchase(s,code,name='',itemCode=''){
  const keys=[code,itemCode,name].map(normKey).filter(Boolean);
  const list=s.products||[];
  for(const k of keys){
    const exact=list.find(p=>
      normKey(p.code)===k||normKey(p.searchName)===k||normKey(p.itemCode)===k||
      normKey(p.barcode)===k||normKey(p.dynamicsProductId)===k
    );
    if(exact)return exact;
  }
  const nk=normKey(name);
  if(nk){
    const byName=list.find(p=>normKey(p.name)===nk);
    if(byName)return byName;
  }
  return null;
}
function purchaseBufferText(buffer){
  const utf8=String(buffer.toString('utf8')||'').replace(/^\uFEFF/,'');
  if(/Madde kodu|Maliyet|Arama ad|Ürün numar/i.test(utf8.slice(0,1000)))return utf8;
  // Excel TR bazen Windows-1254 kaydeder — latin1 ile dene
  const latin=String(buffer.toString('latin1')||'').replace(/^\uFEFF/,'');
  if(/Madde|Maliyet|Arama|Fatura/i.test(latin.slice(0,1000)))return latin;
  return utf8;
}
function parsePurchaseCsvBuffer(buffer){
  const text=purchaseBufferText(buffer);
  const first=text.split(/\r?\n/).find(l=>String(l||'').trim())||'';
  const semi=(first.match(/;/g)||[]).length;
  const comma=(first.match(/,/g)||[]).length;
  const tab=(first.match(/\t/g)||[]).length;
  // İstikbal 3 kolon: Malzeme1;Metin;Birim Fiyat → sadece 2 adet ';'
  const delim=semi>=1&&semi>=comma&&semi>=tab?';':(tab>=1&&tab>=comma?'\t':',');
  const lines=text.split(/\r?\n/).filter(l=>String(l||'').trim());
  if(lines.length<2)return [];
  const headers=lines[0].split(delim).map(h=>String(h||'').trim().replace(/^"|"$/g,'').replace(/^\uFEFF/,''));
  return lines.slice(1).map(line=>{
    const cols=line.split(delim).map(c=>String(c||'').trim().replace(/^"|"$/g,''));
    const row={};
    headers.forEach((h,i)=>{row[h]=cols[i]!=null?cols[i]:''});
    // Dynamics sabit kolon sırası yedek eşleme
    if(headers.length>=13 && (!row['Maliyet tutarı']&&!row['Madde kodu'])){
      row['Ürün numarası']=cols[0]||'';
      row['Madde kodu']=cols[1]||'';
      row['Arama adı']=cols[2]||'';
      row['Ürün adı']=cols[3]||'';
      row['Fiili tarih']=cols[4]||'';
      row['Taraf']=cols[7]||'';
      row['Miktar']=cols[10]||'';
      row['Maliyet tutarı']=cols[12]||'';
      row['Arçelik Fatura Numarası']=cols[14]||'';
    }
    // İstikbal fiyat listesi: Malzeme1 ; Malzeme Uzun Metni ; Birim Fiyat
    if(headers.length>=3 && (purchaseHeaderKey(headers[0]).startsWith('malzeme')||/malzeme1/i.test(headers[0]||'')) && !row['Madde kodu']&&!row['Malzeme1']){
      row['Malzeme1']=cols[0]||'';
      row['Malzeme Uzun Metni E']=cols[1]||'';
      row['Birim Fiyat']=cols[2]||'';
    }
    return row;
  });
}
function purchasePickContains(row,needles=[]){
  const map=new Map();
  for(const [k,v] of Object.entries(row||{})) map.set(purchaseHeaderKey(k),v);
  for(const [k,v] of map){
    if(v===null||v===undefined||String(v).trim()==='')continue;
    for(const n of needles){
      if(k.includes(purchaseHeaderKey(n)))return v;
    }
  }
  return '';
}
function parsePurchaseDate(dateVal){
  if(dateVal instanceof Date)return dateVal.toISOString().slice(0,10);
  const s=String(dateVal||'').trim();
  if(/^\d{1,2}\.\d{1,2}\.\d{4}$/.test(s)){
    const [d,m,y]=s.split('.');
    return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
  }
  if(/^\d{4}-\d{2}-\d{2}/.test(s))return s.slice(0,10);
  return s.slice(0,10);
}
function parsePurchaseVat(raw){
  const s=String(raw||'').trim();
  const m=s.match(/(\d{1,2})/);
  if(m)return Number(m[1])||20;
  return normalizeNumber(raw)||20;
}
function purchaseSheetRows(ws){
  // Başlık satırını bul + hem ham sayı hem formatlı metni al (Excel TR/US)
  const aoaRaw=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:true});
  const aoaFmt=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:false});
  if(!aoaRaw.length)return [];
  let headerIdx=0;
  for(let i=0;i<Math.min(aoaRaw.length,15);i++){
    const line=(aoaRaw[i]||[]).map(c=>String(c??'')).join(' | ');
    if(/Madde\s*kodu|Maliyet\s*tutar|Arama\s*ad|Ürün\s*numar|Cost\s*amount|Malzeme1|Birim\s*Fiyat|Malzeme\s*Uzun/i.test(line)){headerIdx=i;break}
  }
  const headers=(aoaRaw[headerIdx]||[]).map(h=>String(h??'').trim());
  let costIdx=headers.findIndex(h=>{
    const k=purchaseHeaderKey(h);
    return k.includes('maliyettutar')||k.includes('costamount')||k==='maliyet'||k==='birimmaliyet'||k==='birimfiyat';
  });
  // Dynamics hareket export: M kolonu (index 12) = Maliyet tutarı
  if(costIdx<0&&headers.length>=13)costIdx=12;
  const rows=[];
  for(let r=headerIdx+1;r<aoaRaw.length;r++){
    const cols=aoaRaw[r]||[];
    const colsFmt=(aoaFmt[r]||[]);
    if(!cols.some(c=>c!==null&&c!==undefined&&String(c).trim()!==''))continue;
    const row={};
    headers.forEach((h,i)=>{
      if(!h)return;
      const raw=cols[i], fmt=colsFmt[i];
      // Sayı kolonlarında ham değeri tercih et; 0/boşsa formatlı metni dene
      if(typeof raw==='number'&&Number.isFinite(raw))row[h]=raw;
      else if(raw!==null&&raw!==undefined&&String(raw).trim()!=='')row[h]=raw;
      else row[h]=fmt??'';
    });
    // Maliyet yedek: başlık eşleşmese bile index 12 / bulunan costIdx
    if(costIdx>=0){
      const raw=cols[costIdx], fmt=colsFmt[costIdx];
      const nRaw=normalizeNumber(raw);
      const nFmt=normalizeNumber(fmt);
      const best=nRaw>0?raw:(nFmt>0?fmt:raw);
      if(!row['Maliyet tutarı']&&best!==''&&best!=null)row['Maliyet tutarı']=best;
      row.__costRaw=best;
    }
    rows.push(row);
  }
  return rows;
}
function parsePurchaseWorkbook(buffer,fileName=''){
  let rows=[];
  const asText=purchaseBufferText(buffer);
  const name=String(fileName||'').toLocaleLowerCase('tr-TR');
  const isZip=Buffer.isBuffer(buffer)&&buffer.length>3&&buffer[0]===0x50&&buffer[1]===0x4b; // PK = xlsx
  // .xlsx asla CSV sanılmasın
  const looksCsv=!isZip&&(name.endsWith('.csv')||((name.endsWith('.txt')||!/\.xlsx?$/.test(name))&&/Maliyet tutar|Madde kodu|Arama ad|Ürün numar|Fatura|Malzeme1|Birim Fiyat|Malzeme Uzun/i.test(asText.slice(0,1200))&&(/;|,|\t/).test(asText.slice(0,300))));
  if(looksCsv){
    rows=parsePurchaseCsvBuffer(buffer);
  }else{
    const wb=XLSX.read(buffer,{type:'buffer',cellDates:true,codepage:1254,cellText:true});
    const sheetName=wb.SheetNames.find(n=>{
      const ws=wb.Sheets[n];
      const sample=XLSX.utils.sheet_to_json(ws,{header:1,defval:''}).slice(0,5).map(r=>(r||[]).join(' ')).join(' ');
      return /Madde|Maliyet|Arama|Fatura|Ürün|Malzeme1|Birim Fiyat|Malzeme Uzun/i.test(sample);
    })||wb.SheetNames[0];
    const ws=wb.Sheets[sheetName];
    if(!ws)throw new Error('Excel içinde çalışma sayfası bulunamadı');
    rows=purchaseSheetRows(ws);
  }
  if(!rows.length)throw new Error('Excel/CSV boş görünüyor');

  const codeAliases=['Ürün Kodu','Urun Kodu','Madde Kodu','Madde kodu','Ürün numarası','Urun numarasi','Malzeme Kodu','Malzeme1','Malzeme 1','Malzeme No','Malzeme','Stok Kodu','Kod','Barkod','Item Code','Material'];
  const searchAliases=['Arama Adı','Arama Adi','Arama adı','Search name'];
  const nameAliases=['Ürün Adı','Urun Adi','Ürün adı','Malzeme Adı','Malzeme Uzun Metni E','Malzeme Uzun Metni','Malzeme Uzun Metin','Uzun Metin','Malzeme Tanımı','Açıklama','Aciklama','Ürün','Product Name','Tanım'];
  const qtyAliases=['Miktar','Quantity','Qty','Miktarı'];
  // Maliyet / birim fiyat — İstikbal "Birim Fiyat" dahil
  const unitAliases=['Maliyet tutarı','Maliyet tutari','Maliyet Tutarı','Cost amount','Maliyet tutar','Birim maliyet','Birim Maliyet','Birim Fiyat','Birim Fiyatı','Alış Fiyatı','Alis Fiyati','Net Birim Fiyat','Birim Tutar','Unit Price','Maliyet','Fiyat'];
  const totalAliases=['Satır Tutarı','Satir Tutari','Line Total','Net Tutar','Malzeme Tutarı','Toplam Tutar'];
  const invAliases=['Fatura No','Fatura Numarası','Fatura Numarasi','Belge No','Invoice No','Arçelik Fatura Numarası','Arcelik Fatura Numarasi'];
  const dateAliases=['Fatura Tarihi','Tarih','Belge Tarihi','Invoice Date','Date','Fiili tarih','Fiili Tarih'];
  const vatAliases=['KDV','KDV %','KDV Oranı','KDV Orani','Vat','VAT %','Madde satış vergisi grubu','Madde satis vergisi grubu'];
  const supplierAliases=['Tedarikçi','Tedarikci','Cari','Firma','Supplier','Taraf'];

  const parsed=rows.map((r,index)=>{
    const itemCode=String(
      purchasePick(r,['Madde Kodu','Madde kodu','Ürün numarası','Urun numarasi','Malzeme Kodu','Malzeme1','Malzeme 1','Malzeme No','Malzeme'])||
      purchasePickContains(r,['maddekod','urunnumara','malzemekod','malzeme1','malzemeno'])||''
    ).trim();
    const searchName=String(purchasePick(r,searchAliases)||purchasePickContains(r,['aramaad'])||'').trim();
    const productName=String(
      purchasePick(r,nameAliases)||
      purchasePickContains(r,['urunad','malzemead','malzemeuzun','uzunmetin','tanim'])||
      searchName||''
    ).trim();
    // Benzersiz kod: Madde/Malzeme kodu
    const productCode=String(itemCode||searchName||purchasePick(r,codeAliases)||productName||'').trim();
    let quantity=normalizeNumber(purchasePick(r,qtyAliases)||purchasePickContains(r,['miktar','qty'])||0);
    let costRaw=r.__costRaw;
    if(costRaw===''||costRaw==null)costRaw=purchasePick(r,unitAliases);
    if(costRaw===''||costRaw==null){
      for(const [k,v] of Object.entries(r||{})){
        if(k.startsWith('__'))continue;
        if(v===null||v===undefined||String(v).trim()==='')continue;
        const hk=purchaseHeaderKey(k);
        if(hk.includes('maliyettutar')||hk.includes('costamount')||hk==='maliyet'||hk==='birimmaliyet'||hk==='birimfiyat'||hk==='fiyat'){costRaw=v;break}
      }
    }
    if(costRaw===''||costRaw==null){
      costRaw=purchasePickContains(r,['birimfiyat','alisfiyat','unitprice','fiyat'])||'';
    }
    let unitCost=normalizeNumber(costRaw||0);
    const lineTotalRaw=normalizeNumber(purchasePick(r,totalAliases)||0);
    // Miktar yoksa (İstikbal fiyat listesi) → 1
    if(!(quantity>0)&&(unitCost>0||productCode))quantity=1;
    if(!(unitCost>0)&&lineTotalRaw>0&&quantity>0)unitCost=Math.round((lineTotalRaw/quantity)*100)/100;
    const lineTotal=lineTotalRaw>0?lineTotalRaw:Math.round(unitCost*Math.max(quantity||1,0)*100)/100;
    const dateVal=parsePurchaseDate(purchasePick(r,dateAliases)||purchasePickContains(r,['tarih','date']));
    const vatRaw=purchasePick(r,vatAliases)||purchasePickContains(r,['kdv','vat','vergi']);
    return{
      rowNo:index+2,
      invoiceNo:String(purchasePick(r,invAliases)||purchasePickContains(r,['fatura'])||'').trim(),
      date:dateVal,
      supplierName:String(purchasePick(r,supplierAliases)||purchasePickContains(r,['taraf','tedarik','supplier'])||'').trim(),
      productCode,itemCode,searchName,productName,
      quantity:quantity>0?quantity:0,
      unitCost,
      lineTotal,
      vatRate:parsePurchaseVat(vatRaw||20)||20
    };
  }).filter(r=>r.productCode||r.itemCode||r.productName||r.unitCost>0);

  if(!parsed.length)throw new Error('Satır bulunamadı. Madde kodu / Arama adı + Maliyet tutarı gerekli');

  // Aynı madde birden fazla satırda gelebilir → birleştir (miktar toplam, maliyet son tarih)
  const merged=new Map();
  for(const r of parsed){
    const key=normKey(r.itemCode||r.productCode||r.productName);
    if(!key)continue;
    if(!merged.has(key)){
      merged.set(key,{...r,quantity:r.quantity>0?r.quantity:1});
      continue;
    }
    const cur=merged.get(key);
    cur.quantity=(cur.quantity||0)+(r.quantity>0?r.quantity:1);
    const newer=!cur.date||(r.date&&String(r.date)>=String(cur.date));
    if(newer&&r.unitCost>0){
      cur.unitCost=r.unitCost;cur.date=r.date||cur.date;
      cur.invoiceNo=r.invoiceNo||cur.invoiceNo;
    }
    if(!cur.productName&&r.productName)cur.productName=r.productName;
    if(!cur.searchName&&r.searchName)cur.searchName=r.searchName;
    cur.lineTotal=Math.round((cur.unitCost||0)*(cur.quantity||0)*100)/100;
  }
  return [...merged.values()];
}
function purchaseBrandFromSupplier(supplierName='',productName=''){
  const blob=`${supplierName} ${productName}`.toLocaleUpperCase('tr-TR');
  if(/SAMSUNG/.test(blob))return 'Samsung';
  if(/XIAOMI|REDMI|POCO/.test(blob))return 'Xiaomi';
  if(/APPLE|IPHONE/.test(blob))return 'Apple';
  if(/ISTIKBAL|İSTİKBAL|DO[GĞ]TA[SŞ]/.test(blob))return 'İstikbal';
  if(/GRUNDIG/.test(blob))return 'Grundig';
  if(/AR[CÇ]EL[Iİ]K|BEKO/.test(blob))return 'Beko';
  return 'Beko';
}
function isIstikbalSupplier(supplierName=''){
  return /ISTIKBAL|İSTİKBAL|DO[GĞ]TA[SŞ]/i.test(String(supplierName||''));
}
function resolvePurchaseCategoryId(s,categoryId,supplierName,hint=''){
  const wanted=String(categoryId||'').trim();
  if(wanted){
    const hit=(s.categories||[]).find(c=>String(c.id)===wanted&&c.active!==false);
    if(hit)return hit.id;
  }
  const furniture=isIstikbalSupplier(supplierName);
  const ids=ensureDynamicsCoreCategories(s);
  if(furniture)return ids.mobilya;
  return dynamicsSuggestedCategoryId(s,hint)||ids.diger||ids.beyazEsya||'';
}
function ensureProductFromPurchase(s,{productCode,productName,itemCode,searchName,unitCost,vatRate,supplierName,importBatchId,categoryId}){
  const code=String(productCode||itemCode||searchName||productName||'').trim();
  if(!code)return null;
  const furniture=isIstikbalSupplier(supplierName);
  // İstikbal: Malzeme1 = kod, Malzeme Uzun Metni = ad (satışta malzeme adı üstte)
  const niceName=String(productName||searchName||'').trim();
  const name=(furniture?(niceName||code):(niceName||searchName||productCode||code)).trim()||code;
  const materialLabel=furniture
    ? String(niceName||name).trim()||code
    : String(searchName||niceName||code).trim()||code;
  // Seçilen kategori öncelikli; yoksa İstikbal→Mobilya / diğerinde öneri
  const category=resolvePurchaseCategoryId(s,categoryId,supplierName,`${name} ${searchName||''} ${code}`);
  const brand=furniture?'İstikbal':purchaseBrandFromSupplier(supplierName,`${name} ${searchName||''}`);
  const resolvedVat=furniture?10:(normalizeNumber(vatRate||20)||20);
  const product=sanitizeProduct({
    code,
    name,
    searchName:materialLabel,
    itemCode:String(itemCode||code).trim(),
    brand,
    category,
    purchasePrice:normalizeNumber(unitCost||0),
    vatRate:resolvedVat,
    listPrice:0,
    cashPrice:0,
    cardPrice:0,
    stock:0,
    active:true,
    tags:furniture?['alis-faturasi','auto-created','istikbal','mobilya']:['alis-faturasi','auto-created']
  });
  product.purchasePriceSource='purchase-invoice';
  product.purchasePriceUpdatedAt=new Date().toISOString();
  if(importBatchId)product.importBatchId=importBatchId;
  s.products.unshift(product);
  return product;
}
function applyPurchaseInvoiceToStore(s,{
  supplierName='Arçelik A.Ş.',
  invoiceNo='',
  date='',
  warehouseId='',
  note='',
  source='manual',
  updatePurchasePrice=true,
  addStock=false,
  pricesIncludeVat=true,
  createMissingProducts=true,
  categoryId='',
  items=[],
  actor='Yönetici'
}={}){
  const round=n=>Math.round(Number(n||0)*100)/100;
  const wh=String(warehouseId||s.warehouses?.find(w=>w.active!==false)?.id||'');
  const importBatchId=crypto.randomUUID();
  const cleanItems=[];
  let matched=0,unmatched=0,created=0,priceUpdated=0,stockUpdated=0,total=0;
  const furniture=isIstikbalSupplier(supplierName);
  const chosenCategoryId=String(categoryId||'').trim();

  for(const raw of (Array.isArray(items)?items:[])){
    const productCode=String(raw.productCode||raw.searchName||'').trim();
    const productName=String(raw.productName||'').trim();
    const itemCode=String(raw.itemCode||'').trim();
    const searchName=String(raw.searchName||productCode||'').trim();
    const qty=Math.max(0,normalizeNumber(raw.quantity||0));
    let unitCost=normalizeNumber(raw.unitCost||0);
    let vatRate=normalizeNumber(raw.vatRate!=null?raw.vatRate:20)||20;
    if(furniture)vatRate=10;
    if(!(qty>0)||(!productCode&&!productName&&!itemCode)){unmatched++;continue}
    // Arçelik maliyet modunda fiyat zorunlu; İstikbal katalogda 0 fiyatlı ürün de açılsın
    if(updatePurchasePrice&&!(unitCost>0)&&!furniture){unmatched++;continue}
    if(!pricesIncludeVat&&unitCost>0)unitCost=round(unitCost*(1+vatRate/100));

    let product=findProductForPurchase(s,productCode,productName,itemCode);
    let createdNow=false;
    if(!product&&createMissingProducts){
      product=ensureProductFromPurchase(s,{
        productCode:productCode||searchName||itemCode,
        productName,itemCode,searchName,
        unitCost:unitCost>0?unitCost:0,
        vatRate,supplierName,importBatchId,
        categoryId:String(raw.categoryId||chosenCategoryId||'').trim()
      });
      if(product){created++;createdNow=true}
    }
    const prevCost=createdNow?0:normalizeNumber(product?.purchasePrice||0);
    const lineTotal=round(qty*Math.max(unitCost,0));
    total+=lineTotal;
    const line={
      productId:product?.id||'',
      productCode:product?.code||productCode,
      itemCode:itemCode||product?.itemCode||'',
      productName:product?.name||productName||productCode,
      quantity:qty,
      unitCost,
      lineTotal,
      vatRate,
      matched:Boolean(product)&&!createdNow,
      created:createdNow,
      previousPurchasePrice:prevCost
    };
    if(!product){unmatched++;cleanItems.push(line);continue}
    if(!createdNow)matched++;
    // İstikbal eşleşenlerde marka + malzeme adı düzelt; kategori seçildiyse onu kullan
    if(furniture){
      product.brand='İstikbal';
      const rowCat=String(raw.categoryId||chosenCategoryId||'').trim();
      product.category=resolvePurchaseCategoryId(s,rowCat,supplierName,`${product.name||''} ${productCode}`);
      product.vatRate=10;
      if(productName){
        product.name=productName;
        product.searchName=productName; // satışta malzeme adı (üstte)
      }
      if(itemCode)product.itemCode=itemCode;
      product.updatedAt=new Date().toISOString();
      const tags=new Set([...(product.tags||[]).map(String),'istikbal','mobilya','alis-faturasi']);
      product.tags=[...tags];
    } else if(createdNow===false&&chosenCategoryId&&!product.category){
      product.category=resolvePurchaseCategoryId(s,chosenCategoryId,supplierName,'');
    }
    // Sadece maliyet (veya both) modunda alış fiyatı yazılır; stok modunda mevcut maliyete dokunulmaz.
    if(updatePurchasePrice&&unitCost>0){
      product.purchasePrice=unitCost;
      product.purchasePriceSource='purchase-invoice';
      product.purchasePriceUpdatedAt=new Date().toISOString();
      product.updatedAt=new Date().toISOString();
      product.importBatchId=importBatchId;
      if(itemCode&&!product.itemCode)product.itemCode=itemCode;
      priceUpdated++;
    }else if(createdNow||addStock||furniture){
      product.importBatchId=importBatchId;
      if(itemCode&&!product.itemCode)product.itemCode=itemCode;
    }
    if(addStock&&wh){
      addStockMovement(s,{
        productCode:product.code,
        warehouseId:wh,
        type:'purchase',
        quantity:qty,
        reference:invoiceNo||'Alış faturası',
        note:`${supplierName} alış`,
        user:actor
      });
      stockUpdated++;
    }
    cleanItems.push(line);
  }
  if(!cleanItems.length)throw new Error(updatePurchasePrice
    ?'Kaydedilecek geçerli satır yok (ürün kodu + miktar + maliyet gerekli)'
    :'Kaydedilecek geçerli satır yok (ürün kodu + miktar gerekli)');

  const invoice={
    id:importBatchId,
    date:String(date||todayISO()).slice(0,10),
    supplierName:String(supplierName||'Arçelik A.Ş.').trim()||'Arçelik A.Ş.',
    invoiceNo:String(invoiceNo||'').trim(),
    warehouseId:wh,
    note:String(note||'').trim(),
    source:String(source||'manual'),
    updatePurchasePrice:Boolean(updatePurchasePrice),
    addStock:Boolean(addStock),
    createMissingProducts:Boolean(createMissingProducts),
    pricesIncludeVat:Boolean(pricesIncludeVat),
    items:cleanItems,
    total:round(total),
    matched,unmatched,created,priceUpdated,stockUpdated,
    reverted:false,
    createdBy:actor,
    createdAt:new Date().toISOString()
  };
  s.purchaseInvoices.unshift(invoice);
  if(s.purchaseInvoices.length>500)s.purchaseInvoices=s.purchaseInvoices.slice(0,500);
  return invoice;
}
function revertPurchaseInvoiceInStore(s,invoiceId){
  const inv=(s.purchaseInvoices||[]).find(x=>String(x.id)===String(invoiceId));
  if(!inv)throw new Error('Alış aktarımı bulunamadı');
  if(inv.reverted)throw new Error('Bu aktarım zaten geri alınmış');
  let productsRemoved=0,pricesRestored=0,skippedSales=0;
  for(const line of (inv.items||[])){
    const product=(s.products||[]).find(p=>
      (line.productId&&String(p.id)===String(line.productId))||
      normKey(p.code)===normKey(line.productCode)||
      (line.itemCode&&normKey(p.itemCode)===normKey(line.itemCode))
    );
    if(!product)continue;
    if(line.created){
      const hasSale=(s.financeTransactions||[]).some(t=>
        t.kind==='sale'&&!t.cancelled&&Array.isArray(t.items)&&
        t.items.some(i=>normKey(i.productCode)===normKey(product.code))
      );
      if(hasSale){
        product.active=false;
        skippedSales++;
      }else{
        s.products=s.products.filter(p=>p.id!==product.id);
        productsRemoved++;
      }
      continue;
    }
    if(line.previousPurchasePrice!=null){
      product.purchasePrice=normalizeNumber(line.previousPurchasePrice);
      product.purchasePriceSource='purchase-invoice-revert';
      product.purchasePriceUpdatedAt=new Date().toISOString();
      pricesRestored++;
    }
  }
  inv.reverted=true;
  inv.revertedAt=new Date().toISOString();
  inv.revertResult={productsRemoved,pricesRestored,skippedSales};
  return {invoice:inv,productsRemoved,pricesRestored,skippedSales};
}

app.get('/web-api/admin/purchase-invoices',requireAdmin,(req,res)=>{
  const s=readStore();
  const list=(s.purchaseInvoices||[]).slice(0,100).map(inv=>({
    id:inv.id,date:inv.date,supplierName:inv.supplierName,invoiceNo:inv.invoiceNo,
    total:inv.total,matched:inv.matched,unmatched:inv.unmatched,created:inv.created||0,
    priceUpdated:inv.priceUpdated,stockUpdated:inv.stockUpdated,
    source:inv.source,itemCount:(inv.items||[]).length,createdAt:inv.createdAt,createdBy:inv.createdBy,
    reverted:Boolean(inv.reverted)
  }));
  res.json({
    ok:true,
    invoices:list,
    suppliers:(s.suppliers||[]).filter(x=>x.active!==false),
    warehouses:(s.warehouses||[]).filter(w=>w&&w.active!==false&&!w.deletedAt).map(w=>{
      const storeName=(s.stores||[]).find(st=>String(st.id)===String(w.storeId||''))?.name||'';
      return{id:w.id,name:w.name,code:w.code||'',storeId:w.storeId||'',storeName};
    }),
    categories:(s.categories||[]).filter(c=>c&&c.active!==false).map(c=>({id:c.id,name:c.name})).sort((a,b)=>String(a.name).localeCompare(String(b.name),'tr'))
  });
});

app.get('/web-api/admin/purchase-invoice-template',requireAdmin,(req,res)=>{
  const rows=[
    {
      'Fatura No':'ARC2026001',
      'Fatura Tarihi':todayISO(),
      'Tedarikçi':'Arçelik A.Ş.',
      'Ürün Kodu':'C9100',
      'Ürün Adı':'Örnek Çamaşır Makinesi',
      'Miktar':1,
      'Birim Fiyat':18500,
      'KDV %':20
    },
    {
      'Fatura No':'ARC2026001',
      'Fatura Tarihi':todayISO(),
      'Tedarikçi':'Arçelik A.Ş.',
      'Ürün Kodu':'BM3143',
      'Ürün Adı':'Örnek Bulaşık Makinesi',
      'Miktar':2,
      'Birim Fiyat':9200,
      'KDV %':20
    }
  ];
  const ws=XLSX.utils.json_to_sheet(rows);
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'Alis Faturalari');
  const buf=XLSX.write(wb,{type:'buffer',bookType:'xlsx'});
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition','attachment; filename="atak-alis-fatura-sablonu.xlsx"');
  res.send(Buffer.from(buf));
});

app.post('/web-api/admin/purchase-invoice-preview',requireAdmin,dynamicsUpload.single('file'),(req,res)=>{
  try{
    if(!req.file)return res.status(400).json({error:'Excel dosyası seçilmelidir'});
    const s=readStore();
    const rows=parsePurchaseWorkbook(req.file.buffer,req.file.originalname||'');
    let matched=0,willCreate=0,invalid=0,stockOk=0,withCost=0;
    const preview=rows.map(r=>{
      const hasCode=Boolean(r.productCode||r.itemCode||r.productName||r.searchName);
      if(!(r.quantity>0))r.quantity=r.unitCost>0?1:0;
      if(!hasCode||!(r.quantity>0)){
        invalid++;
        const why=!hasCode?'ürün kodu yok':'miktar yok';
        return{...r,status:'invalid',reason:why,matchCode:'',currentPurchasePrice:0};
      }
      const p=findProductForPurchase(s,r.productCode||r.searchName,r.productName,r.itemCode);
      const hasCost=r.unitCost>0;
      if(hasCost)withCost++; else stockOk++;
      if(p){
        matched++;
        return{...r,status:'matched',reason:hasCost?'':'maliyet yok (stok aktarılabilir)',matchCode:p.code,productName:r.productName||p.name,currentPurchasePrice:normalizeNumber(p.purchasePrice||0)};
      }
      willCreate++;
      return{...r,status:'will_create',reason:hasCost?'':'maliyet yok (stok aktarılabilir)',matchCode:'',currentPurchasePrice:0};
    });
    const invoiceNos=[...new Set(preview.map(x=>x.invoiceNo).filter(Boolean))];
    res.json({
      ok:true,
      total:preview.length,matched,willCreate,unmatched:willCreate,invalid,stockOk,withCost,
      invoiceNos,
      preview:preview.slice(0,400),
      truncated:preview.length>400,
      note:'Dynamics CSV (Maliyet tutarı / Madde kodu) desteklenir. Aktarımı sonra listeden geri alıp silebilirsiniz.'
    });
  }catch(e){
    res.status(400).json({error:e.message||'Excel okunamadı'});
  }
});

app.post('/web-api/admin/purchase-invoice-import',requireAdmin,dynamicsUpload.single('file'),(req,res)=>{
  try{
    if(!req.file)return res.status(400).json({error:'Excel dosyası seçilmelidir'});
    const s=readStore();
    const rows=parsePurchaseWorkbook(req.file.buffer,req.file.originalname||'');
    const actor=currentSessionUser(req)?.name||'Yönetici';
    const mode=String(req.body?.mode||'cost'); // cost | stock | both
    const createMissingProducts=true; // yoksa kart açılsın
    const updatePurchasePrice=mode==='cost'||mode==='both';
    const addStock=mode==='stock'||mode==='both'||String(req.body?.addStock||'0')==='1';
    const pricesIncludeVat=String(req.body?.pricesIncludeVat??'1')!=='0';
    const warehouseId=String(req.body?.warehouseId||'');
    const supplierFallback=String(req.body?.supplierName||'Arçelik A.Ş.').trim()||'Arçelik A.Ş.';
    const categoryId=String(req.body?.categoryId||'').trim();
    let categoryMap={};
    try{
      const rawMap=req.body?.categoryMap;
      categoryMap=typeof rawMap==='string'?JSON.parse(rawMap||'{}'):(rawMap&&typeof rawMap==='object'?rawMap:{});
      if(!categoryMap||typeof categoryMap!=='object'||Array.isArray(categoryMap))categoryMap={};
    }catch{ categoryMap={}; }
    const lookupRowCategory=(r)=>{
      const keys=[r.itemCode,r.productCode,r.searchName,r.productName]
        .map(x=>String(x||'').trim()).filter(Boolean);
      for(const k of keys){
        const hit=String(categoryMap[k]||'').trim();
        if(hit)return hit;
      }
      return categoryId;
    };
    if(addStock&&!warehouseId)return res.status(400).json({error:'Stok aktarımı için depo seçilmelidir'});
    const furniture=isIstikbalSupplier(supplierFallback);
    const validCatIds=new Set((s.categories||[]).filter(c=>c&&c.active!==false).map(c=>String(c.id)));

    const items=rows
      .filter(r=>{
        const hasCode=r.productCode||r.productName||r.itemCode;
        if(!hasCode||!(r.quantity>0))return false;
        // İstikbal: 0 fiyatlı satırlar da ürün kartı açılsın (Mobilya)
        if(furniture&&(mode==='cost'||mode==='both'))return true;
        if(mode==='cost'||mode==='both')return r.unitCost>0;
        return true; // stock: miktar yeterli
      })
      .map(r=>{
        const rowCat=lookupRowCategory(r);
        return{
          productCode:r.productCode,
          productName:r.productName,
          itemCode:r.itemCode,
          searchName:r.searchName,
          quantity:r.quantity>0?r.quantity:1,
          unitCost:r.unitCost>0?r.unitCost:0,
          vatRate:furniture?10:r.vatRate,
          categoryId:rowCat
        };
      });
    if(!items.length)return res.status(400).json({error:'Aktarılacak satır yok. Madde kodu / Miktar / Maliyet tutarı kontrol edin.'});

    const missingCats=[];
    for(const r of items){
      if(findProductForPurchase(s,r.productCode||r.searchName,r.productName,r.itemCode))continue;
      if(!r.categoryId){missingCats.push(r.itemCode||r.productCode||r.productName||'?');continue}
      if(!validCatIds.has(String(r.categoryId))){
        return res.status(400).json({error:`Geçersiz kategori: ${r.categoryId}`});
      }
    }
    if(missingCats.length){
      return res.status(400).json({error:`${missingCats.length} yeni ürünün kategorisi eksik — tabloda satır satır seçin`});
    }

    const invoiceNo=String(req.body?.invoiceNo||rows.find(r=>r.invoiceNo)?.invoiceNo||'').trim();
    const date=String(req.body?.date||rows.find(r=>r.date)?.date||todayISO()).slice(0,10);
    const supplierName=furniture
      ? supplierFallback
      : String(rows.find(r=>r.supplierName)?.supplierName||supplierFallback).trim();

    const invoice=applyPurchaseInvoiceToStore(s,{
      supplierName,invoiceNo,date,warehouseId,
      note:String(req.body?.note||`Excel alış (${mode})`),
      source:'excel',
      updatePurchasePrice,addStock,pricesIncludeVat,createMissingProducts,
      categoryId,items,actor
    });
    audit(s,'Alış faturası Excel aktarımı',invoice.invoiceNo||invoice.id,{
      mode,matched:invoice.matched,created:invoice.created,priceUpdated:invoice.priceUpdated,stockUpdated:invoice.stockUpdated,total:invoice.total
    });
    writeStore(s);
    res.json({ok:true,invoice:{
      id:invoice.id,date:invoice.date,invoiceNo:invoice.invoiceNo,supplierName:invoice.supplierName,
      total:invoice.total,matched:invoice.matched,unmatched:invoice.unmatched,created:invoice.created,
      priceUpdated:invoice.priceUpdated,stockUpdated:invoice.stockUpdated,itemCount:invoice.items.length,
      mode,reverted:false
    }});
  }catch(e){
    res.status(400).json({error:e.message||'Excel aktarılamadı'});
  }
});

app.post('/web-api/admin/purchase-invoice/:id/revert',requireAdmin,(req,res)=>{
  try{
    const s=readStore();
    const result=revertPurchaseInvoiceInStore(s,req.params.id);
    audit(s,'Alış aktarımı geri alındı',result.invoice.invoiceNo||result.invoice.id,result.invoice.revertResult||{});
    writeStore(s);
    res.json({ok:true,...result});
  }catch(e){
    res.status(400).json({error:e.message||'Geri alınamadı'});
  }
});

/** Yüklenen ürünlerde sadece alış maliyetini sıfırla — ürün kartı silinmez */
app.post('/web-api/admin/products/zero-purchase-costs',requireAdmin,(req,res)=>{
  try{
    const s=readStore();
    const scope=String(req.body?.scope||'istikbal').toLocaleLowerCase('tr-TR'); // istikbal | imported | all
    let cleared=0;
    for(const p of (s.products||[])){
      const brand=String(p.brand||'').toLocaleLowerCase('tr-TR');
      const tags=(p.tags||[]).map(t=>String(t).toLocaleLowerCase('tr-TR'));
      const src=String(p.purchasePriceSource||'');
      let match=false;
      if(scope==='all'){
        match=true; // alışı olan/olmayan tüm ürünler — source temizlensin
      }else if(scope==='imported'){
        match=tags.includes('alis-faturasi')||tags.includes('auto-created')||src.startsWith('purchase-invoice');
      }else{
        // istikbal (varsayılan)
        match=/istikbal/.test(brand)||tags.includes('istikbal')||(tags.includes('mobilya')&&tags.includes('alis-faturasi'));
      }
      if(!match)continue;
      const had=normalizeNumber(p.purchasePrice)>0||Boolean(p.purchasePriceSource);
      if(!had&&scope!=='all')continue;
      // scope=all: alışı >0 olanları mutlaka sıfırla; 0 olanlara dokunma
      if(scope==='all'&&!(normalizeNumber(p.purchasePrice)>0)&&!p.purchasePriceSource)continue;
      p.purchasePrice=0;
      p.purchasePriceSource='manual-zero';
      p.purchasePriceUpdatedAt=new Date().toISOString();
      p.updatedAt=new Date().toISOString();
      cleared++;
    }
    audit(s,'Alış maliyetleri sıfırlandı','Ürünler',{scope,cleared});
    writeStore(s);
    res.json({ok:true,cleared,scope});
  }catch(e){
    res.status(400).json({error:e.message||'Maliyetler sıfırlanamadı'});
  }
});

app.post('/web-api/admin/purchase-invoice',requireAdmin,(req,res)=>{
  try{
    const s=readStore();
    const x=req.body||{};
    const actor=currentSessionUser(req)?.name||'Yönetici';
    const items=Array.isArray(x.items)?x.items:[];
    if(!items.length)return res.status(400).json({error:'En az bir kalem girin'});
    const invoice=applyPurchaseInvoiceToStore(s,{
      supplierName:x.supplierName||'Arçelik A.Ş.',
      invoiceNo:x.invoiceNo||'',
      date:x.date||todayISO(),
      warehouseId:x.warehouseId||'',
      note:x.note||'',
      source:'manual',
      updatePurchasePrice:x.updatePurchasePrice!==false,
      addStock:Boolean(x.addStock),
      pricesIncludeVat:x.pricesIncludeVat!==false,
      createMissingProducts:x.createMissingProducts!==false,
      items,actor
    });
    audit(s,'Alış faturası manuel kayıt',invoice.invoiceNo||invoice.id,{
      matched:invoice.matched,created:invoice.created,priceUpdated:invoice.priceUpdated,total:invoice.total
    });
    writeStore(s);
    res.json({ok:true,invoice});
  }catch(e){
    res.status(400).json({error:e.message||'Alış faturası kaydedilemedi'});
  }
});

app.get('/web-api/admin/purchase-invoice/:id',requireAdmin,(req,res)=>{
  const s=readStore();
  const inv=(s.purchaseInvoices||[]).find(x=>String(x.id)===String(req.params.id));
  if(!inv)return res.status(404).json({error:'Alış faturası bulunamadı'});
  res.json({ok:true,invoice:inv});
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
  // POS satışları (Satış Merkezi) — dealer / ürün markasına göre Beko & İstikbal
  const pos={beko:0,istikbal:0,other:0};
  const posCounts={beko:0,istikbal:0,other:0};
  for(const t of (s.financeTransactions||[])){
    if(t.kind!=='sale'||t.cancelled)continue;
    const key=txDateKey(t);
    if(!key||key<startDate||key>endDate)continue;
    const b=dealerBrandKey(t);
    const amount=saleAmount(t);
    pos[b]=(pos[b]||0)+amount;
    posCounts[b]=(posCounts[b]||0)+1;
  }
  const round=n=>Math.round(Number(n||0)*100)/100;
  const atakhome=atakHomeRevenue(s,startDate,endDate);
  res.json({startDate,endDate,channels:{
    beko:{amount:round(manual.beko+pos.beko),orderCount:counts.beko+posCounts.beko,source:'pos+manual',posAmount:round(pos.beko),manualAmount:round(manual.beko)},
    istikbal:{amount:round(manual.istikbal+pos.istikbal),orderCount:counts.istikbal+posCounts.istikbal,source:'pos+manual',posAmount:round(pos.istikbal),manualAmount:round(manual.istikbal)},
    atakhome:{amount:atakhome.netAmount,orderCount:atakhome.orderCount,source:'automatic',grossAmount:atakhome.grossAmount,returnAmount:atakhome.returnAmount},
    hepsiburada:{amount:round(manual.hepsiburada),orderCount:counts.hepsiburada,source:'manual'},
    otherPos:{amount:round(pos.other),orderCount:posCounts.other,source:'pos'}
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

app.get('/web-admin',(req,res)=>{res.setHeader('Cache-Control','no-store, no-cache, must-revalidate, max-age=0');res.sendFile(path.join(ROOT,'public','admin.html'))});
app.get('/web-admin/*',(req,res)=>{res.setHeader('Cache-Control','no-store, no-cache, must-revalidate, max-age=0');res.sendFile(path.join(ROOT,'public','admin.html'))});
app.get('/web-admin-v5',(req,res)=>res.redirect('/web-admin'));
app.get('/web-admin-legacy',(req,res)=>res.sendFile(path.join(ROOT,'public','admin-v5.html')));
app.get('/personel',(req,res)=>{res.setHeader('Cache-Control','no-store, no-cache, must-revalidate, max-age=0');res.sendFile(path.join(ROOT,'public','personel.html'))});
app.get('/personel/*',(req,res)=>{res.setHeader('Cache-Control','no-store, no-cache, must-revalidate, max-age=0');res.sendFile(path.join(ROOT,'public','personel.html'))});
app.get('/',(req,res)=>res.redirect('/personel'));
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
