import * as fmt from "./profile-format.js";
import * as ui from "./profile-ui.js";

// The profile editor shared by both Swiftly surfaces: the Safari extension
// popup's Info view (popup.js) and the desktop app's Edit Profile view
// (desktop.js). Both edit the same ApplicantProfile, persisted by the native
// ApplicantProfileStore in the shared App Group, so they must present exactly
// the same sections and fields. Keeping that here (rather than in each page)
// means the two editors can't drift apart. Callers own transport (native
// messaging vs. the desktop WKWebView bridge) and when to save.

// ─── Profile shape ────────────────────────────────────────────────────────

export function emptyProfile() {
  return {
    personal: { fullName: "" },
    education: [],
    experience: [],
    projects: [],
    skills: { languages: [], tools: [], frameworks: [], other: [] },
    sourceMetadata: null,
  };
}

export function normalizeProfile(raw) {
  return {
    personal: { fullName: "", ...(raw?.personal ?? {}) },
    education: raw?.education ?? [],
    experience: raw?.experience ?? [],
    projects: raw?.projects ?? [],
    skills: { languages: [], tools: [], frameworks: [], other: [], ...(raw?.skills ?? {}) },
    sourceMetadata: raw?.sourceMetadata ?? null,
  };
}

export function splitFullName(fullName) {
  const parts = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

// A resume never contains work-eligibility or demographic answers, so carry
// the user's existing answers forward when a freshly parsed resume replaces
// the profile; re-parsing must never silently erase them.
const SELF_REPORTED_FIELDS = [
  "workAuthorization", "requiresSponsorship", "inPersonWork", "pronouns",
  "genderIdentity", "raceEthnicity", "veteranStatus", "disabilityStatus",
  "preferredName", "addressLine1", "city", "state", "postalCode", "country",
  "willingToRelocate", "earliestStartDate", "desiredSalary", "referralSource",
];

export function mergeParsedProfile(prior, parsed) {
  const merged = normalizeProfile(parsed);
  for (const key of SELF_REPORTED_FIELDS) {
    merged.personal[key] = prior?.personal?.[key] ?? null;
  }
  return merged;
}

export function summarizeParse(p) {
  const parts = [];
  if (p.education.length) parts.push(`${p.education.length} education ${p.education.length === 1 ? "entry" : "entries"}`);
  if (p.experience.length) parts.push(`${p.experience.length} job${p.experience.length === 1 ? "" : "s"}`);
  if (p.projects.length) parts.push(`${p.projects.length} project${p.projects.length === 1 ? "" : "s"}`);
  const skillCount = ["languages", "tools", "frameworks", "other"].reduce((n, k) => n + (p.skills[k]?.length || 0), 0);
  if (skillCount) parts.push("skills");
  return parts.length
    ? `Filled in ${parts.join(", ")} below. Review and correct anything that's off.`
    : "Parsed your resume — review your info below.";
}

// Folds a native `parseResume` response into the profile. Returns the profile
// to keep (the merge when parsing worked, `prior` otherwise), whether it
// changed, and the message for the resume card.
export function applyParseResponse(prior, response) {
  if (response?.success && response.profile) {
    const profile = mergeParsedProfile(prior, response.profile);
    return { profile, changed: true, message: summarizeParse(profile) };
  }
  return {
    profile: prior,
    changed: false,
    message: response?.error || "Couldn't parse this resume. You can still fill in your info manually.",
  };
}

// Debounced saving with the header's "Saving… / Saved" indicator, shared by
// the popup and the desktop window. `save` persists the current profile and
// resolves to whether it worked. `busy` is true while an edit is waiting to be
// saved or a save is in flight.
export function createAutosave(save, { delayMs = 500, statusElementId = "save-status" } = {}) {
  let saveTimer = null;
  let saving = false;
  let statusTimer = null;

  function showStatus(text) {
    const el = document.getElementById(statusElementId);
    if (!el) return;
    el.textContent = text;
    el.classList.add("visible");
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => el.classList.remove("visible"), 2000);
  }

  async function flush() {
    clearTimeout(saveTimer);
    saveTimer = null;
    saving = true;
    try {
      showStatus((await save()) ? "Saved" : "Couldn't save");
    } catch {
      showStatus("Couldn't save");
    } finally {
      saving = false;
    }
  }

  function schedule() {
    showStatus("Saving…");
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, delayMs);
  }

  return {
    schedule,
    flush,
    get busy() { return saveTimer !== null || saving; },
  };
}

export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ─── Resume card ──────────────────────────────────────────────────────────

export function renderResumeCard({ fileName, statusMessage, onFileChosen }) {
  const card = document.createElement("div");
  card.className = "card resume-card";
  card.append(sectionLabel("Resume"));

  const row = document.createElement("div");
  row.className = "resume-row";

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = ".pdf";
  fileInput.style.display = "none";
  fileInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) onFileChosen(file);
  });

  const chooseBtn = document.createElement("button");
  chooseBtn.type = "button";
  chooseBtn.className = "btn-secondary";
  chooseBtn.textContent = fileName ? "Replace…" : "Choose PDF…";
  chooseBtn.addEventListener("click", () => fileInput.click());

  row.append(fileInput, chooseBtn);

  if (fileName) {
    const name = document.createElement("span");
    name.className = "resume-filename";
    name.textContent = fileName;
    const check = document.createElement("span");
    check.className = "resume-check";
    check.textContent = "✓";
    row.append(name, check);
  }

  card.append(row);

  if (statusMessage) {
    const status = document.createElement("p");
    status.className = "hint resume-parse-status";
    status.textContent = statusMessage;
    card.append(status);
  }

  return card;
}

export function sectionLabel(text) {
  const label = document.createElement("div");
  label.className = "section-label";
  label.textContent = text;
  return label;
}

// ─── Profile sections ─────────────────────────────────────────────────────

// Appends every profile section's accordion to `container`, editing `profile`
// in place. `onChange` runs after every edit, once the accordions' missing-
// field counts have been refreshed; counts update live without re-rendering
// the form, which would drop input focus and cursor position.
export function renderProfileSections(container, profile, { onChange, personalOpen = false }) {
  const countUpdaters = [];

  function changed() {
    for (const update of countUpdaters) update();
    onChange();
  }

  function wireCount(acc, countFn) {
    const update = () => {
      const n = countFn();
      acc.setCount(fmt.formatMissingFieldsLabel(n), { complete: n === 0 });
    };
    countUpdaters.push(update);
    update();
  }

  const personalAcc = ui.createAccordion({ title: "Personal Information", defaultOpen: personalOpen });
  personalAcc.body.append(ui.renderPersonalFields(profile.personal, (patch) => {
    Object.assign(profile.personal, patch);
    if ("fullName" in patch) Object.assign(profile.personal, splitFullName(patch.fullName));
    changed();
  }));
  container.append(personalAcc.section);
  wireCount(personalAcc, () => fmt.countMissingPersonalFields(profile.personal));

  const eduAcc = ui.createAccordion({ title: "Education" });
  eduAcc.body.append(ui.renderRepeatableList({
    items: profile.education,
    createEntry: () => ({ id: ui.uid(), institution: "", currentOrPlanned: false, awards: [], details: [] }),
    summary: (e) => ({
      title: e.institution,
      subtitle: [e.degree, e.fieldOfStudy].filter(Boolean).join(" in "),
      meta: e.graduationDate || fmt.formatDateRange(e.startDate, e.endDate, e.currentOrPlanned),
    }),
    renderFields: ui.buildEducationFields,
    addLabel: "+ Add Education",
    emptyHint: "No education added yet.",
    onChange: (list) => { profile.education = list; changed(); },
  }));
  container.append(eduAcc.section);
  wireCount(eduAcc, () => fmt.countMissingEducationFields(profile.education));

  const expAcc = ui.createAccordion({ title: "Experience" });
  expAcc.body.append(ui.renderRepeatableList({
    items: profile.experience,
    createEntry: () => ({ id: ui.uid(), company: "", title: "", current: false, teamsOrGroups: [], bullets: [] }),
    summary: (e) => ({
      title: e.title,
      subtitle: e.company,
      meta: fmt.formatDateRange(e.startDate, e.endDate, e.current),
    }),
    renderFields: ui.buildExperienceFields,
    addLabel: "+ Add Experience",
    emptyHint: "No experience added yet.",
    onChange: (list) => { profile.experience = list; changed(); },
  }));
  container.append(expAcc.section);
  wireCount(expAcc, () => fmt.countMissingExperienceFields(profile.experience));

  const projAcc = ui.createAccordion({ title: "Projects" });
  projAcc.body.append(ui.renderRepeatableList({
    items: profile.projects,
    createEntry: () => ({ id: ui.uid(), name: "", technologies: [], bullets: [] }),
    summary: (e) => ({
      title: e.name,
      subtitle: (e.technologies || []).join(" • "),
      meta: null,
    }),
    renderFields: ui.buildProjectFields,
    addLabel: "+ Add Project",
    emptyHint: "No projects added yet.",
    onChange: (list) => { profile.projects = list; changed(); },
  }));
  container.append(projAcc.section);
  wireCount(projAcc, () => fmt.countMissingProjectFields(profile.projects));

  const skillsAcc = ui.createAccordion({ title: "Skills" });
  skillsAcc.body.append(ui.renderSkillsFields(profile.skills, (patch) => {
    Object.assign(profile.skills, patch);
    changed();
  }));
  container.append(skillsAcc.section);

  container.append(renderWorkEligibilitySection(profile.personal, changed));
  container.append(renderDemographicsSection(profile.personal, changed));
}

// Stores an optional personal answer; an emptied field is saved as null.
function setter(p, key, changed) {
  return (v) => { p[key] = v || null; changed(); };
}

function sectionFields() {
  const wrap = document.createElement("div");
  wrap.className = "section-fields";
  return wrap;
}

const YES_NO = [["", ""], ["Yes", "Yes"], ["No", "No"]];
const YES_NO_DECLINE = [...YES_NO, ["Prefer not to answer", "Prefer not to answer"]];

function renderWorkEligibilitySection(p, changed) {
  const acc = ui.createAccordion({ title: "Work Eligibility" });
  const wrap = sectionFields();
  const select = (label, key, options) => ui.selectField({
    label, value: p[key], options, onChange: setter(p, key, changed),
  });
  const input = (label, key, placeholder) => ui.labeledInput({
    label, value: p[key], placeholder, onInput: setter(p, key, changed),
  });

  wrap.append(
    select("Authorized to work in the US?", "workAuthorization", YES_NO_DECLINE),
    select("Will you require visa sponsorship?", "requiresSponsorship", YES_NO_DECLINE),
    select("Can you work in-person / from an office?", "inPersonWork", YES_NO_DECLINE),
    select("Willing to relocate?", "willingToRelocate", YES_NO),
    input("Earliest start date", "earliestStartDate", "June 2027"),
    input("Salary expectation", "desiredSalary", "Leave blank to answer per application"),
    input("How you usually find jobs", "referralSource", "LinkedIn"),
  );
  acc.body.append(wrap);
  return acc.section;
}

// Stored values are the wording ATS forms use, so the autofill engine can
// match them against option text; labels are what the editor shows.
const GENDER_OPTIONS = [
  ["", ""], ["Man", "Man"], ["Woman", "Woman"], ["Non-Binary", "Non-Binary"],
  ["Another Gender Identity", "Another Gender Identity"],
  ["I prefer not to answer", "I prefer not to answer"],
];
const RACE_OPTIONS = [
  "Asian or Asian American", "Black or African American", "Hispanic or Latine",
  "Indigenous or Native American", "Native Hawaiian or Other Pacific Islander",
  "White", "Other", "I prefer not to answer",
];
const VETERAN_OPTIONS = [
  ["", ""],
  ["I am not a protected veteran", "Not a protected veteran"],
  ["I identify as one or more of the classifications of protected veteran listed above", "Protected veteran"],
  ["I decline to self-identify for protected veteran status", "Decline to self-identify"],
];
const DISABILITY_OPTIONS = [
  ["", ""],
  ["Yes, I Have A Disability, Or Have Had One In The Past", "Yes, I have a disability"],
  ["No, I Don't Have A Disability", "No"],
  ["I Don't Wish To Answer", "Prefer not to answer"],
];

function renderDemographicsSection(p, changed) {
  const acc = ui.createAccordion({ title: "Demographics" });
  const wrap = sectionFields();
  const select = (label, key, options) => ui.selectField({
    label, value: p[key], options, onChange: setter(p, key, changed),
  });

  wrap.append(
    ui.labeledInput({ label: "Pronouns", value: p.pronouns, placeholder: "she/her", onInput: setter(p, "pronouns", changed) }),
    select("Gender identity", "genderIdentity", GENDER_OPTIONS),
    ui.fieldGroup("Race / Ethnicity", ui.raceCheckboxGroup(RACE_OPTIONS, p.raceEthnicity, setter(p, "raceEthnicity", changed))),
    select("Veteran status", "veteranStatus", VETERAN_OPTIONS),
    select("Disability status", "disabilityStatus", DISABILITY_OPTIONS),
  );

  acc.body.append(wrap);
  return acc.section;
}
