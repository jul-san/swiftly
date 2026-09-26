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

function renderWorkEligibilitySection(p, changed) {
  const acc = ui.createAccordion({ title: "Work Eligibility" });
  const wrap = document.createElement("div");
  wrap.className = "section-fields";

  wrap.append(
    ui.selectField({
      label: "Authorized to work in the US?", value: p.workAuthorization,
      options: [["", ""], ["Yes", "Yes"], ["No", "No"], ["Prefer not to answer", "Prefer not to answer"]],
      onChange: v => { p.workAuthorization = v || null; changed(); },
    }),
    ui.selectField({
      label: "Will you require visa sponsorship?", value: p.requiresSponsorship,
      options: [["", ""], ["Yes", "Yes"], ["No", "No"], ["Prefer not to answer", "Prefer not to answer"]],
      onChange: v => { p.requiresSponsorship = v || null; changed(); },
    }),
    ui.selectField({
      label: "Can you work in-person / from an office?", value: p.inPersonWork,
      options: [["", ""], ["Yes", "Yes"], ["No", "No"], ["Prefer not to answer", "Prefer not to answer"]],
      onChange: v => { p.inPersonWork = v || null; changed(); },
    }),
  );
  acc.body.append(wrap);
  return acc.section;
}

function renderDemographicsSection(p, changed) {
  const acc = ui.createAccordion({ title: "Demographics" });
  const wrap = document.createElement("div");
  wrap.className = "section-fields";

  wrap.append(
    ui.labeledInput({
      label: "Pronouns", value: p.pronouns, placeholder: "she/her",
      onInput: v => { p.pronouns = v || null; changed(); },
    }),
    ui.selectField({
      label: "Gender identity", value: p.genderIdentity,
      options: [
        ["", ""], ["Man", "Man"], ["Woman", "Woman"], ["Non-Binary", "Non-Binary"],
        ["Another Gender Identity", "Another Gender Identity"],
        ["I prefer not to answer", "I prefer not to answer"],
      ],
      onChange: v => { p.genderIdentity = v || null; changed(); },
    }),
  );

  const raceField = document.createElement("div");
  raceField.className = "mini-field";
  const raceLabel = document.createElement("span");
  raceLabel.className = "mini-field-label";
  raceLabel.textContent = "Race / Ethnicity";
  raceField.append(raceLabel, ui.raceCheckboxGroup(
    ["Asian or Asian American", "Black or African American", "Hispanic or Latine",
      "Indigenous or Native American", "Native Hawaiian or Other Pacific Islander",
      "White", "Other", "I prefer not to answer"],
    p.raceEthnicity,
    (csv) => { p.raceEthnicity = csv || null; changed(); },
  ));
  wrap.append(raceField);

  wrap.append(
    ui.selectField({
      label: "Veteran status", value: p.veteranStatus,
      options: [
        ["", ""],
        ["I am not a protected veteran", "Not a protected veteran"],
        ["I identify as one or more of the classifications of protected veteran listed above", "Protected veteran"],
        ["I decline to self-identify for protected veteran status", "Decline to self-identify"],
      ],
      onChange: v => { p.veteranStatus = v || null; changed(); },
    }),
    ui.selectField({
      label: "Disability status", value: p.disabilityStatus,
      options: [
        ["", ""],
        ["Yes, I Have A Disability, Or Have Had One In The Past", "Yes, I have a disability"],
        ["No, I Don't Have A Disability", "No"],
        ["I Don't Wish To Answer", "Prefer not to answer"],
      ],
      onChange: v => { p.disabilityStatus = v || null; changed(); },
    }),
  );

  acc.body.append(wrap);
  return acc.section;
}
