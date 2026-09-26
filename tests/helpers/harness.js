// Shared browser harness for the autofill DOM tests.
//
// Fixtures are served under real ATS hostnames through Playwright request
// interception (nothing goes to the network), and the extension's content
// scripts are injected in exactly the order manifest.json lists them, so a
// missing or misordered script fails the tests the way it would in Safari.

const path = require("node:path");
const fs = require("node:fs");
const esbuild = require("esbuild");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..", "..");
const RESOURCES = path.join(ROOT, "Swiftly Extension", "Resources");
const FIXTURES = path.join(ROOT, "tests", "fixtures");
const BUILD = path.join(ROOT, "tests", ".build");

function manifestScripts() {
  const manifest = JSON.parse(fs.readFileSync(path.join(RESOURCES, "manifest.json"), "utf8"));
  return manifest.content_scripts[0].js.map(p => path.join(RESOURCES, p));
}

// Bundles a React fixture app (real React + React Select) once per run.
function buildFixtureApp(name) {
  fs.mkdirSync(BUILD, { recursive: true });
  const out = path.join(BUILD, `${name}.js`);
  esbuild.buildSync({
    entryPoints: [path.join(FIXTURES, "src", `${name}.jsx`)],
    bundle: true, outfile: out, format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' }, logLevel: "error",
  });
  return out;
}

let browser;
async function getBrowser() {
  if (!browser) {
    browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  }
  return browser;
}
async function closeBrowser() {
  if (browser) await browser.close();
  browser = null;
}

// Opens `fixture` (an .html file in tests/fixtures) at `url`. When `app` is
// given, the bundled React fixture is served alongside and mounted in #root.
async function openFixture({ url, fixture, app }) {
  const b = await getBrowser();
  const context = await b.newContext();
  const page = await context.newPage();
  const logs = [];
  page.on("console", msg => logs.push(msg.text()));
  page.on("pageerror", err => logs.push(`PAGEERROR ${err.message}`));
  const appFile = app ? buildFixtureApp(app) : null;
  await page.route("**/*", route => {
    const reqUrl = route.request().url();
    if (appFile && reqUrl.endsWith("/__fixture_app.js")) return route.fulfill({ path: appFile, contentType: "text/javascript" });
    if (reqUrl.split("#")[0] === url.split("#")[0]) return route.fulfill({ path: path.join(FIXTURES, fixture), contentType: "text/html" });
    return route.fulfill({ status: 404, body: "" });
  });
  await page.goto(url);
  if (app) await page.waitForSelector("form");
  // Content-script environment: a `browser` global with runtime.onMessage.
  await page.evaluate(() => {
    window.browser = { runtime: { onMessage: { addListener(fn) { (window.__swiftlyListeners ||= []).push(fn); } } } };
  });
  for (const file of manifestScripts()) await page.addScriptTag({ path: file });
  return { page, logs, context };
}

// Sends a popup-style message through content.js and resolves with the reply.
async function sendMessage(page, message) {
  return page.evaluate((msg) => new Promise((resolve) => {
    let answered = false;
    const reply = (r) => { answered = true; resolve(r); };
    for (const fn of window.__swiftlyListeners ?? []) {
      const async = fn(msg, {}, reply);
      if (async === true) return;
    }
    setTimeout(() => { if (!answered) resolve(undefined); }, 50);
  }), message);
}

const RESUME = {
  name: "Test_Resume.pdf",
  type: "application/pdf",
  base64: Buffer.from("%PDF-1.4\n% Swiftly test resume\n%%EOF\n").toString("base64"),
};

// A generic applicant — deliberately not anyone's real data.
function testProfile(overrides = {}) {
  const base = {
    personal: {
      fullName: "Avery Quinn Example",
      firstName: "Avery", lastName: "Example",
      email: "avery.example@example.com", phone: "(555) 010-0199",
      location: "San Francisco, CA",
      linkedinURL: "https://www.linkedin.com/in/avery-example",
      githubURL: "https://github.com/avery-example",
      website: "https://avery.example.dev",
      workAuthorization: "Yes", requiresSponsorship: "No", inPersonWork: "Yes",
      referralSource: "LinkedIn",
      genderIdentity: null, raceEthnicity: null, veteranStatus: null, disabilityStatus: null,
    },
    education: [{
      id: "e1", institution: "Example State University", degree: "Bachelor of Science",
      fieldOfStudy: "Computer Science", startDate: "Aug 2023", graduationDate: "May 2027",
      currentOrPlanned: true, gpa: "3.8", awards: [], details: [],
    }],
    experience: [{
      id: "x1", company: "Example Labs", title: "Software Engineering Intern", location: "Austin, TX",
      startDate: "May 2026", endDate: "Aug 2026", current: false, teamsOrGroups: [],
      bullets: ["Built a thing", "Measured the thing"],
    }],
    projects: [], skills: { languages: [], tools: [], frameworks: [], other: [] }, sourceMetadata: null,
  };
  return {
    ...base, ...overrides,
    personal: { ...base.personal, ...(overrides.personal ?? {}) },
  };
}

module.exports = { openFixture, sendMessage, closeBrowser, testProfile, RESUME, manifestScripts };
