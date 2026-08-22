const path=require('path');
const {
  normalizePhone,hasPhone,extractBestPhone,findHeader,parseAsistekMatrix,classifyParsed,buildAddress
}=require(path.join(__dirname,'..','customer-excel-import.js'));

function assert(cond,msg){if(!cond)throw new Error(msg)}

assert(normalizePhone('532 123 45 67')==='05321234567','10 hane başına 0');
assert(normalizePhone('905321234567')==='05321234567','90 kırpılır');
assert(hasPhone('0532 111 22 33')&&!hasPhone('')&&!hasPhone('-'),'telefon filtresi');
assert(extractBestPhone(['223 33 85'])==='','7 hane alınmaz');
assert(!hasPhone('223 33 85')&&!hasPhone('2234726'),'7 hane hasPhone false');
assert(extractBestPhone(['223 33 02 542 635 52 40']).startsWith('0542'),'karışık alandan GSM');
assert(extractBestPhone(['262 63 67-532 5121702'])==='05325121702','tireli GSM');
assert(extractBestPhone(['0216 372 73 87'])==='02163727387','11 haneli sabit');
assert(extractBestPhone(['216 555 44 33'])==='02165554433','10 haneli 216 alınır');

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

const byName=classifyParsed(parsed,[
  {id:'c2',name:'Ahmet Yılmaz',firstName:'Ahmet',lastName:'Yılmaz',phone:'05990000000'}
]);
assert(byName.counts.existing>=1,'aynı ad soyad mevcut sayılır');

const addr=buildAddress({adres:'Barbaros 1',mahalle:'Dikilitaş',cadde:'Barbaros Cad.',sokak:'',kapi:'12',semt:'Levent',ilce:'Beşiktaş'});
assert(/Barbaros 1/.test(addr)&&/No: 12/.test(addr)&&/Levent/.test(addr),'adres parçaları');

const kartHeader=['Müşteri Kodu','Ünvan','Telefon','İş Yeri Unvanı','İş Telefonu','Fax Numarası','Gsm Numarası','E_Mail','Ev Adresi','İş Adresi','Dogum Tarihi','Evlilik Tarihi','Meslek','Özel Kod','Ev Adresi Mahalle','Ev Adresi Cadde','Ev Adresi Sokak','Ev Adresi Kapı No','İş Adresi Mahalle','İş Adresi Cadde','İş Adresi Sokak','İş Adresi Kapı No','Ev Adresi Şehir','İş Adresi Şehir','Ev Adresi İlçe','İş Adresi İlçe','Ev Adresi Semt','İş Adresi Semt'];
const kartShort=['00000082','BİLAL YILMAZ','223 33 85','','','','','','KÜLTÜR SK NO:40 FERAHEVLER SARIYER','','','','','','','','','','','','','','İstanbul','','Sarıyer','','Ferahevler',''];
const kartGsm=['00012916','EVREN YILDIRIM','5306129202','','','','5306129202','','TARABYA MAH. SANATÇILAR SİTESİ SARIYER','','','','','','TARABYA','','','','','','','','İstanbul','İstanbul','Sarıyer','','',''];
const kartEmpty=['00000018','ATLAS HALI','','','','','','','','','','','','','','','','','','','','','','','','','',''];
const kart=parseAsistekMatrix([kartHeader,kartShort,kartGsm,kartEmpty]);
assert(kart.ok,'kart listesi parse');
assert(kart.rows.find(r=>r.source?.unvan==='BİLAL YILMAZ')?.status==='skip_short','7 hane atlanır');
assert(kart.rows.find(r=>r.source?.unvan==='ATLAS HALI')?.status==='skip_nophone','telefonsuz atlanır');
const evren=kart.rows.find(r=>r.source?.unvan==='EVREN YILDIRIM');
assert(evren?.status==='ready'&&evren.payload.phone==='05306129202','GSM 10 hane alınır');
assert(evren.payload.address.includes('TARABYA'),'ev adresi');
assert(evren.payload.city==='İstanbul'&&/sarıyer/i.test(evren.payload.district),'il/ilçe ev adresi');
assert(evren.payload.invoiceType==='individual','bu listede VKN yok, bireysel');
assert(/Müşteri no 00012916/.test(evren.payload.note),'müşteri kodu nota');

const{
  normalizeBirthDate,mapHeader,mapDataRow,isHeaderRow
}=require(path.join(__dirname,'..','customer-excel-import.js'));
assert(normalizeBirthDate('01.05.1980')==='1980-05-01','doğum gg.aa.yyyy');
assert(normalizeBirthDate('1980-05-01')==='1980-05-01','doğum iso');

const atakHeader=['MÜŞTERİ NO','TC','AD','SOYAD','EV ADRES','İLÇE','İL','MAİL','DOĞUM TARİHİ','KURUMSAL ÜNVAN','KURUMSAL ADRES','İL','İLÇE','VERGİ DAİRESİ','VERGİ NO','İŞ TELEFONU'];
assert(isHeaderRow(atakHeader),'ATAK müşteri başlığı tanınır');
const atakCols=mapHeader(atakHeader);
assert(atakCols.musteriKodu===0&&atakCols.tckn===1&&atakCols.ad===2&&atakCols.soyad===3,'kimlik sütunları');
assert(atakCols.evAdres===4&&atakCols.nufusIlce===5&&atakCols.sehirIl===6&&atakCols.email===7,'ev adres sütunları');
assert(atakCols.dogumTarihi===8&&atakCols.kurumsalUnvan===9&&atakCols.kurumsalAdres===10,'kurumsal + doğum');
assert(atakCols.kurumsalIl===11&&atakCols.kurumsalIlce===12&&atakCols.vergiDaire===13&&atakCols.vergiNo===14&&atakCols.isTel===15,'ikinci il/ilçe + iş telefon');
const atakRow=['A000100','12345678901','AHMET','YILMAZ','Kültür Sk 1','Sarıyer','İstanbul','a@b.com','15.03.1985','ATAK LTD','Ferahevler 10','İstanbul','Sarıyer','Sarıyer','0940148218','05321234567'];
const atakMapped=mapDataRow(atakRow,atakCols);
assert(atakMapped.payload.firstName==='AHMET'&&atakMapped.payload.lastName==='YILMAZ','ad soyad ayrı');
assert(atakMapped.payload.tckn==='12345678901'&&atakMapped.payload.customerCode==='A000100','tc + müşteri no');
assert(atakMapped.payload.address.includes('Kültür')&&atakMapped.payload.city==='İstanbul'&&atakMapped.payload.district==='Sarıyer','ev adres');
assert(atakMapped.payload.email==='a@b.com'&&atakMapped.payload.birthDate==='1985-03-15','mail + doğum');
assert(atakMapped.payload.companyName==='ATAK LTD'&&atakMapped.payload.companyAddress.includes('Ferahevler'),'kurumsal ünvan/adres');
assert(atakMapped.payload.companyCity==='İstanbul'&&atakMapped.payload.companyDistrict==='Sarıyer','kurumsal il/ilçe');
assert(atakMapped.payload.taxOffice==='Sarıyer'&&atakMapped.payload.taxNo==='0940148218','vergi');
assert(atakMapped.payload.phone==='05321234567'&&atakMapped.payload.workPhone==='05321234567'&&atakMapped.payload.invoiceType==='corporate','iş telefonu + kurumsal');

const dupNameMatrix=[atakHeader,atakRow,['A000101','12345678902','AHMET','YILMAZ','Başka adres','Sarıyer','İstanbul','b@b.com','15.03.1985','','','','','','','05329998877']];
const dupParsed=parseAsistekMatrix(dupNameMatrix);
assert(dupParsed.rows.filter(r=>r.status==='skip_dupfile').length===1,'aynı ad soyad dosyada tek kalır');

const decoy=[
  ['MÜŞTERİ NO','AD','SOYAD'],
  ['MÜŞTERİ NO','AD','SOYAD','İŞ TELEFONU'],
  ['A0001','AYŞE','KAYA','05321112233']
];
const decoyFound=findHeader(decoy);
assert(decoyFound&&decoyFound.cols.isTel!=null,'telefonsuz ilk başlık atlanır');
const decoyParsed=parseAsistekMatrix(decoy);
assert(decoyParsed.ok&&decoyParsed.rows.some(r=>r.status==='ready'&&r.payload.phone==='05321112233'),'iş telefonlu satır alınır');

const wrapped=[
  ['MÜŞTERİ NO','TC','AD','SOYAD','EV ADRES','','','','','','','','','','',''],
  ['','','','','','İLÇE','İL','MAİL','','','','','','','',''],
  ['','','','','','','','','DOĞUM TARİHİ','KURUMSAL ÜNVAN','','','','','',''],
  ['','','','','','','','','','','KURUMSAL ADRES','İL','İLÇE','VERGİ DAİRESİ','VERGİ NO','İŞ TELEFONU'],
  ['B1','11111111111','AYŞE','KAYA','Ev 1','Sarıyer','İstanbul','a@x.com','1.1.1990','KAYA LTD','İş 1','İstanbul','Sarıyer','Sarıyer','1234567890','05329991122']
];
const wrapParsed=parseAsistekMatrix(wrapped);
assert(wrapParsed.ok,'satırlara bölünmüş başlık okunur');
assert(wrapParsed.rows.some(r=>r.status==='ready'&&r.payload.firstName==='AYŞE'&&r.payload.phone==='05329991122'),'bölünmüş başlıktan müşteri alınır');

console.log('OK customer-excel-import tests passed');
