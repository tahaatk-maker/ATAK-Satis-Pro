'use strict';
const assert=require('assert');
const cat=require('../lib/istikbal-category');

assert.equal(cat.classifyText('KMX 91 Yatak Baza').id,'istikbal-yatak');
assert.equal(cat.classifyText('L Koltuk Takımı Gri').id,'istikbal-oturma');
assert.equal(cat.classifyText('Yemek Masası 6 Sandalye').id,'istikbal-yemek');
assert.equal(cat.classifyText('Genç Odası Ranza').id,'istikbal-genc');
assert.equal(cat.classifyText('Nevresim Takımı').id,'istikbal-tekstil');
assert.equal(cat.classifyText('Bilinmeyen Ürün XYZ').id,'mobilya');

const store={categories:[{id:'mobilya',name:'Mobilya',active:true}]};
const sug=cat.suggestCategory(store,'Comfort Kanepe Köşe','');
assert.equal(sug.categoryName,'Oturma Grubu');
assert.ok(store.categories.some(c=>c.id==='istikbal-oturma'),'oturma kategorisi oluşturulur');
assert.ok(sug.confidence>=0.6);

const store2={categories:[]};
cat.ensureFurnitureCategories(store2);
assert.ok(store2.categories.length>=5);
assert.ok(cat.isFurnitureCategoryId(store2,'istikbal-yatak'));

console.log('OK istikbal-category tests passed');
