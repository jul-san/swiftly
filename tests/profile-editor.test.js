// Unit tests for the DOM-free parts of profile-editor.js: folding a parsed
// resume into the saved profile, and the debounced autosave shared by the
// popup and the desktop window.
//
// Run with: node --test tests/profile-editor.test.js

const test = require("node:test");
const assert = require("node:assert/strict");

const load = () => import("../Swiftly Extension/Resources/profile-editor.js");

function savedProfile() {
  return {
    personal: { fullName: "Old Name", email: "old@example.com", workAuthorization: "Yes", city: "Austin" },
    education: [], experience: [], projects: [],
    skills: { languages: [], tools: [], frameworks: [], other: [] },
    sourceMetadata: null,
  };
}

test("a successful parse replaces resume data but keeps self-reported answers", async () => {
  const { applyParseResponse } = await load();
  const parsed = { personal: { fullName: "New Name", email: "new@example.com" }, education: [{ institution: "State University" }] };
  const result = applyParseResponse(savedProfile(), { success: true, profile: parsed });

  assert.equal(result.changed, true);
  assert.equal(result.profile.personal.fullName, "New Name");
  assert.equal(result.profile.personal.email, "new@example.com");
  assert.equal(result.profile.personal.workAuthorization, "Yes");
  assert.equal(result.profile.personal.city, "Austin");
  assert.equal(result.profile.education.length, 1);
  assert.match(result.message, /1 education entry/);
});

test("a failed parse keeps the current profile and reports the native error", async () => {
  const { applyParseResponse } = await load();
  const prior = savedProfile();
  const result = applyParseResponse(prior, { success: false, error: "No text could be extracted from this PDF." });

  assert.equal(result.changed, false);
  assert.equal(result.profile, prior);
  assert.equal(result.message, "No text could be extracted from this PDF.");
  assert.match(applyParseResponse(prior, null).message, /Couldn't parse this resume/);
});

// createAutosave only touches the page to show its status line.
function withStatusElement() {
  const el = { textContent: "", classList: { add() {}, remove() {} } };
  globalThis.document = { getElementById: () => el };
  return el;
}

test("autosave debounces edits into one save", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const status = withStatusElement();
  const { createAutosave } = await load();
  let saves = 0;
  const autosave = createAutosave(async () => { saves++; return true; }, { delayMs: 500 });

  autosave.schedule();
  autosave.schedule();
  assert.equal(autosave.busy, true);
  assert.equal(status.textContent, "Saving…");

  t.mock.timers.tick(500);
  await new Promise(setImmediate);
  assert.equal(saves, 1);
  assert.equal(autosave.busy, false);
  assert.equal(status.textContent, "Saved");
});

test("flush saves immediately and reports a failed save", async () => {
  const status = withStatusElement();
  const { createAutosave } = await load();
  let saves = 0;
  const autosave = createAutosave(async () => { saves++; return false; });

  await autosave.flush();
  assert.equal(saves, 1);
  assert.equal(status.textContent, "Couldn't save");

  const throwing = createAutosave(async () => { throw new Error("native side unreachable"); });
  await throwing.flush();
  assert.equal(status.textContent, "Couldn't save");
  assert.equal(throwing.busy, false);
});
