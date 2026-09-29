const sip=require('../public/assets/sip-call.js');

function assert(cond,msg){if(!cond)throw new Error(msg)}

assert(sip.sipDigits('0532 111 22 33')==='05321112233','ulusal 0');
assert(sip.sipDigits('5321112233')==='05321112233','10 hane GSM');
assert(sip.sipDigits('905321112233')==='05321112233','90 E.164');
assert(sip.sipDigits('+90 532 111 22 33')==='05321112233','artı 90');
assert(sip.sipDigits('0212 223 28 71')==='02122232871','sabit hat');
assert(sip.sipDigits('')==='','bos');
assert(sip.sipDigits('12345')==='','kisa reddedilir');
assert(sip.sipHref('0532 111 22 33')==='sip:05321112233','sip href');
assert(sip.sipCallButton('05321112233').includes('href="sip:05321112233"'),'buton href');
assert(sip.sipCallButton('').includes('is-off'),'telefonsuz kapali');

console.log('sip-call.test.js ok');
