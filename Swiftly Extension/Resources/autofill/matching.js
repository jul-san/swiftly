// Pure, DOM-independent text helpers shared by the autofill engine and popup.js.
// Kept dependency-free (no `document`/`browser` references) so they can be
// unit tested directly in Node without a browser or a DOM shim.
//
// Loaded as a plain (non-module) script — by content_scripts ordering in
// manifest.json for the content scripts, and via a <script> tag in popup.html
// for popup.js — so it sticks to global `function` declarations rather than
// import/export.

// ─── Normalization ────────────────────────────────────────────────────────

// Whole-word abbreviations and spelling variants that should compare equal.
const TEXT_EQUIVALENTS = [
  [/\be[\s-]?mail\b/g, "email"],
  [/\bph\b|\bph no\b|\bphone no\b/g, "phone"],
  [/\btel\b/g, "telephone"],
  [/\bzip ?code\b|\bzip\b|\bpost ?code\b/g, "postal code"],
  [/\baddr\b/g, "address"],
  [/\buniv\b/g, "university"],
  [/\byrs\b/g, "years"],
  [/\bdob\b/g, "date of birth"],
  [/\blinked in\b/g, "linkedin"],
  [/\bgit hub\b/g, "github"],
  [/\bweb site\b/g, "website"],
  [/\bsurname\b/g, "last name"],
  [/\bforename\b/g, "first name"],
  [/\bgiven name\b/g, "first name"],
  [/\bfamily name\b/g, "last name"],
  [/\bauthorised\b/g, "authorized"],
  [/\bauthorisation\b/g, "authorization"],
  [/\borganisation\b/g, "organization"],
];

// Lowercases, strips diacritics and punctuation, collapses whitespace, and
// folds common equivalents ("E-mail" → "email", "Given Name" → "first name").
function normalizeText(s) {
  let t = (s ?? "").toString();
  t = t.normalize ? t.normalize("NFKD").replace(/[̀-ͯ]/g, "") : t;
  t = t.toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[’'`]/g, "")
    .replace(/[^a-z0-9+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  for (const [pattern, replacement] of TEXT_EQUIVALENTS) t = t.replace(pattern, replacement);
  return t.replace(/\s+/g, " ").trim();
}

// Removes the decorations ATS forms put around a question's text.
function cleanLabel(s) {
  return (s ?? "").toString()
    .replace(/\s+/g, " ")
    .replace(/\(\s*(required|optional)\s*\)/gi, " ")
    .replace(/\(s\)/gi, "s")
    .replace(/[*✱]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Splits identifiers such as "job_application[first_name]",
// "legalNameSection_firstName" or "name--legalName--firstName" into words.
function tokenizeIdentifier(s) {
  return (s ?? "").toString()
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .replace(/\b[0-9a-f]{8,}\b/gi, " ") // generated ids/UUID chunks carry no meaning
    .replace(/\b\d+\b/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// ─── ATS detection ────────────────────────────────────────────────────────

function hostIs(h, domain) {
  return h === domain || h.endsWith("." + domain);
}

// Classifies a hostname as a supported ATS provider, or null if unsupported.
function detectProviderFromHost(host) {
  const h = (host ?? "").toLowerCase();
  if (hostIs(h, "ashbyhq.com")) return "ashby";
  if (hostIs(h, "greenhouse.io")) return "greenhouse";
  if (hostIs(h, "gem.com")) return "gem";
  if (hostIs(h, "myworkdayjobs.com") || hostIs(h, "myworkdaysite.com")) return "workday";
  return null;
}

const PROVIDER_LABELS = { ashby: "Ashby", greenhouse: "Greenhouse", gem: "Gem", workday: "Workday" };

// ─── Option polarity (yes / no / decline) ────────────────────────────────

const DECLINE_PATTERN = /\b(decline|prefer not|do not wish|dont wish|do not want|dont want|not wish to|rather not|choose not|wish not|not to (answer|say|disclose|self identify)|no answer|undisclosed)\b/;
const NEGATIVE_PATTERN = /^(no|none|nope)\b|\b(not|dont|do not|does not|doesnt|will not|wont|cannot|cant|am not|is not|isnt|never|no longer|without)\b|\bno (sponsorship|visa|need)\b|\bnot (required|needed)\b/;
const POSITIVE_START = /^(yes|yeah|y|true|i am|im|i will|i do|i have|i can|i identify|i would|authorized|eligible|required|i require|i need|citizen|permanent resident)\b/;

// Classifies an answer option (or a stored answer) as "yes", "no", "decline"
// or null when its meaning is not a plain yes/no.
function answerPolarity(text) {
  const t = normalizeText(text);
  if (!t) return null;
  if (DECLINE_PATTERN.test(t)) return "decline";
  if (NEGATIVE_PATTERN.test(t)) return "no";
  if (POSITIVE_START.test(t) || /\b(required|needed|necessary)$/.test(t)) return "yes";
  return null;
}

// ─── Synonyms used when comparing option text ────────────────────────────

const US_STATES = {
  al: "alabama", ak: "alaska", az: "arizona", ar: "arkansas", ca: "california", co: "colorado",
  ct: "connecticut", de: "delaware", fl: "florida", ga: "georgia", hi: "hawaii", id: "idaho",
  il: "illinois", in: "indiana", ia: "iowa", ks: "kansas", ky: "kentucky", la: "louisiana",
  me: "maine", md: "maryland", ma: "massachusetts", mi: "michigan", mn: "minnesota",
  ms: "mississippi", mo: "missouri", mt: "montana", ne: "nebraska", nv: "nevada",
  nh: "new hampshire", nj: "new jersey", nm: "new mexico", ny: "new york", nc: "north carolina",
  nd: "north dakota", oh: "ohio", ok: "oklahoma", or: "oregon", pa: "pennsylvania",
  ri: "rhode island", sc: "south carolina", sd: "south dakota", tn: "tennessee", tx: "texas",
  ut: "utah", vt: "vermont", va: "virginia", wa: "washington", wv: "west virginia",
  wi: "wisconsin", wy: "wyoming", dc: "district of columbia",
};

const COUNTRY_ALIASES = [
  ["united states", "united states of america", "usa", "us", "u s", "u s a", "america"],
  ["united kingdom", "uk", "u k", "great britain", "britain", "england"],
  ["canada", "ca"],
  ["germany", "deutschland"],
  ["netherlands", "the netherlands", "holland"],
  ["india", "in"],
];

// Returns the normalized synonyms a value should also match.
function valueAliases(value) {
  const t = normalizeText(value);
  const out = new Set([t]);
  if (US_STATES[t]) out.add(US_STATES[t]);
  for (const [abbr, name] of Object.entries(US_STATES)) if (name === t) out.add(abbr);
  for (const group of COUNTRY_ALIASES) if (group.includes(t)) group.forEach(g => out.add(g));
  return [...out].filter(Boolean);
}

function words(t) {
  return t.split(" ").filter(Boolean);
}

// Scores how well an option's text matches a desired text value (0…1).
function textMatchScore(optionText, value) {
  // Phone-country pickers append dialing codes: "United States +1".
  const opt = normalizeText((optionText ?? "").toString().replace(/\(?\+\s?\d[\d\s-]*\)?/g, " "));
  if (!opt) return 0;
  let best = 0;
  for (const alias of valueAliases(value)) {
    if (!alias) continue;
    if (opt === alias) return 1;
    // Option text like "United States +1" or "California (CA)".
    const optWords = words(opt);
    const aliasWords = words(alias);
    const startsWithWords = aliasWords.every((w, i) => optWords[i] === w);
    if (startsWithWords && aliasWords.length >= 1 && alias.length >= 2) {
      best = Math.max(best, optWords.length === aliasWords.length ? 1 : 0.9);
      continue;
    }
    // Stored value is longer than the option: "Computer Science and Engineering"
    // vs option "Computer Science" is weaker evidence.
    if (optWords.length >= 1 && optWords.every((w, i) => aliasWords[i] === w) && opt.length >= 4) {
      best = Math.max(best, 0.75);
      continue;
    }
    // Token overlap for reordered/partially matching text.
    const a = new Set(aliasWords.filter(w => w.length > 1));
    const o = new Set(optWords.filter(w => w.length > 1));
    if (a.size && o.size) {
      let inter = 0;
      for (const w of a) if (o.has(w)) inter++;
      const jaccard = inter / (a.size + o.size - inter);
      if (jaccard >= 0.6) best = Math.max(best, 0.6 + 0.3 * jaccard);
    }
  }
  return best;
}

// ─── Degree levels ────────────────────────────────────────────────────────

const DEGREE_LEVELS = [
  ["phd", /\b(ph ?d|doctor(ate)?( of)?|d phil|dphil)\b/],
  ["mba", /\b(mba|master of business administration)\b/],
  ["master", /\b(master|masters|m s|ms|msc|m sc|m a|ma|m eng|meng|m phil|mphil|mfa|mpp|mph|ms e)\b/],
  ["bachelor", /\b(bachelor|bachelors|b s|bs|bsc|b sc|b a|ba|b eng|beng|b e|be|bba|bfa|b tech|btech|s b|a b|undergraduate)\b/],
  ["associate", /\b(associate|associates|a a|a s|aas)\b/],
  ["jd", /\b(j d|jd|juris doctor)\b/],
  ["md", /\b(m d|md|doctor of medicine)\b/],
  ["highschool", /\b(high school|secondary|ged|diploma)\b/],
];

function degreeLevel(text) {
  const t = normalizeText(text).replace(/\./g, " ");
  for (const [level, pattern] of DEGREE_LEVELS) if (pattern.test(t)) return level;
  return null;
}

function degreeFlavor(text) {
  const t = normalizeText(text);
  if (/\b(science|sciences|s|bs|bsc|ms|msc|sb)\b/.test(t)) return "science";
  if (/\b(arts|ba|ma|ab|fine arts)\b/.test(t)) return "arts";
  if (/\b(engineering|beng|meng|be|b tech|btech)\b/.test(t)) return "engineering";
  return null;
}

// ─── Dates ────────────────────────────────────────────────────────────────

const MONTHS = ["january", "february", "march", "april", "may", "june", "july",
  "august", "september", "october", "november", "december"];

function monthIndex(word) {
  const w = normalizeText(word);
  if (!w) return null;
  if (w === "sept") return 8;
  const i = MONTHS.findIndex(m => m === w || (w.length >= 3 && m.startsWith(w)));
  return i === -1 ? null : i;
}

// Parses resume-style dates ("May 2027", "Aug. 2026", "05/2027", "2027",
// "Present") into { month (0-11 or null), year, present }. Returns null when
// nothing reliable can be extracted.
function parseLooseDate(text) {
  const raw = (text ?? "").toString().trim();
  if (!raw) return null;
  const t = normalizeText(raw);
  if (/^(present|current|now|today|ongoing)$/.test(t)) return { month: null, year: null, present: true };
  let m = raw.match(/^(\d{1,2})\s*[/.-]\s*(\d{4})$/);
  if (m) {
    const month = parseInt(m[1], 10) - 1;
    if (month >= 0 && month < 12) return { month, year: parseInt(m[2], 10), present: false };
  }
  m = raw.match(/^(\d{4})\s*[/.-]\s*(\d{1,2})(?:\s*[/.-]\s*\d{1,2})?$/);
  if (m) {
    const month = parseInt(m[2], 10) - 1;
    if (month >= 0 && month < 12) return { month, year: parseInt(m[1], 10), present: false };
  }
  m = t.match(/^([a-z]+) (\d{4})$/);
  if (m && monthIndex(m[1]) !== null) return { month: monthIndex(m[1]), year: parseInt(m[2], 10), present: false };
  m = t.match(/^(spring|summer|fall|autumn|winter) (\d{4})$/);
  if (m) {
    const season = { spring: 4, summer: 7, fall: 11, autumn: 11, winter: 11 }[m[1]];
    return { month: season, year: parseInt(m[2], 10), present: false, approximate: true };
  }
  m = t.match(/^(\d{4})$/);
  if (m) return { month: null, year: parseInt(m[1], 10), present: false };
  return null;
}

// Parses option text describing a period, e.g. "May - Aug 2027",
// "Sept 2027 - Dec 2027", "Jan 2028 or later", "After Jan 2029",
// "Already graduated". Returns { start, end } as month serials (year*12+month)
// with null for open ends, or { past: true } for "already graduated" options.
function parseDateRangeOption(text) {
  const t = normalizeText(text);
  if (/\b(already|previously) (graduated|completed)|\bgraduated\b/.test(t)) return { past: true };
  const tokens = [...t.matchAll(/\b([a-z]{3,9})\b(?: (\d{4}))?|\b(\d{4})\b/g)];
  const points = [];
  for (const tok of tokens) {
    if (tok[3]) { points.push({ month: null, year: parseInt(tok[3], 10) }); continue; }
    const mi = monthIndex(tok[1]);
    if (mi !== null) points.push({ month: mi, year: tok[2] ? parseInt(tok[2], 10) : null });
  }
  if (!points.length) return null;
  // Fill missing years from the next point that has one ("May - Aug 2027").
  for (let i = points.length - 1; i >= 0; i--) {
    if (points[i].year === null) points[i].year = points[i + 1]?.year ?? null;
  }
  if (points.some(p => p.year === null)) return null;
  const serial = (p, end) => p.year * 12 + (p.month ?? (end ? 11 : 0));
  const first = points[0];
  const last = points[points.length - 1];
  if (/\b(or later|and later|onward|onwards|after|later than|or after)\b/.test(t)) {
    const after = /\bafter\b/.test(t) && !/or later/.test(t);
    return { start: serial(first, false) + (after ? 1 : 0), end: null };
  }
  if (/\b(before|or earlier|prior to)\b/.test(t)) return { start: null, end: serial(first, true) };
  return { start: serial(first, false), end: serial(last, true) };
}

// ─── Option choice ────────────────────────────────────────────────────────
//
// `answer` describes what the profile says:
//   { kind: "text", value }                – match option text to a value
//   { kind: "boolean", value: "yes"|"no"|"decline" }
//   { kind: "degree", value }              – degree level matching
//   { kind: "date", value: {month, year} } – exact month/year or a range option
//   { kind: "category", values: [...], canon } – canonical categories (EEO)
//
// Returns { index, confidence, reason }; index is -1 when no option is a
// confident, unambiguous match — callers must then leave the field alone.

const PLACEHOLDER_OPTION = /^(select|choose|please (select|choose)|pick|select one|select an option|none selected|)$/;

function chooseOption(optionTexts, answer, { now = new Date() } = {}) {
  const opts = (optionTexts ?? []).map(t => (t ?? "").toString());
  const usable = opts.map((t, i) => ({ i, t, n: normalizeText(t) }))
    .filter(o => !PLACEHOLDER_OPTION.test(o.n.replace(/\.+$/, "")));
  const none = (reason) => ({ index: -1, confidence: 0, reason });
  if (!answer || !usable.length) return none("no options");

  const pickUnique = (scored, minScore, label) => {
    const ranked = scored.filter(s => s.score >= minScore).sort((a, b) => b.score - a.score);
    if (!ranked.length) return none(`no option matches ${label}`);
    if (ranked.length > 1 && ranked[1].score >= ranked[0].score - 0.05) {
      return none(`ambiguous: ${ranked.length} options match ${label}`);
    }
    return { index: ranked[0].i, confidence: ranked[0].score, reason: `option matches ${label}` };
  };

  switch (answer.kind) {
    case "boolean": {
      const want = answer.value;
      const matches = usable.filter(o => answerPolarity(o.t) === want);
      if (matches.length === 1) {
        const plain = /^(yes|no)$/.test(matches[0].n);
        return { index: matches[0].i, confidence: plain ? 0.98 : 0.92, reason: `only "${want}" option` };
      }
      if (matches.length > 1) return none(`ambiguous: ${matches.length} "${want}" options`);
      return none(`no "${want}" option`);
    }
    case "degree": {
      const level = degreeLevel(answer.value);
      if (!level) return pickUnique(usable.map(o => ({ i: o.i, score: textMatchScore(o.t, answer.value) })), 0.85, "degree");
      const same = usable.filter(o => degreeLevel(o.t) === level);
      if (same.length === 1) return { index: same[0].i, confidence: 0.92, reason: `degree level ${level}` };
      if (same.length > 1) {
        const exact = same.map(o => ({ i: o.i, score: textMatchScore(o.t, answer.value) }))
          .filter(s => s.score >= 0.85);
        if (exact.length === 1) return { index: exact[0].i, confidence: exact[0].score, reason: "degree text" };
        const flavor = degreeFlavor(answer.value);
        const flavored = flavor ? same.filter(o => degreeFlavor(o.t) === flavor) : [];
        if (flavored.length === 1) return { index: flavored[0].i, confidence: 0.88, reason: `degree ${level} (${flavor})` };
        return none(`ambiguous: ${same.length} ${level} options`);
      }
      return none(`no ${level} option`);
    }
    case "date": {
      const d = answer.value;
      if (!d || d.year == null) return none("no date");
      const target = d.year * 12 + (d.month ?? 5);
      const nowSerial = now.getFullYear() * 12 + now.getMonth();
      const hits = [];
      for (const o of usable) {
        const r = parseDateRangeOption(o.t);
        if (!r) continue;
        if (r.past) { if (target < nowSerial) hits.push(o); continue; }
        if (d.month == null && r.start != null && r.end != null && (r.end - r.start) < 12) continue; // year-only can't pick a sub-year range
        const afterStart = r.start == null || target >= r.start;
        const beforeEnd = r.end == null || target <= r.end;
        if (afterStart && beforeEnd) hits.push(o);
      }
      if (hits.length === 1) return { index: hits[0].i, confidence: 0.9, reason: "date falls in option range" };
      if (hits.length > 1) return none("ambiguous: date matches several options");
      return none("no option covers the date");
    }
    case "month": {
      const m = answer.value;
      const hits = usable.filter(o => {
        const n = o.n.replace(/^0+(?=\d)/, "");
        return monthIndex(o.n.split(" ")[0]) === m || n === String(m + 1);
      });
      if (hits.length === 1) return { index: hits[0].i, confidence: 0.97, reason: "month" };
      return none(hits.length ? "ambiguous month options" : "no month option");
    }
    case "location": {
      const parts = (answer.value ?? "").split(",").map(normalizeText).filter(Boolean);
      if (!parts.length) return none("no location");
      const [city, state] = parts;
      const stateAliases = state ? valueAliases(state) : [];
      const scored = usable.map(o => {
        const oParts = o.t.split(",").map(normalizeText).filter(Boolean);
        if (!oParts.length || oParts[0] !== city) return { i: o.i, score: 0 };
        if (!state) return { i: o.i, score: 0.86 };
        const stateHit = oParts.slice(1).some(p => stateAliases.includes(p) || stateAliases.some(a => words(p).join(" ") === a));
        if (stateHit) return { i: o.i, score: 0.95 };
        return { i: o.i, score: oParts.length === 1 ? 0.86 : 0 };
      });
      return pickUnique(scored, 0.85, "location");
    }
    case "category": {
      const wanted = new Set(answer.values);
      const scored = usable.map(o => ({ o, cats: answer.canon(o.t) }));
      const hits = scored.filter(s => s.cats.length && s.cats.every(c => wanted.has(c)) && s.cats.length === wanted.size);
      if (hits.length === 1) return { index: hits[0].o.i, confidence: 0.9, reason: "category match" };
      if (hits.length > 1) return none("ambiguous category options");
      return none("no matching category option");
    }
    case "text":
    default: {
      const scored = usable.map(o => ({ i: o.i, score: textMatchScore(o.t, answer.value) }));
      return pickUnique(scored, 0.85, "value");
    }
  }
}

// CommonJS export for Node-based unit tests only; no-op in the browser.
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    normalizeText, cleanLabel, tokenizeIdentifier, detectProviderFromHost, PROVIDER_LABELS, answerPolarity, valueAliases, textMatchScore,
    degreeLevel, monthIndex, MONTHS, parseLooseDate, parseDateRangeOption, chooseOption,
    US_STATES,
  };
}
