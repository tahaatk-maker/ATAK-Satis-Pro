'use strict';
const assert=require('assert');
const staffEmail=require('../lib/staff-email');

assert.equal(staffEmail.normalizeDomain(' @ATAKHOME.COM.TR/ '), 'atakhome.com.tr');
assert.equal(staffEmail.localPart({username:'tahaatk',name:'Taha Atık'}),'tahaatk');
assert.equal(staffEmail.localPart({username:'',name:'Ahmet Yılmaz'}),'ahmet.yilmaz');

const store={
  settings:{},
  users:[
    {id:'1',name:'Taha Atık',username:'tahaatk',email:'',active:true},
    {id:'2',name:'Ali Kaya',username:'ali',email:'ali@hotmail.com',active:true},
    {id:'3',name:'Ayşe Demir',username:'ayse',email:'',active:true}
  ]
};
const prev=staffEmail.preview(store.users,'atakhome.com.tr');
assert.equal(prev[0].suggested,'tahaatk@atakhome.com.tr');
assert.equal(prev[0].missing,true);
assert.equal(prev[1].missing,false);
assert.equal(prev[1].email,'ali@hotmail.com');
assert.equal(prev[2].suggested,'ayse@atakhome.com.tr');

const r=staffEmail.applyAssignments(store,{domain:'atakhome.com.tr',fillMissing:true});
assert.equal(r.updated,2);
assert.equal(store.users[0].email,'tahaatk@atakhome.com.tr');
assert.equal(store.users[1].email,'ali@hotmail.com','dolu hotmail silinmez');
assert.equal(store.users[2].email,'ayse@atakhome.com.tr');
assert.equal(store.settings.mailDomain,'atakhome.com.tr');

console.log('staff-email.test.js ok');
