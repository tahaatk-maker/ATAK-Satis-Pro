const path=require('path');
const {
  normalizePhone,hasPhone,findHeader,parseAsistekMatrix,classifyParsed,buildAddress
}=require(path.join(__dirname,'..','customer-excel-import.js'));

function assert(cond,msg){if(!cond)throw new Error(msg)}

assert(normalizePhone('532 123 45 67')==='05321234567','10 hane başına 0');
assert(normalizePhone('905321234567')==='05321234567','90 kırpılır');
assert(hasPhone('0532 111 22 33')&&!hasPhone('')&&!hasPhone('-'),'telefon filtresi');

const headerPad=Array.from({length:8},()=>['','','','']);
const header=['Ünvan','Adres','İlçe','Semt','Şehir','Muhasebe','Cari Tipi','Vergi Daire','Vergi No','Telefon','Tc Kimlik No','Adres Mahalle','Adres Cadde','Adres Sokak','Adres Kap','E-mail'];
const corp=['ATAK EV GEREÇLERİ LTD','Barbaros 1','Beşiktaş','Levent','İstanbul','120.01.01','M','Beşiktaş','6080408090','5321112233','','Dikilitaş','Barbaros Cad.','No yok','12','info@x.com'];
const person=['Ahmet Yılmaz','','Kadıköy','','İstanbul','120.01.02','M','','11111111111','2165554433','11111111111','Caferağa','Moda Cad.','','5',''];
const noTel=['Telefonsuz A.Ş.','Adres','Şişli','','İstanbul','120.01.03','T','Şişli','1234567890','','','','','','',''];
const matrix=[...headerPad,header,corp,person,noTel];

const found=findHeader(matrix);
assert(found&&found.index===8,'başlık 9. satır (index 8)');
assert(found.cols.telefon!=null&&found.cols.unvan!=null&&found.cols.vergiNo!=null,'sütun eşleşmesi');

const parsed=parseAsistekMatrix(matrix);
assert(parsed.ok,'parse ok');
const ready=parsed.rows.filter(r=>r.status==='ready');
const skipped=parsed.rows.filter(r=>r.status==='skip_nophone');
assert(ready.length===2,'telefonlular alınır');
assert(skipped.length===1,'telefonsuz elenir');

const c=ready.find(r=>r.payload.taxNo==='6080408090');
assert(c,'kurumsal VKN');
assert(c.payload.invoiceType==='corporate','kurumsal fatura');
assert(c.payload.name==='ATAK EV GEREÇLERİ LTD','şahıs adı = ünvan');
assert(c.payload.companyName==='ATAK EV GEREÇLERİ LTD','firma ünvanı');
assert(c.payload.taxOffice==='Beşiktaş','vergi dairesi');
assert(c.payload.phone==='05321112233','telefon normalize');
assert(c.payload.address.includes('Dikilitaş')&&c.payload.address.includes('Barbaros'),'adres birleşir');
assert(c.payload.email==='info@x.com','e-posta');

const p=ready.find(r=>r.payload.tckn==='11111111111');
assert(p&&p.payload.invoiceType==='individual','11 hane vergi no TCKN olur, bireysel');
assert(!p.payload.taxNo,'bireyselde VKN yok');

const existing=classifyParsed(parsed,[
  {id:'c1',name:'Ahmet Yılmaz',phone:'02165554433',taxNo:'',tckn:'11111111111'}
]);
assert(existing.counts.existing===1,'aynı telefon atlanır');
assert(existing.counts.ready===1,'yeni kurumsal kalır');
assert(existing.counts.noPhone===1,'telefonsuz sayılır');

const addr=buildAddress({adres:'Barbaros 1',mahalle:'Dikilitaş',cadde:'Barbaros Cad.',sokak:'',kapi:'12',semt:'Levent',ilce:'Beşiktaş'});
assert(/Barbaros 1/.test(addr)&&/No: 12/.test(addr)&&/Levent/.test(addr),'adres parçaları');

console.log('OK customer-excel-import tests passed');
