// Unit tests for the semantic field catalog (autofill/catalog.js): how page
// fields are recognized, how confident Swiftly is, and what it refuses to
// answer. Labels are real wording collected from public Greenhouse, Ashby
// and Workday applications. Pure Node; no DOM.
//
// Run with: node --test tests/catalog.test.js

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  classifyField, resolveAnswer, SWIFTLY_FILL_THRESHOLD, SWIFTLY_SENSITIVE_THRESHOLD, SWIFTLY_FIELDS_BY_KEY,
  otherCountryInQuestion,
} = require("../Swiftly Extension/Resources/autofill/catalog.js");

const field = (label, extra = {}) => ({ kind: "text", label, inputType: "text", ...extra });
const choice = (label, extra = {}) => field(label, { kind: "combobox", widget: "reactSelect", ...extra });

function fillable(cls) {
  if (!cls.key || cls.blocked) return false;
  const def = SWIFTLY_FIELDS_BY_KEY[cls.key];
  return cls.confidence >= (def.sensitive ? SWIFTLY_SENSITIVE_THRESHOLD : SWIFTLY_FILL_THRESHOLD);
}

function expectKey(f, key) {
  const cls = classifyField(f, f.hintKey ?? null);
  assert.equal(cls.key, key, `"${f.label}" → ${cls.key} (${cls.confidence})`);
  assert.ok(fillable(cls), `"${f.label}" should be confident enough to fill (got ${cls.confidence})`);
}

function expectNotFilled(f, { blocked } = {}) {
  const cls = classifyField(f, f.hintKey ?? null);
  if (blocked) assert.equal(cls.key, blocked, `"${f.label}" → ${cls.key}`);
  assert.ok(!fillable(cls), `"${f.label}" must not be auto-filled (got ${cls.key} @ ${cls.confidence})`);
}

// ─── Equivalent wording maps to one key ──────────────────────────────────

test("first-name variants", () => {
  for (const l of ["First Name", "First name", "Given Name", "Given name", "Legal First Name", "First Name (Legal)", "FIRST NAME *"]) {
    expectKey(field(l), "personal.firstName");
  }
});

test("preferred name is not the legal first name", () => {
  expectKey(field("Preferred First Name"), "personal.preferredName");
  expectKey(field("Preferred Name"), "personal.preferredName");
});

test("last, full name, email and phone variants", () => {
  for (const l of ["Last Name", "Surname", "Family name", "Legal Last Name"]) expectKey(field(l), "personal.lastName");
  for (const l of ["Name", "Full Name", "Full legal name", "Your name"]) expectKey(field(l), "personal.fullName");
  for (const l of ["Email", "E-mail Address", "Email address"]) expectKey(field(l), "personal.email");
  for (const l of ["Phone", "Phone Number", "Mobile phone", "Cell"]) expectKey(field(l, { inputType: "tel" }), "personal.phone");
});

test("identifiers and autocomplete work without a label", () => {
  expectKey(field("", { name: "job_application[first_name]" }), "personal.firstName");
  expectKey(field("", { autocomplete: "family-name" }), "personal.lastName");
  expectKey(field("", { automationId: "legalNameSection_firstName" }), "personal.firstName");
});

test("online profile questions", () => {
  expectKey(field("LinkedIn Profile"), "personal.linkedinURL");
  expectKey(field("LinkedIn URL"), "personal.linkedinURL");
  expectKey(field("GitHub"), "personal.githubURL");
  expectKey(field("Website"), "personal.website");
  expectKey(field("Portfolio URL"), "personal.website");
  expectKey(field("Personal website"), "personal.website");
});

test("location and address pieces", () => {
  expectKey(field("Location (City)"), "personal.location");
  expectKey(field("Where are you currently located?"), "personal.location");
  expectKey(field("City"), "personal.city");
  expectKey(field("ZIP Code"), "personal.postalCode");
  expectKey(field("State / Province"), "personal.state");
  expectKey(choice("Country"), "personal.country");
});

test("work eligibility questions (real Greenhouse/Ashby/Workday wording)", () => {
  for (const l of [
    "Are you legally authorized to work in the country where the job is located?",
    "Are you legally work authorized to work in the US?",
    "Are you authorized to work in the country for which you applied?",
    "Are you legally eligible to work in the United States?",
    "Are you legally authorized to work in the country in which you are applying?",
  ]) expectKey(choice(l), "eligibility.workAuthorization");
  for (const l of [
    "Will you now or in the future require company sponsorship to retain or extend your work authorization in the country where the job is located?",
    "Will you now (or in the future) require visa sponsorship in order to work in the US?",
    "Will you now, or in the future, require sponsorship for employment visa status (e.g. H-1B)?",
  ]) expectKey(choice(l), "eligibility.requiresSponsorship");
  expectKey(choice("Are you willing to work four days per week in our San Francisco office?"), "eligibility.inPersonWork");
  expectKey(choice("Are you open to relocation?"), "eligibility.willingToRelocate");
});

test("combined authorization-without-sponsorship question derives from both answers", () => {
  expectKey(choice("Are you authorized to work in the US without the need for sponsorship?"), "eligibility.authorizedWithoutSponsorship");
  const p = { personal: { workAuthorization: "Yes", requiresSponsorship: "No" } };
  assert.deepEqual(resolveAnswer("eligibility.authorizedWithoutSponsorship", p), { kind: "boolean", value: "yes" });
  const q = { personal: { workAuthorization: "Yes", requiresSponsorship: "Yes" } };
  assert.deepEqual(resolveAnswer("eligibility.authorizedWithoutSponsorship", q), { kind: "boolean", value: "no" });
  assert.equal(resolveAnswer("eligibility.authorizedWithoutSponsorship", { personal: {} }), null);
});

test("eligibility questions about another country are recognized", () => {
  assert.equal(otherCountryInQuestion("Do you have the right to work in the United Kingdom?"), "united kingdom");
  assert.equal(otherCountryInQuestion("Are you authorized to work in the US?"), null);
  assert.equal(otherCountryInQuestion("Are you authorized to work in the country where the job is located?"), null);
});

test("education and experience fields inside repeatable sections", () => {
  const edu = { section: { kind: "education", index: 0 } };
  expectKey(choice("School", edu), "education.institution");
  expectKey(choice("Degree", edu), "education.degree");
  expectKey(choice("Discipline", edu), "education.fieldOfStudy");
  expectKey(field("Overall Result (GPA)", edu), "education.gpa");
  const exp = { section: { kind: "experience", index: 1 } };
  expectKey(field("Job Title", exp), "experience.title");
  expectKey(field("Company", exp), "experience.company");
  expectKey(field("Location", exp), "experience.location");
  expectKey(field("Role Description", { ...exp, kind: "text", multiline: true }), "experience.description");
});

test("a location inside an experience block is never the applicant's home location", () => {
  const cls = classifyField(field("Location", { section: { kind: "experience", index: 0 } }));
  assert.equal(cls.key, "experience.location");
});

test("top-level education questions", () => {
  expectKey(choice("What is your expected graduation month & year?"), "education.graduation");
  expectKey(choice("Please re-confirm the university you currently attend"), "education.currentSchool");
  expectKey(field("Undergrad Discipline(s)", { kind: "checkboxGroup" }), "education.currentMajor");
  expectKey(choice("Highest degree obtained"), "education.currentDegree");
});

test("screening questions Swiftly can answer from saved preferences", () => {
  expectKey(choice("How did you hear about us?"), "preferences.referralSource");
  expectKey(choice("How did you hear about DV Trading?"), "preferences.referralSource");
  expectKey(field("What is your earliest available start date?"), "preferences.earliestStartDate");
  expectKey(field("What are your salary expectations?"), "preferences.desiredSalary");
});

test("voluntary self-identification is recognized but marked sensitive", () => {
  for (const [l, key] of [["Gender", "eeo.gender"], ["Race", "eeo.race"], ["Are you Hispanic/Latino?", "eeo.hispanic"], ["Veteran Status", "eeo.veteran"], ["Disability Status", "eeo.disability"]]) {
    const cls = classifyField(choice(l));
    assert.equal(cls.key, key);
    assert.ok(SWIFTLY_FIELDS_BY_KEY[key].sensitive);
  }
});

// ─── Questions Swiftly must leave alone ──────────────────────────────────

test("legal attestations and consents are blocked", () => {
  for (const l of ["Terms & Conditions", "I acknowledge that the information I provided is accurate.", "I agree to the processing of my data per the privacy policy", "Electronic signature", "GDPR consent"]) {
    expectNotFilled(field(l, { kind: "checkbox" }), { blocked: "blocked.attestation" });
  }
});

test("employer-specific screening questions are blocked", () => {
  for (const l of [
    "Have you ever worked for Figma before, as an employee or a contractor/consultant?",
    "Have you ever worked for Robinhood as an employee, intern or contractor?",
    "Have you previously worked for this company?",
    "Are you currently bound by a non-compete agreement?",
    "Do you currently hold an active security clearance?",
    "Are you or a family member a government official?",
    "Do you have personal relationships, outside business activities, investments, or IP ownership?",
    "Who referred you?",
    "Are you at least 18 years of age?",
  ]) expectNotFilled(choice(l));
});

test("sensitive demographic questions without a profile field are blocked", () => {
  for (const l of [
    "How would you describe your sexual orientation? (mark all that apply)",
    "Do you identify as transgender? (select one)",
    "Are you a veteran or active member of the United States Armed Forces? (select one)",
    "Date of birth",
    "What is your citizenship?",
  ]) expectNotFilled(choice(l));
});

test("open-ended and unknown questions are not mapped", () => {
  for (const l of ["Why do you want to join Figma?", "Tell us something interesting about yourself", "Additional Information", "Years of professional experience", "If other, please specify"]) {
    const cls = classifyField(field(l));
    assert.ok(!fillable(cls), `"${l}" → ${cls.key} @ ${cls.confidence}`);
  }
});

test("look-alike labels do not borrow identity values", () => {
  expectNotFilled(field("Company name"));
  expectNotFilled(field("Referrer's email"));
  expectNotFilled(field("Emergency contact phone"));
  expectNotFilled(field("Which office location do you prefer?"));
  expectNotFilled(field("From where do you intend to work?"));
  expectNotFilled(field("Referred by (name)"));
});

test("follow-up detail boxes for eligibility are not answered", () => {
  expectNotFilled(field("If yes, please provide your visa type and expiration date."));
});

// ─── Profile values (never fabricated) ──────────────────────────────────

test("missing profile values resolve to null instead of guesses", () => {
  const p = { personal: { fullName: "Avery Example" }, education: [], experience: [] };
  assert.equal(resolveAnswer("personal.email", p), null);
  assert.equal(resolveAnswer("personal.preferredName", p), null);
  assert.equal(resolveAnswer("eligibility.workAuthorization", p), null);
  assert.equal(resolveAnswer("eeo.gender", p), null);
  assert.equal(resolveAnswer("education.institution", p, { section: { kind: "education", index: 0 } }), null);
  assert.deepEqual(resolveAnswer("personal.firstName", p), { kind: "text", value: "Avery" });
});

test("city and state are split only from an unambiguous location", () => {
  assert.equal(resolveAnswer("personal.city", { personal: { location: "Austin, TX" } }).value, "Austin");
  assert.equal(resolveAnswer("personal.state", { personal: { location: "Austin, TX" } }).value, "TX");
  assert.equal(resolveAnswer("personal.city", { personal: { location: "Remote" } }), null);
  assert.equal(resolveAnswer("personal.state", { personal: { location: "London, United Kingdom" } }), null);
});

test("race answers keep every stored category; Hispanic is only answered when stated", () => {
  const p = { personal: { raceEthnicity: "Asian or Asian American, White" } };
  assert.deepEqual(resolveAnswer("eeo.race", p).values, ["asian", "white"]);
  assert.equal(resolveAnswer("eeo.hispanic", p), null);
  assert.deepEqual(resolveAnswer("eeo.hispanic", { personal: { raceEthnicity: "Hispanic or Latine" } }), { kind: "boolean", value: "yes" });
});

test("current employment has no end date", () => {
  const p = { experience: [{ company: "X", title: "Y", startDate: "Jan 2025", endDate: "Present", current: true, bullets: [] }] };
  assert.equal(resolveAnswer("experience.endDate", p, { section: { kind: "experience", index: 0 } }), null);
  assert.deepEqual(resolveAnswer("experience.current", p, { section: { kind: "experience", index: 0 } }), { kind: "boolean", value: "yes" });
});
