// Unit tests for the pure, DOM-independent matching helpers in
// "Swiftly Extension/Resources/autofill/matching.js". These are plain
// string-logic functions (no DOM/browser API), so they run directly under
// Node with no build step and no external dependencies.
//
// Run with: node --test tests/matching.test.js

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  matchesSignalList,
  detectProviderFromHost,
  pickBestSelectOption,
} = require("../Swiftly Extension/Resources/autofill/matching.js");

// ─── detectProviderFromHost ──────────────────────────────────────────────

test("detects Ashby hosts", () => {
  assert.equal(detectProviderFromHost("jobs.ashbyhq.com"), "ashby");
  assert.equal(detectProviderFromHost("ashbyhq.com"), "ashby");
  assert.equal(detectProviderFromHost("acme.ashbyhq.com"), "ashby");
});

test("detects Greenhouse hosts", () => {
  assert.equal(detectProviderFromHost("boards.greenhouse.io"), "greenhouse");
  assert.equal(detectProviderFromHost("job-boards.greenhouse.io"), "greenhouse");
  assert.equal(detectProviderFromHost("greenhouse.io"), "greenhouse");
  assert.equal(detectProviderFromHost("acme.greenhouse.io"), "greenhouse");
});

test("unsupported hosts remain unsupported", () => {
  assert.equal(detectProviderFromHost("linkedin.com"), null);
  assert.equal(detectProviderFromHost("jobs.lever.co"), null);
  assert.equal(detectProviderFromHost("example.com"), null);
  assert.equal(detectProviderFromHost(""), null);
  assert.equal(detectProviderFromHost(undefined), null);
});

test("does not false-positive on lookalike hosts (no false-positive matching)", () => {
  // A host that merely *contains* the vendor name should not match — only an
  // exact domain or a genuine subdomain should.
  assert.equal(detectProviderFromHost("notashbyhq.com"), null);
  assert.equal(detectProviderFromHost("evil-greenhouse.io.attacker.com"), null);
});

// ─── matchesSignalList ───────────────────────────────────────────────────

test("matches on exact normalized equality", () => {
  assert.equal(matchesSignalList(["First Name"], ["first name"]), true);
  assert.equal(matchesSignalList(["first_name"], ["firstname"]), true);
});

test("matches short signals only via exact equality, not substring", () => {
  // "cv" (2 chars) must not match a candidate that merely contains it.
  assert.equal(matchesSignalList(["active"], ["cv"]), false);
  assert.equal(matchesSignalList(["cv"], ["cv"]), true);
});

test("matches long signals via substring once past the length threshold", () => {
  assert.equal(matchesSignalList(["yourlinkedinprofileurl"], ["linkedin profile"]), true);
});

test("unrelated candidates are ignored", () => {
  assert.equal(matchesSignalList(["favorite color"], ["email", "phone", "first name"]), false);
});

test("handles empty/undefined candidates gracefully", () => {
  assert.equal(matchesSignalList([null, undefined, ""], ["email"]), false);
});

// ─── pickBestSelectOption ─────────────────────────────────────────────────

test("picks an exact option match", () => {
  const options = ["", "Bachelor's Degree", "Master's Degree", "PhD"];
  assert.equal(pickBestSelectOption(options, "Master's Degree"), 2);
});

test("picks a substring option match in either direction", () => {
  const options = ["", "United States", "Canada"];
  assert.equal(pickBestSelectOption(options, "United States of America"), 1);
});

test("returns -1 (leave blank) when nothing confidently matches", () => {
  const options = ["", "Bachelor's Degree", "Master's Degree", "PhD"];
  assert.equal(pickBestSelectOption(options, "Bachelor of Science"), -1);
});

test("returns -1 for an empty target value", () => {
  assert.equal(pickBestSelectOption(["", "Yes", "No"], ""), -1);
  assert.equal(pickBestSelectOption(["", "Yes", "No"], null), -1);
});

// ─── Normalization ───────────────────────────────────────────────────────

const {
  normalizeText, cleanLabel, tokenizeIdentifier, answerPolarity, chooseOption,
  parseLooseDate, parseDateRangeOption, degreeLevel,
} = require("../Swiftly Extension/Resources/autofill/matching.js");

test("normalizeText folds case, punctuation and equivalent wording", () => {
  assert.equal(normalizeText("E-mail Address"), "email address");
  assert.equal(normalizeText("Given Name"), "first name");
  assert.equal(normalizeText("Surname"), "last name");
  assert.equal(normalizeText("ZIP code"), "postal code");
  assert.equal(normalizeText("  Linked In  URL "), "linkedin url");
  assert.equal(normalizeText("Authorised to work?"), "authorized to work");
});

test("cleanLabel strips required markers", () => {
  assert.equal(cleanLabel("First Name*"), "First Name");
  assert.equal(cleanLabel("Email (required)"), "Email");
  assert.equal(cleanLabel("Undergrad Discipline(s) *"), "Undergrad Disciplines");
});

test("tokenizeIdentifier splits ATS ids into words and drops generated numbers", () => {
  assert.equal(tokenizeIdentifier("job_application[first_name]"), "job application first name");
  assert.equal(tokenizeIdentifier("legalNameSection_firstName"), "legal name section first name");
  assert.equal(tokenizeIdentifier("name--legalName--firstName"), "name legal name first name");
  assert.equal(tokenizeIdentifier("question_12678497007"), "question");
});

test("detects Gem and Workday hosts", () => {
  assert.equal(detectProviderFromHost("jobs.gem.com"), "gem");
  assert.equal(detectProviderFromHost("acme.wd5.myworkdayjobs.com"), "workday");
  assert.equal(detectProviderFromHost("wd3.myworkdaysite.com"), "workday");
  assert.equal(detectProviderFromHost("gem.com.evil.io"), null);
});

// ─── Yes / no polarity (real Greenhouse option wording) ──────────────────

test("answerPolarity reads verbose yes/no/decline options", () => {
  assert.equal(answerPolarity("Yes, I am currently legally authorized to work in the country where the jobs is located."), "yes");
  assert.equal(answerPolarity("No, I do not and will not require immigration sponsorship"), "no");
  assert.equal(answerPolarity("No sponsorship needed"), "no");
  assert.equal(answerPolarity("Sponsorship required"), "yes");
  assert.equal(answerPolarity("Not authorized"), "no");
  assert.equal(answerPolarity("I am not a protected veteran"), "no");
  assert.equal(answerPolarity("I identify as one or more of the classifications of a protected veteran"), "yes");
  assert.equal(answerPolarity("I don't wish to answer"), "decline");
  assert.equal(answerPolarity("Decline To Self Identify"), "decline");
  assert.equal(answerPolarity("Open to discussion"), null);
});

test("sponsorship: a stored No picks the only No option", () => {
  const options = [
    "Yes, I will require immigration sponsorship now to legally work in the country where the job is located.",
    "Yes, I will require immigration sponsorship in the future to legally work in the country where the job is located.",
    "No, I do not and will not require immigration sponsorship to legally work in the country where the job is located.",
  ];
  assert.equal(chooseOption(options, { kind: "boolean", value: "no" }).index, 2);
});

test("sponsorship: a stored Yes is ambiguous between now and future, so nothing is picked", () => {
  const options = ["Yes, I will require sponsorship now", "Yes, I will require sponsorship in the future", "No, I will not require sponsorship"];
  const r = chooseOption(options, { kind: "boolean", value: "yes" });
  assert.equal(r.index, -1);
  assert.match(r.reason, /ambiguous/);
});

test("authorization options with qualifiers stay ambiguous for Yes but resolve No", () => {
  const options = ["Authorized for any employer", "Not authorized", "Authorized for current employer only"];
  assert.equal(chooseOption(options, { kind: "boolean", value: "yes" }).index, -1);
  assert.equal(chooseOption(options, { kind: "boolean", value: "no" }).index, 1);
});

test("placeholder options are never chosen", () => {
  assert.equal(chooseOption(["Select...", "Yes", "No"], { kind: "boolean", value: "yes" }).index, 1);
  assert.equal(chooseOption(["Please select", "Other"], { kind: "text", value: "please select" }).index, -1);
});

// ─── Text, location, degree, month, date-range options ───────────────────

test("country pickers ignore dialing codes and avoid lookalike countries", () => {
  const opts = ["Canada +1", "United States +1", "United States Minor Outlying Islands +1"];
  assert.equal(chooseOption(opts, { kind: "text", value: "United States" }).index, 1);
  assert.equal(chooseOption(opts, { kind: "text", value: "USA" }).index, 1);
});

test("state abbreviations match full state names", () => {
  assert.equal(chooseOption(["Alabama", "California", "Colorado"], { kind: "text", value: "CA" }).index, 1);
});

test("location answers need the city and a matching state", () => {
  const opts = ["San Francisco, California, United States", "San Francisco, Cordoba, Argentina", "South San Francisco, California, United States"];
  assert.equal(chooseOption(opts, { kind: "location", value: "San Francisco, CA" }).index, 0);
  assert.equal(chooseOption(opts, { kind: "location", value: "Oakland, CA" }).index, -1);
});

test("degree levels map resume wording to form options", () => {
  const opts = ["High School", "Associate's Degree", "Bachelor's Degree", "Master's Degree", "Master of Business Administration (M.B.A.)", "Doctor of Philosophy (Ph.D.)"];
  assert.equal(chooseOption(opts, { kind: "degree", value: "B.S. in Computer Science" }).index, 2);
  assert.equal(chooseOption(opts, { kind: "degree", value: "Master of Science" }).index, 3);
  assert.equal(chooseOption(opts, { kind: "degree", value: "PhD" }).index, 5);
  assert.equal(degreeLevel("BA, Economics"), "bachelor");
});

test("degree flavour breaks ties between bachelor options", () => {
  const opts = ["Bachelor of Arts", "Bachelor of Science", "Master of Science"];
  assert.equal(chooseOption(opts, { kind: "degree", value: "B.S." }).index, 1);
  assert.equal(chooseOption(opts, { kind: "degree", value: "Bachelor's" }).index, -1);
});

test("month options match names, abbreviations and numbers", () => {
  assert.equal(chooseOption(["January", "February", "March"], { kind: "month", value: 1 }).index, 1);
  assert.equal(chooseOption(["Jan", "Feb", "Mar"], { kind: "month", value: 2 }).index, 2);
  assert.equal(chooseOption(["01", "02", "03"], { kind: "month", value: 0 }).index, 0);
});

test("graduation date lands in the right range option (real Greenhouse wording)", () => {
  const opts = ["Already graduated", "Sept - Dec 2026", "Jan - April 2027", "May - Aug 2027", "Sept 2027 - Dec 2027", "Jan 2028 or later"];
  const now = new Date(2026, 8, 26);
  assert.equal(chooseOption(opts, { kind: "date", value: { month: 4, year: 2027 } }, { now }).index, 3);
  assert.equal(chooseOption(opts, { kind: "date", value: { month: 1, year: 2029 } }, { now }).index, 5);
  assert.equal(chooseOption(opts, { kind: "date", value: { month: 4, year: 2024 } }, { now }).index, 0);
  // Year-only dates can't choose between sub-year ranges.
  assert.equal(chooseOption(opts, { kind: "date", value: { month: null, year: 2027 } }, { now }).index, -1);
});

test("parseDateRangeOption understands open-ended ranges", () => {
  assert.deepEqual(parseDateRangeOption("After Jan 2029"), { start: 2029 * 12 + 1, end: null });
  assert.deepEqual(parseDateRangeOption("Aug 2026-Dec 2026"), { start: 2026 * 12 + 7, end: 2026 * 12 + 11 });
  assert.deepEqual(parseDateRangeOption("Already graduated"), { past: true });
});

test("parseLooseDate keeps partial resume dates", () => {
  assert.deepEqual(parseLooseDate("May 2027"), { month: 4, year: 2027, present: false });
  assert.deepEqual(parseLooseDate("Aug. 2026"), { month: 7, year: 2026, present: false });
  assert.deepEqual(parseLooseDate("05/2027"), { month: 4, year: 2027, present: false });
  assert.deepEqual(parseLooseDate("2025"), { month: null, year: 2025, present: false });
  assert.equal(parseLooseDate("Present").present, true);
  assert.equal(parseLooseDate("sometime soon"), null);
});
