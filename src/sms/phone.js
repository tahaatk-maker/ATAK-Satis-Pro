const TR_MOBILE = /^(?:(?:00)?90|0)?(5\d{9})$/;

/**
 * Mobildev örnek formatı: 532XXXXXXX veya 90532XXXXXXX.
 * Türkiye'deki cep numaralarını 10 haneli 5XXXXXXXXX biçimine çevirir.
 */
export function normalizeTrMobile(input) {
  const digits = String(input ?? "").replace(/\D/g, "");
  const match = digits.match(TR_MOBILE);
  if (!match) {
    throw new Error(`Geçersiz GSM numarası: ${input}`);
  }
  return match[1];
}

export function normalizeNumbers(numbers) {
  const list = Array.isArray(numbers) ? numbers : String(numbers).split(/[,;]+/);
  const unique = [...new Set(list.map((n) => n.trim()).filter(Boolean).map(normalizeTrMobile))];
  if (unique.length === 0) {
    throw new Error("En az bir GSM numarası gerekli");
  }
  if (unique.length > 10000) {
    throw new Error("Tek pakette en fazla 10.000 numara gönderilebilir");
  }
  return unique;
}
