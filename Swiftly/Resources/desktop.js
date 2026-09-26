import * as fmt from "./profile-format.js";
import * as ui from "./profile-ui.js";

// This mirrors the Safari extension popup's Info/profile view (same profile
// shape, same accordion-building calls into profile-ui.js/profile-format.js)
// so the desktop app and the extension present identical profile-editing
// behavior. The only real difference is the transport below: the extension
// reaches the native app via `browser.runtime.sendNativeMessage`, while this
// desktop page *is* the native app's own window, so it talks to Swift
// directly through a WKScriptMessageHandler.

// ─── Native bridge (desktop WKWebView ↔ Swift ProfileMessageHandler) ───────

let requestCounter = 0;
const pending = new Map();

function base64ToJson(base64) {
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

// Called back from Swift (DesktopWebBridge) to resolve a pending nativeMessage().
window.__swiftlyResolve = (id, resultBase64) => {
  const resolve = pending.get(id);
  if (!resolve) return;
  pending.delete(id);
  resolve(base64ToJson(resultBase64));
};

function nativeMessage(action, extra = {}, timeoutMs = 4000) {
  const id = ++requestCounter;
  const request = new Promise((resolve) => {
    pending.set(id, resolve);
    window.webkit.messageHandlers.swiftlyNative.postMessage({ id, action, ...extra });
  });
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`nativeMessage("${action}") timed out after ${timeoutMs}ms`)), timeoutMs)
  );
  return Promise.race([request, timeout]).catch((err) => {
    pending.delete(id);
    console.error("[Swiftly]", err);
    throw err;
  });
}

// ─── Profile state ─────────────────────────────────────────────────────────
// Same shape/helpers as the extension popup, so both surfaces read/write an
// identical ApplicantProfile through the shared App Group store.

function emptyProfile() {
  return {
    personal: { fullName: "" },
    education: [],
    experience: [],
    projects: [],
    skills: { languages: [], tools: [], frameworks: [], other: [] },
    sourceMetadata: null,
  };
}

function normalizeProfile(raw) {
  return {
    personal: { fullName: "", ...(raw?.personal ?? {}) },
    education: raw?.education ?? [],
    experience: raw?.experience ?? [],
    projects: raw?.projects ?? [],
    skills: { languages: [], tools: [], frameworks: [], other: [], ...(raw?.skills ?? {}) },
    sourceMetadata: raw?.sourceMetadata ?? null,
  };
}

function splitFullName(fullName) {
  const parts = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

let profile = emptyProfile();
let resumeStatusMessage = "";

// ─── Autosave ────────────────────────────────────────────────────────────

let saveTimer = null;

function scheduleSave() {
  updateFieldCounts();
  showSaveStatus("Saving…");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, 500);
}

const fieldCountUpdaters = {};

function updateFieldCounts() {
  for (const update of Object.values(fieldCountUpdaters)) update();
}

async function persist() {
  try {
    const res = await nativeMessage("saveProfile", { profile });
    showSaveStatus(res?.success ? "Saved" : "Couldn't save");
  } catch {
    showSaveStatus("Couldn't save");
  }
}

let saveStatusTimer = null;
function showSaveStatus(text) {
  const el = document.getElementById("save-status");
  if (!el) return;
  el.textContent = text;
  el.classList.add("visible");
  clearTimeout(saveStatusTimer);
  saveStatusTimer = setTimeout(() => el.classList.remove("visible"), 2000);
}

// ─── Boot ────────────────────────────────────────────────────────────────

init();

async function init() {
  try {
    const res = await nativeMessage("getProfile");
    if (res?.hasProfile && res.profile) {
      profile = normalizeProfile(res.profile);
    }
  } catch (err) {
    // Never let a boot-time failure leave the window stuck on "Loading…".
    console.error("[Swiftly] init failed, starting with an empty profile:", err);
  }

  hide("view-loading");
  show("info-content");
  renderInfo();
}

// ─── Profile view (resume upload + accordions) ─────────────────────────────

function renderInfo() {
  const container = document.getElementById("info-content");
  container.innerHTML = "";
  container.append(renderResumeBlock());

  for (const key of Object.keys(fieldCountUpdaters)) delete fieldCountUpdaters[key];

  function wireCount(key, acc, countFn) {
    fieldCountUpdaters[key] = () => {
      const n = countFn();
      acc.setCount(fmt.formatMissingFieldsLabel(n), { complete: n === 0 });
    };
    fieldCountUpdaters[key]();
  }

  const personalAcc = ui.createAccordion({ title: "Personal Information", defaultOpen: true });
  personalAcc.body.append(ui.renderPersonalFields(profile.personal, (patch) => {
    Object.assign(profile.personal, patch);
    if ("fullName" in patch) Object.assign(profile.personal, splitFullName(patch.fullName));
    scheduleSave();
  }));
  container.append(personalAcc.section);
  wireCount("personal", personalAcc, () => fmt.countMissingPersonalFields(profile.personal));

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
    onChange: (list) => { profile.education = list; scheduleSave(); },
  }));
  container.append(eduAcc.section);
  wireCount("education", eduAcc, () => fmt.countMissingEducationFields(profile.education));

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
    onChange: (list) => { profile.experience = list; scheduleSave(); },
  }));
  container.append(expAcc.section);
  wireCount("experience", expAcc, () => fmt.countMissingExperienceFields(profile.experience));

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
    onChange: (list) => { profile.projects = list; scheduleSave(); },
  }));
  container.append(projAcc.section);
  wireCount("projects", projAcc, () => fmt.countMissingProjectFields(profile.projects));

  const skillsAcc = ui.createAccordion({ title: "Skills" });
  skillsAcc.body.append(ui.renderSkillsFields(profile.skills, (patch) => {
    Object.assign(profile.skills, patch);
    scheduleSave();
  }));
  container.append(skillsAcc.section);

  container.append(renderWorkEligibilitySection());
  container.append(renderDemographicsSection());
}

// ─── Resume upload block ────────────────────────────────────────────────────
// The desktop app doesn't retain the raw resume bytes anywhere (the shared
// profile store only keeps the parsed, structured profile — see
// ApplicantProfileStore / CLAUDE.md's "don't store the raw resume
// indefinitely"), so "is a resume on file" is derived from the profile's own
// sourceMetadata rather than a separate resume-blob cache like the popup's
// browser.storage.local.

function renderResumeBlock() {
  const card = document.createElement("div");
  card.className = "card resume-card";
  card.append(labelNode("Resume"));

  const row = document.createElement("div");
  row.className = "resume-row";

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = ".pdf";
  fileInput.style.display = "none";
  fileInput.addEventListener("change", handleResumeFileChosen);

  const existingName = profile.sourceMetadata?.originalFilename;

  const chooseBtn = document.createElement("button");
  chooseBtn.type = "button";
  chooseBtn.className = "btn-secondary";
  chooseBtn.textContent = existingName ? "Replace…" : "Choose PDF…";
  chooseBtn.addEventListener("click", () => fileInput.click());

  row.append(fileInput, chooseBtn);

  if (existingName) {
    const name = document.createElement("span");
    name.className = "resume-filename";
    name.textContent = existingName;
    const check = document.createElement("span");
    check.className = "resume-check";
    check.textContent = "✓";
    row.append(name, check);
  }

  card.append(row);

  if (resumeStatusMessage) {
    const status = document.createElement("p");
    status.className = "hint resume-parse-status";
    status.textContent = resumeStatusMessage;
    card.append(status);
  }

  return card;
}

function labelNode(text) {
  const label = document.createElement("div");
  label.className = "section-label";
  label.textContent = text;
  return label;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function handleResumeFileChosen(e) {
  const file = e.target.files[0];
  if (!file) return;

  resumeStatusMessage = "Parsing your resume…";
  renderInfo();

  try {
    const base64 = await fileToBase64(file);
    const res = await nativeMessage("parseResume", { fileName: file.name, base64 });
    if (res?.success && res.profile) {
      // A resume never contains EEOC/demographic answers — carry the user's existing
      // answers forward so re-parsing a resume can't silently erase them.
      const priorPersonal = profile.personal;
      profile = normalizeProfile(res.profile);
      Object.assign(profile.personal, {
        workAuthorization: priorPersonal.workAuthorization ?? null,
        requiresSponsorship: priorPersonal.requiresSponsorship ?? null,
        inPersonWork: priorPersonal.inPersonWork ?? null,
        pronouns: priorPersonal.pronouns ?? null,
        genderIdentity: priorPersonal.genderIdentity ?? null,
        raceEthnicity: priorPersonal.raceEthnicity ?? null,
        veteranStatus: priorPersonal.veteranStatus ?? null,
        disabilityStatus: priorPersonal.disabilityStatus ?? null,
      });
      resumeStatusMessage = summarizeParse(profile);
      scheduleSave(); // the native side just saved the un-merged parse — persist the merge
    } else {
      resumeStatusMessage = res?.error || "Couldn't parse this resume. You can still fill in your info manually.";
    }
  } catch {
    resumeStatusMessage = "Couldn't parse this resume right now. You can still fill in your info manually.";
  }
  renderInfo();
}

function summarizeParse(p) {
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

// ─── Work eligibility + demographics (same fields as the extension popup) ──

function renderWorkEligibilitySection() {
  const acc = ui.createAccordion({ title: "Work Eligibility" });
  const wrap = document.createElement("div");
  wrap.className = "section-fields";
  const p = profile.personal;

  wrap.append(
    ui.selectField({
      label: "Authorized to work in the US?", value: p.workAuthorization,
      options: [["", ""], ["Yes", "Yes"], ["No", "No"], ["Prefer not to answer", "Prefer not to answer"]],
      onChange: v => { p.workAuthorization = v || null; scheduleSave(); },
    }),
    ui.selectField({
      label: "Will you require visa sponsorship?", value: p.requiresSponsorship,
      options: [["", ""], ["Yes", "Yes"], ["No", "No"], ["Prefer not to answer", "Prefer not to answer"]],
      onChange: v => { p.requiresSponsorship = v || null; scheduleSave(); },
    }),
    ui.selectField({
      label: "Can you work in-person / from an office?", value: p.inPersonWork,
      options: [["", ""], ["Yes", "Yes"], ["No", "No"], ["Prefer not to answer", "Prefer not to answer"]],
      onChange: v => { p.inPersonWork = v || null; scheduleSave(); },
    }),
  );
  acc.body.append(wrap);
  return acc.section;
}

function renderDemographicsSection() {
  const acc = ui.createAccordion({ title: "Demographics" });
  const wrap = document.createElement("div");
  wrap.className = "section-fields";
  const p = profile.personal;

  wrap.append(
    ui.labeledInput({
      label: "Pronouns", value: p.pronouns, placeholder: "she/her",
      onInput: v => { p.pronouns = v || null; scheduleSave(); },
    }),
    ui.selectField({
      label: "Gender identity", value: p.genderIdentity,
      options: [
        ["", ""], ["Man", "Man"], ["Woman", "Woman"], ["Non-Binary", "Non-Binary"],
        ["Another Gender Identity", "Another Gender Identity"],
        ["I prefer not to answer", "I prefer not to answer"],
      ],
      onChange: v => { p.genderIdentity = v || null; scheduleSave(); },
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
    (csv) => { p.raceEthnicity = csv || null; scheduleSave(); },
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
      onChange: v => { p.veteranStatus = v || null; scheduleSave(); },
    }),
    ui.selectField({
      label: "Disability status", value: p.disabilityStatus,
      options: [
        ["", ""],
        ["Yes, I Have A Disability, Or Have Had One In The Past", "Yes, I have a disability"],
        ["No, I Don't Have A Disability", "No"],
        ["I Don't Wish To Answer", "Prefer not to answer"],
      ],
      onChange: v => { p.disabilityStatus = v || null; scheduleSave(); },
    }),
  );

  acc.body.append(wrap);
  return acc.section;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function show(id) { document.getElementById(id)?.classList.remove("hidden"); }
function hide(id) { document.getElementById(id)?.classList.add("hidden"); }
