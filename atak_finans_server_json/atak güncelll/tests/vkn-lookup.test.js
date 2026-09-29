/* VKN / e-Fatura ünvan parse + lookup hazırlık */
const path=require('path');
const {parseTaxpayerXml,lookupTaxpayer,onlyDigits}=require(path.join(__dirname,'..','qnb-solist-adapter.js'));

function assert(cond,msg){if(!cond)throw new Error(msg)}

assert(onlyDigits('123 456 7890')==='1234567890','sadece rakam');
assert(onlyDigits('VKN:6080408090')==='6080408090','önek temizlenir');

const checkUserXml=`<?xml version="1.0"?>
<S:Envelope xmlns:S="http://schemas.xmlsoap.org/soap/envelope/">
  <S:Body>
    <CheckUserResponse xmlns="http://service.connector.uut.cs.com.tr/">
      <user>
        <identifier>6080408090</identifier>
        <alias>urn:mail:defaultpk@atak.com.tr</alias>
        <title>ATAK EV GEREÇLERİ PAZ. TİC. LTD. ŞTİ.</title>
        <type>PK</type>
      </user>
    </CheckUserResponse>
  </S:Body>
</S:Envelope>`;
const parsed=parseTaxpayerXml(checkUserXml);
assert(parsed.companyName.includes('ATAK EV GEREÇLERİ'),'ünvan Title alanından');
assert(parsed.alias.includes('defaultpk'),'alias');
assert(parsed.identifier==='6080408090','VKN');
assert(parsed.eInvoiceUser===true,'e-fatura kullanıcısı');

const withOffice=`<return>
  <unvan>ÖRNEK A.Ş.</unvan>
  <vergiDairesi>Beşiktaş</vergiDairesi>
  <il>İstanbul</il>
  <ilce>Beşiktaş</ilce>
  <adres>Barbaros Bulvarı No:1</adres>
  <efaturaKullanicisi>true</efaturaKullanicisi>
</return>`;
const office=parseTaxpayerXml(withOffice);
assert(office.companyName==='ÖRNEK A.Ş.','unvan etiketi');
assert(office.taxOffice==='Beşiktaş','vergi dairesi');
assert(office.city==='İstanbul','il');
assert(office.district==='Beşiktaş','ilçe');
assert(office.address.includes('Barbaros'),'adres');

const nsXml=`<ns2:efaturaKullanicisiResponse><ns2:return>true</ns2:return></ns2:efaturaKullanicisiResponse>`;
const flag=parseTaxpayerXml(nsXml);
assert(flag.eInvoiceUser===true,'namespace return true');
assert(!flag.companyName,'ünvan yoksa boş');

(async()=>{
  const bad=await lookupTaxpayer('123',{});
  assert(bad.ok===false&&/10/.test(bad.error),'kısa VKN reddedilir');
  const noCred=await lookupTaxpayer('6080408090',{username:'',password:''});
  assert(noCred.ok===false&&/QNB/.test(noCred.error),'şifresiz QNB uyarısı');
  const noCred2=await lookupTaxpayer('6080408090',{});
  assert(noCred2.ok===false,'boş cfg SOAP çağırmaz');
  console.log('OK vkn-lookup tests passed');
})().catch(e=>{console.error(e);process.exit(1)});
