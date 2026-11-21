/*
 * RedactBridge — local redaction engine (deterministic rules, NO model, NO network).
 *
 * This is the on-device gatekeeper step. In the final product the same step is
 * backed by Firebase AI Logic with InferenceMode.ONLY_ON_DEVICE (Gemini Nano 4,
 * structured JSON extraction); this rules engine runs today, offline, entirely
 * in the browser, and also serves as the deterministic safety net / cross-check
 * under the model output.
 *
 * Detected categories: NAME, PHONE, ID (CN resident ID / US SSN / passport-like),
 * ADDRESS, EMAIL, BANK_CARD.
 *
 * Known limits (honest): name detection is label- and dictionary-based, it is
 * NOT full NER. Unlabelled names in free prose can be missed; the UI therefore
 * keeps a human review step (side-by-side comparison) before anything is sent
 * to the cloud. That review step is a designed part of the product, not a TODO.
 */
(function (global) {
  "use strict";

  // ~120 common Chinese surnames (single-char + common compound).
  // NOTE: compound surnames (欧阳/司马/…) live ONLY in COMPOUND below; their
  // component chars must not enter this single-char set (上/官/诸/葛 are not
  // standalone surnames — splitting them in once flagged "上门威" as a name).
  var SURNAMES = (
    "王李张刘陈杨黄赵吴周徐孙胡朱高林何郭马罗梁宋郑谢韩唐冯于董萧程曹袁邓许傅沈曾彭吕苏卢蒋蔡贾丁魏薛叶阎余潘杜戴夏钟汪田任姜范方石姚谭廖邹熊金陆郝孔白崔康毛邱秦江史顾侯邵孟龙万段漕钱汤尹黎易常武莫贺赖龚文夏侯"
  ).split("");
  // compound surnames need two-char handling
  var COMPOUND = ["欧阳", "司马", "上官", "诸葛", "司徒", "夏侯", "东方", "皇甫", "尉迟", "公孙", "慕容", "长孙", "宇文"];
  var SURNAME_SET = {};
  SURNAMES.forEach(function (s) { SURNAME_SET[s] = true; });

  // Words that start with a surname char but are not names (false-positive guard).
  var NOT_NAME = {
    "王国": 1, "马上": 1, "万元": 1, "金额": 1, "金融": 1, "历史": 1, "方式": 1, "方法": 1,
    "石家庄": 1, "程序": 1, "程度": 1, "高兴": 1, "高速": 1, "林业": 1, "何时": 1, "何地": 1,
    "任何": 1, "如何": 1, "于是": 1, "文章": 1, "文化": 1, "文明": 1, "文件": 1, "文学": 1
  };

  function isHan(ch) { return /[\u4e00-\u9fa5]/.test(ch); }

  // Chinese ID checksum (GB 11643) — used to raise confidence, not to gate.
  function cnIdChecksumOk(id) {
    if (!/^\d{17}[\dXx]$/.test(id)) return false;
    var w = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
    var codes = "10X98765432";
    var sum = 0;
    for (var i = 0; i < 17; i++) sum += parseInt(id[i], 10) * w[i];
    return codes[sum % 11] === id[17].toUpperCase();
  }

  // Luhn check for bank card candidates.
  function luhnOk(num) {
    var digits = num.replace(/\D/g, "");
    if (digits.length < 15 || digits.length > 19) return false;
    var sum = 0, alt = false;
    for (var i = digits.length - 1; i >= 0; i--) {
      var d = parseInt(digits[i], 10);
      if (alt) { d *= 2; if (d > 9) d -= 9; }
      sum += d; alt = !alt;
    }
    return sum % 10 === 0;
  }

  /*
   * redact(text) -> {
   *   redacted: string with placeholders like [NAME_1],
   *   items: [{type, placeholder, original, count}] in first-appearance order,
   *   stats: {total, byType}
   * }
   * Same original value always maps to the same placeholder.
   */
  function redact(text) {
    var spans = []; // {start, end, type, value}

    function addSpan(start, end, type, value) {
      if (end <= start) return;
      // Our own placeholders (e.g. "[ADDRESS_1]" after a label like 现住址：) are
      // not personal data — never let a re-scan of redacted text flag them.
      if (/^\[[A-Z_]+_\d+\]$/.test(value)) return;
      for (var i = 0; i < spans.length; i++) {
        if (start < spans[i].end && end > spans[i].start) return; // overlap: first rule wins
      }
      spans.push({ start: start, end: end, type: type, value: value });
    }
    function scan(re, type, transform) {
      var m; re.lastIndex = 0;
      while ((m = re.exec(text)) !== null) {
        var val = transform ? transform(m) : m[0];
        if (val == null) continue;
        var idx = m.index + m[0].indexOf(val);
        addSpan(idx, idx + val.length, type, val);
        if (m[0].length === 0) re.lastIndex++;
      }
    }

    // ---- EMAIL ----
    scan(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "EMAIL");

    // ---- ID (before PHONE: an 18-digit ID starting 13x must not be eaten as a mobile) ----
    scan(/\b\d{17}[\dXx]\b/g, "ID", function (m) {
      // accept regardless of checksum, but checksum-valid ones are certain;
      // pattern alone (18 digits w/ birthdate shape) is already highly specific.
      return /^\d{6}(18|19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{3}[\dXx]$/.test(m[0]) ? m[0] : null;
    });
    scan(/\b\d{3}-\d{2}-\d{4}\b/g, "ID");                          // US SSN shape
    scan(/\b[EeGg]\d{8}\b/g, "ID");                                // CN passport-like

    // ---- PHONE ----
    // CN mobile with optional +86 and separators; CN landline; US/intl formats.
    scan(/(\+?86[\s-]?)?1[3-9]\d[\s-]?\d{4}[\s-]?\d{4}/g, "PHONE");
    scan(/0\d{2,3}-[2-9]\d{6,7}/g, "PHONE");                       // landline 010-62345678
    scan(/\+1[\s-]?\(?\d{3}\)?[\s-]\d{3}[\s-]\d{4}/g, "PHONE");    // +1 (415) 555-0132
    scan(/\b\d{3}[- ]\d{3}[- ]\d{4}\b/g, "PHONE");                  // 415-555-0132

    // ---- BANK CARD (Luhn-gated, 16-19 digits possibly spaced) ----
    scan(/\b\d{4}(?:[ ]\d{4}){3}(?:[ ]\d{1,3})?\b/g, "BANK_CARD", function (m) {
      return luhnOk(m[0]) ? m[0] : null;
    });
    scan(/\b\d{16,19}\b/g, "BANK_CARD", function (m) {
      return luhnOk(m[0]) ? m[0] : null;
    });

    // ---- ADDRESS ----
    // Label-led: 地址/住址/户籍/现住址/家庭住址/Address followed by content.
    scan(/(?:现住址|家庭住址|户籍地址|住址|地址|Address)\s*[:：]?\s*([^\n;；。]{6,80})/g, "ADDRESS",
      function (m) { return m[1].replace(/[\s,，]+$/, ""); });
    // Standalone CN administrative chain: …省 …市 …(区/县) …(路/街/镇/乡) …号 …(室/栋/幢/单元)
    scan(/[\u4e00-\u9fa5]{2,10}省[\u4e00-\u9fa5]{2,12}市[\u4e00-\u9fa5]{2,40}?(?:号|室|栋|幢|单元)/g, "ADDRESS");
    scan(/[\u4e00-\u9fa5]{2,12}市[\u4e00-\u9fa5]{2,12}(?:区|县)[\u4e00-\u9fa5]{2,30}?(?:号|室|栋|幢|单元)/g, "ADDRESS");
    // Standalone US street address: 123 Main Street / 45 Oak Ave, Springfield, IL 62704
    scan(/\b\d{1,6}\s+(?:[A-Z][a-zA-Z]+\s){0,3}(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr)\b(?:\s*,?\s*(?:Apt|Suite|Ste|#)\s*\w+)?(?:\s*,\s*[A-Z][a-zA-Z ]+,\s*[A-Z]{2}\s*\d{5})?/g, "ADDRESS");

    // ---- NAME ----
    // (a) Label-led CN: 姓名/当事人/联系人/来访者/案主/丈夫/妻子/父亲/母亲/儿子/女儿/家属 followed by 2-4 Han chars.
    // Guard: a capture starting with a function word is a verb phrase, not a name
    // ("其丈夫也来了" once captured "也来了"). None of these chars start a surname.
    scan(/(?:姓名|当事人|联系人|来访者|案主|求助者|丈夫|妻子|配偶|父亲|母亲|儿子|女儿|家属|母亲|本人)\s*[:：]?\s*([一-龥]{2,4})/g, "NAME",
      function (m) { return /^[也又已的了是都还把被给从到说去来着过吗呢吧啊就]/.test(m[1]) ? null : m[1]; });
    // (b) Label-led EN: Name:/Client:/Caller: John Smith
    scan(/(?:Name|Client|Caller|Patient|Spouse|Husband|Wife)\s*:\s*([A-Z][a-z]+(?:\s[A-Z][a-z]+){1,2})/g, "NAME",
      function (m) { return m[1]; });
    // (c) Honorific CN: 王小梅女士 / 李大勇先生
    scan(/([一-龥]{2,4})(?:女士|先生|同志|老师|医生|警官)/g, "NAME", function (m) {
      var n = m[1];
      return (SURNAME_SET[n[0]] || COMPOUND.indexOf(n.slice(0, 2)) >= 0) && !NOT_NAME[n] ? n : null;
    });
    // (d) Surname-dictionary scan over Han runs: surname + 1-2 chars, bounded.
    (function () {
      var runRe = /[一-龥]+/g, m;
      while ((m = runRe.exec(text)) !== null) {
        var run = m[0], base = m.index, i = 0;
        while (i < run.length) {
          var name = null, len = 0;
          var two = run.substr(i, 2);
          if (COMPOUND.indexOf(two) >= 0 && i + 3 <= run.length) { name = run.substr(i, 3); len = 3; if (i + 4 <= run.length && isHan(run[i + 3])) { name = run.substr(i, 4); len = 4; } }
          else if (SURNAME_SET[run[i]] && i + 1 < run.length) {
            len = (i + 2 < run.length && isHan(run[i + 2]) && !/[的了是在和与及或把被给向从到]/.test(run[i + 2])) ? 3 : 2;
            name = run.substr(i, len);
          }
          if (name && !NOT_NAME[name] && !/^(的|了|是|在|和|与)/.test(name.slice(1))) {
            // require the char after the candidate to be a boundary-ish char or run end
            var after = run[i + len] || "";
            if (!after || /[的了是在和与及或把被给向从到说问想去来上下大小]/.test(after) || len === 3) {
              addSpan(base + i, base + i + len, "NAME", name);
              i += len; continue;
            }
          }
          i++;
        }
      }
    })();
    // (e) EN names: two consecutive Capitalized words (guarded by common non-name words).
    scan(/\b([A-Z][a-z]{1,20}\s[A-Z][a-z]{1,20})\b/g, "NAME", function (m) {
      var stop = /^(New York|Los Angeles|San Francisco|Social Security|United States|Case File|Main Street|Oak Avenue)$/;
      return stop.test(m[1]) ? null : m[1];
    });

    // ---- build output ----
    spans.sort(function (a, b) { return a.start - b.start; });
    var counters = {}, map = {}, items = [];
    function placeholderFor(type, value) {
      var key = type + "|" + value;
      if (map[key]) return map[key];
      counters[type] = (counters[type] || 0) + 1;
      var ph = "[" + type + "_" + counters[type] + "]";
      map[key] = ph;
      items.push({ type: type, placeholder: ph, original: value, count: 0 });
      return ph;
    }
    var out = "", last = 0;
    spans.forEach(function (s) {
      out += text.slice(last, s.start);
      out += placeholderFor(s.type, s.value);
      last = s.end;
    });
    out += text.slice(last);
    items.forEach(function (it) {
      it.count = out.split(it.placeholder).length - 1;
    });
    var byType = {};
    items.forEach(function (it) { byType[it.type] = (byType[it.type] || 0) + 1; });
    return { redacted: out, items: items, stats: { total: items.length, byType: byType } };
  }

  var api = { redact: redact, _cnIdChecksumOk: cnIdChecksumOk, _luhnOk: luhnOk };
  global.RedactEngine = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : this);
