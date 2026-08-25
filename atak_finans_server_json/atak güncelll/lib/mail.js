'use strict';

const PANEL_ORIGIN='https://panel.atakhome.com.tr';

function shopHost(host){
  const h=String(host||'').split(',')[0].trim().toLowerCase().replace(/:\d+$/,'');
  return h==='atakhome.com.tr'||h==='www.atakhome.com.tr';
}

function smtpConfig(fromStore, env=process.env){
  const raw=(fromStore&&typeof fromStore==='object')?fromStore:{};
  const host=String(env.SMTP_HOST||raw.host||'').trim()||'smtp.hostinger.com';
  const user=String(env.SMTP_USER||raw.user||'').trim();
  const pass=String(env.SMTP_PASS||raw.pass||'').replace(/\s+/g,'');
  const from=String(env.SMTP_FROM||raw.from||user||'').trim();
  const port=Number(env.SMTP_PORT||raw.port||587)||587;
  const secureFlag=env.SMTP_SECURE!=null?String(env.SMTP_SECURE).trim():raw.secure;
  const secure=secureFlag===true||String(secureFlag)==='true'||(secureFlag==null&&port===465);
  const envOn=String(env.SMTP_ENABLED||'')==='1';
  const storeOn=raw.enabled!==false;
  const hasCreds=Boolean(host&&user&&pass&&from);
  const enabled=hasCreds&&(envOn||storeOn||raw.enabled===true||Boolean(user&&pass));
  return{enabled:Boolean(enabled&&hasCreds),host,port,secure:Boolean(secure),user,pass,from};
}

function transportOptions(cfg){
  const port=Number(cfg.port||587)||587;
  const secure=cfg.secure===true||port===465;
  return{
    host:cfg.host||'smtp.hostinger.com',
    port,
    secure,
    requireTLS:!secure,
    connectionTimeout:12000,
    greetingTimeout:12000,
    socketTimeout:20000,
    auth:{user:cfg.user,pass:cfg.pass}
  };
}

function friendlyMailError(err, cfg){
  const m=String(err&&(err.response||err.message)||err||'Mail gönderilemedi');
  const host=String(cfg&&cfg.host||'').toLowerCase();
  const gmail=/gmail|google/i.test(host);
  if(/EAUTH|Invalid login|Username and Password not accepted|535/i.test(m)){
    if(gmail){
      return 'Gmail şifresi reddedildi. @atakhome.com.tr kutusu Gmail değildir. Sunucuyu smtp.hostinger.com yapın; şifre Hostinger e-posta şifresi olsun (Google uygulama şifresi değil).';
    }
    return 'SMTP giriş reddedildi. Sunucu smtp.hostinger.com, kullanıcı tam adres (ör. taha.atak@atakhome.com.tr), şifre o kutunun Hostinger e-posta şifresi olmalı.';
  }
  if(/ECONNECTION|ETIMEDOUT|ECONNREFUSED|ESOCKET|timeout|connect/i.test(m)){
    return 'SMTP sunucusuna bağlanılamadı. Hostinger için smtp.hostinger.com + port 465 (SSL) veya 587 (SSL kapalı) deneyin.';
  }
  return m.slice(0,280);
}

async function sendWith(nodemailer, cfg, mail){
  const transporter=nodemailer.createTransport(transportOptions(cfg));
  await transporter.sendMail({
    from:cfg.from,
    to:mail.to,
    subject:mail.subject,
    text:mail.text,
    html:mail.html||mail.text
  });
}

async function sendAppMail(cfg, mail, deps={}){
  if(!cfg||!cfg.enabled){
    throw new Error('E-posta (SMTP) ayarı yok. Ayarlar → E-posta’dan smtp.hostinger.com ve kutu şifresini kaydedin.');
  }
  if(!String(mail&&mail.to||'').trim())throw new Error('Alıcı e-posta yok');
  let nodemailer=deps.nodemailer;
  if(!nodemailer){
    try{nodemailer=require('nodemailer')}catch(_){
      throw new Error('nodemailer yüklü değil — VPS’te npm install çalıştırın');
    }
  }
  const send=deps.sendWith||sendWith;
  try{
    await send(nodemailer, cfg, mail);
    return true;
  }catch(first){
    const port=Number(cfg.port||0);
    if(port===465){
      try{
        await send(nodemailer, {...cfg,port:587,secure:false}, mail);
        return true;
      }catch(second){
        throw new Error(friendlyMailError(second, cfg));
      }
    }
    throw new Error(friendlyMailError(first, cfg));
  }
}

function panelOrigin(req, env=process.env){
  const fromEnv=String(env.PUBLIC_BASE_URL||env.PANEL_BASE_URL||'').trim().replace(/\/$/,'');
  if(fromEnv){
    try{
      const u=new URL(fromEnv.includes('://')?fromEnv:`https://${fromEnv}`);
      if(!shopHost(u.host))return `${u.protocol}//${u.host}`;
    }catch(_){}
  }
  const host=String(req&&(req.headers&&(req.headers['x-forwarded-host']||req.headers.host))||'').split(',')[0].trim();
  if(host&&!shopHost(host)&&!/^localhost\b/i.test(host)&&!/^127\.0\.0\.1\b/.test(host)){
    const proto=String(req.headers&&req.headers['x-forwarded-proto']||'https').split(',')[0].trim()||'https';
    return `${proto}://${host.replace(/:\d+$/,'')}`;
  }
  return PANEL_ORIGIN;
}

function resetUrl(origin, token, _portal){
  const base=String(origin||PANEL_ORIGIN).replace(/\/$/,'');
  return `${base}/sifre-sifirla?reset=${encodeURIComponent(token)}`;
}

module.exports={
  PANEL_ORIGIN,
  shopHost,
  smtpConfig,
  transportOptions,
  friendlyMailError,
  sendAppMail,
  panelOrigin,
  resetUrl
};
