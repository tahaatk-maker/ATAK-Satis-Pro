import { describeError, isErrorCode } from "./errorCodes.js";
import { normalizeNumbers } from "./phone.js";

export const DEFAULT_GATEWAY_URL = "https://xmlapi.mobildev.com";

const ACTION = {
  SEND_TO_MANY: 0,
  SEND_MULTI: 1,
  REPORT_BY_DATE: 2,
  REPORT_BY_ID: 3,
  USER_INFO: 4,
  ACCOUNTS: 5,
  CANCEL: 6,
};

export class MobildevSmsError extends Error {
  constructor(code, raw) {
    super(describeError(code));
    this.name = "MobildevSmsError";
    this.code = String(code);
    this.raw = raw;
  }
}

export class MobildevSmsClient {
  /**
   * @param {{ apiKey: string, apiSecret: string, originator?: string, gatewayUrl?: string, fetchImpl?: typeof fetch }} options
   */
  constructor(options) {
    if (!options?.apiKey || !options?.apiSecret) {
      throw new Error("MOBILDEV_API_KEY ve MOBILDEV_API_SECRET gerekli");
    }
    this.apiKey = options.apiKey;
    this.apiSecret = options.apiSecret;
    this.originator = options.originator ?? "";
    this.gatewayUrl = options.gatewayUrl || DEFAULT_GATEWAY_URL;
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
  }

  credentials() {
    return { UserName: this.apiKey, PassWord: this.apiSecret };
  }

  async getUserInfo() {
    const raw = await this.post({ ...this.credentials(), Action: ACTION.USER_INFO });
    return parseUserInfo(raw);
  }

  async getAccounts() {
    const raw = await this.post({ ...this.credentials(), Action: ACTION.ACCOUNTS });
    return parseAccounts(raw);
  }

  /**
   * Aynı metni bir veya birden fazla numaraya gönderir (Action 0).
   * @param {{ to: string|string[], text: string, originator?: string, accountId?: string|number, encoding?: 0|1, messageType?: 'N'|'C', recipientType?: ''|'B'|'T', sendAt?: string, endAt?: string, tags?: string }} input
   */
  async sendToMany(input) {
    const numbers = normalizeNumbers(input.to);
    const text = String(input.text ?? "").trim();
    if (text.length < 3) {
      throw new Error("Mesaj metni en az 3 karakter olmalı");
    }

    const raw = await this.post({
      ...this.credentials(),
      Action: ACTION.SEND_TO_MANY,
      Mesgbody: text,
      Numbers: numbers,
      AccountId: input.accountId ?? "",
      Originator: input.originator ?? this.originator,
      SDate: input.sendAt ?? "",
      EDate: input.endAt ?? "",
      Encoding: input.encoding ?? 0,
      MessageType: input.messageType ?? "N",
      RecipientType: input.recipientType ?? "",
      Tags: input.tags ?? "",
    });

    return parseSendResult(raw);
  }

  /**
   * Numara başına farklı içerik gönderir (Action 1).
   * @param {{ messages: Array<{ to: string, text: string }>, originator?: string, accountId?: string|number, encoding?: 0|1, messageType?: 'N'|'C' }} input
   */
  async sendMulti(input) {
    const messages = (input.messages ?? []).map((item) => ({
      Mesgbody: String(item.text ?? "").trim(),
      Number: normalizeNumbers(item.to)[0],
    }));
    if (messages.length === 0) {
      throw new Error("En az bir mesaj gerekli");
    }
    if (messages.some((m) => m.Mesgbody.length < 3)) {
      throw new Error("Her mesaj metni en az 3 karakter olmalı");
    }

    const raw = await this.post({
      ...this.credentials(),
      Action: ACTION.SEND_MULTI,
      Message: messages,
      AccountId: input.accountId ?? "",
      Originator: input.originator ?? this.originator,
      SDate: input.sendAt ?? "",
      EDate: input.endAt ?? "",
      Encoding: input.encoding ?? 0,
      MessageType: input.messageType ?? "N",
      RecipientType: input.recipientType ?? "",
      Tags: input.tags ?? "",
    });

    return parseSendResult(raw);
  }

  async getReportByIds(msgIds) {
    const ids = (Array.isArray(msgIds) ? msgIds : [msgIds]).map(Number);
    if (ids.length === 0) {
      throw new Error("En az bir MsgID gerekli");
    }
    if (ids.length > 25) {
      throw new Error("Tek istekte en fazla 25 MsgID sorgulanabilir");
    }
    const raw = await this.post({
      ...this.credentials(),
      Action: ACTION.REPORT_BY_ID,
      MsgID: ids,
    });
    return parseReport(raw);
  }

  async getReportByDate(fromDate, toDate) {
    const raw = await this.post({
      ...this.credentials(),
      Action: ACTION.REPORT_BY_DATE,
      FDate: fromDate,
      LDate: toDate,
    });
    return parseReport(raw);
  }

  async cancel(msgId) {
    const raw = await this.post({
      ...this.credentials(),
      Action: ACTION.CANCEL,
      MsgID: Number(msgId),
    });
    const code = String(raw).trim();
    if (code !== "00") {
      throw new MobildevSmsError(code, raw);
    }
    return { cancelled: true, code };
  }

  async post(payload) {
    const response = await this.fetchImpl(this.gatewayUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const raw = (await response.text()).trim();
    if (!response.ok) {
      throw new Error(`Mobildev HTTP ${response.status}: ${raw.slice(0, 200)}`);
    }
    if (isErrorCode(raw) || /^err\s*\d{2}/i.test(raw)) {
      const code = raw.replace(/^err\s*/i, "").slice(0, 2);
      throw new MobildevSmsError(code, raw);
    }
    return raw;
  }
}

export function createClientFromEnv(env = process.env, fetchImpl) {
  return new MobildevSmsClient({
    apiKey: env.MOBILDEV_API_KEY,
    apiSecret: env.MOBILDEV_API_SECRET,
    originator: env.MOBILDEV_ORIGINATOR,
    gatewayUrl: env.MOBILDEV_GATEWAY_URL,
    fetchImpl,
  });
}

export function parseUserInfo(raw) {
  const lines = splitLines(raw);
  if (lines.length === 0) {
    return { credit: 0, originators: [] };
  }
  const credit = Number(lines[0].replace(",", ".")) || 0;
  return { credit, originators: lines.slice(1).filter(Boolean), raw };
}

export function parseAccounts(raw) {
  return { raw, lines: splitLines(raw) };
}

export function parseSendResult(raw) {
  const packetId = String(raw).trim();
  if (!packetId) {
    throw new MobildevSmsError("10", raw);
  }
  return { packetId, raw };
}

const REPORT_STATUS = {
  1: "Rapor bekleniyor",
  2: "İletildi",
  3: "İletilemedi",
};

export function parseReport(raw) {
  const rows = splitLines(raw)
    .map((line) => line.split("\t").filter((part) => part !== ""))
    .filter((cols) => cols.length >= 3)
    .map((cols) => ({
      timerId: cols[0],
      msisdn: cols[1],
      status: Number(cols[2]),
      statusLabel: REPORT_STATUS[Number(cols[2])] ?? "Bilinmiyor",
      deliveryDate: cols[3] ?? "",
      reason: cols[4] ?? "",
      messageSize: cols[5] ?? "",
      messageType: cols[6] ?? "",
      recipientType: cols[7] ?? "",
      iysBrandCode: cols[8] ?? "",
      encoding: cols[9] ?? "",
    }));
  return { rows, raw };
}

function splitLines(raw) {
  return String(raw ?? "")
    .split(/\r\n|\n|\r|\u000a/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}
