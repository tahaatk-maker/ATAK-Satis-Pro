/** Mobildev SMS JSON/XML API v3.0 hata kodları. */
export const ERROR_CODES = {
  "00": "İşlem başarılı / iptal edildi",
  "01": "Hatalı kullanıcı adı, şifre veya bayi kodu",
  "02": "Yetersiz kredi, geçersiz mesaj ID veya rapor henüz hazır değil",
  "03": "Tanımsız Action parametresi",
  "04": "Gelen XML/JSON yok",
  "05": "XML/JSON düğümü eksik ya da hatalı",
  "06": "Tanımsız Originator bilgisi",
  "07": "Mesaj kodu (ID) yok",
  "08": "Verilen tarihler arasında SMS gönderimi yok",
  "09": "Tarih alanları boş veya hatalı",
  "10": "SMS gönderilemedi",
  "11": "Tanımlanamayan hata",
  "12": "Admin yetkisi gerektiren alana yetkisiz erişim",
  "13": "Rapor istenen kullanıcı yok",
  "20": "Yalnızca HTTP POST kabul edilir",
  "21": "Hatalı MessageType (C: Kampanya, N: Bildirim)",
  "22": "Hatalı RecipientType (B: Bireysel, T: Tacir)",
  "23": "Mesaj metni boş bırakılamaz",
  "24": "Gönderim yapılacak GSM numarası eklenmemiş",
  "25": "TR gönderim yetkisi bulunmamakta",
  "26": "Geçersiz veya hatalı accountId bilgisi",
  "27": "Tek istekte en fazla 25 MsgID sorgulanabilir",
  "28": "Tarih aralığı en fazla 72 saat olabilir",
  "29": "İptal hatası (eksik/hatalı MsgID, zaten gönderilmiş veya iptal edilmiş paket)",
};

export function describeError(code) {
  const normalized = String(code ?? "").trim();
  return ERROR_CODES[normalized] ?? `Bilinmeyen Mobildev hata kodu: ${normalized}`;
}

export function isErrorCode(value) {
  const normalized = String(value ?? "").trim();
  if (!/^\d{2}$/.test(normalized)) {
    return false;
  }
  // 00 is success for cancel; treat other known 2-digit codes as errors.
  return normalized !== "00" && Boolean(ERROR_CODES[normalized]);
}
