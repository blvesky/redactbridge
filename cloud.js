/*
 * RedactBridge — cloud step via Firebase AI Logic.
 *
 * Real path (only when window.RB_FIREBASE_CONFIG is set, see
 * firebase-config.example.js): loads the Firebase JS SDK (v12.5.0+, per
 * official hybrid get-started), builds a model with
 * InferenceMode.ONLY_IN_CLOUD, and returns result.response.inferenceSource
 * verbatim so the UI badge shows where the inference actually ran.
 *
 * Mock path (no config): returns a locally templated brief and marks it
 * mock:true in the return value AND in the UI. A mock is never presented
 * as a real model call.
 *
 * App Check: if self.FIREBASE_APPCHECK_DEBUG_TOKEN is set on the page
 * (local dev only — never commit a real token), it is wired before AI calls.
 */
(function (global) {
  "use strict";

  var SDK = "12.5.0";
  var CDN = "https://www.gstatic.com/firebasejs/" + SDK + "/";

  function isConfigured() {
    return !!(global.RB_FIREBASE_CONFIG && global.RB_FIREBASE_CONFIG.apiKey &&
      global.RB_FIREBASE_CONFIG.apiKey !== "YOUR_API_KEY");
  }

  var _app = null, _ai = null;
  function loadFirebase() {
    if (_app) return Promise.resolve({ app: _app, ai: _ai });
    return Promise.all([
      import(CDN + "firebase-app.js"),
      import(CDN + "firebase-ai.js"),
      import(CDN + "firebase-app-check.js")
    ]).then(function (mods) {
      var appMod = mods[0], aiMod = mods[1], acMod = mods[2];
      _app = appMod.initializeApp(global.RB_FIREBASE_CONFIG);
      if (typeof self !== "undefined" && self.FIREBASE_APPCHECK_DEBUG_TOKEN) {
        try {
          acMod.initializeAppCheck(_app, {
            provider: new acMod.CustomProvider({
              getToken: function () {
                return Promise.resolve({
                  token: String(self.FIREBASE_APPCHECK_DEBUG_TOKEN),
                  expireTimeMillis: Date.now() + 60 * 60 * 1000
                });
              }
            }),
            isTokenAutoRefreshEnabled: true
          });
        } catch (e) { /* App Check optional in skeleton; real setup registers the debug token in Console. */ }
      }
      _ai = aiMod.getAI(_app, { backend: new aiMod.GoogleAIBackend() });
      return { app: _app, ai: _ai, aiMod: aiMod };
    });
  }

  function briefPrompt(redactedText, items, lang) {
    var cats = {};
    items.forEach(function (it) { cats[it.type] = (cats[it.type] || 0) + 1; });
    var lines = [
      "You are assisting a frontline social worker / legal-aid worker.",
      "The intake note below has ALREADY been redacted on the worker's device.",
      "Placeholders like [NAME_1] refer to real people whose identities you must not guess.",
      "Write a concise case brief with these sections:",
      "1) Situation summary (3-5 sentences)",
      "2) Risk factors",
      "3) Immediate needs",
      "4) Suggested referrals and next steps",
      "",
      "Redaction categories present: " + JSON.stringify(cats),
      "",
      "REDACTED INTAKE NOTE:",
      redactedText
    ];
    if (lang === "zh") lines.push("", "Write the brief in Simplified Chinese (简体中文). Keep the placeholders (e.g. [NAME_1]) unchanged.");
    return lines.join("\n");
  }

  function mockBrief(redactedText, items, lang) {
    var cats = {};
    items.forEach(function (it) { cats[it.type] = (cats[it.type] || 0) + 1; });
    var catLine = Object.keys(cats).map(function (k) { return k + " ×" + cats[k]; }).join(", ") || "none";
    if (lang === "zh") {
      return [
        "个案简报（结构预览）",
        "",
        "1) 情况摘要",
        "一份面谈记录已在设备本地完成脱敏（" + catLine + "）。",
        "脱敏后记录：" + redactedText.slice(0, 220) + (redactedText.length > 220 ? "…" : ""),
        "",
        "2) 风险因素",
        "• 配置云端模型后，由模型根据脱敏记录评估。",
        "",
        "3) 紧急需求",
        "• 按记录内容制定安全计划并预约跟进面谈。",
        "",
        "4) 转介建议与下一步",
        "• 按上述需求匹配庇护、法律援助与心理咨询转介。"
      ].join("\n");
    }
    return [
      "CASE BRIEF (structure preview)",
      "",
      "1) Situation summary",
      "A client intake note was redacted on-device (" + catLine + "). ",
      "The redacted note reads: " + redactedText.slice(0, 220) + (redactedText.length > 220 ? "…" : ""),
      "",
      "2) Risk factors",
      "• To be assessed from the redacted note by the cloud model in the full version.",
      "",
      "3) Immediate needs",
      "• Safety planning and a follow-up appointment, per the note's content.",
      "",
      "4) Suggested referrals and next steps",
      "• Shelter / legal-aid / counselling referrals matched to the needs above."
    ].join("\n");
  }

  /*
   * generateCaseBrief(redactedText, items, lang?)
   * -> Promise<{ text, inferenceSource: string|null, mock: boolean, model: string }>
   */
  function generateCaseBrief(redactedText, items, lang) {
    if (!isConfigured()) {
      return new Promise(function (resolve) {
        setTimeout(function () {
          resolve({
            text: mockBrief(redactedText, items, lang),
            inferenceSource: null,
            mock: true,
            model: "(none — local template)"
          });
        }, 350);
      });
    }
    return loadFirebase().then(function (ctx) {
      var aiMod = ctx.aiMod;
      var model = aiMod.getGenerativeModel(ctx.ai, {
        mode: aiMod.InferenceMode.ONLY_IN_CLOUD,
        inCloudParams: { model: "gemini-3.8-flash" }
      });
      return model.generateContent(briefPrompt(redactedText, items, lang)).then(function (result) {
        return {
          text: result.response.text(),
          inferenceSource: result.response.inferenceSource || "IN_CLOUD",
          mock: false,
          model: "gemini-3.8-flash"
        };
      });
    });
  }

  /*
   * doubleCheckRedacted(redactedText) — second pair of eyes, ON DEVICE ONLY.
   * Asks Gemini Nano 4 (via AI Logic, InferenceMode.ONLY_ON_DEVICE) to scan the
   * already-redacted text for anything that still looks like personal data.
   * The input contains no raw originals, but the check is still pinned to the
   * device: reviewing case material is device work by design.
   *
   * Honest states: with no Firebase config, or when the on-device model is
   * unavailable, this resolves { available:false, reason } — it never falls
   * back to the cloud and never pretends to have run.
   * -> Promise<{ available: boolean, findings?: string, inferenceSource?: string|null,
   *              model?: string, reason?: string }>
   */
  function doubleCheckRedacted(redactedText) {
    if (!isConfigured()) {
      return Promise.resolve({
        available: false,
        reason: "No Firebase project configured — the on-device AI double-check needs Firebase AI Logic. The deterministic rules re-scan above still applies."
      });
    }
    return loadFirebase().then(function (ctx) {
      var aiMod = ctx.aiMod;
      var model = aiMod.getGenerativeModel(ctx.ai, {
        mode: aiMod.InferenceMode.ONLY_ON_DEVICE,
        inCloudParams: { model: "gemini-3.5-flash-lite" }
      });
      var prompt = [
        "You are a privacy checker. The text below is an intake note that has already been redacted;",
        "personal data was replaced by placeholders like [NAME_1], [PHONE_1].",
        "List anything that STILL looks like real personal data (a real name, phone number, ID number,",
        "street address, email, bank card number) that was missed. Reply with one item per line,",
        "or exactly: NONE",
        "",
        "TEXT:",
        redactedText
      ].join("\n");
      return model.generateContent(prompt).then(function (result) {
        return {
          available: true,
          findings: result.response.text(),
          inferenceSource: result.response.inferenceSource || null,
          model: "Gemini Nano 4 (on-device via AI Logic)"
        };
      }).catch(function (err) {
        return {
          available: false,
          reason: "On-device model unavailable on this browser/device: " + (err && err.message ? err.message : String(err))
        };
      });
    }).catch(function (err) {
      return {
        available: false,
        reason: "Firebase SDK failed to load: " + (err && err.message ? err.message : String(err))
      };
    });
  }

  /*
   * probeDevice() — availability + (when configured) SDK device init.
   * Must be called from a user gesture for the init/download path.
   * -> Promise<{ configured, promptApi: string, sdkInit: string, inferenceSource: string|null }>
   * Never rejects; failures are reported as status strings.
   */
  function probeDevice() {
    var out = { configured: isConfigured(), promptApi: "unknown", sdkInit: "skipped", inferenceSource: null };
    var steps = Promise.resolve();
    if ("LanguageModel" in global) {
      steps = steps.then(function () {
        return global.LanguageModel.availability()
          .then(function (a) { out.promptApi = String(a); })
          .catch(function () { out.promptApi = "error"; });
      });
    } else {
      out.promptApi = "absent (LanguageModel API not present in this browser)";
    }
    if (!out.configured) {
      out.sdkInit = "skipped — no Firebase config; on-device SDK path not attempted";
      return steps.then(function () { return out; });
    }
    return steps.then(function () {
      return loadFirebase().then(function (ctx) {
        var aiMod = ctx.aiMod;
        var model = aiMod.getGenerativeModel(ctx.ai, {
          mode: aiMod.InferenceMode.PREFER_ON_DEVICE,
          inCloudParams: { model: "gemini-3.5-flash-lite" }
        });
        return model.initializeDeviceModel(function () {})
          .then(function () {
            out.sdkInit = "initializeDeviceModel() resolved";
            return model.generateContent("Reply with the single word: ready");
          })
          .then(function (result) {
            out.inferenceSource = result.response.inferenceSource || null;
            return out;
          })
          .catch(function (err) {
            out.sdkInit = "failed: " + (err && err.message ? err.message : String(err));
            return out;
          });
      }).catch(function (err) {
        out.sdkInit = "SDK load failed: " + (err && err.message ? err.message : String(err));
        return out;
      });
    });
  }

  global.RedactBridgeCloud = {
    isConfigured: isConfigured,
    generateCaseBrief: generateCaseBrief,
    doubleCheckRedacted: doubleCheckRedacted,
    probeDevice: probeDevice
  };
})(window);
