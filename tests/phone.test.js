import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeTrMobile, normalizeNumbers } from "../src/sms/phone.js";

test("10 haneli cep numarasını olduğu gibi bırakır", () => {
  assert.equal(normalizeTrMobile("5321234567"), "5321234567");
});

test("0, 90 ve +90 öneklerini temizler", () => {
  assert.equal(normalizeTrMobile("0532 123 45 67"), "5321234567");
  assert.equal(normalizeTrMobile("+90 532-123-45-67"), "5321234567");
  assert.equal(normalizeTrMobile("905321234567"), "5321234567");
});

test("geçersiz numarayı reddeder", () => {
  assert.throws(() => normalizeTrMobile("2125550000"), /Geçersiz GSM/);
  assert.throws(() => normalizeTrMobile("123"), /Geçersiz GSM/);
});

test("liste ve virgüllü metni tekilleştirir", () => {
  assert.deepEqual(
    normalizeNumbers(["05321234567", "5321234567", "905321234568"]),
    ["5321234567", "5321234568"],
  );
  assert.deepEqual(normalizeNumbers("5321234567, 5321234568"), ["5321234567", "5321234568"]);
  assert.deepEqual(normalizeNumbers("0532 123 45 67"), ["5321234567"]);
});
