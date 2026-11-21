/* RedactBridge — UI wiring. No top-level throws; every async path is caught. */
(function () {
  "use strict";

  var SAMPLE_CN = "面谈记录（2026-11-20，社区庇护所）。当事人：王小梅，联系电话 138-1234-5678，身份证号 320508199003124564，邮箱 wangxiaomei@example.com。现住址：江苏省苏州市姑苏区干将西路 288 号 3 幢 502 室。其丈夫李大勇（电话 +86 139 5555 0134）多次上门威胁。她希望申请临时庇护和法律援助，银行卡 4242 4242 4242 4242 是她仅有的账户。";
  var SAMPLE_EN = "Client: Maria Gonzalez, phone +1 (415) 555-0132, SSN 123-45-6789, lives at 482 Oak Avenue, Springfield, IL 62704. Her spouse Daniel Gonzalez called the office twice.";

  var $ = function (id) { return document.getElementById(id); };
  var els = {
    input: $("inputText"), redactBtn: $("redactBtn"), briefBtn: $("briefBtn"),
    clearBtn: $("clearBtn"), briefLang: $("briefLang"),
    badge: $("sourceBadge"), badgeDetail: $("badgeDetail"),
    stats: $("stats"), originalView: $("originalView"), redactedView: $("redactedView"),
    mapBody: document.querySelector("#mapTable tbody"),
    outgoing: $("outgoingText"), safetyLine: $("safetyLine"),
    copyRedactedBtn: $("copyRedactedBtn"), copyStatus: $("copyStatus"),
    doubleCheckBtn: $("doubleCheckBtn"), doubleCheckOut: $("doubleCheckOut"),
    mockBanner: $("mockBanner"), briefOut: $("briefOut"), briefStatus: $("briefStatus"),
    copyBriefBtn: $("copyBriefBtn"), downloadCaseBtn: $("downloadCaseBtn"), exportStatus: $("exportStatus"),
    diagConfig: $("diagConfig"), diagPromptApi: $("diagPromptApi"), diagAvail: $("diagAvail"),
    probeBtn: $("probeBtn"), probeStatus: $("probeStatus"), probeOut: $("probeOut"),
    selftest: $("selftest")
  };

  var state = { result: null, rawText: "", briefText: "" };

  function esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  function setBadge(kind, text, detail) {
    els.badge.className = "badge badge-" + kind;
    els.badge.textContent = text;
    if (detail) els.badgeDetail.textContent = detail;
  }

  function highlightOriginal(text, items) {
    if (!items.length) return esc(text);
    var sorted = items.slice().sort(function (a, b) { return b.original.length - a.original.length; });
    var pattern = sorted.map(function (it) { return escRe(it.original); }).join("|");
    var typeOf = {};
    items.forEach(function (it) { typeOf[it.original] = it.type; });
    return esc(text).replace(new RegExp(pattern, "g"), function (m) {
      return '<mark class="hl hl-' + (typeOf[m] || "X") + '">' + esc(m) + "</mark>";
    });
  }

  function highlightRedacted(redacted) {
    return esc(redacted).replace(/\[([A-Z_]+_\d+)\]/g, '<span class="ph">$&</span>');
  }

  /* Build the outgoing text from the raw note, applying only approved (non-kept) items. */
  function buildOutgoing() {
    if (!state.result) return "";
    var active = state.result.items.filter(function (it) { return !it.keep; });
    if (!active.length) return state.rawText;
    var sorted = active.slice().sort(function (a, b) { return b.original.length - a.original.length; });
    var byOriginal = {};
    sorted.forEach(function (it) { byOriginal[it.original] = it.placeholder; });
    var pattern = sorted.map(function (it) { return escRe(it.original); }).join("|");
    return state.rawText.replace(new RegExp(pattern, "g"), function (m) { return byOriginal[m]; });
  }

  /*
   * Deterministic safety scan of the outgoing text (runs locally, no model):
   *  1) no approved item's original may still be present;
   *  2) a fresh engine pass must find no personal data other than items the
   *     worker explicitly chose to keep.
   * Returns an array of problem strings; empty = clean.
   */
  function verifyOutgoing(text) {
    var problems = [];
    if (!state.result) return problems;
    state.result.items.forEach(function (it) {
      if (!it.keep && text.indexOf(it.original) !== -1) {
        problems.push("Approved redaction " + it.placeholder + " is still present in the outgoing text.");
      }
    });
    var kept = {};
    state.result.items.forEach(function (it) { if (it.keep) kept[it.original] = true; });
    var fresh = window.RedactEngine.redact(text);
    fresh.items.forEach(function (it) {
      if (/^\[[A-Z_]+_\d+\]$/.test(it.original)) return; // placeholders are not data
      if (!kept[it.original]) {
        problems.push("Possible personal data still in outgoing text: “" + it.original + "” (" + it.type + ").");
      }
    });
    return problems;
  }

  function renderSafety() {
    if (!state.result) {
      els.safetyLine.className = "safety-line";
      els.safetyLine.textContent = "Safety scan: not run yet.";
      return [];
    }
    var problems = verifyOutgoing(els.outgoing.value);
    if (problems.length === 0) {
      els.safetyLine.className = "safety-line safety-ok";
      els.safetyLine.textContent = "✓ Safety scan passed — no approved redaction is present and no other personal data was detected in the outgoing text.";
    } else {
      els.safetyLine.className = "safety-line safety-bad";
      els.safetyLine.textContent = "✗ Safety scan found " + problems.length + " problem(s) — fix before sending: " + problems.slice(0, 4).join(" ");
    }
    return problems;
  }

  function renderReview() {
    var result = state.result;
    els.originalView.innerHTML = highlightOriginal(state.rawText, result.items);
    var outgoing = buildOutgoing();
    els.redactedView.innerHTML = highlightRedacted(outgoing);
    els.outgoing.value = outgoing;

    var activeCount = result.items.filter(function (it) { return !it.keep; }).length;
    var chips = ['<span class="chip chip-total">' + activeCount + " of " + result.stats.total + " item(s) will be redacted</span>"];
    Object.keys(result.stats.byType).forEach(function (t) {
      chips.push('<span class="chip">' + t + " ×" + result.stats.byType[t] + "</span>");
    });
    chips.push('<span class="chip chip-local">ran 100% locally — 0 bytes uploaded</span>');
    els.stats.innerHTML = chips.join(" ");

    if (result.items.length) {
      els.mapBody.innerHTML = result.items.map(function (it, idx) {
        return "<tr" + (it.keep ? ' class="row-kept"' : "") + "><td><input type=\"checkbox\" data-idx=\"" + idx + "\" class=\"keep-toggle\"" +
          (it.keep ? "" : " checked") + "></td><td><code>" + esc(it.placeholder) + "</code></td><td>" + esc(it.type) +
          "</td><td>" + esc(it.original) + "</td><td>" + it.count + "</td></tr>";
      }).join("");
      Array.prototype.forEach.call(els.mapBody.querySelectorAll(".keep-toggle"), function (box) {
        box.addEventListener("change", function () {
          var it = state.result.items[Number(box.getAttribute("data-idx"))];
          it.keep = !box.checked;
          renderReview();
        });
      });
    } else {
      els.mapBody.innerHTML = '<tr><td colspan="5" class="empty">No sensitive items detected. Review the original manually before sending anything.</td></tr>';
    }

    els.briefBtn.disabled = false;
    els.copyRedactedBtn.disabled = false;
    els.doubleCheckBtn.disabled = false;
    els.mockBanner.hidden = window.RedactBridgeCloud.isConfigured();
    renderSafety();
  }

  function runRedaction() {
    var text = els.input.value;
    state.rawText = text;
    if (!text.trim()) {
      setBadge("idle", "— not run yet —", "Paste an intake note first.");
      return null;
    }
    var result = window.RedactEngine.redact(text);
    result.items.forEach(function (it) { it.keep = false; });
    state.result = result;
    renderReview();
    setBadge("local", "LOCAL · on-device step",
      "Redaction ran in this browser (rules engine). In the full build this step is Gemini Nano 4 via AI Logic ONLY_ON_DEVICE.");
    return result;
  }

  function runBrief() {
    if (!state.result) return Promise.resolve(null);
    var problems = renderSafety();
    if (problems.length) {
      els.briefStatus.textContent = "Blocked by the safety scan — fix the outgoing text first.";
      return Promise.resolve(null);
    }
    var outgoing = els.outgoing.value;
    els.briefStatus.textContent = "Generating…";
    els.briefBtn.disabled = true;
    return window.RedactBridgeCloud.generateCaseBrief(outgoing, state.result.items, els.briefLang.value)
      .then(function (res) {
        state.briefText = res.text;
        els.briefOut.textContent = res.text;
        els.briefStatus.textContent = "";
        els.briefBtn.disabled = false;
        els.copyBriefBtn.disabled = false;
        els.downloadCaseBtn.disabled = false;
        if (res.mock) {
          setBadge("mock", "MOCK · no cloud call made",
            "No Firebase project configured — the brief is a local template, shown for structure only.");
        } else if (res.inferenceSource === "ON_DEVICE") {
          setBadge("device", "ON_DEVICE", "AI Logic reports this inference ran on-device (" + res.model + ").");
        } else {
          setBadge("cloud", "IN_CLOUD", "AI Logic reports this inference ran in the cloud (" + res.model + "). Only redacted text was sent.");
        }
        return res;
      })
      .catch(function (err) {
        els.briefStatus.textContent = "Cloud call failed: " + (err && err.message ? err.message : String(err));
        els.briefBtn.disabled = false;
        return null;
      });
  }

  function runDoubleCheck() {
    if (!state.result) return Promise.resolve(null);
    els.doubleCheckOut.hidden = false;
    els.doubleCheckOut.textContent = "Running the on-device AI double-check…";
    return window.RedactBridgeCloud.doubleCheckRedacted(els.outgoing.value).then(function (res) {
      if (!res.available) {
        els.doubleCheckOut.innerHTML = "<strong>On-device AI double-check unavailable.</strong> " + esc(res.reason) +
          " Nothing was sent anywhere — the check is pinned to the device by design.";
        return res;
      }
      els.doubleCheckOut.innerHTML = "<strong>On-device AI double-check ran (" + esc(res.model || "") + ").</strong>\n" + esc(res.findings || "");
      if (res.inferenceSource === "ON_DEVICE") {
        setBadge("device", "ON_DEVICE", "Double-check ran on-device via Firebase AI Logic.");
      }
      return res;
    });
  }

  function copyText(text, statusEl, doneMsg) {
    function done() { statusEl.textContent = doneMsg; setTimeout(function () { statusEl.textContent = ""; }, 2500); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(done).catch(function () { fallback(); });
    }
    fallback();
    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); done(); } catch (e) { statusEl.textContent = "Copy failed — select the text manually."; }
      document.body.removeChild(ta);
    }
    return Promise.resolve();
  }

  function downloadCaseFile() {
    var lines = [
      "# Case file — RedactBridge",
      "",
      "Generated: " + new Date().toISOString(),
      "Privacy note: this file contains ONLY the worker-approved redacted note and the generated brief.",
      "The original note and the placeholder mapping never left the worker's device and are not included.",
      "",
      "## Redacted intake note (as sent to the cloud)",
      "",
      els.outgoing.value,
      "",
      "## Case brief",
      "",
      state.briefText || "(no brief generated)"
    ];
    var blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = "redactbridge-case-file.md";
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    els.exportStatus.textContent = "Case file downloaded (redacted note + brief only).";
  }

  function clearAll() {
    els.input.value = "";
    state.result = null; state.rawText = ""; state.briefText = "";
    els.originalView.textContent = "Run step 1 to see the comparison.";
    els.redactedView.textContent = "—";
    els.outgoing.value = "";
    els.stats.innerHTML = "";
    els.mapBody.innerHTML = '<tr><td colspan="5" class="empty">No redactions yet.</td></tr>';
    els.briefOut.textContent = "The brief will appear here.";
    els.briefBtn.disabled = true;
    els.copyRedactedBtn.disabled = true;
    els.doubleCheckBtn.disabled = true;
    els.copyBriefBtn.disabled = true;
    els.downloadCaseBtn.disabled = true;
    els.doubleCheckOut.hidden = true;
    renderSafety();
    setBadge("idle", "— not run yet —", "Redaction runs locally; the case brief runs in the cloud.");
  }

  function lightProbe() {
    els.diagConfig.textContent = window.RedactBridgeCloud.isConfigured() ? "yes" : "no — mock mode";
    if ("LanguageModel" in window) {
      els.diagPromptApi.textContent = "present";
      window.LanguageModel.availability()
        .then(function (a) {
          els.diagAvail.textContent = String(a);
          if (a !== "available") {
            els.diagAvail.textContent += " → cloud fallback path applies for model steps; local redaction unaffected";
          }
        })
        .catch(function () { els.diagAvail.textContent = "error while probing"; });
    } else {
      els.diagPromptApi.textContent = "absent in this browser";
      els.diagAvail.textContent = "unavailable → cloud fallback path applies for model steps; local redaction unaffected";
    }
  }

  function fullProbe() {
    els.probeStatus.textContent = "Probing… (model download/init can take a while)";
    return window.RedactBridgeCloud.probeDevice().then(function (out) {
      els.probeOut.hidden = false;
      els.probeOut.textContent = JSON.stringify(out, null, 2);
      els.probeStatus.textContent = "Probe finished.";
      if (out.inferenceSource === "ON_DEVICE") {
        setBadge("device", "ON_DEVICE", "Probe call ran on-device via Firebase AI Logic.");
      } else if (out.inferenceSource === "IN_CLOUD") {
        setBadge("cloud", "IN_CLOUD", "Probe call fell back to the cloud — on-device model not usable here.");
      }
      return out;
    });
  }

  $("loadSampleCn").addEventListener("click", function () { els.input.value = SAMPLE_CN; });
  $("loadSampleEn").addEventListener("click", function () { els.input.value = SAMPLE_EN; });
  els.redactBtn.addEventListener("click", runRedaction);
  els.briefBtn.addEventListener("click", runBrief);
  els.probeBtn.addEventListener("click", fullProbe);
  els.clearBtn.addEventListener("click", clearAll);
  els.outgoing.addEventListener("input", renderSafety);
  els.copyRedactedBtn.addEventListener("click", function () { copyText(els.outgoing.value, els.copyStatus, "Outgoing text copied."); });
  els.copyBriefBtn.addEventListener("click", function () { copyText(state.briefText, els.exportStatus, "Brief copied."); });
  els.downloadCaseBtn.addEventListener("click", downloadCaseFile);
  els.doubleCheckBtn.addEventListener("click", runDoubleCheck);
  lightProbe();

  /* ---- self-test mode: ?selftest=1 ---- */
  if (/[?&]selftest=1/.test(location.search)) {
    var checks = [];
    function check(name, ok) { checks.push({ name: name, pass: !!ok }); }

    els.input.value = SAMPLE_CN;
    var result = runRedaction();
    var leaks = ["王小梅", "李大勇", "138-1234-5678", "320508199003124564", "干将西路", "wangxiaomei@example.com", "4242 4242 4242 4242"];
    leaks.forEach(function (s) { check("no leak: " + s, result.redacted.indexOf(s) === -1); });
    ["[NAME_1]", "[PHONE_1]", "[ID_1]", "[ADDRESS_1]", "[EMAIL_1]", "[BANK_CARD_1]"].forEach(function (p) {
      check("placeholder present: " + p, result.redacted.indexOf(p) !== -1);
    });
    check("exactly 8 items", result.items.length === 8);
    check("non-sensitive text intact （上门威胁）", result.redacted.indexOf("上门威胁") !== -1);

    runBrief().then(function (res) {
      check("brief is honestly labelled mock", res && res.mock === true);

      // English sample coverage
      els.input.value = SAMPLE_EN;
      var en = runRedaction();
      check("EN sample: exactly 5 items", en.items.length === 5);
      check("EN no leak: Maria Gonzalez", en.redacted.indexOf("Maria Gonzalez") === -1);
      check("EN no leak: 123-45-6789", en.redacted.indexOf("123-45-6789") === -1);
      check("EN no leak: 482 Oak Avenue", en.redacted.indexOf("482 Oak Avenue") === -1);

      // Back to CN for the review-interaction checks
      els.input.value = SAMPLE_CN;
      runRedaction();
      check("safety scan clean on approved outgoing text", verifyOutgoing(els.outgoing.value).length === 0);

      var nameItem = state.result.items.filter(function (it) { return it.placeholder === "[NAME_1]"; })[0];
      nameItem.keep = true;
      els.outgoing.value = buildOutgoing();
      check("keep-toggle restores the original in outgoing text", els.outgoing.value.indexOf("王小梅") !== -1);
      nameItem.keep = false;
      els.outgoing.value = buildOutgoing();
      check("re-approving removes it again", els.outgoing.value.indexOf("王小梅") === -1 && verifyOutgoing(els.outgoing.value).length === 0);

      var planted = els.outgoing.value + " 备用电话 138-1234-5678";
      check("safety scan detects a planted leak", verifyOutgoing(planted).length >= 1);

      return window.RedactBridgeCloud.doubleCheckRedacted(els.outgoing.value);
    }).then(function (dc) {
      check("on-device double-check honestly unavailable without config", dc && dc.available === false);

      els.briefLang.value = "zh";
      return runBrief();
    }).then(function (resZh) {
      check("ZH brief (mock) uses the Chinese template", resZh && resZh.text.indexOf("个案简报") !== -1);
      els.briefLang.value = "en";

      var passed = checks.filter(function (c) { return c.pass; }).length;
      var report = {
        suite: "RedactBridge full-build self-test",
        passed: passed, total: checks.length,
        allPass: passed === checks.length,
        checks: checks,
        redacted: result.redacted,
        badgeAfterBrief: els.badge.textContent
      };
      window.__SELFTEST__ = report;
      els.selftest.hidden = false;
      els.selftest.textContent = JSON.stringify(report, null, 2);
      document.title = report.allPass ? "SELFTEST PASS" : "SELFTEST FAIL";
    });
  }
})();
