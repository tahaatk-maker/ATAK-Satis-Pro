'use strict';

/** Rapid360 / D365 F&O “Detaylı satış bilgileri XML” (DmrDetailedSalesReport) → Atak satış kayıtları. */

function foldKey(s){
  return String(s || '').toLocaleLowerCase('tr-TR')
    .replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's')
    .replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ç/g, 'c')
    .replace(/^[_$]+/, '')
    .replace(/[^a-z0-9]/g, '');
}

function decodeEntities(s){
  return String(s || '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

function decodeBuffer(buf){
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf || '');
  if(!b.length) return '';
  if(b.length >= 2 && b[0] === 0xFF && b[1] === 0xFE) return b.slice(2).toString('utf16le');
  if(b.length >= 2 && b[0] === 0xFE && b[1] === 0xFF){
    const swap = Buffer.alloc(b.length - 2);
    for(let i = 2; i + 1 < b.length; i += 2){ swap[i - 2] = b[i + 1]; swap[i - 1] = b[i]; }
    return swap.toString('utf16le');
  }
  if(b.length >= 3 && b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) return b.slice(3).toString('utf8');
  const sample = b.slice(0, 80);
  if(sample.includes(0) && b.length >= 4){
    const evenZero = [...sample].filter((_, i) => i % 2 === 1).every(x => x === 0);
    if(evenZero) return b.toString('utf16le');
  }
  return b.toString('utf8');
}

function parseAttrs(tok){
  const attrs = {};
  const re = /([^\s=<>/]+)\s*=\s*"([^"]*)"|([^\s=<>/]+)\s*=\s*'([^']*)'/g;
  let m;
  while((m = re.exec(String(tok || '')))){
    const name = String(m[1] || m[3] || '').replace(/^.*:/, '');
    if(!name) continue;
    attrs[name] = decodeEntities(m[2] != null ? m[2] : m[4]);
  }
  return attrs;
}

function parseXmlTree(text){
  const src = String(text || '')
    .replace(/^\uFEFF/, '')
    .replace(/<\?xml[^?]*\?>/i, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, c) => c.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));
  const tokens = src.match(/<[^>]+>|[^<]+/g) || [];
  const root = { name: 'root', children: [], text: '', attrs: {} };
  const stack = [root];
  for(const tok of tokens){
    if(tok.startsWith('<?') || tok.startsWith('<!')) continue;
    if(tok.startsWith('</')){
      if(stack.length > 1) stack.pop();
      continue;
    }
    if(tok.startsWith('<')){
      const selfClose = /\/\s*>$/.test(tok);
      const m = tok.match(/^<\s*\/?\s*([^>\s\/]+)/);
      if(!m) continue;
      const name = String(m[1]).replace(/^.*:/, '');
      const node = { name, children: [], text: '', attrs: parseAttrs(tok) };
      stack[stack.length - 1].children.push(node);
      if(!selfClose) stack.push(node);
      continue;
    }
    stack[stack.length - 1].text += tok;
  }
  return root;
}

function nodeValue(node){
  const kids = node.children || [];
  const out = {};
  for(const [k, v] of Object.entries(node.attrs || {})){
    if(v != null && String(v).trim() !== '') out[k] = String(v).trim();
  }
  if(!kids.length){
    const t = decodeEntities(node.text).trim();
    if(t && !Object.keys(out).length) return t;
    if(t && out._text == null) out._text = t;
    return Object.keys(out).length ? out : t;
  }
  for(const c of kids){
    const k = c.name;
    const v = nodeValue(c);
    if(out[k] === undefined) out[k] = v;
    else{
      if(!Array.isArray(out[k])) out[k] = [out[k]];
      out[k].push(v);
    }
  }
  const t = decodeEntities(node.text).trim();
  if(t && !Object.keys(out).length) return t;
  return out;
}

function flattenRecord(obj){
  if(obj == null || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const out = {};
  for(const [k, v] of Object.entries(obj)){
    if(v == null) continue;
    if(typeof v === 'object') continue;
    const key = foldKey(k);
    if(key) out[key] = String(v).trim();
  }
  return Object.keys(out).length ? out : null;
}

function walkRecords(val, acc, inherit = {}){
  if(val == null) return;
  if(Array.isArray(val)){
    for(const x of val) walkRecords(x, acc, inherit);
    return;
  }
  if(typeof val !== 'object') return;
  const flat = flattenRecord(val) || {};
  const merged = { ...inherit, ...flat };
  const next = { ...inherit };
  const sid = pick(merged, KEY.salesId);
  if(sid) next.siparisno = sid;
  if(Object.keys(flat).length && (sid || pick(merged, KEY.itemCode) || pick(merged, KEY.itemName) || pick(merged, KEY.custAccount) || composeCustomerName(merged) || merged.odemetarihi || merged.toplamtutar)){
    acc.push(merged);
  }
  for(const v of Object.values(val)) walkRecords(v, acc, next);
}

const KEY = {
  salesId: ['salesid','salesorder','salesordernumber','salesordernum','satissiparisi','satissiparis','siparisno','salesnumber','ordernumber','satisno','orderid','satissiparisiid','transactionnumber','receiptid','transactionid'],
  orderDate: ['orderdate','siparistarihi','transdate','createddate','createddatetime','receiptdate','tarih','salesdate','transactiondate','orderingdate'],
  invoiceDate: ['invoicedate','faturatarihi','invoicedatetime'],
  invoiceNo: ['invoiceid','invoicenumber','emanetfatura','faturano','invoicesayac','faturasayac','faturasayacno','invoicecounter'],
  custAccount: ['custaccount','musterihesabi','accountnum','customercode','accountnumcust','musterikodu','custaccountnum','orderingcustomeraccountnumber','invoicecustomeraccountnumber','customeraccount'],
  firstName: ['ad','adi','musteriad','firstname','givenname','first','irtibatadi','kisiadi','personfirstname'],
  middleName: ['ikinciad','ortadad','middlename','secondname'],
  lastName: ['soyad','soyadi','musterisoyadi','lastname','surname','familyname','faturalanacakmusterisoyadi'],
  billedName: ['faturalanacakmusteriadi'],
  musteriAdi: ['musteriadi','musteri'],
  fullName: ['adsoyad','advesoyad','custname','customername','partyname','namealias','salesname','invoicecustomername'],
  company: ['unvan','unvani','firmaunvani','companyname','ticariunvan'],
  store: ['inventlocationid','store','magaza','warehouse','inventlocation','storeid','warehouseid','storenumber','retailstoreid','inventsiteid'],
  eInvoice: ['iseinvoice','efaturami','einvoice','efatura'],
  webOrder: ['isweborder','websiparisimi','weborder'],
  itemCode: ['itemid','itemcode','malzemekodu','maddekodu','itemnumber','productcode','urunkodu','productnumber'],
  itemName: ['malzemeadi','itemname','name','metin','text','urunadi','itemtext','salesdetail','satisdetayi','searchname','aramaadi','productname','saleslineitemdescription'],
  qty: ['qty','quantity','salesqty','adet','miktar','orderedqty','lineqty','orderedsalesquantity','qtyordered'],
  unitPrice: ['salesprice','birimfiyat','price','unitprice','satisprice'],
  lineAmount: ['lineamount','lineamountmst','satistutari','linenetamount','amountmst','kalemtutar','netamount'],
  headerTotal: ['toplamtutar','faturatutari','kdvtutartoplami'],
  cancelled: ['faturasinifi','faturaasama','status','iptal'],
  salesperson: ['satistemsilcisi','salesperson','satici','personel'],
  tckn: ['tckimlik','tckn','tcno','tckimlikno'],
  taxNo: ['vergino','vkn','taxnumber','verginumarasi'],
  taxOffice: ['vergidairesi','taxoffice'],
  address: ['adres','address','evadresi','faturaadresi'],
  city: ['sehir','city','il'],
  district: ['ilce','district'],
  neighborhood: ['semt','mahalle','neighborhood'],
  email: ['eposta','email','mail','musteriemail'],
  phone: ['ceptelefonu','gsm','mobile','mobiltelefon','telefon','irtibattelefonu','evtelefonu','phoneno','phone'],
  payMethod: ['paymmode','odemeyontemi','paymentmethod','paymterm','paymmethod'],
  payName: ['paymmodename','odemeyontemiadi','paymentmethodname','paymname'],
  payAmount: ['odenecektutar','amountcur','paymamount','paymentamount','tutarodenecek'],
  dueDate: ['duedate','vade','vadetarihi'],
  installments: ['kktaksitsayisi','taksitsayisi','installments'],
  lineNo: ['linenum','faturasatri','invoiceline','satirno'],
  paro: ['parotrx','parotrxnumarasi']
};

function pick(rec, names){
  if(!rec) return '';
  for(const n of names){
    if(rec[n] != null && String(rec[n]).trim() !== '') return String(rec[n]).trim();
  }
  return '';
}

function nameKey(s){
  return foldKey(String(s || '').replace(/\s+/g, ''));
}

function joinNameParts(parts){
  const out = [];
  for(const raw of parts || []){
    const s = String(raw || '').replace(/\s+/g, ' ').trim();
    if(!s) continue;
    const key = nameKey(s);
    if(!key) continue;
    const idx = out.findIndex(x => {
      const k = nameKey(x);
      return k === key || k.includes(key) || key.includes(k);
    });
    if(idx < 0) out.push(s);
    else if(s.length > out[idx].length) out[idx] = s;
  }
  return out.join(' ').trim();
}

function betterPersonName(current, incoming){
  const a = String(current || '').replace(/\s+/g, ' ').trim();
  const b = String(incoming || '').replace(/\s+/g, ' ').trim();
  if(!b) return a;
  if(!a) return b;
  if(a === b) return a;
  const fa = nameKey(a);
  const fb = nameKey(b);
  if(fb.includes(fa) && b.length >= a.length) return b;
  if(fa.includes(fb)) return a;
  const aParts = a.split(/\s+/).length;
  const bParts = b.split(/\s+/).length;
  if(bParts > aParts) return b;
  return a;
}

/** Rapid360 Ad + Soyad sütunlarını Atak tek “Ad Soyad” alanına birleştirir. */
function composeCustomerName(rec){
  if(!rec) return '';
  const first = pick(rec, KEY.firstName);
  const middle = pick(rec, KEY.middleName);
  const last = pick(rec, KEY.lastName);
  const billed = pick(rec, KEY.billedName);
  const musteriAdi = pick(rec, KEY.musteriAdi);
  const full = pick(rec, KEY.fullName);
  const company = pick(rec, KEY.company);
  const candidates = [];
  if(first || last) candidates.push(joinNameParts([first, middle, last]));
  if(first && billed) candidates.push(joinNameParts([first, middle, billed]));
  if(musteriAdi && last) candidates.push(joinNameParts([musteriAdi, last]));
  if(musteriAdi && billed) candidates.push(joinNameParts([musteriAdi, billed]));
  candidates.push(full, musteriAdi, billed, last, first, company);
  return candidates.filter(Boolean).sort((a, b) => b.length - a.length || a.localeCompare(b, 'tr'))[0] || '';
}

function asNumber(v){
  if(typeof v === 'number' && Number.isFinite(v)) return Math.round(v * 100) / 100;
  let s = String(v || '').trim().replace(/\s/g, '');
  if(!s) return 0;
  if(s.includes(',') && s.includes('.')){
    if(s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  }else if(s.includes(',')) s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function toIsoDate(raw){
  const s = String(raw || '').trim();
  const tr = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/);
  if(tr) return `${tr[3]}-${String(tr[2]).padStart(2, '0')}-${String(tr[1]).padStart(2, '0')}`;
  if(/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const ax = s.match(/^(\d{4})(\d{2})(\d{2})/);
  if(ax && s.length === 8) return `${ax[1]}-${ax[2]}-${ax[3]}`;
  const dt = new Date(s);
  if(Number.isFinite(dt.getTime()) && dt.getFullYear() > 1990){
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  }
  return '';
}

function truthy(v){
  return /^(1|true|yes|evet|on|x)$/i.test(String(v || '').trim());
}

function mapPaymentMethod(raw){
  const s = String(raw || '').toLocaleLowerCase('tr-TR');
  if(/senet|promiss|cek|çek/.test(s)) return 'Senet';
  if(/kredi\s*kart|kk\b|card|pos/.test(s)) return 'Kredi Kartı';
  if(/havale|eft|transfer|banka/.test(s)) return 'Havale';
  if(/vadeli|credit|acik\s*hesap|açık/.test(s)) return 'Vadeli';
  if(/nakit|cash|nak\b/.test(s)) return 'Nakit';
  return String(raw || '').trim() || 'Karma';
}

function isCancelledFlag(v){
  return /iptal/.test(String(v || '').toLocaleLowerCase('tr-TR'));
}

function recKind(rec){
  const item = pick(rec, KEY.itemCode);
  const itemName = pick(rec, KEY.itemName);
  const qty = asNumber(pick(rec, KEY.qty));
  const pay = pick(rec, KEY.payMethod) || pick(rec, KEY.payName);
  const payAmt = asNumber(pick(rec, KEY.payAmount));
  const cust = pick(rec, KEY.custAccount) || composeCustomerName(rec);
  const isPayNode = !!(rec.odemetarihi || rec.vadetarihi || rec.taksitsayisi);
  if(isPayNode && !item) return 'payment';
  const hasLine = !!(item || ((itemName || qty) && !pay && !cust));
  const hasPay = !!(pay || (payAmt && !item && !cust));
  if(hasLine && cust) return 'both';
  if(hasPay && !hasLine) return 'payment';
  if(hasLine) return 'line';
  if(cust || pick(rec, KEY.orderDate) || pick(rec, KEY.invoiceDate) || rec.toplamtutar) return 'header';
  if(payAmt) return 'payment';
  return '';
}

function ensureSale(map, id){
  const key = String(id || '').trim();
  if(!key) return null;
  if(!map.has(key)){
    map.set(key, {
      salesId: key,
      orderDate: '',
      invoiceDate: '',
      invoiceNumber: '',
      custAccount: '',
      custName: '',
      firstName: '',
      lastName: '',
      store: '',
      eInvoice: false,
      webOrder: false,
      cancelled: false,
      salespersonName: '',
      tckn: '',
      taxNo: '',
      taxOffice: '',
      companyName: '',
      address: '',
      city: '',
      district: '',
      neighborhood: '',
      email: '',
      phone: '',
      headerTotal: 0,
      lines: [],
      payments: []
    });
  }
  return map.get(key);
}

function applyHeader(sale, rec){
  sale.orderDate = sale.orderDate || toIsoDate(pick(rec, KEY.orderDate));
  sale.invoiceDate = sale.invoiceDate || toIsoDate(pick(rec, KEY.invoiceDate));
  sale.invoiceNumber = sale.invoiceNumber || pick(rec, KEY.invoiceNo);
  sale.custAccount = sale.custAccount || pick(rec, KEY.custAccount);
  sale.custName = betterPersonName(sale.custName, composeCustomerName(rec));
  sale.firstName = sale.firstName || pick(rec, KEY.firstName);
  sale.lastName = sale.lastName || pick(rec, KEY.lastName);
  const billedLast = pick(rec, KEY.billedName);
  if(!sale.lastName && billedLast && !/\s/.test(billedLast)) sale.lastName = billedLast;
  sale.store = sale.store || pick(rec, KEY.store);
  sale.salespersonName = sale.salespersonName || pick(rec, KEY.salesperson);
  sale.tckn = sale.tckn || pick(rec, KEY.tckn);
  sale.taxNo = sale.taxNo || pick(rec, KEY.taxNo);
  sale.taxOffice = sale.taxOffice || pick(rec, KEY.taxOffice);
  sale.companyName = sale.companyName || pick(rec, KEY.company);
  sale.address = sale.address || pick(rec, KEY.address);
  sale.city = sale.city || String(pick(rec, KEY.city) || '').replace(/\s*\/\s*TUR\s*$/i, '').trim();
  sale.district = sale.district || pick(rec, KEY.district);
  sale.neighborhood = sale.neighborhood || pick(rec, KEY.neighborhood);
  if(sale.neighborhood && sale.address && !nameKey(sale.address).includes(nameKey(sale.neighborhood))){
    sale.address = `${sale.address} ${sale.neighborhood}`.trim();
  }
  sale.email = sale.email || pick(rec, KEY.email);
  sale.phone = sale.phone || pick(rec, KEY.phone);
  const taxDigits = String(sale.taxNo || '').replace(/\D/g, '');
  if(!sale.tckn && taxDigits.length === 11){
    sale.tckn = taxDigits;
    sale.taxNo = '';
  }else if(taxDigits.length === 10) sale.taxNo = taxDigits;
  const headerTotal = asNumber(pick(rec, KEY.headerTotal));
  if(headerTotal) sale.headerTotal = headerTotal;
  if(isCancelledFlag(pick(rec, KEY.cancelled))) sale.cancelled = true;
  if(truthy(pick(rec, KEY.eInvoice))) sale.eInvoice = true;
  if(truthy(pick(rec, KEY.webOrder))) sale.webOrder = true;
}

function applyLine(sale, rec){
  const qtyRaw = asNumber(pick(rec, KEY.qty));
  const qty = Math.max(1, Math.round(qtyRaw || 1));
  let amount = asNumber(pick(rec, KEY.lineAmount) || rec.tutar);
  let unit = asNumber(pick(rec, KEY.unitPrice));
  sale.salespersonName = sale.salespersonName || pick(rec, KEY.salesperson);
  if(!amount && unit) amount = Math.round(unit * qty * 100) / 100;
  if(!unit && amount) unit = Math.round((amount / qty) * 100) / 100;
  const code = pick(rec, KEY.itemCode);
  const name = pick(rec, KEY.itemName) || code || 'Rapid360 kalem';
  if(!code && !pick(rec, KEY.itemName) && !amount) return;
  sale.lines.push({
    itemCode: code,
    name,
    quantity: qty,
    unitPrice: unit,
    total: amount || Math.round(unit * qty * 100) / 100,
    lineNo: pick(rec, KEY.lineNo),
    paro: pick(rec, KEY.paro)
  });
}

function applyPayment(sale, rec){
  const label = pick(rec, KEY.payName) || pick(rec, KEY.payMethod);
  const amount = asNumber(pick(rec, KEY.payAmount) || rec.tutar);
  if(!label && !amount) return;
  sale.payments.push({
    method: mapPaymentMethod(label),
    rawMethod: label,
    amount,
    dueDate: toIsoDate(pick(rec, KEY.dueDate)),
    installments: Math.round(asNumber(pick(rec, KEY.installments))) || 0
  });
}

function groupRecords(records){
  const map = new Map();
  for(const rec of records || []){
    const id = pick(rec, KEY.salesId);
    if(!id) continue;
    const sale = ensureSale(map, id);
    const kind = recKind(rec);
    if(kind === 'header' || kind === 'both') applyHeader(sale, rec);
    if(kind === 'line' || kind === 'both') applyLine(sale, rec);
    if(kind === 'payment') applyPayment(sale, rec);
    if(!kind) applyHeader(sale, rec);
  }
  const sales = [];
  let cancelledCount = 0;
  for(const sale of map.values()){
    if(sale.cancelled){ cancelledCount += 1; continue; }
    if(!sale.lines.length && sale.payments.length){
      const sum = Math.round(sale.payments.reduce((a, p) => a + Number(p.amount || 0), 0) * 100) / 100;
      if(sum > 0){
        sale.lines.push({ itemCode: '', name: 'Rapid360 satış', quantity: 1, unitPrice: sum, total: sum, lineNo: '', paro: '' });
      }
    }
    let total = Math.round(sale.lines.reduce((a, l) => a + Number(l.total || 0), 0) * 100) / 100;
    if((!total || total < 0.01) && sale.headerTotal > 0){
      total = sale.headerTotal;
      if(!sale.lines.length){
        sale.lines.push({ itemCode: '', name: 'Rapid360 satış', quantity: 1, unitPrice: total, total, lineNo: '', paro: '' });
      }
    }else if(sale.headerTotal > total) total = sale.headerTotal;
    sale.total = total;
    if(!sale.orderDate) sale.orderDate = sale.invoiceDate;
    if(!sale.custName) sale.custName = sale.companyName || sale.custAccount || 'Rapid360 müşteri';
    if(sale.custName && (!sale.firstName || !sale.lastName)){
      const bits = String(sale.custName).trim().split(/\s+/).filter(Boolean);
      if(bits.length >= 2){
        sale.lastName = sale.lastName || bits[bits.length - 1];
        sale.firstName = sale.firstName || bits.slice(0, -1).join(' ');
      }else if(bits.length === 1 && !sale.firstName) sale.firstName = bits[0];
    }
    if(sale.total > 0 || sale.lines.length) sales.push(sale);
  }
  sales.sort((a, b) => String(b.orderDate).localeCompare(String(a.orderDate)) || String(b.salesId).localeCompare(String(a.salesId)));
  return { sales, cancelledCount };
}

function parseSpreadsheetRows(text){
  const sheets = [];
  const sheetRe = /<(?:ss:)?Worksheet\b[^>]*?(?:(?:ss:)?Name|name)="([^"]+)"[^>]*>([\s\S]*?)<\/(?:ss:)?Worksheet>/gi;
  let m;
  while((m = sheetRe.exec(text))){
    const name = decodeEntities(m[1]);
    const body = m[2];
    const rows = [];
    const rowRe = /<(?:ss:)?Row\b[^>]*>([\s\S]*?)<\/(?:ss:)?Row>/gi;
    let r;
    while((r = rowRe.exec(body))){
      const cells = [];
      const cellRe = /<(?:ss:)?Cell\b([^>]*)>([\s\S]*?)<\/(?:ss:)?Cell>|(<(?:ss:)?Cell\b[^>]*\/>)/gi;
      let c;
      let idx = 0;
      while((c = cellRe.exec(r[1]))){
        const attrs = c[1] || '';
        const idxM = attrs.match(/(?:ss:)?Index="(\d+)"/i);
        if(idxM) idx = Number(idxM[1]) - 1;
        const dataM = String(c[2] || '').match(/<(?:ss:)?Data\b[^>]*>([\s\S]*?)<\/(?:ss:)?Data>/i);
        cells[idx] = decodeEntities(String(dataM ? dataM[1] : '').replace(/<[^>]+>/g, '')).trim();
        idx += 1;
      }
      if(cells.some(x => x)) rows.push(cells);
    }
    sheets.push({ name, rows });
  }
  return sheets;
}

function recordsFromSheet(sheet){
  const rows = sheet.rows || [];
  if(rows.length < 2) return [];
  const headers = rows[0].map(h => foldKey(h));
  const out = [];
  for(const row of rows.slice(1)){
    const rec = {};
    headers.forEach((h, i) => {
      if(h && row[i]) rec[h] = String(row[i]).trim();
    });
    if(Object.keys(rec).length) out.push(rec);
  }
  return out;
}

function isSpreadsheetXml(text){
  return /urn:schemas-microsoft-com:office:spreadsheet|<(?:ss:)?Workbook[\s>]|<(?:ss:)?Worksheet\b/i.test(text);
}

function extractSalesFromRecords(records){
  return groupRecords(records).sales;
}

function extractSalesFromJson(payload){
  if(payload == null) return { sales: [], cancelledCount: 0, recordCount: 0, format: 'empty' };
  if(Buffer.isBuffer(payload)) return extractSales(decodeBuffer(payload));
  if(typeof payload === 'string') return extractSales(payload);
  const records = [];
  walkRecords(payload, records);
  const grouped = groupRecords(records);
  return { sales: grouped.sales, cancelledCount: grouped.cancelledCount, recordCount: records.length, format: 'json' };
}

function extractSales(text){
  const raw = String(text || '').replace(/^\uFEFF/, '');
  if(!raw.trim()) return { sales: [], cancelledCount: 0, recordCount: 0, format: 'empty' };
  if(isSpreadsheetXml(raw)){
    const sheets = parseSpreadsheetRows(raw);
    const records = sheets.flatMap(recordsFromSheet);
    const grouped = groupRecords(records);
    return { sales: grouped.sales, cancelledCount: grouped.cancelledCount, recordCount: records.length, format: 'spreadsheet-xml', sheets: sheets.map(s => s.name) };
  }
  const tree = parseXmlTree(raw);
  const records = [];
  walkRecords(nodeValue(tree), records);
  const grouped = groupRecords(records);
  return { sales: grouped.sales, cancelledCount: grouped.cancelledCount, recordCount: records.length, format: 'xml' };
}

function recordsFromXlsxWorkbook(wb, XLSX){
  const records = [];
  for(const name of wb.SheetNames || []){
    const sheet = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
    for(const row of rows){
      const rec = {};
      for(const [k, v] of Object.entries(row)){
        const key = foldKey(k);
        if(key && v != null && String(v).trim() !== '') rec[key] = String(v).trim();
      }
      if(Object.keys(rec).length) records.push(rec);
    }
  }
  return records;
}

module.exports = {
  foldKey,
  decodeBuffer,
  asNumber,
  toIsoDate,
  mapPaymentMethod,
  extractSales,
  extractSalesFromJson,
  extractSalesFromRecords,
  recordsFromXlsxWorkbook,
  parseXmlTree,
  composeCustomerName,
  betterPersonName
};
