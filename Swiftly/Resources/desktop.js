import * as editor from "./profile-editor.js";

// The Swiftly desktop app window: a home screen with the Swiftly branding and
// an Edit Profile action, and a profile editor built from the same
// profile-editor.js the Safari extension popup uses. Both surfaces read and
// write the one profile in the shared App Group store; the only difference is
// the transport below. The extension reaches the native side through
// `browser.runtime.sendNativeMessage`, while this page *is* the native app's
// own window, so it talks to Swift directly through a WKScriptMessageHandler.

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
  let timer;
  const request = new Promise((resolve) => {
    pending.set(id, resolve);
    window.webkit.messageHandlers.swiftlyNative.postMessage({ id, action, ...extra });
  });
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`nativeMessage("${action}") timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([request, timeout])
    .catch((err) => {
      pending.delete(id);
      console.error("[Swiftly]", err);
      throw err;
    })
    .finally(() => clearTimeout(timer));
}

// ─── Profile state ─────────────────────────────────────────────────────────

let profile = editor.emptyProfile();
let resumeStatusMessage = "";

// What the shared store held the last time this window read or wrote it, as a
// key-order-independent string. Comparing against this (rather than against
// the in-memory profile, which carries JS-only fields and nulls the native
// encoder drops) tells us whether someone else, i.e. the extension, has
// changed the profile since.
let lastSyncedSnapshot = null;

async function readStore() {
  const res = await nativeMessage("getProfile");
  const raw = res?.hasProfile && res.profile ? res.profile : null;
  return { raw, snapshot: stableStringify(raw) };
}

async function loadProfile() {
  const { raw, snapshot } = await readStore();
  lastSyncedSnapshot = snapshot;
  return raw ? editor.normalizeProfile(raw) : editor.emptyProfile();
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

// ─── Autosave ────────────────────────────────────────────────────────────

const autosave = editor.createAutosave(async () => {
  const res = await nativeMessage("saveProfile", { profile });
  if (!res?.success) return false;
  lastSyncedSnapshot = (await readStore()).snapshot;
  return true;
});

// ─── Staying in sync with the Safari extension ─────────────────────────────
// This window lives for the app's whole lifetime, so the profile it loaded at
// launch goes stale as soon as the user edits in the extension popup. Saves
// write the whole profile, so editing that stale copy would overwrite the
// extension's changes. AppDelegate calls this whenever the window becomes key;
// it reloads from the shared store unless there are local edits still waiting
// to be saved (those are newer than anything in the store).

window.__swiftlyRefresh = async () => {
  if (autosave.busy) return;
  let store;
  try {
    store = await readStore();
  } catch {
    return;
  }
  if (autosave.busy || store.snapshot === lastSyncedSnapshot) return;
  lastSyncedSnapshot = store.snapshot;
  profile = store.raw ? editor.normalizeProfile(store.raw) : editor.emptyProfile();
  rerenderCurrentView();
};

// ─── Boot ────────────────────────────────────────────────────────────────

init();

async function init() {
  try {
    profile = await loadProfile();
  } catch (err) {
    // Never let a boot-time failure leave the window stuck on "Loading…".
    console.error("[Swiftly] init failed, starting with an empty profile:", err);
  }

  document.getElementById("edit-profile-btn").addEventListener("click", showEditor);
  document.getElementById("back-btn").addEventListener("click", showHome);

  hide("view-loading");
  showHome();
}

let currentView = null;

function showHome() {
  currentView = "home";
  hide("view-editor");
  show("view-home");
  resumeStatusMessage = "";
  renderHome();
}

function showEditor() {
  currentView = "editor";
  hide("view-home");
  show("view-editor");
  window.scrollTo(0, 0);
  renderEditor();
}

function rerenderCurrentView() {
  if (currentView === "home") renderHome();
  else if (currentView === "editor") renderEditor();
}

// ─── Home ────────────────────────────────────────────────────────────────

function renderHome() {
  const name = profile.personal.fullName?.trim();
  document.getElementById("home-name").textContent = name || "Let's set up your profile";
  document.getElementById("home-summary").textContent = summarizeProfile(profile);
}

function summarizeProfile(p) {
  const parts = [];
  const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  if (p.education.length) parts.push(count(p.education.length, "school", "schools"));
  if (p.experience.length) parts.push(count(p.experience.length, "job", "jobs"));
  if (p.projects.length) parts.push(count(p.projects.length, "project", "projects"));
  if (parts.length) return parts.join(" · ");
  return p.personal.fullName?.trim()
    ? "Add your education, experience and projects."
    : "Upload a resume or fill in your details to start autofilling.";
}

// ─── Profile editor ────────────────────────────────────────────────────────

function renderEditor() {
  const container = document.getElementById("info-content");
  container.innerHTML = "";
  // The desktop app doesn't keep the raw resume (the shared store only holds
  // the parsed profile; see CLAUDE.md's "don't store the raw resume
  // indefinitely"), so the file on record comes from the profile's own
  // sourceMetadata rather than the popup's browser.storage copy.
  container.append(editor.renderResumeCard({
    fileName: profile.sourceMetadata?.originalFilename,
    statusMessage: resumeStatusMessage,
    onFileChosen: handleResumeFileChosen,
  }));
  editor.renderProfileSections(container, profile, { onChange: autosave.schedule, personalOpen: true });
}

async function handleResumeFileChosen(file) {
  resumeStatusMessage = "Parsing your resume…";
  renderEditor();

  try {
    const base64 = await editor.fileToBase64(file);
    const res = await nativeMessage("parseResume", { fileName: file.name, base64 });
    const parsed = editor.applyParseResponse(profile, res);
    profile = parsed.profile;
    resumeStatusMessage = parsed.message;
    if (parsed.changed) autosave.flush(); // parsing doesn't save; store the merged profile now
  } catch {
    resumeStatusMessage = "Couldn't parse this resume right now. You can still fill in your info manually.";
  }
  renderEditor();
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function show(id) { document.getElementById(id)?.classList.remove("hidden"); }
function hide(id) { document.getElementById(id)?.classList.add("hidden"); }
