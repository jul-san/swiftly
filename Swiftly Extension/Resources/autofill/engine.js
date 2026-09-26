// The autofill engine: detect → classify → decide → fill, repeated while
// answering questions reveals new ones. ATS adapters (autofill/adapters/*.js)
// register themselves in SWIFTLY_ADAPTERS and only add platform structure;
// all semantic matching and safety rules live here and in catalog.js.
//
// Safety rules enforced here, for every adapter:
//   • runs only when the user clicks Autofill (content.js message)
//   • never submits, never clicks Next/Submit/Apply
//   • never overwrites a field that already has a value
//   • fills only confident mappings; sensitive answers only from explicit
//     profile values; attestations/consents and unknown questions are left
//   • logs decisions without logging profile values

/* global detectFields, describeField, classifyField, resolveAnswer, SWIFTLY_FIELDS_BY_KEY,
   SWIFTLY_FILL_THRESHOLD, SWIFTLY_SENSITIVE_THRESHOLD, singleChoiceRaceAnswer, formatDatePart,
   chooseOption, fillText, fillNativeSelect, setChecked, fillDropdown, fillButtonGroup, fillFile,
   swiftlySleep, PROVIDER_LABELS, otherCountryInQuestion, detectProviderFromHost, normalizeText */

var SWIFTLY_ADAPTERS = globalThis.SWIFTLY_ADAPTERS || (globalThis.SWIFTLY_ADAPTERS = []);

const SWIFTLY_MAX_PASSES = 5;

function swiftlyLog(...args) {
  try { console.debug("[Swiftly]", ...args); } catch {}
}

function pickAdapter(loc, doc) {
  const provider = detectProviderFromHost(loc.hostname);
  return SWIFTLY_ADAPTERS.find(a => a.id === provider)
    ?? SWIFTLY_ADAPTERS.find(a => a.canHandle?.(loc, doc))
    ?? null;
}

// Resolves once the DOM has been quiet for `quietMs` (or after `maxMs`).
function waitForDomSettle(doc, { quietMs = 350, maxMs = 2500 } = {}) {
  return new Promise(resolve => {
    let timer = null;
    const view = doc.defaultView;
    const finish = () => { observer.disconnect(); clearTimeout(timer); clearTimeout(cap); resolve(); };
    const bump = () => { clearTimeout(timer); timer = setTimeout(finish, quietMs); };
    const observer = new view.MutationObserver(bump);
    observer.observe(doc.body, { childList: true, subtree: true, attributes: true, characterData: true });
    const cap = setTimeout(finish, maxMs);
    bump();
  });
}

// ─── Choosing the answer for a specific control ───────────────────────────

function choiceAnswerFor(answer, field) {
  switch (answer.kind) {
    case "text":
      if (/^personal\.(location|city)$/.test(field.__key)) return { kind: "location", value: answer.value };
      return { kind: "text", value: answer.value };
    case "degree": return answer;
    case "boolean": return answer;
    case "category": return field.kind === "checkboxGroup" ? answer : (answer.multiValue ? singleChoiceRaceAnswer(answer) : answer);
    case "date":
      if (field.datePart === "month") return answer.value.month != null ? { kind: "month", value: answer.value.month } : null;
      if (field.datePart === "year") return answer.value.year != null ? { kind: "text", value: String(answer.value.year) } : null;
      return { kind: "date", value: answer.value };
    default: return null;
  }
}

function textValueFor(answer, field) {
  switch (answer.kind) {
    case "text":
    case "degree": return answer.value;
    case "date": {
      if (field.datePart === "month" || field.datePart === "year") {
        const numeric = field.inputType === "number" || /^\d*$/.test(field.placeholder || "") || field.hintStyle === "number";
        return formatDatePart(answer.value, field.datePart, { style: field.datePart === "month" && numeric ? "number" : undefined });
      }
      const ph = (field.placeholder || "").toLowerCase();
      if (/mm\s*\/\s*yyyy/.test(ph)) return formatDatePart(answer.value, "full", { style: "mm/yyyy" });
      if (/yyyy\s*-\s*mm/.test(ph)) return formatDatePart(answer.value, "full", { style: "yyyy-mm" });
      if (field.inputType === "date" || field.inputType === "month") return null; // needs exact day; leave for the user
      return answer.text;
    }
    default: return null; // yes/no and categories are never typed into free text
  }
}

async function fillField(field, answer, ctx) {
  const adapter = ctx.adapter;
  switch (field.kind) {
    case "text": {
      const value = textValueFor(answer, field);
      if (value == null) return { ok: false, reason: "answer does not fit a text box" };
      if (field.inputType === "number" && !/^-?\d+(\.\d+)?$/.test(value)) return { ok: false, reason: "profile value is not a number" };
      if (field.inputType === "email" && !/@/.test(value)) return { ok: false, reason: "profile email looks invalid" };
      return fillText(field.element, value) ? { ok: true } : { ok: false, reason: "page rejected the value" };
    }
    case "select": {
      const a = choiceAnswerFor(answer, field);
      if (!a) return { ok: false, reason: "no usable answer for a dropdown" };
      const choice = chooseOption(field.options.map(o => o.text), a);
      if (choice.index === -1) return { ok: false, skip: true, reason: choice.reason };
      return fillNativeSelect(field.element, field.options[choice.index].index) ? { ok: true, reason: choice.reason } : { ok: false, reason: "page rejected the option" };
    }
    case "combobox": {
      const a = choiceAnswerFor(answer, field);
      if (!a) return { ok: false, reason: "no usable answer for a dropdown" };
      const query = a.kind === "text" ? a.value : a.kind === "location" ? a.value.split(",")[0] : null;
      const res = await (adapter?.fillDropdown ?? fillDropdown)(field, a, { query });
      return res;
    }
    case "radio":
    case "buttonGroup": {
      const a = choiceAnswerFor(answer, field);
      if (!a) return { ok: false, reason: "no usable answer" };
      const choice = chooseOption(field.options.map(o => o.text), a);
      if (choice.index === -1) return { ok: false, skip: true, reason: choice.reason };
      const ok = field.kind === "radio" ? setChecked(field.options[choice.index].element, true) : fillButtonGroup(field, choice.index);
      return ok ? { ok: true, reason: choice.reason } : { ok: false, reason: "page did not accept the choice" };
    }
    case "checkboxGroup": {
      const texts = field.options.map(o => o.text);
      let targets = [];
      if (answer.kind === "category") {
        for (const cat of answer.values) {
          const matches = texts.map((t, i) => ({ i, cats: answer.canon(t) })).filter(x => x.cats.includes(cat) && x.cats.length === 1);
          if (matches.length === 1) targets.push(matches[0].i);
        }
      } else if (answer.kind === "text" || answer.kind === "degree") {
        const choice = chooseOption(texts, answer.kind === "degree" ? answer : { kind: "text", value: answer.value });
        if (choice.index !== -1) targets.push(choice.index);
      }
      targets = [...new Set(targets)];
      if (!targets.length) return { ok: false, skip: true, reason: "no option confidently matches" };
      let all = true;
      for (const i of targets) all = setChecked(field.options[i].element, true) && all;
      return all ? { ok: true, reason: `${targets.length} option(s)` } : { ok: false, reason: "page did not accept the choice" };
    }
    case "checkbox": {
      if (answer.kind !== "boolean" || answer.value === "decline") return { ok: false, reason: "not a yes/no answer" };
      return setChecked(field.element, answer.value === "yes") ? { ok: true } : { ok: false, reason: "page did not accept the choice" };
    }
    default:
      return { ok: false, reason: `unsupported control (${field.kind})` };
  }
}

// ─── Decision for one field ───────────────────────────────────────────────

function decide(field, profile, ctx) {
  const cls = classifyField(field, field.hintKey);
  const out = { cls, key: cls.key, confidence: cls.confidence };
  if (cls.blocked) return { ...out, action: "skipped", reason: `${cls.blocked} — left for you` };
  if (!cls.key) return { ...out, action: "skipped", reason: "no confident mapping" };
  const def = SWIFTLY_FIELDS_BY_KEY[cls.key];
  const threshold = def?.sensitive ? SWIFTLY_SENSITIVE_THRESHOLD : SWIFTLY_FILL_THRESHOLD;
  if (cls.confidence < threshold) return { ...out, action: "skipped", reason: `confidence below ${threshold}` };
  if (field.kind === "checkbox" && def?.answer !== "boolean") return { ...out, action: "skipped", reason: "checkbox is not a yes/no answer Swiftly stores" };
  if (cls.key.startsWith("eligibility.") && cls.key !== "eligibility.inPersonWork" && cls.key !== "eligibility.willingToRelocate") {
    const other = otherCountryInQuestion(field.label);
    if (other) return { ...out, action: "skipped", reason: `asks about ${other}; your saved answer is for the US` };
  }
  if (field.kind !== "checkbox" && !field.isEmpty) return { ...out, action: "skipped", reason: "already has a value" };
  if (field.kind === "checkbox" && !field.isEmpty) return { ...out, action: "skipped", reason: "already checked" };
  const answer = resolveAnswer(cls.key, profile, field, ctx);
  if (!answer) return { ...out, action: "skipped", reason: def?.sensitive ? "no explicit answer saved in your profile" : "no value in your profile" };
  if (field.kind === "checkbox" && answer.kind === "boolean" && answer.value === "no") return { ...out, action: "skipped", reason: "already matches your profile (unchecked)" };
  return { ...out, action: "fill", answer };
}

// ─── Main entry ───────────────────────────────────────────────────────────

async function runAutofill({ profile, resume = null, doc = document, loc = location, log = swiftlyLog } = {}) {
  const adapter = pickAdapter(loc, doc);
  if (!adapter) return { supported: false, filled: 0, fields: [], needsAttention: [] };
  const report = { supported: true, provider: adapter.id, providerLabel: PROVIDER_LABELS[adapter.id] ?? adapter.id, filled: 0, fields: [], needsAttention: [] };
  log(`ATS detected: ${report.providerLabel}`);

  const blocked = adapter.blockedReason?.(doc);
  if (blocked) {
    log(`Not filling: ${blocked}`);
    return { ...report, blocked };
  }
  const root = adapter.formRoot?.(doc) ?? doc.body;
  if (!root) return { ...report, blocked: "No application form found on this page." };
  if (adapter.stepName) log(`Step: ${adapter.stepName(doc) ?? "unknown"}`);

  const ctx = { adapter, doc, hasResume: !!resume?.base64 };
  const handled = new Set();
  const record = (field, decision, result) => {
    const { label, type } = describeField(field);
    const action = decision.action === "fill" ? (result?.ok ? "filled" : result?.skip ? "skipped" : "failed") : decision.action;
    const reason = result?.reason ?? decision.reason ?? "";
    report.fields.push({ label, type, key: decision.key ?? null, confidence: +(decision.confidence ?? 0).toFixed(2), action, reason, required: !!field.required });
    if (action === "filled") report.filled++;
    log(`${action}: "${label}" [${type}] → ${decision.key ?? "unknown"} (confidence ${(decision.confidence ?? 0).toFixed(2)})${reason ? ` — ${reason}` : ""}`);
  };

  if (adapter.prepare) {
    try { await adapter.prepare({ doc, root, profile, log }); } catch (err) { log("prepare failed", err?.message); }
  }

  // Resume first: some ATSs parse it and pre-populate fields, which Swiftly
  // then leaves alone rather than overwriting.
  if (ctx.hasResume) {
    const fileFields = detectFields(root, adapter).filter(f => f.kind === "file");
    for (const f of fileFields) {
      handled.add(f.element);
      const d = decide(f, profile, ctx);
      if (d.action !== "fill" || d.key !== "documents.resume") { record(f, d); continue; }
      const ok = fillFile(f.element, resume);
      record(f, d, { ok, reason: ok ? "attached your saved resume" : "upload was rejected" });
      if (ok) {
        await waitForDomSettle(doc, adapter.resumeSettle ?? { quietMs: 800, maxMs: 5000 });
        break; // one resume per form
      }
    }
  }

  for (let pass = 0; pass < SWIFTLY_MAX_PASSES; pass++) {
    const fields = detectFields(root, adapter).filter(f => !handled.has(f.element));
    if (!fields.length) break;
    let changed = 0;
    for (const field of fields) {
      handled.add(field.element);
      for (const m of field.members ?? []) handled.add(m);
      if (field.kind === "file" && !ctx.hasResume) { record(field, { action: "skipped", key: classifyField(field, field.hintKey).key, confidence: 0, reason: "no saved resume file" }); continue; }
      const d = decide(field, profile, ctx);
      field.__key = d.key;
      if (d.action !== "fill") { record(field, d); continue; }
      let result;
      try {
        result = await fillField(field, d.answer, ctx);
      } catch (err) {
        result = { ok: false, reason: `error: ${err?.message ?? err}` };
      }
      record(field, d, result);
      if (result.ok) {
        changed++;
        if (field.kind === "combobox" || field.kind === "radio" || field.kind === "buttonGroup") await swiftlySleep(adapter.interactionDelayMs ?? 60);
      }
    }
    if (!changed) break;
    // Answers can reveal follow-up questions; wait for the page to render them.
    await waitForDomSettle(doc, adapter.settle ?? { quietMs: 300, maxMs: 2000 });
  }

  // Required fields still empty need the user's attention.
  const stillEmpty = detectFields(root, adapter).filter(f => f.required && f.isEmpty);
  report.needsAttention = [...new Set(stillEmpty.map(f => describeField(f).label))];
  log(`Done: filled ${report.filled}; ${report.needsAttention.length} required field(s) left for you.`);
  return report;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { runAutofill, decide, pickAdapter };
}
