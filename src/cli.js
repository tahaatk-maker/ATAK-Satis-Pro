#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createClientFromEnv } from "./sms/mobildevClient.js";

loadDotEnv();

const [command, ...rest] = process.argv.slice(2);

try {
  const client = createClientFromEnv();
  if (command === "info") {
    console.log(JSON.stringify(await client.getUserInfo(), null, 2));
  } else if (command === "accounts") {
    console.log(JSON.stringify(await client.getAccounts(), null, 2));
  } else if (command === "send") {
    const args = parseArgs(rest);
    if (!args.to || !args.text) {
      throw new Error("Kullanım: npm run sms:send -- --to 5XXXXXXXXX --text \"Mesaj\"");
    }
    const result = await client.sendToMany({
      to: args.to.split(","),
      text: args.text,
      originator: args.originator,
      encoding: args.encoding === "tr" ? 1 : 0,
    });
    console.log(JSON.stringify(result, null, 2));
  } else if (command === "report") {
    const args = parseArgs(rest);
    if (args.id) {
      console.log(JSON.stringify(await client.getReportByIds(args.id.split(",")), null, 2));
    } else if (args.from && args.to) {
      console.log(JSON.stringify(await client.getReportByDate(args.from, args.to), null, 2));
    } else {
      throw new Error("Kullanım: node src/cli.js report --id 123 veya --from YYYY-MM-DD --to YYYY-MM-DD");
    }
  } else {
    console.log(`ATAK Satış Pro — Mobildev SMS

Komutlar:
  npm run sms:info
  npm run sms:accounts
  npm run sms:send -- --to 5XXXXXXXXX --text "Merhaba"
  node src/cli.js report --id 123
  node src/cli.js report --from 2026-08-01 --to 2026-08-02
`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith("--")) continue;
    out[key.slice(2)] = argv[i + 1] ?? "true";
    i += 1;
  }
  return out;
}

function loadDotEnv() {
  const path = resolve(process.cwd(), ".env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}
