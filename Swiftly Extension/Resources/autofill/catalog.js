// The semantic field catalog: which canonical profile keys exist, how page
// fields are recognized as one of them (with a confidence score), and how a
// profile value is turned into an answer for a given control.
//
// Pure and DOM-independent (works on the plain `DetectedField` description
// the detector produces), so classification is unit tested in Node.
//
// Plain script (see matching.js); in Node it pulls its helpers via require.

/* global normalizeText, tokenizeIdentifier, answerPolarity, parseLooseDate, cleanLabel */
if (typeof module !== "undefined" && module.exports && typeof normalizeText === "undefined") {
  Object.assign(globalThis, require("./matching.js"));
}

// ─── Thresholds ───────────────────────────────────────────────────────────

const SWIFTLY_FILL_THRESHOLD = 0.8;       // fill at or above this confidence
const SWIFTLY_SENSITIVE_THRESHOLD = 0.85; // EEO / eligibility need more certainty

// Signal weights: how much a match on each source is worth by itself.
const SIGNAL_WEIGHTS = {
  hint: 0.97,         // adapter recognized a known ATS structure (e.g. Greenhouse #first_name)
  autocomplete: 0.95, // standard autocomplete token
  label: 0.9,         // <label>, aria-labelledby, legend, question title
  aria: 0.88,         // aria-label
  identifier: 0.82,   // name / id / data-automation-id tokens
  placeholder: 0.72,
  nearby: 0.55,       // surrounding container text
};

// ─── Field catalog ────────────────────────────────────────────────────────
//
// patterns: regexes tested against normalized label-like text.
// idPatterns: regexes tested against tokenized name/id/automation-id.
// not: label text that rules this key out even when a pattern matches.
// controls: which control families may carry the key.
// answer: "text" | "boolean" | "degree" | "date" | "category" | "file".
// sensitive: EEO / eligibility answers — only ever from explicit profile values.
// blocked: never filled; recognized so the report can say why.

const TEXTUAL = ["text", "textarea", "choice"];

const SWIFTLY_FIELDS = [
  // Identity
  { key: "personal.preferredName", patterns: [/\b(preferred|chosen) (first )?name\b|\bnickname\b|\bname you (go|prefer) by\b|\bgoes by\b/], idPatterns: [/\bpreferred (first )?name\b/], controls: TEXTUAL, answer: "text" },
  { key: "personal.firstName", patterns: [/^(legal |your |candidate |applicant )?first name( legal)?$|^first name \w+$|^legal first name$|^first$/], idPatterns: [/\bfirst ?name\b|\bfname\b/], not: /preferred|chosen|nick|emergency|referr|reference|manager|parent|spouse|contact/, autocomplete: ["given-name"], controls: TEXTUAL, answer: "text" },
  { key: "personal.middleName", patterns: [/^(legal )?middle (name|initial)$/], idPatterns: [/\bmiddle ?name\b/], controls: TEXTUAL, answer: "text" },
  { key: "personal.lastName", patterns: [/^(legal |your )?last name( legal)?$|^legal last name$|^last$/], idPatterns: [/\blast ?name\b|\blname\b/], not: /emergency|referr|reference|manager|parent|spouse|contact|maiden|previous/, autocomplete: ["family-name"], controls: TEXTUAL, answer: "text" },
  { key: "personal.fullName", patterns: [/^(your |full |legal |candidate |applicant |full legal )*name$|^(first and last|full) name$|^name first and last$/], idPatterns: [/^(full ?name|name|candidate name|applicant name|your name)$/], not: /company|school|university|employer|referr|reference|manager|emergency|file|user ?name|business|preferred/, autocomplete: ["name"], controls: TEXTUAL, answer: "text" },
  { key: "personal.email", patterns: [/\bemail( address)?\b/], idPatterns: [/\bemail\b/], not: /referr|reference|manager|recruiter|emergency|school|alternat|secondary|confirm|parent|company|work email|supervisor/, autocomplete: ["email"], inputTypes: ["email"], controls: TEXTUAL, answer: "text" },
  { key: "personal.phone", patterns: [/\b(phone|mobile|cell|telephone)( number)?\b/], idPatterns: [/\b(phone|mobile|telephone)( number)?\b/], not: /type|device|extension|ext\b|country code|referr|reference|emergency|manager|confirm|code$/, autocomplete: ["tel", "tel-national"], inputTypes: ["tel"], controls: TEXTUAL, answer: "text" },
  { key: "personal.pronouns", patterns: [/\bpronouns?\b/], idPatterns: [/\bpronoun/], controls: TEXTUAL, answer: "text" },

  // Location / address
  { key: "personal.location", patterns: [/^(current )?location( city)?$|^location city state$|where are you (currently )?(located|based)|^current (city|location|city and state)$|^city and state$|^(your )?location$/], idPatterns: [/^(candidate )?location$|^current location$/], not: /office|prefer|willing|relocat|desired|intend|work location|job location|remote|hub|which/, controls: TEXTUAL, answer: "text" },
  { key: "personal.addressLine1", patterns: [/^(street |home |mailing |current |residential )?address( line)?( 1)?$|^street( address)?$/], idPatterns: [/\baddress line ?1\b|\bstreet address\b|^address$/], not: /email|ip|web|line 2|2$/, autocomplete: ["address-line1", "street-address"], controls: TEXTUAL, answer: "text" },
  { key: "personal.city", patterns: [/^(current |home )?city( town)?$|^town$|^city town$/], idPatterns: [/\bcity\b/], not: /state|country|born|birth/, autocomplete: ["address-level2"], controls: TEXTUAL, answer: "text" },
  { key: "personal.state", patterns: [/^(state|province|region|state province|state or province|state region|state province region|county)$|\b(which|what) (us )?state do you (currently )?(live|reside) in\b/], idPatterns: [/\b(state|province|country region)\b/], not: /united|country$/, autocomplete: ["address-level1"], controls: TEXTUAL, answer: "text" },
  { key: "personal.postalCode", patterns: [/\bpostal code\b/], idPatterns: [/\bpostal ?code\b|\bzip\b/], autocomplete: ["postal-code"], controls: TEXTUAL, answer: "text" },
  { key: "personal.country", patterns: [/^(current )?country( region)?( of residence)?$|^country where you (live|reside)$|^what country do you (currently )?(live|reside) in$/], idPatterns: [/^country$|\bcountry dropdown\b|^country country$|\baddress country\b/], not: /phone|code|citizen|authori|work|visa/, autocomplete: ["country", "country-name"], controls: TEXTUAL, answer: "text" },

  // Online profiles
  { key: "personal.linkedinURL", patterns: [/\blinkedin\b/], idPatterns: [/\blinked ?in\b/], not: /hear|source|referr|how did|where did/, controls: TEXTUAL, answer: "text" },
  { key: "personal.githubURL", patterns: [/\bgithub\b/], idPatterns: [/\bgithub\b/], not: /hear|source|how did/, controls: TEXTUAL, answer: "text" },
  { key: "personal.website", patterns: [/^(personal |portfolio |your )?(website|portfolio|homepage|personal site|blog)( url| link| website)?$|^(other )?website$|^portfolio( website)?( url| link)?$|^website portfolio$|^portfolio website$/], idPatterns: [/\b(website|portfolio|homepage)\b/], not: /company|linkedin|github|hear/, autocomplete: ["url"], controls: TEXTUAL, answer: "text" },

  // Documents
  { key: "documents.resume", patterns: [/\b(resume|cv|curriculum vitae)\b/], idPatterns: [/\b(resume|cv)\b/], not: /cover|autofill|parse|transcript/, controls: ["file"], answer: "file" },
  { key: "documents.coverLetter", patterns: [/\bcover letter\b/], idPatterns: [/\bcover letter\b/], controls: ["file", "textarea"], answer: "none" },

  // Work eligibility (explicit answers only)
  { key: "eligibility.authorizedWithoutSponsorship", patterns: [/\b(authorized|eligible|legally (able|permitted)) to work\b.*\bwithout\b.*\bsponsor/], controls: ["choice", "checkbox"], answer: "boolean", sensitive: true },
  { key: "eligibility.requiresSponsorship", patterns: [/\bsponsor(ship)?\b|\bvisa (support|sponsorship|transfer)\b|\bimmigration (support|sponsorship)\b|\bh ?1 ?b\b/], idPatterns: [/\bsponsor/], not: /without|explain|details|if yes|if so|type of|which visa|what visa/, controls: ["choice", "checkbox"], answer: "boolean", sensitive: true },
  { key: "eligibility.workAuthorization", patterns: [/\b(legally )?(authorized|eligible|permitted|entitled) to (work|be employed)\b|\blegally able to work\b|\bwork authorization\b|\bright to work\b|\bwork permit\b|\bemployment eligibility\b|\beligible for employment\b|\blegally work\b|\bwork (legally|lawfully)\b|\blegal right to work\b|\bwork authorized\b/], idPatterns: [/\bwork auth|\bauthorized to work\b|\blegally authorized\b/], not: /sponsor|explain|details|if no|if not|which countr|what countr/, controls: ["choice", "checkbox"], answer: "boolean", sensitive: true },
  { key: "eligibility.inPersonWork", patterns: [/\b(work|working|be|come) (from|in|at|into) (the |our |an )?(office|on ?site)\b|\bin ?person\b|\bon ?site\b|\bdays (a|per|each) week (in|at|from)\b|\bhybrid\b.*\b(willing|able|comfortable|open)\b|\b(willing|able|comfortable|open)\b.*\bhybrid\b|\bcommute\b/], not: /remote only|prefer remote|explain|details|which office/, controls: ["choice", "checkbox"], answer: "boolean" },
  { key: "eligibility.willingToRelocate", patterns: [/\brelocat(e|ion|ing)\b/], not: /assistance|package|explain|details|where|which/, controls: ["choice", "checkbox"], answer: "boolean" },

  // Preferences
  { key: "preferences.earliestStartDate", patterns: [/\b(earliest|available|availability|when can you|when could you|when would you be able to) (to )?(start|begin|join)\b|\bearliest (possible )?start( date)?\b|\bavailable start date\b|\bdesired start date\b|\bstart availability\b|\bearliest\b.*\b(start|begin|join)\b/], not: /internship|graduat/, controls: ["text", "textarea"], answer: "text" },
  { key: "preferences.desiredSalary", patterns: [/\b(salary|compensation|pay) (expectation|requirement|range|expectations|requirements)\b|\b(expected|desired|target) (annual )?(salary|compensation|pay|base)\b|\bsalary\b/], not: /current salary|previous salary|history|last salary/, controls: ["text", "textarea"], answer: "text" },
  { key: "preferences.referralSource", patterns: [/\bhow did you (hear|find|learn|come across)\b|\bwhere did you (hear|find|learn|see)\b|\b(referral|application|candidate|lead) source\b|^source$|\bhow did you discover\b/], idPatterns: [/^source$|\bsource source\b|\bhow did you hear\b/], not: /name|who|employee|referred by|specify|other/, controls: ["choice"], answer: "text" },

  // Education (repeatable; index comes from the section)
  { key: "education.institution", section: "education", patterns: [/\b(school|university|college|institution)( name)?\b/], idPatterns: [/\b(school|university|institution|college)( name| item)?\b/], not: /high school|email|location|city|degree|major|graduat|gpa|type/, controls: TEXTUAL, answer: "text" },
  { key: "education.degree", section: "education", patterns: [/\bdegree( type| level| name| obtained)?\b|\blevel of education\b|\bhighest (level of )?education\b|\beducation level\b/], idPatterns: [/\bdegree\b/], not: /graduat|date|major|field|discipline|school|university/, controls: TEXTUAL, answer: "degree" },
  { key: "education.fieldOfStudy", section: "education", patterns: [/\bmajor\b|\bfield of study\b|\bdiscipline\b|\barea of study\b|\bconcentration\b|\bcourse of study\b|\bfield\b/], idPatterns: [/\b(major|field of study|discipline)\b/], not: /minor|date/, controls: TEXTUAL, answer: "text" },
  { key: "education.gpa", section: "education", patterns: [/\bgpa\b|\bgrade point\b|\boverall result\b|\bgrade average\b/], idPatterns: [/\bgpa\b|\bgrade average\b/], controls: TEXTUAL, answer: "text" },
  { key: "education.startDate", section: "education", patterns: [/\b(start|from|begin|first year attended|attended from)\b/], idPatterns: [/\bstart|\bfirst year attended\b|\bfrom\b/], controls: TEXTUAL, answer: "date" },
  { key: "education.endDate", section: "education", patterns: [/\b(end|to|graduation|graduate|completion|last year attended|attended to)\b/], idPatterns: [/\bend|\bgraduation\b|\blast year attended\b|\bto\b/], controls: TEXTUAL, answer: "date" },
  // Top-level education questions (e.g. "What is your expected graduation date?")
  { key: "education.graduation", patterns: [/\b(expected |anticipated )?graduation (date|month|year|month and year|term)\b|\bwhen (do|will) you (expect to )?graduate\b|\bgraduation\b/], not: /high school|degree type|major/, controls: TEXTUAL, answer: "date" },
  { key: "education.currentSchool", patterns: [/^(current |most recent )?(school|university|college|institution)( name)?$|\bwhat (school|university|college) do you (currently )?attend\b|\bcurrent (university|school|college)\b|\b(university|school|college) you (currently )?attend\b/], not: /high school|email|location|degree|major|graduat|gpa/, controls: TEXTUAL, answer: "text" },
  { key: "education.currentDegree", patterns: [/^(current |highest )?degree( type| level| obtained| earned)?$|\bhighest degree\b|\bdegree (are you )?(currently )?pursuing\b|\bhighest (level of )?education\b|\blevel of education\b/], not: /graduat|date|major|field|discipline/, controls: TEXTUAL, answer: "degree" },
  { key: "education.currentMajor", patterns: [/^(current |undergrad(uate)? )?(major|field of study|discipline)s?$|\bwhat is your major\b|^(undergrad(uate)? )?discipline\b/], not: /minor/, controls: TEXTUAL, answer: "text" },
  { key: "education.currentGpa", patterns: [/^(current |cumulative |undergrad(uate)? )?gpa\b|\bwhat is your gpa\b/], not: /scale|out of|major gpa/, controls: ["text"], answer: "text" },

  // Experience (repeatable)
  { key: "experience.title", section: "experience", patterns: [/\b(job |position |role )?title\b|^position$|^role$/], idPatterns: [/\b(job )?title\b|\bposition\b/], controls: TEXTUAL, answer: "text" },
  { key: "experience.company", section: "experience", patterns: [/\b(company|employer|organization)( name)?\b/], idPatterns: [/\b(company|employer|organization)( name)?\b/], not: /website|url|industry|size/, controls: TEXTUAL, answer: "text" },
  { key: "experience.location", section: "experience", patterns: [/\blocation\b|\bcity\b/], idPatterns: [/\blocation\b/], controls: TEXTUAL, answer: "text" },
  { key: "experience.current", section: "experience", patterns: [/\b(currently|still) work(ing)? here\b|\bcurrent (role|job|position|employer)\b|\bi currently work\b|\bpresent\b/], idPatterns: [/\bcurrently work here\b|\bcurrent role\b/], controls: ["checkbox"], answer: "boolean" },
  { key: "experience.startDate", section: "experience", patterns: [/\b(start|from|begin)\b/], idPatterns: [/\bstart|\bfrom\b/], controls: TEXTUAL, answer: "date" },
  { key: "experience.endDate", section: "experience", patterns: [/\b(end|to|until)\b/], idPatterns: [/\bend|\bto\b/], controls: TEXTUAL, answer: "date" },
  { key: "experience.description", section: "experience", patterns: [/\b(role )?description\b|\bresponsibilit|\bsummary\b|\bduties\b|\baccomplishments\b/], idPatterns: [/\bdescription\b/], controls: ["textarea", "text"], answer: "text" },
  // Top-level "current employer / title" questions
  { key: "experience.currentCompany", patterns: [/^(current |most recent |present )(company|employer)( name)?$|^(company|employer)$/], not: /website|previous|former/, controls: ["text", "choice"], answer: "text" },
  { key: "experience.currentTitle", patterns: [/^(current |most recent |present )(job )?(title|position|role)$/], controls: ["text", "choice"], answer: "text" },

  // Voluntary self-identification: explicit profile answers only.
  { key: "eeo.gender", patterns: [/\bgender\b|^sex$/], idPatterns: [/\bgender\b/], not: /pronoun|transgender|sexual orientation|self describe|please specify/, controls: ["choice", "checkboxGroup"], answer: "category", sensitive: true },
  { key: "eeo.hispanic", patterns: [/\b(are you )?hispanic( or | )?latin(o|a|x|e)?\b\??$|^hispanic ethnicity$|^ethnicity hispanic/], idPatterns: [/\bhispanic ethnicity\b/], controls: ["choice"], answer: "boolean", sensitive: true },
  { key: "eeo.race", patterns: [/\brace\b|\bethnicit|\bracial\b/], idPatterns: [/\brace\b|\bethnicity\b/], not: /self describe|please specify|hispanic ethnicity$/, controls: ["choice", "checkboxGroup"], answer: "category", sensitive: true },
  { key: "eeo.veteran", patterns: [/\bprotected veteran\b|^veteran status$|\bveteranstatus\b|\bveteran status\b/], idPatterns: [/\bveteran status\b|\beeoc veteran/], not: /active member|armed forces|military spouse|family/, controls: ["choice"], answer: "boolean", sensitive: true },
  { key: "eeo.disability", patterns: [/\bdisability( status)?\b|\bdisabilitystatus\b/], idPatterns: [/\bdisability status\b|\beeoc disability/], not: /chronic|accommodat|adjustment|assist/, controls: ["choice"], answer: "boolean", sensitive: true },

  // Never filled by Swiftly. Recognized so the report can say why.
  { key: "blocked.attestation", blocked: "legal attestation or consent", patterns: [/\bi (hereby )?(agree|acknowledge|certify|consent|confirm|attest|understand|accept|authorize)\b|\b(terms|privacy (policy|notice)|consent|acknowledg|certif|attest|signature|e ?sign|declaration|gdpr|data (processing|retention))\b/] },
  { key: "blocked.screening", blocked: "employer-specific screening question", patterns: [/\b(previously|ever|formerly|currently) (been )?(worked|employed|work)\b|\bformer employee\b|\bworked (for|at) \w+( \w+)? before\b|\bnon ?compete\b|\bnon ?solicit|\brestrictive covenant\b|\bsecurity clearance\b|\bclearance\b|\bgovernment (official|employee|entity)\b|\bpublic official\b|\bpolitically exposed\b|\brelative|\bfamily member\b|\brelated to\b|\bpersonal relationship|\boutside business\b|\bconflict of interest\b|\breferred by\b|\bwho referred\b|\breferr(er|al) name\b|\bemployee referral\b|\bat least 18\b|\b18 years\b|\bover 18\b|\bbackground check\b|\bdrug (test|screen)\b/] },
  { key: "blocked.demographic", blocked: "sensitive demographic question", patterns: [/\bsexual orientation\b|\btransgender\b|\blgbt|\bage\b|\bdate of birth\b|\bbirth ?date\b|\breligio|\bmarital\b|\bsocial security\b|\bssn\b|\bnational (id|insurance)\b|\bcitizenship\b|\bnationality\b|\bcriminal|\bconvicted\b|\bfelony\b|\bveteran or active member\b|\barmed forces\b|\bmilitary\b|\bchronic condition\b|\bneurodivergen/] },
];

const SWIFTLY_FIELDS_BY_KEY = Object.fromEntries(SWIFTLY_FIELDS.map(f => [f.key, f]));

// ─── Classification ───────────────────────────────────────────────────────

function controlFamily(field) {
  switch (field.kind) {
    case "text": return field.multiline ? "textarea" : "text";
    case "select":
    case "combobox":
    case "radio":
    case "buttonGroup": return "choice";
    case "checkboxGroup": return "checkboxGroup";
    case "checkbox": return "checkbox";
    case "file": return "file";
    default: return field.kind;
  }
}

function controlAllows(def, field) {
  const family = controlFamily(field);
  if (!def.controls) return true;
  if (def.controls.includes(family)) return true;
  // Multi-select checkbox groups can answer "choice" questions in category form.
  // Multi-select checkbox groups answer "choice" questions ("mark all that apply").
  if (family === "checkboxGroup" && def.controls.includes("choice")) return true;
  return false;
}

function sourceTexts(field) {
  const primary = cleanLabel(field.label || "");
  return [
    { src: "label", text: primary },
    { src: "aria", text: primary === cleanLabel(field.ariaLabel || "") ? "" : cleanLabel(field.ariaLabel || "") },
    { src: "placeholder", text: cleanLabel(field.placeholder || "") },
    { src: "nearby", text: primary ? "" : cleanLabel(field.nearbyText || "") },
  ].filter(s => s.text);
}

function identifierTexts(field) {
  return [field.name, field.idAttr, field.automationId].filter(Boolean).map(tokenizeIdentifier).filter(Boolean);
}

// Scores one catalog entry against a field. Returns { score, evidence[] }.
function scoreDefinition(def, field, hintKey) {
  const evidence = [];
  let best = 0;
  let agreeing = 0;

  if (hintKey && hintKey === def.key) {
    best = SIGNAL_WEIGHTS.hint;
    evidence.push("ATS structure");
    agreeing++;
  }

  const ac = (field.autocomplete || "").toLowerCase().split(/\s+/).filter(t => t && !/^(section-|shipping|billing|home|work|mobile)/.test(t));
  if (def.autocomplete && ac.some(t => def.autocomplete.includes(t))) {
    best = Math.max(best, SIGNAL_WEIGHTS.autocomplete);
    evidence.push("autocomplete");
    agreeing++;
  }

  const labelIsLong = normalizeText(field.label).length > 140;
  for (const { src, text } of sourceTexts(field)) {
    const t = normalizeText(text);
    if (!t) continue;
    if (def.not && def.not.test(t)) {
      if (src === "label" || src === "aria") return { score: 0, evidence: [`label rules out ${def.key}`] };
      continue;
    }
    if (def.patterns?.some(p => p.test(t))) {
      let w = SIGNAL_WEIGHTS[src];
      if (src === "label" && labelIsLong) w -= 0.03;
      best = Math.max(best, w);
      evidence.push(src);
      agreeing++;
    }
  }

  if (def.idPatterns) {
    for (const t of identifierTexts(field)) {
      if (def.not && def.not.test(t)) continue;
      if (def.idPatterns.some(p => p.test(t))) {
        best = Math.max(best, SIGNAL_WEIGHTS.identifier);
        evidence.push("name/id");
        agreeing++;
        break;
      }
    }
  }

  if (best > 0 && def.inputTypes) {
    if (def.inputTypes.includes(field.inputType)) { best += 0.03; evidence.push("input type"); }
  } else if (best > 0 && field.inputType === "email" && def.key !== "personal.email" && controlFamily(field) === "text") {
    best -= 0.3; // an email-typed box is almost never something else
  }

  if (agreeing >= 2) best += 0.03;
  return { score: Math.min(best, 0.99), evidence };
}

// Classifies a detected field. Returns
//   { key, confidence, evidence, blocked?, alternatives }
// key is null when nothing matched.
function classifyField(field, hintKey = null) {
  const section = field.section?.kind ?? null;
  const results = [];

  for (const def of SWIFTLY_FIELDS) {
    if (def.blocked) continue;
    if (def.section && def.section !== section) continue;
    // Inside a repeatable education/experience block only that block's keys apply.
    if (!def.section && section && (def.key.startsWith("education.") || def.key.startsWith("experience."))) continue;
    if (section && !def.section && !def.key.startsWith("documents.")) {
      // e.g. a "Location" inside an experience block is experience.location, not personal.location
      continue;
    }
    if (!controlAllows(def, field)) continue;
    const { score, evidence } = scoreDefinition(def, field, hintKey);
    if (score > 0) results.push({ key: def.key, score, evidence });
  }
  results.sort((a, b) => b.score - a.score);

  // Blocked patterns are checked against the question text only; they win
  // over any fillable key unless the ATS structure itself identified the field.
  const labelText = normalizeText(cleanLabel(field.label || field.ariaLabel || ""));
  if (labelText && !(hintKey && results[0]?.key === hintKey)) {
    for (const def of SWIFTLY_FIELDS) {
      if (!def.blocked) continue;
      if (def.patterns.some(p => p.test(labelText))) {
        return { key: def.key, confidence: 0.95, evidence: ["label"], blocked: def.blocked, alternatives: results.slice(0, 2) };
      }
    }
  }

  if (!results.length) return { key: null, confidence: 0, evidence: [], alternatives: [] };

  const [top, second] = results;
  let confidence = top.score;
  const evidence = [...top.evidence];
  // A close competitor means the question could mean either thing.
  if (second && second.score >= 0.6 && second.score >= top.score - 0.08 && !(hintKey && hintKey === top.key)) {
    confidence = Math.min(confidence, top.score - 0.3);
    evidence.push(`ambiguous with ${second.key}`);
  }
  return { key: top.key, confidence: Math.max(0, confidence), evidence, alternatives: results.slice(1, 3) };
}

// Work-eligibility answers in the profile are about the United States.
// Returns the other country a question asks about, or null.
const US_WORDS = /\b(united states|usa|us|u s|america)\b/;
const OTHER_COUNTRIES = /\b(united kingdom|uk|u k|britain|england|scotland|ireland|canada|australia|new zealand|germany|france|spain|italy|netherlands|switzerland|sweden|norway|denmark|finland|poland|portugal|austria|belgium|israel|india|singapore|japan|china|hong kong|korea|brazil|mexico|argentina|uae|dubai|european union|eu|eea)\b/;
function otherCountryInQuestion(label) {
  const t = normalizeText(label);
  const m = t.match(OTHER_COUNTRIES);
  if (!m) return null;
  if (US_WORDS.test(t.replace(m[0], " "))) return null; // mentions the US too; be conservative below
  return m[0];
}

// ─── Profile values ───────────────────────────────────────────────────────

function nonEmpty(v) {
  const s = (v ?? "").toString().trim();
  return s ? s : null;
}

function splitName(fullName) {
  const parts = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { first: parts[0] ?? null, last: null };
  return { first: parts[0], last: parts[parts.length - 1] };
}

// "San Francisco, CA" → { city, state }. Only the unambiguous
// "<city>, <2-letter state>" / "<city>, <state name>" shape is split.
function splitLocation(location) {
  const parts = (location ?? "").split(",").map(s => s.trim()).filter(Boolean);
  if (parts.length < 2 || parts.length > 3) return {};
  const [city, state] = parts;
  const st = normalizeText(state);
  const isState = /^[a-z]{2}$/.test(st) || Object.values(typeof US_STATES !== "undefined" ? US_STATES : {}).includes(st);
  return isState ? { city, state } : {};
}

function polarityOf(stored) {
  return answerPolarity(stored);
}

function dateAnswer(text) {
  const d = parseLooseDate(text);
  if (!d || d.present) return null;
  return d;
}

// Canonical race/ethnicity categories for matching stored values against
// option text. Multiple categories per text are allowed (e.g. "Two or more").
function raceCategories(text) {
  const t = normalizeText(text).replace(/\bnot hispanic( or latin(o|a|x|e))?\b/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return [];
  if (DECLINE_RACE.test(t)) return ["decline"];
  if (/\btwo or more\b|\bmultiracial\b|\bmixed\b/.test(t)) return ["multiple"];
  const cats = [];
  if (/\bhispanic\b|\blatin(o|a|x|e)\b|\bspanish origin\b/.test(t)) cats.push("hispanic");
  if (/\bwhite\b|\beuropean\b|\bcaucasian\b/.test(t)) cats.push("white");
  if (/\bblack\b|\bafrican\b/.test(t)) cats.push("black");
  if (/\bhawaiian\b|\bpacific islander\b/.test(t)) cats.push("pacific");
  if (/\beast asian\b/.test(t)) cats.push("asian:east");
  else if (/\bsouth asian\b/.test(t)) cats.push("asian:south");
  else if (/\bsoutheast asian\b/.test(t)) cats.push("asian:southeast");
  else if (/\basian\b/.test(t)) cats.push("asian");
  if (/\bamerican indian\b|\balaska(n)? native\b|\bindigenous\b|\bnative american\b|\bfirst nations\b/.test(t)) cats.push("native");
  if (/\bmiddle eastern\b|\bnorth african\b|\bmena\b/.test(t)) cats.push("mena");
  if (!cats.length && /^other\b/.test(t)) cats.push("other");
  return cats;
}
const DECLINE_RACE = /\b(decline|prefer not|do not wish|dont wish|do not want|dont want|not to (answer|say|disclose|self identify))\b/;

function genderCategories(text) {
  const t = normalizeText(text);
  if (!t) return [];
  if (DECLINE_RACE.test(t)) return ["decline"];
  if (/\bnon ?binary\b|\bgender ?(queer|fluid|nonconforming)\b/.test(t)) return ["nonbinary"];
  if (/^(wo)?man$|^(fe)?male$|^(a )?(wo)?man\b|^(fe)?male\b|^(cis(gender)? )?(wo)?man\b/.test(t)) {
    return [/\bwoman\b|\bfemale\b/.test(t) ? "woman" : "man"];
  }
  if (/\bself describe\b|\banother\b|\bnot listed\b/.test(t)) return ["other"];
  return [];
}

// Resolves the answer the profile gives for `key`, shaped for the control.
// Returns null when the profile has no appropriate value (never fabricates).
//   { kind: "text", value } | { kind: "boolean", value } | { kind: "degree", value }
//   { kind: "date", value: {month, year}, text } | { kind: "category", values, canon }
//   { kind: "file" }
function resolveAnswer(key, profile, field = {}, context = {}) {
  const p = profile?.personal ?? {};
  const idx = field.section?.index ?? 0;
  const edu = (profile?.education ?? [])[idx];
  const exp = (profile?.experience ?? [])[idx];
  const text = (v) => (nonEmpty(v) ? { kind: "text", value: nonEmpty(v) } : null);
  const bool = (v) => {
    const pol = polarityOf(v);
    return pol ? { kind: "boolean", value: pol } : null;
  };
  const date = (v) => {
    const d = dateAnswer(v);
    return d ? { kind: "date", value: d, text: nonEmpty(v) } : null;
  };
  const currentEdu = () => {
    const list = profile?.education ?? [];
    return list.find(e => e.currentOrPlanned) ?? list[0] ?? null;
  };
  const currentExp = () => {
    const list = profile?.experience ?? [];
    return list.find(e => e.current) ?? null;
  };

  switch (key) {
    case "personal.firstName": return text(p.firstName || splitName(p.fullName).first);
    case "personal.lastName": return text(p.lastName || splitName(p.fullName).last);
    case "personal.middleName": return text(p.middleName);
    case "personal.fullName": return text(p.fullName || [p.firstName, p.lastName].filter(Boolean).join(" "));
    case "personal.preferredName": return text(p.preferredName);
    case "personal.email": return text(p.email);
    case "personal.phone": return text(p.phone);
    case "personal.pronouns": return text(p.pronouns);
    case "personal.location": return text(p.location || [p.city, p.state].filter(Boolean).join(", "));
    case "personal.addressLine1": return text(p.addressLine1);
    case "personal.city": return text(p.city || splitLocation(p.location).city);
    case "personal.state": return text(p.state || splitLocation(p.location).state);
    case "personal.postalCode": return text(p.postalCode);
    case "personal.country": return text(p.country);
    case "personal.linkedinURL": return text(p.linkedinURL);
    case "personal.githubURL": return text(p.githubURL);
    case "personal.website": return text(p.website);

    case "documents.resume": return context.hasResume ? { kind: "file" } : null;

    case "eligibility.workAuthorization": return bool(p.workAuthorization);
    case "eligibility.requiresSponsorship": return bool(p.requiresSponsorship);
    case "eligibility.authorizedWithoutSponsorship": {
      const auth = polarityOf(p.workAuthorization);
      const sponsor = polarityOf(p.requiresSponsorship);
      if (auth === "yes" && sponsor === "no") return { kind: "boolean", value: "yes" };
      if (auth === "no" || sponsor === "yes") return { kind: "boolean", value: "no" };
      return null;
    }
    case "eligibility.inPersonWork": return bool(p.inPersonWork);
    case "eligibility.willingToRelocate": return bool(p.willingToRelocate);

    case "preferences.earliestStartDate": return text(p.earliestStartDate);
    case "preferences.desiredSalary": return text(p.desiredSalary);
    case "preferences.referralSource": return text(p.referralSource);

    case "education.institution": return edu ? text(edu.institution) : null;
    case "education.degree": return edu && nonEmpty(edu.degree) ? { kind: "degree", value: edu.degree } : null;
    case "education.fieldOfStudy": return edu ? text(edu.fieldOfStudy) : null;
    case "education.gpa": return edu ? text(edu.gpa) : null;
    case "education.startDate": return edu ? date(edu.startDate) : null;
    case "education.endDate": return edu ? date(edu.graduationDate || edu.endDate) : null;
    case "education.graduation": { const e = currentEdu(); return e ? date(e.graduationDate || e.endDate) : null; }
    case "education.currentSchool": { const e = currentEdu(); return e ? text(e.institution) : null; }
    case "education.currentDegree": { const e = currentEdu(); return e && nonEmpty(e.degree) ? { kind: "degree", value: e.degree } : null; }
    case "education.currentMajor": { const e = currentEdu(); return e ? text(e.fieldOfStudy) : null; }
    case "education.currentGpa": { const e = currentEdu(); return e ? text(e.gpa) : null; }

    case "experience.title": return exp ? text(exp.title) : null;
    case "experience.company": return exp ? text(exp.company) : null;
    case "experience.location": return exp ? text(exp.location) : null;
    case "experience.current": return exp ? { kind: "boolean", value: exp.current ? "yes" : "no" } : null;
    case "experience.startDate": return exp ? date(exp.startDate) : null;
    case "experience.endDate": return exp && !exp.current ? date(exp.endDate) : null;
    case "experience.description": {
      const bullets = (exp?.bullets ?? []).map(b => (b ?? "").trim()).filter(Boolean);
      return bullets.length ? { kind: "text", value: bullets.map(b => `• ${b}`).join("\n") } : null;
    }
    case "experience.currentCompany": { const e = currentExp(); return e ? text(e.company) : null; }
    case "experience.currentTitle": { const e = currentExp(); return e ? text(e.title) : null; }

    case "eeo.gender": {
      const cats = genderCategories(p.genderIdentity);
      return cats.length ? { kind: "category", values: cats, canon: genderCategories } : null;
    }
    case "eeo.race": {
      const stored = (p.raceEthnicity ?? "").split(",").map(s => s.trim()).filter(Boolean);
      const cats = [...new Set(stored.flatMap(raceCategories))];
      if (!cats.length) return null;
      return { kind: "category", values: cats, canon: raceCategories, multiValue: true };
    }
    case "eeo.hispanic": {
      const stored = (p.raceEthnicity ?? "").split(",").map(s => s.trim()).filter(Boolean);
      const cats = stored.flatMap(raceCategories);
      if (cats.includes("hispanic")) return { kind: "boolean", value: "yes" };
      if (cats.includes("decline")) return { kind: "boolean", value: "decline" };
      return null; // not listing Hispanic is not the same as answering "No"
    }
    case "eeo.veteran": return bool(p.veteranStatus);
    case "eeo.disability": return bool(p.disabilityStatus);
    default: return null;
  }
}

// For single-choice race questions: several stored categories collapse to a
// "Two or more races" option when the form offers one.
function singleChoiceRaceAnswer(answer) {
  const real = answer.values.filter(c => c !== "decline");
  if (real.length >= 2) return { kind: "category", values: ["multiple"], canon: raceCategories };
  return answer;
}

// Formats a date answer for a text field / date part.
function formatDatePart(d, part, { style } = {}) {
  if (!d) return null;
  if (part === "year") return d.year != null ? String(d.year) : null;
  if (part === "month") {
    if (d.month == null) return null;
    if (style === "number") return String(d.month + 1);
    if (style === "number2") return String(d.month + 1).padStart(2, "0");
    return (typeof MONTHS !== "undefined" ? MONTHS : [])[d.month]?.replace(/^./, c => c.toUpperCase()) ?? null;
  }
  // Whole-date text input: honor an MM/YYYY-style placeholder when present.
  if (style === "mm/yyyy") return d.month != null && d.year != null ? `${String(d.month + 1).padStart(2, "0")}/${d.year}` : null;
  if (style === "yyyy-mm") return d.month != null && d.year != null ? `${d.year}-${String(d.month + 1).padStart(2, "0")}` : null;
  return null;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    SWIFTLY_FIELDS, SWIFTLY_FIELDS_BY_KEY, SWIFTLY_FILL_THRESHOLD, SWIFTLY_SENSITIVE_THRESHOLD,
    classifyField, resolveAnswer, raceCategories, genderCategories, singleChoiceRaceAnswer,
    formatDatePart, splitLocation, controlFamily, otherCountryInQuestion,
  };
}
