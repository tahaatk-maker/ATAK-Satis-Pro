# ATAK Satış Pro — Mobildev SMS API

Mobildev’in paylaştığı [SMS Entegrasyon Kılavuzu](https://postman.mobildev.com/#e1dbff4d-fa75-45e8-986e-0eb005fd2556) bu repoya **JSON API v3.0** üzerinden yüklendi.

Gateway: `POST https://xmlapi.mobildev.com`  
Kimlik: panelden alınan **API Key** (`UserName`) ve **API Secret** (`PassWord`)

## 1. API’yi yüklemek

### A. Postman’a koleksiyonu almak

1. [Mobildev dokümanını](https://postman.mobildev.com/#e1dbff4d-fa75-45e8-986e-0eb005fd2556) açın **veya** `postman/mobildev-sms-json-v3.json` dosyasını kullanın.
2. Postman → **Import** → dosyayı seçin.
3. Collection variables içine `apikey` ve `apisecret` yazın.
4. **Kullanıcı Bilgileri Kontrolü** isteğini çalıştırın. Kredi ve originator listesi dönüyorsa kimlik doğrudur.

### B. Uygulamaya bağlamak

```bash
cp .env.example .env
```

`.env` içine Mobildev panelinden (`https://www.mobildev.com/login.asp`) ürettiğiniz değerleri yazın:

```
MOBILDEV_API_KEY=...
MOBILDEV_API_SECRET=...
MOBILDEV_ORIGINATOR=ATAK
```

Kimlik kontrolü:

```bash
npm run sms:info
```

Örnek gönderim (canlı SMS düşer):

```bash
npm run sms:send -- --to 5XXXXXXXXX --text "ATAK Satis Pro test"
```

## 2. Kodda kullanım

```js
import { createClientFromEnv } from "./src/index.js";

const sms = createClientFromEnv();

const { packetId } = await sms.sendToMany({
  to: ["5321234567"],
  text: "Siparişiniz alındı.",
  messageType: "N", // N: bildirim, C: kampanya
});

const report = await sms.getReportByIds([packetId]);
```

| Metot | Mobildev Action | Ne işe yarar |
| --- | --- | --- |
| `getUserInfo()` | 4 | Kredi + originator listesi |
| `getAccounts()` | 5 | Operatör hesapları (`accountId`) |
| `sendToMany()` | 0 | Aynı metni birden fazla numaraya gönder |
| `sendMulti()` | 1 | Numara başına farklı metin |
| `getReportByIds()` | 3 | Paket/timer ID ile rapor |
| `getReportByDate()` | 2 | Tarih aralığı raporu (en fazla 72 saat) |
| `cancel()` | 6 | İleri tarihli gönderimi iptal et |

Numaralar `5XXXXXXXXX`, `05XXXXXXXXX` veya `905XXXXXXXXX` olabilir; istemci 10 haneye çevirir. Tek pakette en fazla 10.000 numara.

## 3. Dikkat edilecekler

- Kampanya (`MessageType: C`) için originator IYS / marka kodu ile eşleşmiş olmalı.
- Türkçe karakter için `encoding: 1` kullanın (hesapta yetki gerekir).
- Gönderim sonrası dönen `packetId` mutlaka loglanmalı; rapor bununla çekilir.
- Raporlar içinde bulunulan ay için geçerlidir.
- Gerçek key/secret’i repoya koymayın; yalnızca `.env` kullanın.

Kaynak doküman: [postman.mobildev.com SMS Entegrasyon Kılavuzu](https://postman.mobildev.com/#e1dbff4d-fa75-45e8-986e-0eb005fd2556)
