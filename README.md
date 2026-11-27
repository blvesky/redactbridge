# RedactBridge

**Private intake notes in, cloud-grade case briefs out — and the raw note never leaves the device.**

RedactBridge is a web app for frontline **social workers and legal-aid workers**.
Caseworkers take intake notes full of personal data — names, phone numbers,
ID numbers, home addresses, bank cards — and then face an impossible choice:
do the paperwork by hand, or paste a client's most sensitive details into a
cloud AI. RedactBridge removes that choice. The note is **redacted on the
device first**; only the redacted text — with placeholders like `[NAME_1]` —
is ever sent to the cloud, where a larger model drafts the case brief,
referral plan and paperwork outline.

Built for **#BuildHybridAI 2026** with **Firebase AI Logic** hybrid inference
(on-device Gemini Nano 4 + cloud Gemini), targeting the Web/Chrome platform.

## Why hybrid is the product, not a feature

The on-device/cloud split in RedactBridge is dictated by privacy, not by
performance:

- **Anything that touches the raw note must run on-device.** Extraction,
  redaction and the second-opinion double-check are pinned to the device with
  `InferenceMode.ONLY_ON_DEVICE`. There is no code path that sends raw text
  to the cloud — if the on-device step cannot run, the app says so instead of
  silently rerouting.
- **Only the approved, redacted text may use the cloud.** Drafting a brief
  needs long-text reasoning, so it runs with `InferenceMode.ONLY_IN_CLOUD` —
  on input the worker has reviewed, approved, and can edit character by
  character.
- **The app proves where inference ran.** Every AI Logic call returns
  `response.inferenceSource`, and the header badge displays it verbatim
  (`ON_DEVICE` / `IN_CLOUD`), next to `LOCAL` for the rules-engine step and
  `MOCK` when no Firebase project is configured. Nothing is hard-coded.

## How it works

1. **Paste the intake note** (Chinese and English supported; two fictional
   sample notes are built in).
2. **On-device redaction.** A deterministic rules engine (labels, surname
   dictionary, ID birthdate shape + checksum, bank-card Luhn check) proposes
   redactions for names, phone numbers, ID numbers, addresses, emails and
   bank cards — 100% locally, zero bytes uploaded. The rules engine performs
   this step in every configuration; Gemini Nano 4 is used only for the
   optional on-device double-check in step 3.
3. **Human review.** Side-by-side highlighted comparison, a per-item mapping
   table with approve/keep toggles (untick a false positive to restore it),
   and an editable *outgoing text* box — exactly what will be sent, nothing
   else. A deterministic **safety scan** re-checks the outgoing text and
   blocks the send button while it finds problems (an approved redaction
   still present, or new personal data typed back in). An optional
   **on-device AI double-check** (Gemini Nano 4, `ONLY_ON_DEVICE`) adds a
   model-based second scan.
4. **Cloud brief.** The outgoing text goes to `gemini-3.5-flash` via Firebase
   AI Logic (`ONLY_IN_CLOUD`) and returns a structured case brief: situation
   summary, risk factors, immediate needs, referrals and next steps — in
   English or Simplified Chinese. Copy it, or download a case file (.md)
   containing the redacted note and the brief. The original note and the
   placeholder mapping are never included in any export.

## Hybrid design — function × mode × model

| Function | InferenceMode | Model | Why this side of the bridge |
|---|---|---|---|
| Sensitive-field extraction + redaction | `ONLY_ON_DEVICE` | Gemini Nano 4 (on-device) | Raw notes are personal data; they must never leave the device. The rules engine runs this step locally and cross-checks the model. |
| Redaction double-check (single-turn) | `ONLY_ON_DEVICE` | Gemini Nano 4 (on-device) | Reviewing case material is device work by design; never routed to the cloud. |
| Case brief + referral plan | `ONLY_IN_CLOUD` | gemini-3.5-flash (free tier) | Input is already redacted; needs long-text reasoning. |
| Document polish / rewrite | `PREFER_IN_CLOUD` | gemini-3.5-flash-lite | Input is redacted; cloud preferred, device fallback acceptable. |

## Run it

Static site, no build step:

```bash
npx serve .          # or: python3 -m http.server
# then open index.html in Chrome
```

Without any configuration the app runs in **honest mock mode**: redaction,
review and the safety scan are fully real; the brief step returns a clearly
labelled local template (amber banner + `MOCK` badge), never a fake model
call.

### Connect a Firebase project (real AI Logic path)

1. Create a Firebase project and a Web app in the
   [Firebase Console](https://console.firebase.google.com/).
2. Copy `firebase-config.example.js` to `firebase-config.js`, fill in your
   Web app config, and uncomment the `<script src="firebase-config.js">` tag
   in `index.html`. **`firebase-config.js` is git-ignored — never commit a
   filled-in config, an App Check debug token, or any `.env` file.**
3. **App Check (required):** for local development set
   `self.FIREBASE_APPCHECK_DEBUG_TOKEN = true` before the app scripts (see
   the example config), load the page once, and register the debug token
   printed in the console under Console → App Check → Manage debug tokens.
   For production, register a reCAPTCHA v3 provider instead.
4. **On-device model:** in desktop Chrome, enable the
   "Gemma 4 for Built-in AI" flag (`chrome://flags`), then use the
   *Initialize / probe on-device model* button in the app's Diagnostics
   section — `initializeDeviceModel()` is only ever called from that user
   gesture. On-device inference needs Chrome 139+ and hardware above the
   documented Chrome Prompt API thresholds; the app probes availability at
   runtime and shows the fallback instead of hiding it.

## Tests

```bash
node tests/redact.test.js     # 27 engine unit checks, no dependencies
```

In-browser end-to-end self-test: open `index.html?selftest=1`. It runs the
full flow on the fictional samples and renders a JSON report into the page
(26 checks): zero sensitive-string leaks (CN + EN samples), placeholder
integrity, review keep/restore toggles, the outgoing-text safety scan
(including a deliberately planted leak), honest mock labelling, and the
Chinese brief template.

## Privacy model

- Raw notes exist only in the page's memory. No storage, no analytics, no
  network call happens before the worker presses *Generate case brief* —
  and that call contains only the approved outgoing text.
- The placeholder ↔ original mapping table is rendered locally for review
  and is deliberately excluded from the downloadable case file.
- Demo data in this repo is fully fictional.

## Known limits (honest)

- The rules engine is heuristic, not NER: unlabelled names in free prose can
  be missed, and words starting with a surname character can be over-flagged
  (e.g. 周一 "Monday"). The human review step is therefore a designed part
  of the product, not a placeholder — nothing is sent until the worker
  approves the outgoing text, and the safety scan re-checks it.
- On-device inference depends on the visitor's Chrome and hardware; on
  machines below the Prompt API thresholds the double-check reports itself
  unavailable rather than falling back to the cloud with case material.

## License

Apache License 2.0 — see [LICENSE](LICENSE).
