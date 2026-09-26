// Pure, DOM-independent matching helpers shared by content.js and popup.js.
// Kept dependency-free (no `document`/`browser` references) so they can be
// unit tested directly in Node without a browser or a DOM shim.
//
// Loaded as a plain (non-module) script — by content_scripts ordering in
// manifest.json for content.js, and via a <script> tag in popup.html for
// popup.js — so it must stick to global `function` declarations rather than
// import/export.

function normalizeSignal(s) {
  return (s ?? "").toString().toLowerCase().replace(/[-_\s]/g, "");
}

// candidates: raw strings pulled from a DOM element (name/id/placeholder/label/…)
// signals: known phrasings for the field we're looking for
function matchesSignalList(candidates, signals) {
  const normCandidates = (candidates ?? []).filter(Boolean).map(normalizeSignal);
  for (const signal of signals) {
    const normalized = normalizeSignal(signal);
    if (normCandidates.some(c => c === normalized)) return true;
    if (normalized.length >= 8 && normCandidates.some(c => c.includes(normalized))) return true;
  }
  return false;
}

// Classifies a hostname as a supported ATS provider, or null if unsupported.
function detectProviderFromHost(host) {
  const h = (host ?? "").toLowerCase();
  if (h === "ashbyhq.com" || h.endsWith(".ashbyhq.com")) return "ashby";
  if (h === "greenhouse.io" || h.endsWith(".greenhouse.io")) return "greenhouse";
  return null;
}

// Picks the index of the <select> option whose visible text best matches `value`.
// Returns -1 when no option is a confident match — callers should leave the
// field blank rather than guess.
function pickBestSelectOption(optionTexts, value) {
  const target = normalizeSignal(value);
  if (!target) return -1;
  const normalized = (optionTexts ?? []).map(normalizeSignal);

  let idx = normalized.findIndex(t => t === target);
  if (idx !== -1) return idx;

  return normalized.findIndex(t => t.length > 0 && (t.includes(target) || target.includes(t)));
}

// CommonJS export for Node-based unit tests only; no-op in the browser.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { normalizeSignal, matchesSignalList, detectProviderFromHost, pickBestSelectOption };
}
