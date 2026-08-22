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
  return String(v).trim();
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
  if(/^\d{4}-\d{2}-\d{2}$/.test(s))return s;
  const m=s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if(m){
    const dd=m[1].padStart(2,'0');
    const mm=m[2].padStart(2,'0');
    return `${m[3]}-${mm}-${dd}`;
  }
  return s.slice(0,32);
}

const COL_RULES=[
  ['musteriKodu', /^(musteri kodu|musteri no|cari kod|cari no)$/],
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
  ['unvan', /^(unvan|unvani|title|cari unvan)$/],
  ['adres', /^(adres|acik adres)$/]
];

function isHeaderRow(cells){
  const folds=(cells||[]).map(c=>fold(c));
  const hasTel=folds.some(h=>
    /telefon|gsm|^tel$|ev tel|is tel/.test(h)||h.startsWith('gsm')
  );
  const hasUnvan=folds.some(h=>h==='unvan'||h.includes('unvan')||h==='ad'||h==='soyad'||h==='adi'||h==='soyadi');
  const hasVergi=folds.some(h=>h.includes('vergi'));
  const hasCari=folds.some(h=>h.includes('cari tip'));
  const hasKod=folds.some(h=>h==='musteri kodu'||h==='musteri no'||h==='cari kod');
  return (hasTel||hasKod)&&(hasUnvan||hasVergi||hasCari||hasKod);
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
function findHeader(matrix){
  const rows=Array.isArray(matrix)?matrix:[];
  const max=Math.min(rows.length,30);
  for(let i=0;i<max;i++){
    if(isHeaderRow(rows[i]))return {index:i,cols:mapHeader(rows[i]),headers:(rows[i]||[]).map(cellStr)};
  }
  return null;
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
  const found=findHeader(matrix);
  if(!found)return {ok:false,error:'Müşteri başlık satırı bulunamadı (Ünvan / Ad Soyad / Telefon / Müşteri No).',rows:[],header:null};
  const {index,cols,headers}=found;
  if(cols.telefon==null&&cols.gsm==null&&cols.evTel==null&&cols.isTel==null)return {ok:false,error:'Telefon / GSM / Ev Tel / İş Telefon sütunu yok.',rows:[],header:found};
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
  const utf=buffer.toString('utf8');
  const head=utf.slice(0,2500);
  const utfOk=!head.includes('\uFFFD') && (/Müşteri|Ünvan|İlçe|Şehir/.test(head) || !/[^\x00-\x7F]/.test(head.slice(0,80)));
  if(utfOk && !/Müþteri|Ýþ Yeri|Þehir/.test(head))return utf.replace(/^\uFEFF/,'');
  const b=Buffer.isBuffer(buffer)?buffer:Buffer.from(buffer);
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
function matrixFromWorkbook(XLSX,buffer,originalName=''){
  const name=String(originalName||'').toLocaleLowerCase('tr-TR');
  const csvLike=!looksLikeZip(buffer)&&(/\.(csv|txt)$/.test(name)||!/\.xlsx?$/.test(name));
  if(csvLike){
    const text=decodeCsvText(buffer);
    const wb=XLSX.read(text,{type:'string',FS:';',raw:false});
    return {wb,decoded:true};
  }
  return {wb:XLSX.read(buffer,{type:'buffer',cellDates:false,raw:false,codepage:28599}),decoded:false};
}
function parseWorkbook(XLSX,buffer,originalName=''){
  const {wb}=matrixFromWorkbook(XLSX,buffer,originalName);
  let best=null;
  for(const sheetName of wb.SheetNames||[]){
    if(/^talimat/i.test(String(sheetName)))continue;
    const ws=wb.Sheets[sheetName];
    if(!ws)continue;
    const matrix=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:false});
    const parsed=parseAsistekMatrix(matrix);
    if(!parsed.ok)continue;
    const withPhone=(parsed.rows||[]).filter(r=>r.status==='ready'||r.phone).length;
    if(!best||withPhone>(best._withPhone||0)){
      best={...parsed,sheet:sheetName,_withPhone:withPhone};
    }
  }
  if(!best)return {ok:false,error:'Excel/CSV’de müşteri başlığı (Ad / Ünvan / Telefon / Müşteri No) bulunan sayfa yok.',rows:[],header:null};
  delete best._withPhone;
  return best;
}

module.exports={
  fold,cellStr,digits,normalizePhone,hasPhone,extractBestPhone,phoneSkipReason,isValidTrPhone,
  normalizeBirthDate,isHeaderRow,mapHeader,findHeader,mapDataRow,buildAddress,
  parseAsistekMatrix,findExistingCustomer,classifyParsed,parseWorkbook,decodeCsvText
};
