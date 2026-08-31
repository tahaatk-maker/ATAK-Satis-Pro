/** ATAK Ev Gereçleri — satıcı kartı verileri */

export const COMPANY = {
  legalName: "ATAK EV GEREÇLERİ PAZ. TİC. LTD. ŞTİ.",
  defaultLandline: "0212 223 28 71",
  defaultAddress: "Ferahevler Mah. Adnankahveci Cad. No:109 Sarıyer/İSTANBUL",
};

function formatPhone(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return "";
  const with0 = digits.startsWith("0") ? digits : `0${digits}`;
  if (with0.length === 11) {
    return `${with0.slice(0, 4)} ${with0.slice(4, 7)} ${with0.slice(7, 9)} ${with0.slice(9)}`;
  }
  return raw;
}

/**
 * 4 satıcı kartı.
 * Firma unvanı ve logolar ortaktır. Cep / e-posta kişiye özeldir.
 * 3. satıcı farklı mağaza hattı ve adresi kullanır.
 */
export const SELLERS = [
  {
    id: 1,
    name: "Muhammed Emir ATAK",
    mobile: formatPhone("5403431312"),
    email: "emir.atak@atakhome.com.tr",
    landline: formatPhone("0212 223 28 71"),
    address: "Ferahevler Mah. Adnankahveci Cad. No:109 Sarıyer/İSTANBUL",
  },
  {
    id: 2,
    name: "Taha Yasin ATAK",
    mobile: formatPhone("05433585060"),
    email: "taha.atak@atakhome.com.tr",
    landline: formatPhone("0212 223 28 71"),
    address: "Ferahevler Mah. Adnankahveci Cad. No:109 Sarıyer/İSTANBUL",
  },
  {
    id: 3,
    name: "Emine Yakışır",
    mobile: formatPhone("05333326991"),
    email: "emine.yakisir@atakhome.com.tr",
    landline: formatPhone("02122625651"),
    address: "Ferahevler Mah. Adnan Kahveci Cad. No:24 Sarıyer/İSTANBUL",
  },
  {
    id: 4,
    name: "",
    mobile: "",
    email: "",
    landline: formatPhone("0212 223 28 71"),
    address: "Ferahevler Mah. Adnankahveci Cad. No:109 Sarıyer/İSTANBUL",
  },
];

export function isComplete(seller) {
  return Boolean(seller.name && seller.mobile && seller.email);
}

export function telHref(value) {
  return "tel:+90" + String(value || "").replace(/\s+/g, "").replace(/^0/, "");
}

export function vcard(seller) {
  const parts = seller.name.split(" ");
  const last = parts.slice(-1)[0];
  const first = parts.slice(0, -1).join(" ");
  return [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `FN:${seller.name}`,
    `N:${last};${first};;;`,
    `ORG:${COMPANY.legalName}`,
    `TEL;TYPE=CELL:${seller.mobile.replace(/\s+/g, "")}`,
    `TEL;TYPE=WORK:${seller.landline.replace(/\s+/g, "")}`,
    `EMAIL:${seller.email}`,
    `ADR;TYPE=WORK:;;${seller.address};;;;Türkiye`,
    "END:VCARD",
  ].join("\n");
}
