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
