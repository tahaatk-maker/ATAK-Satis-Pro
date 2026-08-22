/**
 * Asistek müşteri Excel/CSV → Müşteri Ekle alanları.
 * Sadece telefonu olan satırlar alınır. Mevcut telefon/VKN/TCKN ezilmez.
 */
'use strict';

const {personNameKey}=require('./lib/customer-dedupe');

function fold(v){
  return String(v??'').trim().toLocaleLowerCase('tr-TR')
    .replace(/ğ/g,'g').replace(/ü/g,'u').replace(/ş/g,'s')
    .replace(/ı/g,'i').replace(/ö/g,'o').replace(/ç/g,'c')
    .replace(/[^a-z0-9]+/g,' ')
    .trim();
}
function cellStr(v){
  if(v==null||v==='')return '';
  if(typeof v==='number'&&Number.isFinite(v)){
    if(Math.abs(v-Math.round(v))<1e-6)return String(Math.round(v));
    return String(v);
  }
  if(v instanceof Date && !Number.isNaN(v.getTime()))return v.toISOString().slice(0,10);
  const s=String(v).replace(/^(?:\uFEFF|ï»¿)+/,'').trim();
  if(/^(null|n\/a|undefined|#n\/a)$/i.test(s))return '';
  return s;
}
function digits(v){return cellStr(v).replace(/\D/g,'')}
function normalizePhone(v){
  let d=digits(v);
  if(!d)return '';
  if(d.startsWith('90')&&d.length>=12)d=d.slice(2);
  if(d.length===10)d='0'+d;
  return d;
}
function isValidTrPhone(n){
  return /^0[2-5]\d{9}$/.test(String(n||''));
}
function splitPhoneGroups(text){
  return String(text||'').split(/\s{2,}|[/|,;]|(?:\s+-\s+)/).map(s=>s.trim()).filter(Boolean);
}
function extractBestPhone(texts){
  const found=[];
  const push=p=>{
    const n=normalizePhone(p);
    if(isValidTrPhone(n)&&!found.includes(n))found.push(n);
  };
  for(const text of (texts||[])){
    for(const g of splitPhoneGroups(text)){
      const d=digits(g);
      if(!d||d.length===7)continue;
      if(d.length<10)continue;
      let m; const mob=/0?5\d{9}/g;
      let any=false;
      while((m=mob.exec(d))){push(m[0]);any=true}
      if(any)continue;
      if(d.length===10||d.length===11)push(d);
    }
  }
  if(!found.length)return '';
  return found.find(p=>p.startsWith('05'))||found[0];
}
function phoneSkipReason(texts){
  const groups=(texts||[]).flatMap(t=>splitPhoneGroups(t));
  const digitLens=groups.map(g=>digits(g).length).filter(n=>n>0);
  if(!digitLens.length)return 'Telefon yok';
  if(digitLens.every(n=>n===7))return '7 haneli numara';
  if(digitLens.every(n=>n<10))return `${Math.max(...digitLens)} haneli numara`;
  return 'Geçerli telefon yok';
}
function hasPhone(v){
  return extractBestPhone([v]).length===11;
}
function normalizeBirthDate(v){
  if(v==null||v==='')return '';
  if(typeof v==='number'&&Number.isFinite(v)&&v>20000&&v<80000){
    const excel=new Date(Date.UTC(1899,11,30)+Math.round(v)*86400000);
    if(!Number.isNaN(excel.getTime()))return excel.toISOString().slice(0,10);
  }
  const s=cellStr(v);
  const iso=s.match(/^(\d{4}-\d{2}-\d{2})/);
  if(iso)return iso[1];
  const dotted=s.match(/^(\d{1,2})[.](\d{1,2})[.](\d{2,4})$/);
  if(dotted){
    let y=Number(dotted[3]);
    if(dotted[3].length===2)y=y>=70?1900+y:2000+y;
    return `${y}-${dotted[2].padStart(2,'0')}-${dotted[1].padStart(2,'0')}`;
  }
  const slashed=s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if(slashed){
    const a=Number(slashed[1]); const b=Number(slashed[2]); let y=Number(slashed[3]);
    if(slashed[3].length===2)y=y>=70?1900+y:2000+y;
    const mdy=a<=12&&b>12;
    const dd=String(mdy?b:a).padStart(2,'0');
    const mm=String(mdy?a:b).padStart(2,'0');
    return `${y}-${mm}-${dd}`;
  }
  return s.slice(0,32);
}

const COL_RULES=[
  ['musteriKodu', /^(musteri kodu|musteri no|musteri numarasi|cari kod|cari no)$/],
  ['tckn', /^(tc kimlik no|tckn|tc no|kimlik no|tc)$/],
  ['vergiNo', /^(vergi no|vkn|vergi numarasi)$/],
  ['vergiDaire', /^vergi dair/],
  ['vergiHint', /^vergi$/],
  ['ad', /^(ad|adi)$/],
  ['soyad', /^(soyad|soyadi)$/],
  ['yazismaUnvan', /^yazisma unvan/],
  ['yazismaAdres', /^yazisma adres/],
  ['dogumTarihi', /^dogum tarih/],
  ['gsm', /^(gsm|gsm no|gsm numarasi|cep telefonu)$/],
  ['isTel', /is (telefon|tel)/],
  ['evTel', /ev (telefon|tel)/],
  ['telefon', /^(telefon|tel|telefon no)$/],
  ['email', /^(e mail|email|eposta|e posta|mail)$/],
  ['isUnvan', /is yeri unvan/],
  ['kurumsalUnvan', /kurumsal unvan/],
  ['kurumsalAdres', /kurumsal adres/],
  ['evAdres', /^ev adres/],
  ['isAdres', /^is adres/],
  ['evMahalle', /^ev adresi mahalle$/],
  ['evCadde', /^ev adresi cadde$/],
  ['evSokak', /^ev adresi sokak$/],
  ['evKapi', /^ev adresi kapi/],
  ['evSehir', /^ev adresi sehir$/],
  ['isSehir', /^is adresi sehir$/],
  ['evIlce', /^ev adresi ilce$/],
  ['isIlce', /^is adresi ilce$/],
  ['evSemt', /^ev adresi semt$/],
  ['isSemt', /^is adresi semt$/],
  ['altSehir', /^alt adres sehir$/],
  ['altIlce', /^alt adres ilce$/],
  ['nufusIlce', /^(ilce)$/],
  ['sehirIl', /^(il)$/],
  ['mahalle', /^(adres mahalle|mahalle)$/],
  ['cadde', /^(adres cadde|cadde)$/],
  ['sokak', /^(adres sokak|sokak)$/],
  ['kapi', /^(adres kap|kapi no|kapi)$/],
  ['semt', /^semt$/],
  ['sehir', /^(sehir)$/],
  ['cariTipi', /^cari tip/],
  ['muhasebe', /^muhasebe/],
  ['unvan', /^(unvan|unvani|title|cari unvan|ad soyad|adi soyadi)$/],
  ['adres', /^(adres|acik adres)$/]
];

function isHeaderRow(cells){
  const folds=(cells||[]).map(c=>fold(c));
  const hasTel=folds.some(h=>
    /telefon|gsm|^tel$|ev tel|is tel|is telefon/.test(h)||h.startsWith('gsm')
  );
  const hasUnvan=folds.some(h=>h==='unvan'||h.includes('unvan')||h==='ad'||h==='soyad'||h==='adi'||h==='soyadi');
  const hasVergi=folds.some(h=>h.includes('vergi'));
  const hasCari=folds.some(h=>h.includes('cari tip'));
  const hasKod=folds.some(h=>h==='musteri kodu'||h==='musteri no'||h==='cari kod'||h==='cari no');
  const hasMail=folds.some(h=>h==='mail'||h==='e mail'||h==='email'||h==='eposta');
  return (hasTel||hasKod)&&(hasUnvan||hasVergi||hasCari||hasKod||hasMail);
}
function headerHasPhone(cols){
  return !!(cols&&(cols.telefon!=null||cols.gsm!=null||cols.isTel!=null||cols.evTel!=null));
}
function scoreHeaderCells(cells){
  if(!isHeaderRow(cells))return 0;
  const cols=mapHeader(cells);
  let s=1;
  if(headerHasPhone(cols))s+=20;
  if(cols.ad!=null||cols.soyad!=null)s+=8;
  if(cols.unvan!=null||cols.kurumsalUnvan!=null)s+=4;
  if(cols.musteriKodu!=null)s+=3;
  if(cols.tckn!=null)s+=2;
  if(cols.evAdres!=null||cols.adres!=null)s+=2;
  if(cols.email!=null)s+=1;
  return s;
}
function combineHeaderRows(rows,start,count){
  const slice=(rows||[]).slice(start,start+count);
  const width=Math.max(0,...slice.map(r=>(r||[]).length));
  return Array.from({length:width},(_,i)=>{
    const parts=[];
    for(const r of slice){
      const v=cellStr((r||[])[i]);
      if(!v)continue;
      if(!parts.some(p=>fold(p)===fold(v)))parts.push(v);
    }
    return parts.join(' ');
  });
}
function rowLooksLikeData(cells){
  const filled=(cells||[]).map(cellStr).filter(Boolean);
  if(filled.length<2)return false;
  if(filled.some(v=>extractBestPhone([v])))return true;
  if(filled.some(v=>digits(v).length>=10))return true;
  return filled.filter(v=>v.length>42).length>=2;
}
function rowLooksLikeHeaderLabels(cells){
  const filled=(cells||[]).map(cellStr).filter(Boolean);
  if(!filled.length)return true;
  if(rowLooksLikeData(cells))return false;
  if(isHeaderRow(cells))return true;
  return filled.length<=8&&filled.every(v=>String(v).length<=40);
}
function inferPhoneColumn(matrix,headerIndex,cols){
  if(headerHasPhone(cols))return cols;
  const start=headerIndex+1;
  const width=Math.max(0,...(matrix||[]).slice(start,start+80).map(r=>(r||[]).length));
  let bestI=-1,bestN=0;
  for(let i=0;i<width;i++){
    let n=0;
    for(let r=start;r<Math.min((matrix||[]).length,start+80);r++){
      if(extractBestPhone([cellStr((matrix[r]||[])[i])]))n++;
    }
    if(n>bestN){bestN=n;bestI=i}
  }
  if(bestN>=1&&bestI>=0)cols.isTel=bestI;
  return cols;
}
function findHeader(matrix){
  const rows=Array.isArray(matrix)?matrix:[];
  const max=Math.min(rows.length,40);
  let best=null;
  for(let start=0;start<max;start++){
    for(let count=1;count<=4&&start+count<=rows.length;count++){
      const window=rows.slice(start,start+count);
      if(count>1&&window.some(r=>!rowLooksLikeHeaderLabels(r)))break;
      const headers=combineHeaderRows(rows,start,count);
      const score=scoreHeaderCells(headers)-(count-1);
      if(score<=(best&&best.score||0))continue;
      best={index:start+count-1,cols:mapHeader(headers),headers,score};
    }
  }
  if(!best)return inferHeaderlessAsistek(rows);
  best.cols=inferPhoneColumn(rows,best.index,best.cols||{});
  return {index:best.index,cols:best.cols,headers:best.headers};
}
const ASISTEK_POS_17={
  musteriKodu:0,tckn:1,ad:2,soyad:3,unvan:4,evAdres:5,nufusIlce:6,sehirIl:7,
  email:8,dogumTarihi:9,kurumsalUnvan:10,kurumsalAdres:11,kurumsalIl:12,kurumsalIlce:13,
  vergiDaire:14,vergiNo:15,isTel:16
};
const ASISTEK_POS_16={
  musteriKodu:0,tckn:1,ad:2,soyad:3,evAdres:4,nufusIlce:5,sehirIl:6,
  email:7,dogumTarihi:8,kurumsalUnvan:9,kurumsalAdres:10,kurumsalIl:11,kurumsalIlce:12,
  vergiDaire:13,vergiNo:14,isTel:15
};
function looksLikeCustomerCode(v){
  const s=cellStr(v);
  if(!s)return false;
  if(/^0\d{5,10}$/.test(s))return true;
  if(/^[A-Za-z]\d{4,8}$/.test(s))return true;
  if(/^\d{4,8}$/.test(s))return true;
  if(/^\d{1,3}$/.test(s)&&Number(s)>0)return true;
  return false;
}
function looksLikePersonName(v){
  const s=cellStr(v);
  if(!s||s.length>64)return false;
  const k=fold(s);
  if(/^(ad|adi|soyad|soyadi|unvan|tc|mail|il|ilce|null|musteri no)$/.test(k))return false;
  return /[A-Za-zÇĞİÖŞÜçğıöşü]{2,}/.test(s);
}
function countColPhones(matrix,idx,limit=80){
  let n=0;
  for(const row of (matrix||[]).slice(0,limit)){
    if(extractBestPhone([cellStr((row||[])[idx])]))n++;
  }
  return n;
}
function firstAsistekDataRow(matrix){
  const max=Math.min(25,(matrix||[]).length);
  for(let i=0;i<max;i++){
    const r=matrix[i]||[];
    if(looksLikeCustomerCode(r[0])&&looksLikePersonName(r[2])&&looksLikePersonName(r[3]))return i;
  }
  return -1;
}
function inferHeaderlessAsistek(matrix){
  const start=firstAsistekDataRow(matrix);
  if(start<0)return null;
  const sample=(matrix||[]).slice(start,start+80);
  let codes=0,names=0,wide=0;
  for(const row of sample){
    const r=row||[];
    if(looksLikeCustomerCode(r[0]))codes++;
    if(looksLikePersonName(r[2])&&looksLikePersonName(r[3]))names++;
    if((r.length>=15)||r.filter(c=>cellStr(c)).length>=8)wide++;
  }
  const p16=countColPhones(sample,16);
  const p15=countColPhones(sample,15);
  if(codes<3||names<3||wide<3)return null;
  if(p16<1&&p15<1)return null;
  const use17=p16>=p15;
  return {
    index:start-1,
    cols:use17?{...ASISTEK_POS_17}:{...ASISTEK_POS_16},
    headers:use17
      ?['Müşteri no','TC','Ad','Soyad','Ünvan','Ev adres','İlçe','İl','Mail','Doğum tarihi','Kurumsal ünvan','Kurumsal adres','İl','İlçe','Vergi dairesi','Vergi no','İş telefonu']
      :['Müşteri no','TC','Ad','Soyad','Ev adres','İlçe','İl','Mail','Doğum tarihi','Kurumsal ünvan','Kurumsal adres','İl','İlçe','Vergi dairesi','Vergi no','İş telefonu'],
    inferred:true
  };
}
function mapHeader(cells){
  const cols={};
  let ilCount=0,ilceCount=0;
  (cells||[]).forEach((h,idx)=>{
    const key=fold(h);
    if(!key)return;
    if(key==='il'){
      ilCount++;
      if(ilCount===1){if(cols.sehirIl==null)cols.sehirIl=idx}
      else if(cols.kurumsalIl==null)cols.kurumsalIl=idx;
      return;
    }
    if(key==='ilce'){
      ilceCount++;
      if(ilceCount===1){if(cols.nufusIlce==null)cols.nufusIlce=idx}
      else if(cols.kurumsalIlce==null)cols.kurumsalIlce=idx;
      return;
    }
    for(const [field,re] of COL_RULES){
      if(cols[field]!=null)continue;
      if(re.test(key)){cols[field]=idx;break}
    }
  });
  return cols;
}
function pick(row,cols,field){
  const i=cols[field];
  if(i==null)return '';
  return cellStr(row[i]);
}
function firstFilled(row,cols,fields){
  for(const f of fields){
    const v=pick(row,cols,f);
    if(v)return v;
  }
  return '';
}
function buildAddress(parts){
  const out=[];
  const push=v=>{
    const s=cellStr(v);
    if(!s)return;
    if(out.some(p=>p.toLocaleLowerCase('tr-TR').includes(s.toLocaleLowerCase('tr-TR'))))return;
    out.push(s);
  };
  push(parts.adres);
  push(parts.mahalle);
  push(parts.cadde);
  push(parts.sokak);
  if(parts.kapi)push('No: '+cellStr(parts.kapi));
  const semt=cellStr(parts.semt);
  const ilce=cellStr(parts.ilce);
  if(semt && fold(semt)!==fold(ilce))push(semt);
  return out.join(' ').trim();
}
function inferPlace(text){
  const t=fold(text);
  if(/sariyer|ferahevler|tarabya|istinye|yenikoy|resitpasa|bahcekoy|emirgan|buyukdere|zeytinburnu|besiktas|sisli|beyoglu|fatih|kagithane|eyup/.test(t))
    return {city:'İstanbul',district: /sariyer|ferahevler|tarabya|istinye|yenikoy|resitpasa|bahcekoy|emirgan/.test(t)?'Sarıyer':''};
  if(/kadikoy|uskudar|umraniye|atasehir|maltepe/.test(t))
    return {city:'İstanbul',district:''};
  if(/istanbul/.test(t))return {city:'İstanbul',district:''};
  return {city:'',district:''};
}
function isCorporateTip(cariTipi){
  const t=fold(cariTipi);
  if(!t)return false;
  if(/tuzel|kurumsal|firma|limited|ltd|anonim|sirket/.test(t))return true;
  if(/^(t|k)$/.test(t))return true;
  return false;
}
function uniquePush(list,s){
  const t=String(s||'').trim();
  if(!t)return;
  if(list.some(x=>fold(x)===fold(t)))return;
  list.push(t);
}

function mapDataRow(row,cols){
  const unvan=pick(row,cols,'unvan');
  const isUnvan=pick(row,cols,'isUnvan');
  const yazismaUnvan=pick(row,cols,'yazismaUnvan');
  const ad=pick(row,cols,'ad');
  const soyad=pick(row,cols,'soyad');
  const person= [ad,soyad].filter(Boolean).join(' ').trim();
  const cariTipi=pick(row,cols,'cariTipi');
  const muhasebe=pick(row,cols,'muhasebe');
  const kod=pick(row,cols,'musteriKodu');
  const vergiRaw=pick(row,cols,'vergiNo');
  const tcknRaw=pick(row,cols,'tckn');
  const vergiHint=pick(row,cols,'vergiHint');
  const dogum=pick(row,cols,'dogumTarihi');
  const vergiDigits=digits(vergiRaw);
  let tcknDigits=digits(tcknRaw);
  let vkn='';
  if(vergiDigits.length===10)vkn=vergiDigits;
  else if(vergiDigits.length===11 && tcknDigits.length!==11)tcknDigits=vergiDigits;
  const evAdres=firstFilled(row,cols,['yazismaAdres','evAdres','adres']);
  const isAdres=firstFilled(row,cols,['kurumsalAdres','isAdres']);
  const hasEv=cols.evAdres!=null||cols.evSehir!=null||cols.evIlce!=null;
  const city=firstFilled(row,cols,['evSehir','isSehir','altSehir','sehir','sehirIl']);
  const district=firstFilled(row,cols,hasEv
    ?['evIlce','evSemt','nufusIlce','isIlce','isSemt','altIlce','semt']
    :['evIlce','evSemt','isIlce','isSemt','altIlce','nufusIlce','ilce','semt']);
  const address=buildAddress({
    adres:evAdres||isAdres,
    mahalle:firstFilled(row,cols,['evMahalle','mahalle']),
    cadde:firstFilled(row,cols,['evCadde','cadde']),
    sokak:firstFilled(row,cols,['evSokak','sokak']),
    kapi:firstFilled(row,cols,['evKapi','kapi']),
    semt:firstFilled(row,cols,['evSemt','semt']),
    ilce:firstFilled(row,cols,['evIlce','ilce'])
  });
  const displayName=person||yazismaUnvan||unvan||isUnvan||'';
  const inferred=inferPlace([address,city,district,displayName].join(' '));
  const taxOffice=pick(row,cols,'vergiDaire')||(/dair|vergi/i.test(vergiHint)&&digits(vergiHint).length<10?vergiHint:'');
  const email=firstFilled(row,cols,['email']);
  const kurumsalUnvan=pick(row,cols,'kurumsalUnvan');
  const companyAddress=pick(row,cols,'kurumsalAdres')||isAdres;
  const companyCity=firstFilled(row,cols,['kurumsalIl','isSehir']);
  const companyDistrict=firstFilled(row,cols,['kurumsalIlce','isIlce']);
  const birthDate=normalizeBirthDate(dogum);
  const phoneFields=[
    pick(row,cols,'gsm'),
    pick(row,cols,'telefon'),
    pick(row,cols,'isTel'),
    pick(row,cols,'evTel')
  ];
  const phone=extractBestPhone(phoneFields);
  const notes=[];
  uniquePush(notes, kod?`Müşteri no ${kod}`:'');
  uniquePush(notes, muhasebe?`Muhasebe ${muhasebe}`:'');
  uniquePush(notes, cariTipi?`Cari tipi ${cariTipi}`:'');
  uniquePush(notes, isUnvan?`İş yeri: ${isUnvan}`:'');
  uniquePush(notes, yazismaUnvan&&yazismaUnvan!==displayName?`Yazışma: ${yazismaUnvan}`:'');
  uniquePush(notes, dogum?`Doğum ${dogum}`:'');
  uniquePush(notes, kurumsalUnvan&&kurumsalUnvan!==displayName?`Kurumsal: ${kurumsalUnvan}`:'');
  const corporate=Boolean(vkn)||isCorporateTip(cariTipi)||Boolean(kurumsalUnvan&&vkn);
  if(corporate&&!vkn)uniquePush(notes,'Kurumsal işaretli ama 10 haneli VKN yok');
  if(vergiDigits && vergiDigits.length!==10 && vergiDigits.length!==11)
    uniquePush(notes,`Vergi no ham: ${vergiRaw}`);
  const useCorp=Boolean(vkn);
  const payload={
    name:displayName,
    phone,
    email,
    birthDate,
    city:city||inferred.city||'İstanbul',
    district:district||inferred.district||'Sarıyer',
    address:address||'Belirtilmedi',
    deliverySameAsBilling:true,
    invoiceType:useCorp?'corporate':'individual',
    companyName:useCorp?(kurumsalUnvan||yazismaUnvan||isUnvan||unvan||displayName):'',
    companyAddress,
    companyCity,
    companyDistrict,
    workPhone:useCorp?phone:'',
    taxOffice:useCorp?(taxOffice||companyCity||city||'Belirtilmedi'):'',
    taxNo:useCorp?vkn:'',
    tckn:tcknDigits.length===11?tcknDigits:'',
    customerCode:kod||'',
    note:notes.join(' · '),
    active:true
  };
  if(ad&&soyad){
    payload.firstName=ad;
    payload.lastName=soyad;
  }
  return{
    unvan:displayName,cariTipi,muhasebe,telefonRaw:phoneFields.filter(Boolean).join(' | '),
    phoneSkip:phone? '':phoneSkipReason(phoneFields),
    payload
  };
}

function parseAsistekMatrix(matrix){
  const found=findHeader(matrix)||inferHeaderlessAsistek(matrix);
  if(!found)return {ok:false,error:'Müşteri başlık satırı bulunamadı (Ünvan / Ad Soyad / Telefon / Müşteri No). Başlık yoksa Asistek sırası: Müşteri no, TC, Ad, Soyad, Ev adres, İlçe, İl, Mail, Doğum tarihi, Kurumsal ünvan…, İş telefonu.',rows:[],header:null};
  found.cols=inferPhoneColumn(matrix,found.index,found.cols||{});
  const {index,cols,headers}=found;
  if(cols.telefon==null&&cols.gsm==null&&cols.evTel==null&&cols.isTel==null)return {ok:false,error:'Telefon / GSM / Ev Tel / İş Telefon sütunu yok. Başlık satırında İş telefonu olmalı.',rows:[],header:found};
  const rows=[];
  const seenPhone=new Set();
  const seenName=new Set();
  for(let i=index+1;i<(matrix||[]).length;i++){
    const line=matrix[i]||[];
    if(!line.some(c=>cellStr(c)))continue;
    const mapped=mapDataRow(line,cols);
    const phone=mapped.payload.phone;
    if(!phone){
      const reason=mapped.phoneSkip||'Telefon yok';
      const short=/haneli/.test(reason);
      rows.push({status:short?'skip_short':'skip_nophone',reason,payload:null,source:mapped});
      continue;
    }
    if(!String(mapped.payload.name||'').trim()){
      rows.push({status:'skip_noname',reason:'Ad / soyad / ünvan boş',payload:null,source:mapped,phone});
      continue;
    }
    if(seenPhone.has(phone)){
      rows.push({status:'skip_dupfile',reason:'Aynı telefonda tekrar satır',payload:null,source:mapped,phone});
      continue;
    }
    const nameKey=personNameKey(mapped.payload);
    if(nameKey&&seenName.has(nameKey)){
      rows.push({status:'skip_dupfile',reason:'Aynı ad soyadda tekrar satır',payload:null,source:mapped,phone});
      continue;
    }
    seenPhone.add(phone);
    if(nameKey)seenName.add(nameKey);
    rows.push({status:'ready',reason:'',payload:mapped.payload,source:mapped,phone});
  }
  return {ok:true,header:{index,cols,headers},rows};
}

function phoneKey(v){return normalizePhone(v)||extractBestPhone([v])}
function findExistingCustomer(customers,payload){
  const phone=phoneKey(payload.phone);
  const vkn=digits(payload.taxNo);
  const tckn=digits(payload.tckn);
  const kod=String(payload.customerCode||'').trim().toLocaleLowerCase('tr-TR');
  return (customers||[]).find(c=>{
    if(!c||c.active===false||c.deletedAt)return false;
    if(phone&&phoneKey(c.phone)===phone)return true;
    if(vkn.length===10&&digits(c.taxNo)===vkn)return true;
    if(tckn.length===11&&digits(c.tckn)===tckn)return true;
    const existingKod=String(c.customerCode||c.rapidCustAccount||c.code||'').trim().toLocaleLowerCase('tr-TR');
    if(kod&&existingKod&&kod===existingKod)return true;
    const nameKey=personNameKey(payload);
    if(nameKey&&personNameKey(c)===nameKey)return true;
    return false;
  })||null;
}

function classifyParsed(parsed,customers){
  const counts={total:0,noPhone:0,shortPhone:0,noName:0,dupFile:0,existing:0,ready:0,corporate:0,individual:0};
  const out=[];
  for(const row of (parsed.rows||[])){
    counts.total++;
    if(row.status==='skip_nophone'){counts.noPhone++;out.push(row);continue}
    if(row.status==='skip_short'){counts.shortPhone++;out.push(row);continue}
    if(row.status==='skip_noname'){counts.noName++;out.push(row);continue}
    if(row.status==='skip_dupfile'){counts.dupFile++;out.push(row);continue}
    const existing=findExistingCustomer(customers,row.payload);
    if(existing){
      counts.existing++;
      out.push({...row,status:'existing',reason:`Kayıtlı: ${existing.companyName||existing.name}`,existingId:existing.id,existingName:existing.name});
      continue;
    }
    counts.ready++;
    if(row.payload.invoiceType==='corporate')counts.corporate++;
    else counts.individual++;
    out.push(row);
  }
  return {counts,rows:out,header:parsed.header};
}

function looksLikeZip(buffer){
  return Buffer.isBuffer(buffer)&&buffer.length>3&&buffer[0]===0x50&&buffer[1]===0x4b;
}
function looksLikeOle(buffer){
  return Buffer.isBuffer(buffer)&&buffer.length>8&&buffer[0]===0xD0&&buffer[1]===0xCF&&buffer[2]===0x11&&buffer[3]===0xE0;
}
function friendlyExcelError(e,originalName=''){
  const raw=String(e&&e.message||e||'').trim();
  const name=String(originalName||'');
  if(/password|encrypt/i.test(raw))return 'Excel şifreli. Şifreyi kaldırıp xlsx olarak kaydedin.';
  if(/codepage|cfb|ole|unsupported|cannot find|corrupt|bad zip/i.test(raw))
    return `Excel okunamadı (${name||'dosya'}). Excel’de Farklı Kaydet → .xlsx yapıp tekrar yükleyin.`;
  return raw?`Excel okunamadı: ${raw}`:`Excel okunamadı (${name||'dosya'}). xlsx veya csv olarak kaydedin.`;
}
function readWorkbookBuffer(XLSX,buffer,originalName=''){
  const name=String(originalName||'').toLocaleLowerCase('tr-TR');
  const head=Buffer.isBuffer(buffer)?buffer.slice(0,500).toString('utf8'):String(buffer||'').slice(0,500);
  if(/<html|<table/i.test(head)||/ss:Workbook|<Workbook[\s>]|spreadsheetml/i.test(head)){
    return XLSX.read(String(buffer.toString?buffer.toString('utf8'):buffer),{type:'string',raw:false});
  }
  const csvName=/\.(csv|txt)$/.test(name)||(!looksLikeZip(buffer)&&!looksLikeOle(buffer)&&!/\.xlsx?m?$/.test(name));
  if(csvName&&!looksLikeZip(buffer)&&!looksLikeOle(buffer)){
    const text=decodeCsvText(buffer);
    return XLSX.read(text,{type:'string',FS:';',raw:false});
  }
  const payloads=[{type:'buffer',data:buffer},{type:'array',data:Uint8Array.from(buffer)}];
  const extras=[{cellDates:false,raw:false},{cellDates:false,raw:true},{raw:false}];
  let last;
  for(const payload of payloads){
    for(const extra of extras){
      try{return XLSX.read(payload.data,{...extra,type:payload.type})}
      catch(e){last=e}
    }
  }
  if(looksLikeOle(buffer)||/\.xls$/.test(name)){
    try{return XLSX.read(buffer,{type:'buffer',bookType:'xls',raw:false})}
    catch(e){last=e}
  }
  throw last||new Error('Excel açılamadı');
}
function matrixFromWorkbook(XLSX,buffer,originalName=''){
  return {wb:readWorkbookBuffer(XLSX,buffer,originalName),decoded:true};
}
function parseWorkbook(XLSX,buffer,originalName=''){
  let wb;
  try{
    ({wb}=matrixFromWorkbook(XLSX,buffer,originalName));
  }catch(e){
    return {ok:false,error:friendlyExcelError(e,originalName),rows:[],header:null};
  }
  if(!wb||!Array.isArray(wb.SheetNames)||!wb.SheetNames.length)
    return {ok:false,error:`Excel’de sayfa yok (${originalName||'dosya'}). xlsx olarak kaydedip tekrar deneyin.`,rows:[],header:null};
  let best=null;
  let lastErr='';
  for(const sheetName of wb.SheetNames||[]){
    if(/^talimat/i.test(String(sheetName)))continue;
    const ws=wb.Sheets[sheetName];
    if(!ws)continue;
    let matrix;
    try{matrix=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:false})}
    catch(e){lastErr=friendlyExcelError(e,originalName);continue}
    const parsed=parseAsistekMatrix(matrix);
    if(!parsed.ok){
      lastErr=parsed.error||lastErr;
      continue;
    }
    const withPhone=(parsed.rows||[]).filter(r=>r.status==='ready'||r.phone).length;
    if(!best||withPhone>(best._withPhone||0)){
      best={...parsed,sheet:sheetName,_withPhone:withPhone};
    }
  }
  if(!best)return {ok:false,error:lastErr||`Excel’de müşteri başlığı bulunamadı (${originalName||'dosya'}). İlk satırda Ad, Soyad ve İş telefonu olsun.`,rows:[],header:null};
  delete best._withPhone;
  return best;
}
/* Asistek CSV: başlık ISO-8859-9, satırlar çoğu IBM-857 (DOS Türkçe) */
const CP857={
  128:'Ç',129:'ü',130:'é',135:'ç',141:'ı',142:'Ä',144:'É',148:'ö',152:'İ',153:'Ö',154:'Ü',
  158:'Ş',159:'ş',166:'Ğ',167:'ğ',181:'Á',198:'ã',199:'Ã'
};
function decodeCp857(buf){
  let out='';
  for(const b of buf)out+=b<128?String.fromCharCode(b):(CP857[b]||String.fromCharCode(b));
  return out;
}
function scoreTr(s){
  const good=(String(s).match(/[İıŞşĞğÜüÖöÇç]/g)||[]).length;
  const bad=(String(s).match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\uFFFD■¦˜š]/g)||[]).length;
  return good*4-bad*3;
}
function fixTrMojibake(s){
  return String(s)
    .replace(/Ý/g,'İ').replace(/ý/g,'ı')
    .replace(/Þ/g,'Ş').replace(/þ/g,'ş')
    .replace(/Ð/g,'Ğ').replace(/ð/g,'ğ');
}
function decodeBestLine(buf){
  let iso='';
  try{iso=new TextDecoder('iso-8859-9').decode(buf)}catch(_){iso=Buffer.from(buf).toString('latin1')}
  const dos=decodeCp857(buf);
  return fixTrMojibake(scoreTr(dos)>scoreTr(iso)?dos:iso);
}
function decodeCsvText(buffer){
  const b=Buffer.isBuffer(buffer)?buffer:Buffer.from(buffer);
  if(b.length>=3&&b[0]===0xEF&&b[1]===0xBB&&b[2]===0xBF)return b.slice(3).toString('utf8');
  const utf=b.toString('utf8');
  const head=utf.slice(0,2500);
  let iso='';
  try{iso=new TextDecoder('iso-8859-9').decode(b)}catch(_){iso=b.toString('latin1')}
  const utfScore=scoreTr(head);
  const isoScore=scoreTr(iso.slice(0,2500));
  const utfOk=!head.includes('\uFFFD') && (utfScore>=isoScore || /Müşteri|Ünvan|İlçe|Şehir/.test(head) || !/[^\x00-\x7F]/.test(head.slice(0,80)));
  if(utfOk && !/Müþteri|Ýþ Yeri|Þehir/.test(head))return utf.replace(/^\uFEFF/,'');
  const lines=[];
  let start=0;
  for(let i=0;i<b.length;i++){
    if(b[i]!==10)continue;
    let end=i;
    if(end>start&&b[end-1]===13)end--;
    lines.push(decodeBestLine(b.subarray(start,end)));
    start=i+1;
  }
  if(start<b.length)lines.push(decodeBestLine(b.subarray(start)));
  return lines.join('\n');
}

module.exports={
  fold,cellStr,digits,normalizePhone,hasPhone,extractBestPhone,phoneSkipReason,isValidTrPhone,
  normalizeBirthDate,isHeaderRow,mapHeader,findHeader,mapDataRow,buildAddress,
  parseAsistekMatrix,findExistingCustomer,classifyParsed,parseWorkbook,decodeCsvText
};
