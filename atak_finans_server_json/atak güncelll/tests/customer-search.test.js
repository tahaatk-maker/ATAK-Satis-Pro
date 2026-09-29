const {matchEntry,haystack,searchIndex}=require('../lib/customer-search');

function assert(cond,msg){if(!cond)throw new Error(msg)}

const a=haystack({id:'1',name:'EYÜP ERKAN',phone:'05427823361',tckn:'12345678901',customerCode:'00000001',companyName:'ERKAN LTD',city:'İstanbul'});
assert(matchEntry(a,'eyüp','')||matchEntry(a,'eyup',''),'ad bulunur');
assert(matchEntry(a,'erkan',''),'soyad bulunur');
assert(matchEntry(a,'','05427823361')||matchEntry(a,'0542','0542'),'telefon bulunur');
assert(matchEntry(a,'00000001',''),'müşteri no bulunur');
assert(matchEntry(a,'erkan ltd',''),'firma ünvanı bulunur');
assert(!matchEntry(a,'xyzxyz',''),'uydurma ad bulunmaz');

const store={customers:[
  {id:'1',name:'EYÜP ERKAN',phone:'05427823361',firstName:'EYÜP',lastName:'ERKAN'},
  {id:'2',name:'YILMAZ BAYRAK',phone:'02122992131',active:false},
  {id:'3',name:'RENGİN GÜVEN',phone:'05324615929',companyName:'ZEYNEP GÜR',tckn:'57361159298'},
  {id:'4',name:'AHMET YILMAZ',phone:'05320000000',deletedAt:'2026-01-01'}
]};
const byName=searchIndex(store,{q:'rengin',limit:20});
assert(byName.total===1&&byName.entries[0].c.id==='3','pasif/silinmiş elenir, rengin bulunur');
const byPhone=searchIndex(store,{q:'532461',limit:20});
assert(byPhone.entries.some(r=>r.c.id==='3'),'telefon parçası bulunur');
const empty=searchIndex(store,{q:'',limit:20});
assert(empty.needQuery===true&&empty.entries.length===0,'boş arama listeyi dökmez');
const listed=searchIndex(store,{q:'',listAll:true,limit:20});
assert(listed.entries.length===2,'list=1 sadece aktifleri verir');

console.log('OK customer-search tests passed');
