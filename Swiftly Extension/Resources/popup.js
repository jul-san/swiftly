import * as editor from "./profile-editor.js";

// detectProviderFromHost and PROVIDER_LABELS are defined globally by
// autofill/matching.js, loaded via a plain <script> tag in popup.html before
// this module.

// ─── Native messaging (bridges to the companion app's parser + storage) ────

function nativeMessage(action, extra = {}, timeoutMs = 4000) {
  let timer;
  const request = Promise.resolve(browser.runtime.sendNativeMessage({ action, ...extra }));
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`nativeMessage("${action}") timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([request, timeout])
    .catch((err) => {
      console.error("[Swiftly]", err);
      throw err;
    })
    .finally(() => clearTimeout(timer));
}

// ─── Profile state ───────────────────────────────────────────────────────

let profile = editor.emptyProfile();
let resumeMeta = null;
let resumeStatusMessage = "";

const autosave = editor.createAutosave(async () => {
  const res = await nativeMessage("saveProfile", { profile });
  return !!res?.success;
});

const AUTOFILL_LABEL = "Autofill with Swiftly";

// ─── Boot ────────────────────────────────────────────────────────────────

init();

async function init() {
  try {
    const [{ resume }, profileRes] = await Promise.all([
      browser.storage.local.get("resume").catch(() => ({ resume: null })),
      nativeMessage("getProfile").catch(() => ({ hasProfile: false })),
    ]);

    resumeMeta = resume ?? null;
    if (profileRes?.hasProfile && profileRes.profile) {
      profile = editor.normalizeProfile(profileRes.profile);
    }
  } catch (err) {
    // Never let a boot-time failure leave the popup stuck on "Loading…".
    console.error("[Swiftly] init failed, starting with an empty profile:", err);
  }

  hide("view-loading");
  show("nav-btn");
  document.getElementById("nav-btn").addEventListener("click", () => {
    if (document.getElementById("view-info").classList.contains("hidden")) {
      showInfo();
    } else {
      showHome();
    }
  });

  showHome();
}

function showHome() {
  hide("view-info");
  show("view-main");
  document.getElementById("nav-btn").textContent = "Info";
  renderHome();
}

function showInfo() {
  hide("view-main");
  show("view-info");
  document.getElementById("nav-btn").textContent = "Done";
  renderInfo();
}

// ─── Home view (page status + autofill) ────────────────────────────────────

function renderHome() {
  document.getElementById("profile-name").textContent = profile.personal.fullName || "";

  if (resumeMeta?.name) {
    document.getElementById("resume-status-name").textContent = resumeMeta.name;
    show("resume-status");
  } else {
    hide("resume-status");
  }

  renderPageStatus().catch((err) => {
    console.error("[Swiftly] couldn't check the current page:", err);
    hide("page-checking");
    show("page-other");
  });
}

async function renderPageStatus() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url ?? "";
  const tabId = tab?.id;

  // Ask the page first: the content script also runs inside ATS iframes
  // embedded on company career sites, where the tab URL isn't an ATS host.
  const detected = await browser.tabs.sendMessage(tabId, { action: "detect" }).catch(() => null);
  const provider = detected?.provider ?? detectProvider(url);
  hide("page-checking");

  if (!provider) {
    show("page-other");
    return;
  }
  document.getElementById("provider-status-text").textContent =
    `${PROVIDER_LABELS[provider] ?? provider} application detected`;
  show("page-supported");
  const btn = document.getElementById("autofill-btn");
  btn.textContent = AUTOFILL_LABEL;
  btn.disabled = !!detected?.blocked;
  setAutofillReport(detected?.blocked ?? null);
  if (!detected?.blocked) btn.onclick = () => doAutofill(tabId);
}

async function doAutofill(tabId) {
  const btn = document.getElementById("autofill-btn");
  btn.disabled = true;
  btn.textContent = "Filling…";
  setAutofillReport(null);
  try {
    const { resume } = await browser.storage.local.get("resume");
    const result = await browser.tabs.sendMessage(tabId, {
      action: "autofill",
      profile,
      resume: resume ?? null,
    });
    if (!result) throw new Error("no response");
    if (result.blocked || result.error) {
      btn.textContent = AUTOFILL_LABEL;
      btn.disabled = false;
      setAutofillReport(result.blocked || result.error);
      return;
    }
    const n = result.filled ?? 0;
    btn.textContent = `✓ Filled ${n} field${n === 1 ? "" : "s"}`;
    btn.disabled = false; // multi-step forms (Workday) can be filled again on the next step
    setAutofillReport(summarizeAttention(result.needsAttention ?? []));
  } catch {
    btn.textContent = "Reload the page and try again";
    btn.disabled = false;
  }
}

function summarizeAttention(labels) {
  if (!labels.length) return "Review the form before you submit it.";
  const shown = labels.slice(0, 4).map(l => l.length > 48 ? `${l.slice(0, 47)}…` : l);
  const more = labels.length > shown.length ? `, and ${labels.length - shown.length} more` : "";
  return `Still needs you: ${shown.join("; ")}${more}.`;
}

function setAutofillReport(text) {
  const el = document.getElementById("autofill-report");
  if (!el) return;
  el.textContent = text ?? "";
  el.classList.toggle("hidden", !text);
}

function detectProvider(url) {
  try {
    return detectProviderFromHost(new URL(url).hostname);
  } catch { return null; }
}

// ─── Info view (resume upload + shared profile editor) ─────────────────────

function renderInfo() {
  const container = document.getElementById("info-content");
  container.innerHTML = "";
  container.append(editor.renderResumeCard({
    fileName: resumeMeta?.name,
    statusMessage: resumeStatusMessage,
    onFileChosen: handleResumeFileChosen,
  }));
  editor.renderProfileSections(container, profile, { onChange: autosave.schedule });
}

async function handleResumeFileChosen(file) {
  const base64 = await editor.fileToBase64(file);
  resumeMeta = { name: file.name, base64, type: file.type };
  await browser.storage.local.set({ resume: resumeMeta });

  resumeStatusMessage = "Parsing your resume…";
  renderInfo();

  try {
    const res = await nativeMessage("parseResume", { fileName: file.name, base64 });
    const parsed = editor.applyParseResponse(profile, res);
    profile = parsed.profile;
    resumeStatusMessage = parsed.message;
    // Parsing doesn't save; store the merged profile right away, before the
    // popup can close.
    if (parsed.changed) autosave.flush();
  } catch {
    resumeStatusMessage = "Couldn't reach Swiftly's parser. You can still fill in your info manually.";
  }
  renderInfo();
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function show(id) { document.getElementById(id)?.classList.remove("hidden"); }
function hide(id) { document.getElementById(id)?.classList.add("hidden"); }
