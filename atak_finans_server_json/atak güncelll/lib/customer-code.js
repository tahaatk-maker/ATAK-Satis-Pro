'use strict';

const ATAK_RE = /^A(\d+)$/i;

function normalizeCustomerCode(raw){
  return String(raw || '').trim().replace(/\s+/g, '');
}

function codeKey(code){
  return normalizeCustomerCode(code).toLocaleLowerCase('tr-TR');
}

function parseAtakSeq(code){
  const m = ATAK_RE.exec(normalizeCustomerCode(code));
  return m ? Number(m[1]) : 0;
}

function formatAtakCode(n){
  const num = Math.max(1, Math.floor(Number(n) || 1));
  return 'A' + String(num).padStart(Math.max(6, String(num).length), '0');
}

function isAtakSeqCode(code){
  return parseAtakSeq(code) > 0;
}

function codesOf(row){
  return [row && row.customerCode, row && row.rapidCustAccount, row && row.code]
    .map(normalizeCustomerCode)
    .filter(Boolean);
}

function isTaken(customers, code, exceptId){
  const k = codeKey(code);
  if(!k) return false;
  return (customers || []).some(c => {
    if(!c || c.deletedAt) return false;
    if(exceptId && String(c.id) === String(exceptId)) return false;
    return codesOf(c).some(x => codeKey(x) === k);
  });
}

function maxAtakSeq(customers, stored){
  let max = Math.max(0, Math.floor(Number(stored) || 0));
  for(const c of customers || []){
    const n = parseAtakSeq(c && c.customerCode);
    if(n > max) max = n;
  }
  return max;
}

function peekNext(store = {}){
  return formatAtakCode(maxAtakSeq(store.customers, store.customerCodeSeq) + 1);
}

function bumpSeq(store, code){
  const n = parseAtakSeq(code);
  if(!n) return;
  store.customerCodeSeq = Math.max(Math.floor(Number(store.customerCodeSeq) || 0), n);
}

function allocate(store, requested, { exceptId } = {}){
  const want = normalizeCustomerCode(requested);
  if(want){
    if(isTaken(store.customers, want, exceptId)){
      throw new Error(`Bu müşteri kodu başka bir kayıtta var: ${want}`);
    }
    bumpSeq(store, want);
    return want;
  }
  let n = maxAtakSeq(store.customers, store.customerCodeSeq) + 1;
  let code = formatAtakCode(n);
  while(isTaken(store.customers, code, exceptId)){
    n += 1;
    code = formatAtakCode(n);
  }
  store.customerCodeSeq = n;
  return code;
}

function resolveForSave(store, requested, { existing } = {}){
  const want = normalizeCustomerCode(requested);
  const exceptId = existing && existing.id;
  if(existing){
    if(want) return allocate(store, want, { exceptId });
    return normalizeCustomerCode(existing.customerCode || existing.rapidCustAccount || existing.code || '');
  }
  if(want && isTaken(store.customers, want) && isAtakSeqCode(want)){
    return allocate(store, '');
  }
  return allocate(store, want);
}

module.exports = {
  normalizeCustomerCode,
  codeKey,
  parseAtakSeq,
  formatAtakCode,
  isAtakSeqCode,
  isTaken,
  peekNext,
  allocate,
  resolveForSave
};
