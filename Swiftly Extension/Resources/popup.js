import * as editor from "./profile-editor.js";

// detectProviderFromHost is defined globally by autofill/matching.js, loaded
// via a plain <script> tag in popup.html before this module.

const PROVIDER_LABELS = { ashby: "Ashby", greenhouse: "Greenhouse" };

// ─── Native messaging (bridges to the companion app's parser + storage) ────

function nativeMessage(action, extra = {}, timeoutMs = 4000) {
  const request = Promise.resolve(browser.runtime.sendNativeMessage({ action, ...extra }));
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`nativeMessage("${action}") timed out after ${timeoutMs}ms`)), timeoutMs)
  );
  return Promise.race([request, timeout]).catch((err) => {
    console.error("[Swiftly]", err);
    throw err;
  });
}

// ─── Profile state ───────────────────────────────────────────────────────

let profile = editor.emptyProfile();
let resumeMeta = null;
let resumeStatusMessage = "";

// ─── Autosave ────────────────────────────────────────────────────────────

let saveTimer = null;

function scheduleSave() {
  showSaveStatus("Saving…");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, 500);
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

  browser.tabs.query({ active: true, currentWindow: true }).then(tabs => {
    const url = tabs[0]?.url ?? "";
    const tabId = tabs[0]?.id;
    hide("page-checking");

    const provider = detectProvider(url);
    if (provider) {
      document.getElementById("provider-status-text").textContent =
        `${PROVIDER_LABELS[provider]} application detected`;
      show("page-supported");
      const btn = document.getElementById("autofill-btn");
      btn.disabled = false;
      btn.textContent = "Autofill with Swiftly";
      btn.onclick = () => doAutofill(tabId);
    } else {
      show("page-other");
    }
  });
}

async function doAutofill(tabId) {
  const btn = document.getElementById("autofill-btn");
  btn.disabled = true;
  btn.textContent = "Filling…";
  try {
    const { resume } = await browser.storage.local.get("resume");
    const result = await browser.tabs.sendMessage(tabId, {
      action: "autofill",
      profile,
      resume: resume ?? null,
    });
    const n = result?.filled ?? 0;
    btn.textContent = `✓ Filled ${n} field${n === 1 ? "" : "s"}`;
  } catch {
    btn.textContent = "Reload the page and try again";
    btn.disabled = false;
  }
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
  editor.renderProfileSections(container, profile, { onChange: scheduleSave });
}

async function handleResumeFileChosen(file) {
  const base64 = await editor.fileToBase64(file);
  resumeMeta = { name: file.name, base64, type: file.type };
  await browser.storage.local.set({ resume: resumeMeta });

  resumeStatusMessage = "Parsing your resume…";
  renderInfo();

  try {
    const res = await nativeMessage("parseResume", { fileName: file.name, base64 });
    if (res?.success && res.profile) {
      profile = editor.mergeParsedProfile(profile, res.profile);
      resumeStatusMessage = editor.summarizeParse(profile);
      scheduleSave(); // the native side just saved the un-merged parse — persist the merge
    } else {
      resumeStatusMessage = res?.error || "Couldn't parse this resume. You can still fill in your info manually.";
    }
  } catch {
    resumeStatusMessage = "Couldn't reach Swiftly's parser. You can still fill in your info manually.";
  }
  renderInfo();
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function show(id) { document.getElementById(id)?.classList.remove("hidden"); }
function hide(id) { document.getElementById(id)?.classList.add("hidden"); }
