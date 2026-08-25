'use strict';
const assert=require('assert');
const mail=require('../lib/mail');
const reset=require('../lib/password-reset');

const cfg=mail.smtpConfig({
  enabled:true,host:'smtp.gmail.com',port:465,secure:true,
  user:'tarabyabeko@gmail.com',pass:'abcd efgh ijkl mnop',from:''
});
assert.equal(cfg.pass,'abcdefghijklmnop');
assert.equal(cfg.from,'tarabyabeko@gmail.com');
assert.equal(cfg.enabled,true);

const off=mail.smtpConfig({enabled:false,host:'smtp.gmail.com',user:'',pass:'',from:''});
assert.equal(off.enabled,false);

const implied=mail.smtpConfig({
  enabled:false,host:'smtp.gmail.com',port:587,
  user:'a@b.c',pass:'apppass',from:'a@b.c'
});
assert.equal(implied.enabled,true,'kullanıcı+şifre varsa gönderim açık');

assert.equal(mail.shopHost('atakhome.com.tr'),true);
assert.equal(mail.shopHost('panel.atakhome.com.tr'),false);
assert.equal(
  mail.panelOrigin({headers:{host:'atakhome.com.tr','x-forwarded-proto':'https'}}),
  'https://panel.atakhome.com.tr'
);
assert.equal(
  mail.panelOrigin({headers:{host:'panel.atakhome.com.tr'}}),
  'https://panel.atakhome.com.tr'
);
assert.match(
  mail.resetUrl('https://panel.atakhome.com.tr','tok123','staff'),
  /\/sifre-sifirla\?reset=tok123$/
);
assert.match(
  mail.resetUrl('https://panel.atakhome.com.tr','tok123','admin'),
  /\/sifre-sifirla\?reset=tok123$/
);

const store={
  users:[{id:'u1',username:'ali',email:'ali@atak.com',role:'sales',active:true,passwordHash:'old'}],
  passwordResets:[]
};
assert.equal(reset.findResetUser(store,'ALI').id,'u1');
assert.equal(reset.findResetUser(store,'ali@atak.com').id,'u1');
assert.equal(reset.findResetUser(store,'yok'),null);
assert.equal(reset.portalForUser({role:'admin'}),'admin');
assert.equal(reset.portalForUser({role:'sales'}),'staff');

const issued=reset.issueResetToken(store,store.users[0],1_700_000_000_000);
assert.equal(typeof issued.token,'string');
assert.equal(issued.token.length,64);
const user=reset.consumeResetToken(store,issued.token,'yeniSifre1',p=>'HASH:'+p,1_700_000_000_100);
assert.equal(user.passwordHash,'HASH:yeniSifre1');
assert.throws(()=>reset.consumeResetToken(store,issued.token,'yeniSifre1',p=>p,1_700_000_000_200),/kullanılmış/);

assert.match(
  mail.friendlyMailError({message:'535 Username and Password not accepted'}, {host:'smtp.gmail.com'}),
  /smtp\.hostinger\.com/
);
assert.match(
  mail.friendlyMailError({message:'Invalid login'}, {host:'smtp.hostinger.com'}),
  /Hostinger e-posta şifresi/
);

async function testRetry587(){
  const sent=[];
  await mail.sendAppMail(
    {enabled:true,host:'smtp.gmail.com',port:465,secure:true,user:'a@b.c',pass:'x',from:'a@b.c'},
    {to:'x@y.z',subject:'t',text:'hi'},
    {
      nodemailer:{createTransport(){return{}}},
      sendWith:async(_n,cfgUsed)=>{
        sent.push(cfgUsed.port);
        if(cfgUsed.port===465)throw new Error('ETIMEDOUT');
      }
    }
  );
  assert.deepEqual(sent,[465,587]);
}

testRetry587().then(()=>console.log('mail-reset.test.js ok')).catch(err=>{
  console.error(err);
  process.exit(1);
});
