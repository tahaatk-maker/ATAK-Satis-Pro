'use strict';
const assert = require('assert');
const dp = require('../lib/digital-planet');

function assertOk(cond, msg){
  if(!cond) throw new Error(msg);
}

assertOk(dp.parseTicket('<GetFormsAuthenticationTicketResult>TICK-1</GetFormsAuthenticationTicketResult>') === 'TICK-1', 'ticket');
assertOk(dp.parseTicket('<GetFormsAuthenticationTicketResult>null</GetFormsAuthenticationTicketResult>') === '', 'null ticket');

const okXml = `
<SendInvoiceDataResult>
  <Invoices>
    <InvoiceStateResult>
      <ServiceResult>Successful</ServiceResult>
      <ServiceResultDescription>OK</ServiceResultDescription>
      <UUID>u-1</UUID>
      <InvoiceId>ATA2026000000009</InvoiceId>
      <ErrorCode>0</ErrorCode>
    </InvoiceStateResult>
  </Invoices>
  <ServiceResult>Successful</ServiceResult>
  <ErrorCode>0</ErrorCode>
</SendInvoiceDataResult>`;
const ok = dp.parseSendResult(okXml);
assertOk(ok.ok && ok.invoiceId === 'ATA2026000000009' && ok.uuid === 'u-1', 'send ok');

const bad = dp.parseSendResult('<SendInvoiceDataResult><ServiceResult>Error</ServiceResult><ServiceResultDescription>MapCode yok</ServiceResultDescription></SendInvoiceDataResult>');
assertOk(!bad.ok && /MapCode/.test(bad.message), 'send error');

const fault = dp.parseSendResult('<soap:Fault><faultstring>Unauthorized</faultstring></soap:Fault>');
assertOk(!fault.ok && fault.message === 'Unauthorized', 'soap fault');

const cfg = dp.ensureConfig({
  corporateCode: 'ATAK',
  loginName: 'user1',
  password: 'secret',
  templateCode: 'DTP'
}).cfg;
assertOk(dp.isReady(cfg), 'ready');
const inner = dp.sendBody(cfg, 'TICK-1', '<Invoice>ubl</Invoice>');
assertOk(inner.includes('<FileType>UBL</FileType>'), 'ubl type');
assertOk(inner.includes('<TemplateCode>DTP</TemplateCode>'), 'template');
assertOk(inner.includes(Buffer.from('<Invoice>ubl</Invoice>', 'utf8').toString('base64')), 'base64 ubl');
assertOk(!inner.includes('secret'), 'şifre send body’de yok');

const env = dp.soapEnvelope('GetFormsAuthenticationTicket', dp.ticketBody(cfg));
assertOk(env.includes('SOAPAction') === false, 'action body’de değil');
assertOk(env.includes('<CorporateCode>ATAK</CorporateCode>'), 'corporate');
assertOk(env.includes('<LoginName>user1</LoginName>'), 'login');

const calls = [];
async function fakeFetch(url, opt){
  calls.push({ url, action: opt.headers.SOAPAction, body: opt.body });
  if(String(opt.headers.SOAPAction).includes('GetFormsAuthenticationTicket')){
    return { ok: true, status: 200, text: async() => '<GetFormsAuthenticationTicketResponse><GetFormsAuthenticationTicketResult>TICK-9</GetFormsAuthenticationTicketResult></GetFormsAuthenticationTicketResponse>' };
  }
  return { ok: true, status: 200, text: async() => okXml };
}

(async()=>{
  const sent = await dp.sendUbl(cfg, '<Invoice>x</Invoice>', { fetchImpl: fakeFetch });
  assertOk(sent.ok && sent.invoiceId === 'ATA2026000000009', 'sendUbl');
  assertOk(calls[0].action === '"http://tempuri.org/GetFormsAuthenticationTicket"', 'soap action ticket');
  assertOk(calls[1].action === '"http://tempuri.org/SendInvoiceDataWithTemplateCode"', 'soap action send+template');
  assertOk(calls[0].url.includes('integration.digitalplanet.com.tr'), 'live url');

  const missing = dp.ensureConfig({}).cfg;
  assertOk(!dp.isReady(missing), 'eksik hazır değil');
  const pub = dp.publicConfig({ corporateCode: 'ATAK', loginName: 'u', password: 'p' }, { reveal: false });
  assertOk(pub.password === '********' && pub.ready === true, 'public mask');

  const merged = dp.mergeIncoming({ password: 'old' }, { corporateCode: 'X', loginName: 'Y', password: '********' });
  assertOk(merged.password === 'old' && merged.corporateCode === 'X', 'şifre korunur');

  console.log('digital-planet.test.js ok');
})().catch(e=>{ console.error(e); process.exit(1); });
