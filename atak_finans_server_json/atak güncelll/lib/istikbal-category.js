'use strict';

/**
 * İstikbal / Doğtaş ürün adından kategori tahmini.
 * Yavaş ve kural tabanlı (doğru eşleşme öncelikli); site scrape yok.
 */

function norm(v){
  return String(v||'').toLocaleLowerCase('tr-TR')
    .replace(/ı/g,'i').replace(/İ/g,'i')
    .replace(/ş/g,'s').replace(/ğ/g,'g')
    .replace(/ü/g,'u').replace(/ö/g,'o').replace(/ç/g,'c')
    .replace(/[^a-z0-9\s]+/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}

/** Öncelik sırası önemli — daha spesifik kurallar üstte */
const RULES=[
  {
    id:'istikbal-tekstil',
    name:'Ev Tekstili',
    aliases:['Tekstil','Nevresim'],
    sort:56,
    re:/\b(nevresim|yorgan|yastik|pike|carşaf|carsaf|alez|yatak ortusu|battaniye|hirka|havlu|perde)\b/
  },
  {
    id:'istikbal-bahce',
    name:'Bahçe Mobilyası',
    aliases:['Bahce','Dış Mekan','Dis Mekan'],
    sort:55,
    re:/\b(bahce|dis mekan|dismekan|rattan|salincak|seherlik|mangal)\b/
  },
  {
    id:'istikbal-genc',
    name:'Genç Odası',
    aliases:['Genc Odasi','Çocuk Odası','Cocuk Odasi'],
    sort:54,
    re:/\b(genc oda|gencodasi|cocuk oda|cocukodasi|genc yatak|ranza|calisma masasi)\b/
  },
  {
    id:'istikbal-yemek',
    name:'Yemek Odası',
    aliases:['Yemek Odasi','Mutfak Masası'],
    sort:53,
    re:/\b(yemek oda|yemekoda|yemek masas|sandalye|konsol|vitrin|büfe|bufe|servis dolabi)\b/
  },
  {
    id:'istikbal-yatak',
    name:'Yatak Odası',
    aliases:['Yatak Odasi','Yatak','Baza'],
    sort:52,
    re:/\b(yatak|baza|baslik|başlık|komodin|gardırop|gardirop|sokak dolabi|yatak odasi|yatakoda|karyola|şifonyer|sifonyer)\b/
  },
  {
    id:'istikbal-oturma',
    name:'Oturma Grubu',
    aliases:['Oturma','Koltuk','Kanepe'],
    sort:51,
    re:/\b(koltuk|kanepe|kose|köşe|berjer|oturma|chesteer|chester|loveseat|puf|divan|l koltuk|u koltuk)\b/
  },
  {
    id:'mobilya',
    name:'Mobilya',
    aliases:['İstikbal Mobilya'],
    sort:50,
    re:/\b(mobilya|istikbal|dogtas|doğtaş)\b/
  }
];

function classifyText(blob=''){
  const t=norm(blob);
  if(!t)return {id:'mobilya',name:'Mobilya',confidence:0.2,reason:'boş ad'};
  for(const rule of RULES){
    if(rule.re.test(t)){
      return {
        id:rule.id,
        name:rule.name,
        confidence:rule.id==='mobilya'?0.55:0.86,
        reason:`eşleşti: ${rule.name}`
      };
    }
  }
  // Kod / model ipuçları (İstikbal stok listeleri)
  if(/\b(kmx|baza|yatak)\b/.test(t)||/\bytk\b/.test(t)){
    return {id:'istikbal-yatak',name:'Yatak Odası',confidence:0.7,reason:'kod/yatak ipucu'};
  }
  if(/\b(klt|knp|otur)\b/.test(t)){
    return {id:'istikbal-oturma',name:'Oturma Grubu',confidence:0.65,reason:'kod/oturma ipucu'};
  }
  return {id:'mobilya',name:'Mobilya',confidence:0.45,reason:'varsayılan mobilya'};
}

function ensureFurnitureCategories(store){
  if(!store.categories)store.categories=[];
  const byNorm=new Map();
  for(const c of store.categories){
    byNorm.set(norm(c.name),c);
    byNorm.set(norm(c.id),c);
  }
  const ensured={};
  for(const rule of RULES){
    let hit=store.categories.find(c=>String(c.id)===rule.id)
      ||store.categories.find(c=>norm(c.name)===norm(rule.name))
      ||rule.aliases.map(a=>store.categories.find(c=>norm(c.name)===norm(a))).find(Boolean);
    if(!hit){
      hit={
        id:rule.id,
        name:rule.name,
        active:true,
        sort:rule.sort,
        description:'İstikbal otomatik kategori',
        tags:['istikbal','mobilya','furniture']
      };
      store.categories.push(hit);
    }else{
      hit.active=hit.active!==false;
      if(!hit.id)hit.id=rule.id;
      const tags=new Set([...(hit.tags||[]).map(String),'istikbal','mobilya','furniture']);
      hit.tags=[...tags];
    }
    ensured[rule.id]=hit.id;
  }
  return ensured;
}

function findCategoryId(store,guess){
  if(!guess)return '';
  const id=String(guess.id||'').trim();
  const name=String(guess.name||'').trim();
  const hit=(store.categories||[]).find(c=>
    (id&&String(c.id)===id)||
    (name&&norm(c.name)===norm(name))
  );
  return hit&&hit.active!==false?hit.id:'';
}

/**
 * @returns {{categoryId:string,categoryName:string,confidence:number,reason:string}}
 */
function suggestCategory(store,productName='',extra=''){
  ensureFurnitureCategories(store);
  const guess=classifyText(`${productName} ${extra}`);
  let categoryId=findCategoryId(store,guess);
  if(!categoryId){
    const ids=ensureFurnitureCategories(store);
    categoryId=ids[guess.id]||ids.mobilya||'mobilya';
  }
  const cat=(store.categories||[]).find(c=>String(c.id)===String(categoryId));
  return {
    categoryId,
    categoryName:cat?.name||guess.name,
    confidence:guess.confidence,
    reason:guess.reason
  };
}

function isFurnitureCategoryId(store,categoryId=''){
  const id=String(categoryId||'');
  if(!id)return false;
  if(id==='mobilya'||id.startsWith('istikbal-'))return true;
  const cat=(store.categories||[]).find(c=>String(c.id)===id);
  if(!cat)return false;
  const tags=(cat.tags||[]).map(t=>String(t).toLocaleLowerCase('tr-TR'));
  if(tags.includes('furniture')||tags.includes('mobilya')||tags.includes('istikbal'))return true;
  return /mobilya|yatak|oturma|yemek|genc|bahce|tekstil/i.test(String(cat.name||''));
}

module.exports={
  RULES,
  norm,
  classifyText,
  ensureFurnitureCategories,
  suggestCategory,
  isFurnitureCategoryId
};
