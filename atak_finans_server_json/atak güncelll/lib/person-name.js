'use strict';

/** Atak müşteri kartı: Ad ve Soyad ayrı, görünen name = "Ad Soyad". */

function splitPersonName(full){
  const parts = String(full || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if(!parts.length) return { firstName: '', lastName: '' };
  if(parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] };
}

function joinPersonName(firstName, lastName, fallback){
  const name = [firstName, lastName].map(s => String(s || '').replace(/\s+/g, ' ').trim()).filter(Boolean).join(' ').trim();
  return name || String(fallback || '').replace(/\s+/g, ' ').trim();
}

function normalizePersonName(input = {}){
  let firstName = String(input.firstName || input.ad || '').replace(/\s+/g, ' ').trim();
  let lastName = String(input.lastName || input.soyad || '').replace(/\s+/g, ' ').trim();
  const fallback = String(input.name || '').replace(/\s+/g, ' ').trim();
  const explicit = Object.prototype.hasOwnProperty.call(input, 'firstName')
    || Object.prototype.hasOwnProperty.call(input, 'lastName')
    || Object.prototype.hasOwnProperty.call(input, 'ad')
    || Object.prototype.hasOwnProperty.call(input, 'soyad');
  if(explicit && (firstName || lastName)){
    return { firstName, lastName, name: joinPersonName(firstName, lastName, fallback) };
  }
  if(!firstName && !lastName && fallback){
    const split = splitPersonName(fallback);
    firstName = split.firstName;
    lastName = split.lastName;
  }
  return { firstName, lastName, name: joinPersonName(firstName, lastName, fallback) };
}

module.exports = { splitPersonName, joinPersonName, normalizePersonName };
