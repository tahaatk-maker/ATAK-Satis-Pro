/**
 * Asistek / Logo tarzı cari Excel → Müşteri Ekle alanları.
 * Sadece telefonu olan satırlar alınır. Mevcut telefon/VKN/TCKN ezilmez.
 */
'use strict';

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
function hasPhone(v){
  const d=normalizePhone(v);
  return d.length>=10;
}

const COL_RULES=[
  ['tckn', /^(tc kimlik no|tckn|tc no|kimlik no)$/],
  ['vergiNo', /^(vergi no|vkn|vergi numarasi)$/],
  ['vergiDaire', /^vergi dair/],
  ['telefon', /^(telefon|tel|cep|gsm|telefon no)$/],
  ['email', /^(e mail|email|eposta|e posta)$/],
  ['mahalle', /mahalle/],
  ['cadde', /cadde/],
  ['sokak', /sokak/],
  ['kapi', /^(adres kap|kapi no|kapi)$/],
  ['ilce', /^(ilce)$/],
  ['semt', /^semt$/],
  ['sehir', /^(sehir|il)$/],
  ['cariTipi', /^cari tip/],
  ['muhasebe', /^muhasebe/],
  ['unvan', /^(unvan|unvani|title|cari unvan)$/],
  ['adres', /^(adres|acik adres)$/]
];

function isHeaderRow(cells){
  const folds=(cells||[]).map(c=>fold(c));
  const hasTel=folds.some(h=>/^(telefon|tel|cep|gsm|telefon no)$/.test(h));
  const hasUnvan=folds.some(h=>/^unvan/.test(h));
  const hasVergi=folds.some(h=>h.includes('vergi'));
  const hasCari=folds.some(h=>h.includes('cari tip'));
  return hasTel&&(hasUnvan||hasVergi||hasCari);
}
function mapHeader(cells){
  const cols={};
  (cells||[]).forEach((h,idx)=>{
    const key=fold(h);
    if(!key)return;
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
  const telefon=pick(row,cols,'telefon');
  const cariTipi=pick(row,cols,'cariTipi');
  const muhasebe=pick(row,cols,'muhasebe');
  const vergiRaw=pick(row,cols,'vergiNo');
  const tcknRaw=pick(row,cols,'tckn');
  const vergiDigits=digits(vergiRaw);
  let tcknDigits=digits(tcknRaw);
  let vkn='';
  if(vergiDigits.length===10)vkn=vergiDigits;
  else if(vergiDigits.length===11 && tcknDigits.length!==11)tcknDigits=vergiDigits;
  const corporate=Boolean(vkn)||isCorporateTip(cariTipi);
  const city=pick(row,cols,'sehir');
  const district=pick(row,cols,'ilce')||pick(row,cols,'semt');
  const address=buildAddress({
    adres:pick(row,cols,'adres'),
    mahalle:pick(row,cols,'mahalle'),
    cadde:pick(row,cols,'cadde'),
    sokak:pick(row,cols,'sokak'),
    kapi:pick(row,cols,'kapi'),
    semt:pick(row,cols,'semt'),
    ilce:pick(row,cols,'ilce')
  });
  const taxOffice=pick(row,cols,'vergiDaire');
  const email=pick(row,cols,'email');
  const phone=normalizePhone(telefon);
  const notes=[];
  uniquePush(notes, muhasebe?`Muhasebe ${muhasebe}`:'');
  uniquePush(notes, cariTipi?`Cari tipi ${cariTipi}`:'');
  if(corporate&&!vkn)uniquePush(notes,'Kurumsal işaretli ama 10 haneli VKN yok');
  if(vergiDigits && vergiDigits.length!==10 && vergiDigits.length!==11)
    uniquePush(notes,`Vergi no ham: ${vergiRaw}`);
  const name=unvan||'';
  const useCorp=Boolean(vkn);
  return{
    unvan,cariTipi,muhasebe,telefonRaw:telefon,
    payload:{
      name,
      phone,
      email,
      city:city||'Belirtilmedi',
      district:district||'Merkez',
      address:address||'Belirtilmedi',
      deliverySameAsBilling:true,
      invoiceType:useCorp?'corporate':'individual',
      companyName:useCorp?(unvan||name):'',
      taxOffice:useCorp?(taxOffice||city||'Belirtilmedi'):'',
      taxNo:useCorp?vkn:'',
      tckn:tcknDigits.length===11?tcknDigits:'',
      note:notes.join(' · '),
      active:true
    }
  };
}

function parseAsistekMatrix(matrix){
  const found=findHeader(matrix);
  if(!found)return {ok:false,error:'Ünvan / Telefon / Vergi No başlık satırı bulunamadı (ilk 30 satır).',rows:[],header:null};
  const {index,cols,headers}=found;
  if(cols.telefon==null)return {ok:false,error:'Telefon sütunu yok.',rows:[],header:found};
  const rows=[];
  const seenPhone=new Set();
  for(let i=index+1;i<(matrix||[]).length;i++){
    const line=matrix[i]||[];
    if(!line.some(c=>cellStr(c)))continue;
    const mapped=mapDataRow(line,cols);
    const phone=mapped.payload.phone;
    if(!hasPhone(mapped.telefonRaw)){
      rows.push({status:'skip_nophone',reason:'Telefon yok',payload:null,source:mapped});
      continue;
    }
    if(!String(mapped.payload.name||'').trim()){
      rows.push({status:'skip_noname',reason:'Ünvan boş',payload:null,source:mapped,phone});
      continue;
    }
    if(seenPhone.has(phone)){
      rows.push({status:'skip_dupfile',reason:'Aynı telefonda tekrar satır',payload:null,source:mapped,phone});
      continue;
    }
    seenPhone.add(phone);
    rows.push({status:'ready',reason:'',payload:mapped.payload,source:mapped,phone});
  }
  return {ok:true,header:{index,cols,headers},rows};
}

function phoneKey(v){return normalizePhone(v)}
function findExistingCustomer(customers,payload){
  const phone=phoneKey(payload.phone);
  const vkn=digits(payload.taxNo);
  const tckn=digits(payload.tckn);
  return (customers||[]).find(c=>{
    if(!c||c.active===false||c.deletedAt)return false;
    if(phone&&phoneKey(c.phone)===phone)return true;
    if(vkn.length===10&&digits(c.taxNo)===vkn)return true;
    if(tckn.length===11&&digits(c.tckn)===tckn)return true;
    return false;
  })||null;
}

function classifyParsed(parsed,customers){
  const counts={total:0,noPhone:0,noName:0,dupFile:0,existing:0,ready:0,corporate:0,individual:0};
  const out=[];
  for(const row of (parsed.rows||[])){
    counts.total++;
    if(row.status==='skip_nophone'){counts.noPhone++;out.push(row);continue}
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

function parseWorkbook(XLSX,buffer){
  const wb=XLSX.read(buffer,{type:'buffer',cellDates:false,raw:false});
  let best=null;
  for(const name of wb.SheetNames||[]){
    if(/^talimat/i.test(String(name)))continue;
    const ws=wb.Sheets[name];
    if(!ws)continue;
    const matrix=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:false});
    const parsed=parseAsistekMatrix(matrix);
    if(!parsed.ok)continue;
    const withPhone=(parsed.rows||[]).filter(r=>r.status==='ready'||r.phone).length;
    if(!best||withPhone>(best._withPhone||0)){
      best={...parsed,sheet:name,_withPhone:withPhone};
    }
  }
  if(!best)return {ok:false,error:'Excel’de Telefon + Ünvan/Vergi başlığı bulunan sayfa yok.',rows:[],header:null};
  delete best._withPhone;
  return best;
}

module.exports={
  fold,cellStr,digits,normalizePhone,hasPhone,
  isHeaderRow,mapHeader,findHeader,mapDataRow,buildAddress,
  parseAsistekMatrix,findExistingCustomer,classifyParsed,parseWorkbook
};
