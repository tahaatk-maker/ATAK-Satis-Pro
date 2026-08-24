'use strict';

const {parse}=require('csv-parse/sync');

const HEADER_RE=/Madde\s*kodu|Maliyet\s*tutar|Arama\s*ad|Ürün\s*numar|Malzeme1|Birim\s*Fiyat|Malzeme\s*Uzun|Ürün\s*Kodu|Stok\s*Kodu|Cost\s*amount|\bPP\b|Stok\s*Miktar/i;

function purchaseHeaderKey(h){
  return String(h||'').toLocaleLowerCase('tr-TR')
    .replace(/ı/g,'i').replace(/ş/g,'s').replace(/ğ/g,'g')
    .replace(/ü/g,'u').replace(/ö/g,'o').replace(/ç/g,'c')
    .replace(/[^a-z0-9]+/g,'');
}

function looksLikeHeaderLine(line){
  return HEADER_RE.test(String(line||''));
}

function scoreHeaderText(t){
  const head=String(t||'').slice(0,2500);
  let s=0;
  if(looksLikeHeaderLine(head))s+=5;
  if(/Malzeme1|Birim Fiyat|Stok Miktar|\bPP\b|Madde kodu/i.test(head))s+=3;
  if(/�/.test(head))s-=4; // bozuk UTF-8
  return s;
}

function bufferText(buffer){
  if(!buffer)return '';
  const buf=Buffer.isBuffer(buffer)?buffer:Buffer.from(buffer);
  if(buf.length>=2&&buf[0]===0xFF&&buf[1]===0xFE){
    return buf.toString('utf16le').replace(/^\uFEFF/,'');
  }
  if(buf.length>=2&&buf[0]===0xFE&&buf[1]===0xFF){
    const swapped=Buffer.alloc(buf.length-2);
    for(let i=2;i+1<buf.length;i+=2){swapped[i-2]=buf[i+1];swapped[i-1]=buf[i]}
    return swapped.toString('utf16le').replace(/^\uFEFF/,'');
  }
  const utf8=String(buf.toString('utf8')||'').replace(/^\uFEFF/,'');
  let cp1254='';
  try{cp1254=String(buf.toString('latin1')||'').replace(/^\uFEFF/,'')}catch(_){cp1254=''}
  // Hostinger/İstikbal CSV çoğu zaman Windows-1254; Türkçe başlıklar UTF-8'de bozulur
  const cands=[
    {t:utf8,s:scoreHeaderText(utf8)},
    {t:cp1254,s:scoreHeaderText(cp1254)+(/Üretim|Miktarı|Malzeme/i.test(cp1254.slice(0,300))?2:0)}
  ].sort((a,b)=>b.s-a.s);
  return cands[0].t||utf8;
}

function detectDelim(line){
  const first=String(line||'');
  const semi=(first.match(/;/g)||[]).length;
  const comma=(first.match(/,/g)||[]).length;
  const tab=(first.match(/\t/g)||[]).length;
  if(semi>=1&&semi>=comma&&semi>=tab)return ';';
  if(tab>=1&&tab>=comma)return '\t';
  return ',';
}

function headerIndex(lines){
  for(let i=0;i<Math.min(lines.length,30);i++){
    if(looksLikeHeaderLine(lines[i]))return i;
  }
  return 0;
}

function fillIstikbalAliases(row,headers,cols){
  if(!row||headers.length<3)return row;
  const keys=headers.map(purchaseHeaderKey);
  const hasPp=keys.some(k=>k==='pp');
  const hasStok=keys.some(k=>k.includes('stokmiktar')||k==='miktar');
  const malzemeIdx=keys.findIndex(k=>k==='malzeme1'||k==='malzeme');
  const ppIdx=keys.findIndex(k=>k==='pp');
  const qtyIdx=keys.findIndex(k=>k.includes('stokmiktar')||k==='miktar');

  // İstikbal depo stok: ;Malzeme1;Üretim yeri;Stok Miktarı;PP
  // Burada Malzeme1 = ürün ADI (kod değil), PP = birim fiyat (₺)
  if(hasPp&&malzemeIdx>=0){
    const name=String(cols[malzemeIdx]??row['Malzeme1']??'').trim();
    const price=String(cols[ppIdx]??row.PP??row.pp??'').trim();
    const qty=qtyIdx>=0?String(cols[qtyIdx]??'').trim():'';
    if(name){
      // Kod yoksa adın tamamını kod gibi kullan (aynı ad = aynı kart)
      if(!row['Madde kodu'])row['Malzeme1']=name;
      row['Malzeme Uzun Metni E']=row['Malzeme Uzun Metni E']||name;
      row['Ürün adı']=row['Ürün adı']||name;
    }
    if(price&&!row['Birim Fiyat']&&!row['Maliyet tutarı']){
      row['Birim Fiyat']=price;
      row.__costRaw=price;
    }
    if(qty&&!row['Miktar'])row['Miktar']=qty;
    return row;
  }

  const h0=purchaseHeaderKey(headers[0]);
  if((h0.startsWith('malzeme')||/malzeme1/i.test(headers[0]||''))&&!row['Madde kodu']&&!row['Malzeme1']){
    row['Malzeme1']=cols[0]||'';
    row['Malzeme Uzun Metni E']=cols[1]||'';
    row['Birim Fiyat']=cols[2]||'';
  }
  if(headers.length>=13&&(!row['Maliyet tutarı']&&!row['Madde kodu'])){
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
  return row;
}

function parseCsvBuffer(buffer){
  const text=bufferText(buffer);
  const lines=text.split(/\r?\n/).filter(l=>String(l||'').trim());
  if(lines.length<2)return [];
  const start=headerIndex(lines);
  const delim=detectDelim(lines[start]);
  const body=lines.slice(start).join('\n');
  let records=[];
  try{
    records=parse(body,{
      columns:true,
      skip_empty_lines:true,
      relax_column_count:true,
      relax_quotes:true,
      bom:true,
      delimiter:delim,
      trim:true
    });
  }catch(_){
    const headers=lines[start].split(delim).map(h=>String(h||'').trim().replace(/^"|"$/g,'').replace(/^\uFEFF/,''));
    records=lines.slice(start+1).map(line=>{
      const cols=line.split(delim).map(c=>String(c||'').trim().replace(/^"|"$/g,''));
      const row={};
      headers.forEach((h,i)=>{row[h]=cols[i]!=null?cols[i]:''});
      return fillIstikbalAliases(row,headers,cols);
    });
    return records;
  }
  const headers=Object.keys(records[0]||{});
  return records.map(row=>{
    const cols=headers.map(h=>row[h]);
    return fillIstikbalAliases(row,headers,cols);
  });
}

/** İstikbal stok listesinde fatura yok → her aktarıma tek sanal no (gerçek faturalarla karışmaz). */
function virtualInvoiceNo({supplier='',date='',mode='',now=new Date()}={}){
  const supplierKey=String(supplier||'').toLocaleLowerCase('tr-TR')
    .replace(/ı/g,'i').replace(/İ/g,'i');
  const furniture=/istikbal|dogtas|doğtaş/.test(supplierKey);
  const d=String(date||'').replace(/\D/g,'').slice(0,8)||[
    now.getFullYear(),
    String(now.getMonth()+1).padStart(2,'0'),
    String(now.getDate()).padStart(2,'0')
  ].join('');
  const t=[
    String(now.getHours()).padStart(2,'0'),
    String(now.getMinutes()).padStart(2,'0'),
    String(now.getSeconds()).padStart(2,'0')
  ].join('');
  const rand=Math.random().toString(36).slice(2,6).toUpperCase();
  const kind=String(mode||'')==='stock'?'STOK':(String(mode||'')==='cost'?'FIYAT':'AKTAR');
  const prefix=furniture?`IST-SANAL-${kind}`:`SANAL-${kind}`;
  return `${prefix}-${d}-${t}-${rand}`;
}

module.exports={
  purchaseHeaderKey,
  looksLikeHeaderLine,
  bufferText,
  detectDelim,
  headerIndex,
  parseCsvBuffer,
  virtualInvoiceNo
};
