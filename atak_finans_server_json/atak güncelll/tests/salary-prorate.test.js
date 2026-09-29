'use strict';
const pr = require('../lib/salary-prorate');

function assert(cond, msg){
  if(!cond) throw new Error(msg);
}
function almost(a, b, msg){
  assert(Math.abs(Number(a) - Number(b)) < 0.001, msg + ` (got ${a}, want ${b})`);
}

assert(pr.normalizeHireDate('2026-08-08') === '2026-08-08', 'normalize ok');
assert(pr.normalizeHireDate('2026-08-32') === '', 'invalid day');
assert(pr.normalizeHireDate('') === '', 'empty');
assert(pr.daysInMonth(2026, 8) === 31, 'ağustos 31');
assert(pr.daysInMonth(2026, 2) === 28, 'şubat 2026');
assert(pr.daysInMonth(2024, 2) === 29, 'şubat 2024 artık');

const emine = pr.prorateMonthlySalary({
  salaryMonthly: 56000,
  hireDate: '2026-08-08',
  month: '2026-08'
});
assert(emine.prorated === true, 'ağustos kısmi');
assert(emine.daysInMonth === 31, '31 gün');
assert(emine.daysWorked === 24, '8–31 = 24 gün');
assert(emine.rangeLabel === '8–31', 'aralık etiketi');
assert(emine.ratioLabel === '24/31', 'oran');
almost(emine.salaryEarned, Math.round(56000 * 24 / 31 * 100) / 100, '56000 × 24/31');
almost(emine.salaryEarned, 43354.84, 'Emine Ağustos hak ediş');
assert(emine.salaryMonthly === 56000, 'sözleşme maaşı durur');

const fullLater = pr.prorateMonthlySalary({
  salaryMonthly: 56000,
  hireDate: '2026-08-08',
  month: '2026-09'
});
assert(fullLater.prorated === false, 'eylül tam ay');
assert(fullLater.daysWorked === 30, 'eylül 30');
almost(fullLater.salaryEarned, 56000, 'eylül tam 56000');

const beforeStart = pr.prorateMonthlySalary({
  salaryMonthly: 56000,
  hireDate: '2026-09-01',
  month: '2026-08'
});
assert(beforeStart.salaryEarned === 0, 'işe başlamadan önceki ay 0');
assert(beforeStart.daysWorked === 0, '0 gün');

const dayOne = pr.prorateMonthlySalary({
  salaryMonthly: 56000,
  hireDate: '2026-08-01',
  month: '2026-08'
});
assert(dayOne.prorated === false, 'ayın 1 inde başlayan tam maaş');
almost(dayOne.salaryEarned, 56000, '1 Ağustos tam');

const noHire = pr.prorateMonthlySalary({
  salaryMonthly: 56000,
  hireDate: '',
  month: '2026-08'
});
assert(noHire.prorated === false, 'tarih yoksa tam ay');
almost(noHire.salaryEarned, 56000, 'tarihsiz 56000');

const lastDay = pr.prorateMonthlySalary({
  salaryMonthly: 31000,
  hireDate: '2026-08-31',
  month: '2026-08'
});
assert(lastDay.daysWorked === 1, 'son gün 1 gün');
almost(lastDay.salaryEarned, 1000, '31000 × 1/31');

const part = pr.formulaSalaryPart(emine);
assert(/Kısmi maaş/.test(part) && /24\/31/.test(part), 'formül kısmi');
assert(/^Maaş /.test(pr.formulaSalaryPart(noHire)), 'formül tam');

console.log('salary-prorate.test.js ok');
