// End-to-end autofill tests in headless Chromium.
//
// Each fixture is served under its real ATS hostname (intercepted, offline)
// and the extension's content scripts are injected in manifest order, then
// driven through content.js exactly as the popup does. The Greenhouse
// fixture runs real React 18 + React Select 5, so controlled inputs and
// comboboxes behave like job-boards.greenhouse.io.
//
// Run with: npm test   (or node --test tests/autofill.dom.test.js)

const test = require("node:test");
const assert = require("node:assert/strict");
const { openFixture, sendMessage, closeBrowser, testProfile, RESUME } = require("./helpers/harness");

test.after(closeBrowser);

const byLabel = (report, re) => report.fields.find(f => re.test(f.label));

// Profile values must never appear in Swiftly's console logs.
function assertLogsArePrivate(logs, profile) {
  const secrets = [profile.personal.email, profile.personal.phone, profile.personal.linkedinURL, profile.personal.lastName, profile.education?.[0]?.institution]
    .filter(Boolean);
  for (const line of logs.filter(l => l.startsWith("[Swiftly]"))) {
    for (const s of secrets) assert.ok(!line.includes(s), `log leaks a profile value: ${line}`);
  }
}

// ─── Greenhouse (job-boards, React) ───────────────────────────────────────

test("Greenhouse: fills identity, React Select dropdowns, education, custom questions", async () => {
  const profile = testProfile();
  const { page, logs } = await openFixture({ url: "https://job-boards.greenhouse.io/example/jobs/1", fixture: "greenhouse-app.html", app: "greenhouse-app" });
  const report = await sendMessage(page, { action: "autofill", profile, resume: RESUME });
  const s = await page.evaluate(() => window.__ghState());

  assert.equal(report.provider, "greenhouse");
  // Controlled React inputs: state only changes if Swiftly's events reached React.
  assert.equal(s.first_name, "Avery");
  assert.equal(s.last_name, "Example");
  assert.equal(s.email, "avery.example@example.com");
  assert.equal(s.phone, "(555) 010-0199");
  assert.equal(s.resume, "Test_Resume.pdf");
  assert.equal(s.cover_letter, null, "cover letter upload is never filled with the resume");
  // Async location typeahead: typed, then the matching option was chosen.
  assert.equal(s["candidate-location"], "San Francisco, California, United States");
  // Education block (async school search, degree level mapping, month selects + number years).
  assert.equal(s["school--0"], "Example State University");
  assert.equal(s["degree--0"], "Bachelor's Degree");
  assert.equal(s["discipline--0"], "Computer Science");
  assert.equal(s["start-month--0"], "August");
  assert.equal(s["start-year--0"], "2023");
  assert.equal(s["end-month--0"], "May");
  assert.equal(s["end-year--0"], "2027");
  // Custom questions.
  assert.equal(s.question_1001, profile.personal.linkedinURL);
  assert.equal(s.question_1002, profile.personal.website);
  assert.equal(s.question_1003, profile.personal.githubURL);
  assert.equal(s.question_1004, "May - Aug 2027", "graduation date matched to its range option");
  assert.equal(s.question_1005, "Yes");
  assert.match(s.question_1006, /^Yes, I am currently legally authorized/);
  assert.match(s.question_1007, /^No, I do not and will not require/);
  assert.equal(s.question_1009, "LinkedIn");
  assert.deepEqual(s["question_1013[]"], ["Computer Science"], "multi-select checkbox group");
  assert.equal(await page.evaluate(() => window.__ghSubmitCount()), 0);
  assertLogsArePrivate(logs, profile);
});

test("Greenhouse: leaves attestations, screening, essays, EEO and existing values alone", async () => {
  const { page } = await openFixture({ url: "https://job-boards.greenhouse.io/example/jobs/1", fixture: "greenhouse-app.html", app: "greenhouse-app" });
  const report = await sendMessage(page, { action: "autofill", profile: testProfile(), resume: RESUME });
  const s = await page.evaluate(() => window.__ghState());

  assert.equal(s.preferred_name, "Already typed", "non-empty fields are never overwritten");
  assert.equal(s.question_1010, null, "previous-employment question left for the user");
  assert.equal(s.question_1011, null, "terms & conditions left for the user");
  assert.equal(s.question_1012, "", "essay question left blank");
  assert.equal(s.question_1014, "", "visa detail follow-up left blank");
  for (const id of ["gender", "hispanic_ethnicity", "veteran_status", "disability_status"]) assert.equal(s[id], null, `${id} not guessed`);
  assert.deepEqual(s.demographic_sexual_orientation, []);
  assert.equal(s.country, null, "no country saved, so the phone country stays empty");

  assert.equal(byLabel(report, /Terms/).action, "skipped");
  assert.match(byLabel(report, /Terms/).reason, /attestation/);
  assert.match(byLabel(report, /worked for this company/).reason, /screening/);
  assert.ok(report.needsAttention.includes("Terms & Conditions"));
  assert.ok(report.needsAttention.includes("Why do you want to join us?"));
});

test("Greenhouse: a question revealed by an answer is detected and filled", async () => {
  const profile = testProfile({ personal: { earliestStartDate: "June 2027" } });
  const { page } = await openFixture({ url: "https://job-boards.greenhouse.io/example/jobs/1", fixture: "greenhouse-app.html", app: "greenhouse-app" });
  const report = await sendMessage(page, { action: "autofill", profile, resume: null });
  const s = await page.evaluate(() => window.__ghState());
  assert.equal(s.question_1008, "June 2027");
  assert.equal(byLabel(report, /earliest available start/).action, "filled");
});

test("Greenhouse: a stored Yes on the 3-way sponsorship question is ambiguous and left alone", async () => {
  const profile = testProfile({ personal: { requiresSponsorship: "Yes" } });
  const { page } = await openFixture({ url: "https://job-boards.greenhouse.io/example/jobs/1", fixture: "greenhouse-app.html", app: "greenhouse-app" });
  const report = await sendMessage(page, { action: "autofill", profile, resume: null });
  const s = await page.evaluate(() => window.__ghState());
  assert.equal(s.question_1007, null);
  assert.match(byLabel(report, /sponsorship/).reason, /ambiguous/);
});

test("Greenhouse: EEO answers are filled only from explicit profile answers", async () => {
  const profile = testProfile({ personal: { genderIdentity: "Woman", veteranStatus: "I am not a protected veteran", disabilityStatus: "I Don't Wish To Answer", raceEthnicity: "Black or African American" } });
  const { page } = await openFixture({ url: "https://job-boards.greenhouse.io/example/jobs/1", fixture: "greenhouse-app.html", app: "greenhouse-app" });
  await sendMessage(page, { action: "autofill", profile, resume: null });
  const s = await page.evaluate(() => window.__ghState());
  assert.equal(s.gender, "Female");
  assert.equal(s.veteran_status, "I am not a protected veteran");
  assert.equal(s.disability_status, "I do not want to answer");
  assert.equal(s.hispanic_ethnicity, null, "not listing Hispanic is not treated as answering No");
});

test("Greenhouse (legacy boards / embed): native inputs, selects and radios", async () => {
  const { page } = await openFixture({ url: "https://boards.greenhouse.io/embed/job_app?for=example&token=1", fixture: "greenhouse-legacy.html" });
  const report = await sendMessage(page, { action: "autofill", profile: testProfile(), resume: RESUME });
  const v = await page.evaluate(() => ({
    first: first_name.value, email: email.value, location: document.getElementById("location").value, linkedin: question_linkedin.value,
    degree: education_degree_0.selectedOptions[0].textContent, discipline: education_discipline_0.selectedOptions[0].textContent,
    school: education_school_name_0.value, auth: document.querySelector("input[name=work_authorization]:checked")?.value,
    custom: question_custom.value, resume: resume.files.length,
  }));
  assert.equal(v.first, "Avery");
  assert.equal(v.email, "avery.example@example.com");
  assert.equal(v.location, "Existing City, ST", "pre-filled value preserved");
  assert.equal(v.linkedin, "https://www.linkedin.com/in/avery-example");
  assert.equal(v.degree, "Bachelor's Degree");
  assert.equal(v.discipline, "Computer Science");
  assert.equal(v.school, "", "no school option matches, so none is picked");
  assert.equal(byLabel(report, /^School$/).action, "skipped");
  assert.equal(v.auth, "yes");
  assert.equal(v.custom, "");
  assert.equal(v.resume, 1);
});

// ─── Ashby ────────────────────────────────────────────────────────────────

test("Ashby: system fields, Yes/No widgets, radios, typeahead location, conditional follow-up", async () => {
  const profile = testProfile({ personal: { willingToRelocate: "Yes", earliestStartDate: "June 2027" } });
  const { page, logs } = await openFixture({ url: "https://jobs.ashbyhq.com/example/abc/application", fixture: "ashby-app.html" });
  const report = await sendMessage(page, { action: "autofill", profile, resume: RESUME });
  const v = await page.evaluate(() => ({
    name: _systemfield_name.value, email: _systemfield_email.value,
    phone: document.getElementById("6b1d0f7e-2c1a-4f7e-9a51-1c0de0000001").value,
    location: _systemfield_location.value, resume: _systemfield_resume.files.length,
    autofillUpload: document.getElementById("autofill-resume").files.length,
    linkedin: document.getElementById("7c2e1f8a-0000-4000-8000-000000000002").value,
    pressed: Object.fromEntries([...document.querySelectorAll("._yesno button[aria-pressed=true]")].map(b => [b.closest("[data-field-path]").dataset.fieldPath, b.textContent])),
    relocate: document.querySelector("input[name=q-relocate]:checked")?.value,
    office: document.querySelector("input[name=q-office]:checked")?.value,
    start: document.getElementById("q-start")?.value,
    why: document.getElementById("q-why-input").value, ack: document.getElementById("q-ack-box").checked,
    gender: document.querySelector("input[name=_systemfield_eeoc_gender]:checked"), submits: window.__submits,
  }));
  assert.equal(report.provider, "ashby");
  assert.equal(v.name, "Avery Quinn Example");
  assert.equal(v.email, "avery.example@example.com");
  assert.equal(v.phone, "+1 555 000 1234", "existing phone preserved");
  assert.equal(v.location, "San Francisco, California, United States");
  assert.equal(v.resume, 1);
  assert.equal(v.autofillUpload, 0, "the 'Autofill from resume' uploader is not the resume field");
  assert.equal(v.linkedin, profile.personal.linkedinURL);
  assert.equal(v.pressed["q-auth"], "Yes");
  assert.equal(v.pressed["q-sponsor"], "No");
  assert.equal(v.pressed["q-uk-auth"], undefined, "UK right-to-work not answered from a US answer");
  assert.equal(v.relocate, "a");
  assert.equal(v.office, "y");
  assert.equal(v.start, "June 2027", "follow-up that appeared after answering was filled");
  assert.equal(v.why, "");
  assert.equal(v.ack, false);
  assert.equal(v.gender, null);
  assert.equal(v.submits, 0);
  assert.match(byLabel(report, /United Kingdom/).reason, /united kingdom/);
  assertLogsArePrivate(logs, profile);
});

test("Ashby: EEOC radios use explicit answers, several races collapse to 'Two or More'", async () => {
  const profile = testProfile({ personal: { genderIdentity: "Man", raceEthnicity: "Asian or Asian American, White" } });
  const { page } = await openFixture({ url: "https://jobs.ashbyhq.com/example/abc/application", fixture: "ashby-app.html" });
  await sendMessage(page, { action: "autofill", profile, resume: null });
  const v = await page.evaluate(() => ({
    gender: document.querySelector("input[name=_systemfield_eeoc_gender]:checked")?.value,
    race: document.querySelector("input[name=_systemfield_eeoc_race]:checked")?.value,
  }));
  assert.equal(v.gender, "Male");
  assert.equal(v.race, "4");
});

// ─── Gem ──────────────────────────────────────────────────────────────────

test("Gem: generic labelled form, portaled ARIA combobox, toggles, checkbox group", async () => {
  const profile = testProfile();
  const { page, logs } = await openFixture({ url: "https://jobs.gem.com/example/am9icG9zdDpFeGFtcGxl", fixture: "gem-app.html" });
  const detect = await sendMessage(page, { action: "detect" });
  assert.equal(detect.provider, "gem");
  const report = await sendMessage(page, { action: "autofill", profile, resume: RESUME });
  const v = await page.evaluate(() => ({
    first: document.getElementById("f-a1").value, last: document.getElementById("f-a2").value,
    email: document.getElementById("f-a3").value, phone: document.getElementById("f-a4").value,
    resume: document.getElementById("f-a5").files.length, linkedin: document.getElementById("f-a6").value,
    site: document.getElementById("f-a7").value, loc: document.getElementById("f-a8").value,
    degree: document.getElementById("f-b1").value,
    toggles: [...document.querySelectorAll(".toggle button[aria-pressed=true]")].map(b => b.textContent),
    arrangement: document.querySelector("input[name=arr]:checked"),
    sources: [...document.querySelectorAll("input[name=src]:checked")].map(i => i.value),
    years: document.getElementById("f-c2").value, consent: document.getElementById("f-c3").checked, submits: window.__submits,
  }));
  assert.equal(report.provider, "gem");
  assert.equal(v.first, "Avery");
  assert.equal(v.last, "Example");
  assert.equal(v.email, "avery.example@example.com");
  assert.equal(v.phone, "(555) 010-0199");
  assert.equal(v.resume, 1);
  assert.equal(v.linkedin, profile.personal.linkedinURL);
  assert.equal(v.site, profile.personal.website);
  assert.equal(v.loc, "San Francisco, CA");
  assert.equal(v.degree, "Bachelor's");
  assert.deepEqual(v.toggles, ["No", "Yes"], "sponsorship No, authorization Yes");
  assert.equal(v.arrangement, null, "work-arrangement preference is not guessed");
  assert.deepEqual(v.sources, ["1"]);
  assert.equal(v.years, "", "years of experience is not guessed");
  assert.equal(v.consent, false);
  assert.equal(v.submits, 0);
  assertLogsArePrivate(logs, profile);
});

// ─── Workday ──────────────────────────────────────────────────────────────

test("Workday: sign-in pages are never filled", async () => {
  const { page } = await openFixture({ url: "https://example.wd5.myworkdayjobs.com/en-US/External/login", fixture: "workday-signin.html" });
  const report = await sendMessage(page, { action: "autofill", profile: testProfile(), resume: RESUME });
  assert.match(report.blocked, /Sign in/);
  assert.equal(await page.inputValue("#email-in"), "");
  assert.equal(await page.inputValue("#pw"), "");
});

test("Workday: fills each step as the user moves through it, never presses Next", async () => {
  const profile = testProfile({ personal: { country: "United States" } });
  const { page, logs } = await openFixture({ url: "https://example.wd5.myworkdayjobs.com/en-US/External/job/X/apply", fixture: "workday-app.html" });

  // Step 1: My Information
  let report = await sendMessage(page, { action: "autofill", profile, resume: RESUME });
  let wd = await page.evaluate(() => window.__wd);
  assert.equal(report.provider, "workday");
  assert.equal(wd["source--source"], "LinkedIn", "searchable prompt: typed, Enter, option clicked");
  assert.equal(wd["country--country"], "United States of America", "listbox button dropdown");
  assert.equal(wd["name--legalName--firstName"], "Avery");
  assert.equal(wd["name--legalName--lastName"], "Example");
  assert.equal(wd["address--city"], "San Francisco");
  assert.equal(wd["address--countryRegion"], "California");
  assert.equal(wd["phoneNumber--phoneNumber"], "(555) 010-0199");
  assert.equal(wd.candidateIsPreviousWorker, undefined, "previous-worker question left for the user");
  assert.equal(wd["phoneNumber--phoneType"], undefined, "phone device type not guessed");
  assert.equal(wd["name--preferredCheck"], undefined);
  await page.click("#next"); // the user moves on

  // Step 2: My Experience — blocks are added, then filled.
  report = await sendMessage(page, { action: "autofill", profile, resume: RESUME });
  wd = await page.evaluate(() => window.__wd);
  const we = (k) => Object.entries(wd).find(([id]) => id.startsWith("workExperience-") && id.endsWith(k))?.[1];
  const ed = (k) => Object.entries(wd).find(([id]) => id.startsWith("education-") && id.endsWith(k))?.[1];
  assert.equal(we("--jobTitle"), "Software Engineering Intern");
  assert.equal(we("--companyName"), "Example Labs");
  assert.equal(we("--location"), "Austin, TX");
  assert.equal(we("--startDate-dateSectionMonth-input"), "5");
  assert.equal(we("--startDate-dateSectionYear-input"), "2026");
  assert.equal(we("--endDate-dateSectionYear-input"), "2026");
  assert.match(we("--roleDescription"), /Built a thing/);
  assert.equal(we("--currentlyWorkHere"), undefined, "not current, so the box stays unchecked");
  assert.equal(ed("--schoolName"), "Example State University");
  assert.equal(ed("--degree"), "Bachelor's Degree");
  assert.equal(ed("--fieldOfStudy"), "Computer Science");
  assert.equal(ed("--gradeAverage"), "3.8");
  assert.equal(ed("--firstYearAttended-dateSectionYear-input"), "2023");
  assert.equal(ed("--lastYearAttended-dateSectionYear-input"), "2027");
  assert.equal(wd["resumeAttachments--attachments"], "Test_Resume.pdf");
  await page.click("#next");

  // Step 3: Application Questions
  report = await sendMessage(page, { action: "autofill", profile, resume: RESUME });
  wd = await page.evaluate(() => window.__wd);
  assert.equal(wd["primaryQuestionnaire--q1"], "Yes");
  assert.equal(wd["primaryQuestionnaire--q2"], "No");
  assert.equal(wd["primaryQuestionnaire--q3"], undefined, "age question not answered");
  assert.equal(wd["primaryQuestionnaire--q4"], undefined, "non-compete not answered");
  assert.ok(report.needsAttention.some(l => /18 years/.test(l)));

  assert.equal(await page.evaluate(() => window.__untrustedNext), 0, "Swiftly never clicks Next");
  assertLogsArePrivate(logs, profile);
});

test("Workday: My Information step from a saved live page", async () => {
  // The editor's address fields win over the one-line location.
  const profile = testProfile({ personal: { addressLine1: "1 Example Way", city: "Denver", state: "CO", postalCode: "80202", country: "United States" } });
  const { page, logs } = await openFixture({ url: "https://example.wd5.myworkdayjobs.com/en-US/External/job/X/apply/applyManually", fixture: "workday-myinfo-snapshot.html" });
  const report = await sendMessage(page, { action: "autofill", profile, resume: RESUME });
  const wd = await page.evaluate(() => window.__wd);

  assert.equal(report.provider, "workday");
  assert.equal(wd["source--source"], "LinkedIn");
  assert.equal(wd["name--legalName--firstName"], "Avery");
  assert.equal(wd["name--legalName--lastName"], "Example");
  assert.equal(wd["address--addressLine1"], "1 Example Way");
  assert.equal(wd["address--city"], "Denver");
  assert.equal(wd["address--countryRegion"], "Colorado", "chosen from the popup, not from the phone-code prompt's selected pill");
  assert.equal(wd["address--postalCode"], "80202");
  assert.equal(wd["phoneNumber--phoneNumber"], "(555) 010-0199");
  // The hidden id input beside each listbox button is never typed into.
  const shims = await page.$$eval("button[aria-haspopup=listbox] + input", els => els.map(e => e.value));
  assert.deepEqual(shims, ["bc33aa3152ec42d4995f4791a106ed09", "colorado", ""]);
  assert.equal(wd["country--country"], undefined, "preselected country left alone");
  assert.equal(wd["phoneNumber--extension"], undefined, "extension is not the phone number");
  assert.equal(wd["phoneNumber--countryPhoneCode"], undefined);
  assert.equal(wd.candidateIsPreviousWorker, undefined, "previous-worker question left for the user");
  assert.equal(wd["phoneNumber--phoneType"], undefined, "phone device type not guessed");
  assert.equal(wd.zr8y5, undefined, "SMS opt-in never checked");
  assert.deepEqual(report.needsAttention.map(l => l.slice(0, 20)), ["Have you previously ", "Phone Device Type"]);
  assert.equal(await page.evaluate(() => window.__untrustedNext), 0, "Swiftly never clicks Save and Continue");
  assertLogsArePrivate(logs, profile);
});

test("Workday: My Information keeps typed values and reports what the profile lacks", async () => {
  const { page } = await openFixture({ url: "https://example.wd5.myworkdayjobs.com/en-US/External/job/X/apply/applyManually", fixture: "workday-myinfo-snapshot.html" });
  await page.fill("#name--legalName--firstName", "Ave");
  const report = await sendMessage(page, { action: "autofill", profile: testProfile(), resume: RESUME });
  const wd = await page.evaluate(() => window.__wd);
  assert.equal(wd["name--legalName--firstName"], "Ave", "existing value preserved");
  assert.equal(await page.inputValue("#address--addressLine1"), "", "no street address in the profile, none invented");
  assert.equal(await page.inputValue("#address--postalCode"), "");
  assert.ok(report.needsAttention.includes("Address Line 1"));
  assert.ok(report.needsAttention.includes("Postal Code"));
});

// ─── Cross-cutting ────────────────────────────────────────────────────────

test("frames without an application stay silent so the embedding frame's form answers", async () => {
  const { page } = await openFixture({ url: "https://job-boards.greenhouse.io/example", fixture: "workday-signin.html" });
  // A Greenhouse host page with no application form: no adapter structure matches.
  await page.evaluate(() => { document.body.innerHTML = "<h1>Open roles</h1><a href='#'>Engineer</a>"; });
  assert.equal(await sendMessage(page, { action: "detect" }), undefined);
  assert.equal(await sendMessage(page, { action: "autofill", profile: testProfile() }), undefined);
});

test("logs explain each decision without values", async () => {
  const profile = testProfile();
  const { page, logs } = await openFixture({ url: "https://jobs.gem.com/example/x", fixture: "gem-app.html" });
  await sendMessage(page, { action: "autofill", profile, resume: null });
  const lines = logs.filter(l => l.startsWith("[Swiftly]"));
  assert.ok(lines.some(l => /ATS detected: Gem/.test(l)));
  assert.ok(lines.some(l => /filled: "First name" \[text\] → personal\.firstName \(confidence 0\.\d\d\)/.test(l)));
  assert.ok(lines.some(l => /skipped: "Anything else you'd like us to know\?" .*→ unknown .*no confident mapping/.test(l)));
  assert.ok(lines.some(l => /skipped: "I agree to the processing.*attestation/.test(l)));
  assertLogsArePrivate(logs, profile);
});

// ─── Real markup snapshot ─────────────────────────────────────────────────

test("Greenhouse snapshot: real job-boards markup is detected and classified correctly", async () => {
  const { page } = await openFixture({ url: "https://job-boards.greenhouse.io/example/jobs/2", fixture: "greenhouse-snapshot.html" });
  const rows = await page.evaluate(() => {
    const adapter = pickAdapter(location, document);
    return detectFields(adapter.formRoot(document), adapter).map(f => {
      const c = classifyField(f, f.hintKey);
      return { label: f.label, type: describeField(f).type, key: c.key, blocked: !!c.blocked, required: f.required, section: f.section?.kind ?? null, part: f.datePart };
    });
  });
  const find = (re) => rows.find(r => re.test(r.label));
  const expectations = [
    [/^First Name$/, "personal.firstName", "text"],
    [/^Email$/, "personal.email", "text"],
    [/^Country$/, "personal.country", "combobox/reactSelect"],
    [/^Phone$/, "personal.phone", "text"],
    [/^Resume\/CV$/, "documents.resume", "file"],
    [/^Cover Letter$/, "documents.coverLetter", "file"],
    [/^School$/, "education.institution", "combobox/reactSelect"],
    [/^Degree$/, "education.degree", "combobox/reactSelect"],
    [/^Start date month$/, "education.startDate", "combobox/reactSelect"],
    [/^End date year$/, "education.endDate", "text"],
    [/^LinkedIn Profile$/, "personal.linkedinURL", "text"],
    [/university you currently attend/, "education.currentSchool", "combobox/reactSelect"],
    [/expected graduation date/, "education.graduation", "combobox/reactSelect"],
    [/^Undergrad Disciplines$/, "education.currentMajor", "checkboxGroup"],
    [/country do you currently reside/, "personal.country", "combobox/reactSelect"],
    [/which US state/, "personal.state", "combobox/reactSelect"],
    [/legally authorized to work/, "eligibility.workAuthorization", "combobox/reactSelect"],
    [/require employer sponsorship/, "eligibility.requiresSponsorship", "combobox/reactSelect"],
    [/How did you hear/, "preferences.referralSource", "combobox/reactSelect"],
    [/^Gender$/, "eeo.gender", "combobox/reactSelect"],
    [/^Veteran Status$/, "eeo.veteran", "combobox/reactSelect"],
  ];
  for (const [re, key, type] of expectations) {
    const row = find(re);
    assert.ok(row, `no field labelled ${re}`);
    assert.equal(row.key, key, `${row.label}`);
    assert.equal(row.type, type, `${row.label}`);
  }
  assert.equal(find(/^Start date month$/).part, "month");
  assert.equal(find(/^School$/).section, "education");
  assert.equal(find(/^Terms/).blocked, true);
  assert.equal(find(/proprietary trading firm\?/)?.key ?? null, null, "employer-specific experience question stays unknown");
  assert.equal(find(/^First Name$/).required, true);
  assert.equal(find(/^Preferred First Name$/).required, false);
  // The hidden "required" shims next to each React Select are not fields.
  assert.ok(rows.every(r => r.label), "every detected field has a label");
});
