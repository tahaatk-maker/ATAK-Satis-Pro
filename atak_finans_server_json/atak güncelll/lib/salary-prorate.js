'use strict';

/** Takvim günü: işe başlama tarihi olan ayda maaş (başlangıç–ay sonu) / ayın gün sayısı. */

function round2(n){
  return Math.round(Number(n || 0) * 100) / 100;
}

function normalizeHireDate(v){
  const s = String(v == null ? '' : v).trim().slice(0, 10);
  if(!s) return '';
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!m) return '';
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if(dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return '';
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function monthKey(v, fallback){
  const s = String(v || '').slice(0, 7);
  if(/^\d{4}-\d{2}$/.test(s)) return s;
  const fb = String(fallback || '').slice(0, 7);
  return /^\d{4}-\d{2}$/.test(fb) ? fb : '';
}

function daysInMonth(year, month1to12){
  return new Date(Date.UTC(Number(year), Number(month1to12), 0)).getUTCDate();
}

function monthParts(key){
  const m = monthKey(key);
  if(!m) return null;
  const y = Number(m.slice(0, 4));
  const mo = Number(m.slice(5, 7));
  const dim = daysInMonth(y, mo);
  return { key: m, year: y, month: mo, daysInMonth: dim, start: `${m}-01`, end: `${m}-${String(dim).padStart(2, '0')}` };
}

/**
 * @param {{salaryMonthly?:number, hireDate?:string, month?:string}} opts
 * @returns {{salaryMonthly:number, salaryEarned:number, daysInMonth:number, daysWorked:number, prorated:boolean, hireDate:string, hireDay:number, rangeLabel:string, ratioLabel:string}}
 */
function prorateMonthlySalary(opts = {}){
  const salary = round2(opts.salaryMonthly);
  const parts = monthParts(opts.month);
  const hire = normalizeHireDate(opts.hireDate);
  if(!parts){
    return {
      salaryMonthly: salary,
      salaryEarned: salary,
      daysInMonth: 0,
      daysWorked: 0,
      prorated: false,
      hireDate: hire,
      hireDay: 0,
      rangeLabel: '',
      ratioLabel: ''
    };
  }
  const dim = parts.daysInMonth;
  if(!hire){
    return {
      salaryMonthly: salary,
      salaryEarned: salary,
      daysInMonth: dim,
      daysWorked: dim,
      prorated: false,
      hireDate: '',
      hireDay: 0,
      rangeLabel: `1–${dim}`,
      ratioLabel: `${dim}/${dim}`
    };
  }
  const hireDay = Number(hire.slice(8, 10));
  if(hire > parts.end){
    return {
      salaryMonthly: salary,
      salaryEarned: 0,
      daysInMonth: dim,
      daysWorked: 0,
      prorated: true,
      hireDate: hire,
      hireDay,
      rangeLabel: 'işe başlamadı',
      ratioLabel: `0/${dim}`
    };
  }
  if(hire <= parts.start){
    return {
      salaryMonthly: salary,
      salaryEarned: salary,
      daysInMonth: dim,
      daysWorked: dim,
      prorated: false,
      hireDate: hire,
      hireDay,
      rangeLabel: `1–${dim}`,
      ratioLabel: `${dim}/${dim}`
    };
  }
  const daysWorked = dim - hireDay + 1;
  const salaryEarned = round2(salary * daysWorked / dim);
  return {
    salaryMonthly: salary,
    salaryEarned,
    daysInMonth: dim,
    daysWorked,
    prorated: true,
    hireDate: hire,
    hireDay,
    rangeLabel: `${hireDay}–${dim}`,
    ratioLabel: `${daysWorked}/${dim}`
  };
}

function formulaSalaryPart(pr){
  const earned = Number(pr?.salaryEarned || 0).toLocaleString('tr-TR');
  const full = Number(pr?.salaryMonthly || 0).toLocaleString('tr-TR');
  if(pr?.prorated){
    return `Kısmi maaş ${earned} (${full} × ${pr.ratioLabel})`;
  }
  return `Maaş ${full}`;
}

module.exports = {
  round2,
  normalizeHireDate,
  monthKey,
  daysInMonth,
  prorateMonthlySalary,
  formulaSalaryPart
};
