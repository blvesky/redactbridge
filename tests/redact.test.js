/*
 * RedactBridge — redaction engine unit tests (node, no dependencies).
 * Run: node tests/redact.test.js   (expects ../redact.js relative to tests/)
 * Every assertion reflects behaviour verified against the shipped engine.
 */
"use strict";
const path = require("path");
const engine = require(path.join(__dirname, "..", "redact.js"));

let passed = 0, failed = 0;
function check(name, ok) {
  if (ok) { passed++; console.log("PASS -", name); }
  else { failed++; console.log("FAIL -", name); }
}
function types(result) { return result.items.map((i) => i.type); }
function has(result, type, original) {
  return result.items.some((i) => i.type === type && (original === undefined || i.original === original));
}

const SAMPLE_CN = "面谈记录（2026-11-20，社区庇护所）。当事人：王小梅，联系电话 138-1234-5678，身份证号 320508199003124564，邮箱 wangxiaomei@example.com。现住址：江苏省苏州市姑苏区干将西路 288 号 3 幢 502 室。其丈夫李大勇（电话 +86 139 5555 0134）多次上门威胁。她希望申请临时庇护和法律援助，银行卡 4242 4242 4242 4242 是她仅有的账户。";
const SAMPLE_EN = "Client: Maria Gonzalez, phone +1 (415) 555-0132, SSN 123-45-6789, lives at 482 Oak Avenue, Springfield, IL 62704. Her spouse Daniel Gonzalez called the office twice.";

// --- Chinese shelter sample: full coverage + zero leak ---
const cn = engine.redact(SAMPLE_CN);
check("CN sample detects exactly 8 items", cn.items.length === 8);
["王小梅", "李大勇", "138-1234-5678", "+86 139 5555 0134", "320508199003124564",
 "wangxiaomei@example.com", "4242 4242 4242 4242"].forEach((s) => {
  check("CN zero leak: " + s, cn.redacted.indexOf(s) === -1);
});
check("CN address replaced", cn.redacted.indexOf("[ADDRESS_1]") !== -1 && cn.redacted.indexOf("干将西路") === -1);
check("CN non-sensitive text intact （上门威胁）", cn.redacted.indexOf("上门威胁") !== -1);
check("CN same value -> same placeholder", (() => {
  const r = engine.redact("王小梅来了，王小梅的丈夫也来了。");
  return r.redacted.indexOf("[NAME_1]") !== -1 && r.redacted.indexOf("[NAME_2]") === -1;
})());

// --- English legal-aid sample ---
const en = engine.redact(SAMPLE_EN);
check("EN sample detects exactly 5 items", en.items.length === 5);
check("EN zero leak: Maria Gonzalez", en.redacted.indexOf("Maria Gonzalez") === -1);
check("EN zero leak: SSN", en.redacted.indexOf("123-45-6789") === -1);
check("EN zero leak: street address", en.redacted.indexOf("482 Oak Avenue") === -1);

// --- Individual detectors ---
check("CN landline detected", has(engine.redact("办公室电话 010-62345678，周一到周五有人接听。"), "PHONE", "010-62345678"));
check("CN mobile without separators detected", has(engine.redact("微信同号 13955550134，随时联系。"), "PHONE", "13955550134"));
check("CN passport-like ID detected", has(engine.redact("护照号 E12345678，有效期到 2030 年。"), "ID", "E12345678"));
check("Compound surname name detected", has(engine.redact("来访者欧阳娜娜是社区志愿者，陪同前往派出所。"), "NAME", "欧阳娜娜"));
check("Luhn-invalid card NOT detected", !has(engine.redact("她记下的卡号 4242 4242 4242 4241 是抄错的。"), "BANK_CARD"));
check("CN ID with wrong birthdate shape NOT detected as ID",
  !has(engine.redact("编号 320508199913124564 是假的。"), "ID", "320508199913124564"));

// --- False-positive guards ---
check("石家庄 is not flagged as a name", !has(engine.redact("他老家在石家庄，去年搬到苏州。"), "NAME", "石家庄"));

// --- Re-scan stability: redacted output must not re-flag its own placeholders ---
check("re-scan of redacted CN text finds 0 items", engine.redact(cn.redacted).items.length === 0);
check("re-scan of redacted EN text finds 0 items", engine.redact(en.redacted).items.length === 0);

// --- Checksum helpers ---
check("cnIdChecksumOk accepts the sample ID", engine._cnIdChecksumOk("320508199003124564") === true);
check("luhnOk accepts 4242…4242", engine._luhnOk("4242 4242 4242 4242") === true);
check("luhnOk rejects 4242…4241", engine._luhnOk("4242 4242 4242 4241") === false);

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
