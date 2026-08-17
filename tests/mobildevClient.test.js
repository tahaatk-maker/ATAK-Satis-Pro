import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MobildevSmsClient,
  MobildevSmsError,
  parseUserInfo,
  parseReport,
  parseSendResult,
} from "../src/sms/mobildevClient.js";
import { isErrorCode } from "../src/sms/errorCodes.js";

function mockFetch(body, status = 200) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => body,
    };
  };
  return { fetchImpl, calls };
}

function client(fetchImpl) {
  return new MobildevSmsClient({
    apiKey: "test-key",
    apiSecret: "test-secret",
    originator: "ATAK",
    fetchImpl,
  });
}

test("kredi ve originator yanıtını satır satır ayırır", () => {
  const parsed = parseUserInfo("1250\nATAK\nATAKSATIS");
  assert.equal(parsed.credit, 1250);
  assert.deepEqual(parsed.originators, ["ATAK", "ATAKSATIS"]);
});

test("gönderim yanıtındaki paket ID'yi döner", () => {
  assert.deepEqual(parseSendResult("732395885"), { packetId: "732395885", raw: "732395885" });
});

test("rapor satırlarını tab ile parse eder", () => {
  const raw = "500032\t00905056641234\t2\t26012021151731\t0\t1\tN\t-\t-\t0";
  const { rows } = parseReport(raw);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].timerId, "500032");
  assert.equal(rows[0].status, 2);
  assert.equal(rows[0].statusLabel, "İletildi");
});

test("2 haneli hata kodlarını tanır", () => {
  assert.equal(isErrorCode("01"), true);
  assert.equal(isErrorCode("00"), false);
  assert.equal(isErrorCode("732395885"), false);
});

test("sendToMany JSON Action 0 isteği atar", async () => {
  const { fetchImpl, calls } = mockFetch("732395885");
  const result = await client(fetchImpl).sendToMany({
    to: "0532 123 45 67",
    text: "Siparişiniz alındı",
  });
  assert.equal(result.packetId, "732395885");
  const payload = JSON.parse(calls[0].init.body);
  assert.equal(calls[0].url, "https://xmlapi.mobildev.com");
  assert.equal(calls[0].init.headers["Content-Type"], "application/json");
  assert.equal(payload.Action, 0);
  assert.equal(payload.UserName, "test-key");
  assert.equal(payload.PassWord, "test-secret");
  assert.deepEqual(payload.Numbers, ["5321234567"]);
  assert.equal(payload.Mesgbody, "Siparişiniz alındı");
  assert.equal(payload.Originator, "ATAK");
  assert.equal(payload.MessageType, "N");
});

test("getUserInfo Action 4 isteği atar", async () => {
  const { fetchImpl, calls } = mockFetch("10\nATAK");
  const info = await client(fetchImpl).getUserInfo();
  assert.equal(info.credit, 10);
  assert.deepEqual(info.originators, ["ATAK"]);
  assert.equal(JSON.parse(calls[0].init.body).Action, 4);
});

test("hatalı kimlikte MobildevSmsError fırlatır", async () => {
  const { fetchImpl } = mockFetch("01");
  await assert.rejects(
    () => client(fetchImpl).sendToMany({ to: "5321234567", text: "Test mesaji" }),
    (error) => {
      assert.ok(error instanceof MobildevSmsError);
      assert.equal(error.code, "01");
      return true;
    },
  );
});

test("eksik kimlikle client oluşturulamaz", () => {
  assert.throws(() => new MobildevSmsClient({ apiKey: "", apiSecret: "x" }), /gerekli/);
});
