'use strict';
const assert = require('assert');
const codes = require('../lib/customer-code');

assert.equal(codes.formatAtakCode(1), 'A000001');
assert.equal(codes.formatAtakCode(42), 'A000042');
assert.equal(codes.parseAtakSeq('A000010'), 10);
assert.equal(codes.parseAtakSeq('2521-M0044001'), 0);
assert.equal(codes.normalizeCustomerCode(' 2521-M0044001 '), '2521-M0044001');

const store = {
  customerCodeSeq: 0,
  customers: [
    { id: '1', customerCode: '2521-M0044001', rapidCustAccount: '2521-M0044001' },
    { id: '2', customerCode: 'A000003' }
  ]
};
assert.equal(codes.peekNext(store), 'A000004');

const a = codes.allocate(store, '');
assert.equal(a, 'A000004');
store.customers.push({ id: '3', customerCode: a });
assert.equal(codes.peekNext(store), 'A000005');

const rapid = codes.allocate(store, '2521-M0099999');
assert.equal(rapid, '2521-M0099999');
assert.equal(codes.peekNext(store), 'A000005');

assert.throws(() => codes.allocate(store, '2521-M0044001'), /başka bir kayıtta/);

const kept = codes.resolveForSave(store, '', { existing: { id: '1', customerCode: '2521-M0044001' } });
assert.equal(kept, '2521-M0044001');

const created = codes.resolveForSave({ customerCodeSeq: 0, customers: [] }, '');
assert.equal(created, 'A000001');

const bumped = codes.resolveForSave(store, 'A000003');
assert.equal(bumped, 'A000005');

console.log('customer-code tests OK');
