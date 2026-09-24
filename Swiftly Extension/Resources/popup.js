// ─── Startup ─────────────────────────────────────────────────────────────────

browser.storage.local.get(["profile", "resume"]).then(({ profile, resume }) => {
  hide("view-loading");
  if (profile?.firstName || profile?.lastName) {
    restoreResumeUI(resume);
    showMain(profile, resume);
  } else {
    restoreResumeUI(resume);
    show("view-setup");
  }
});

// ─── Resume upload ────────────────────────────────────────────────────────────

let pendingResume = null;

document.getElementById("f-resume-btn").addEventListener("click", () => {
  document.getElementById("f-resume-input").click();
});

document.getElementById("f-resume-input").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const base64 = reader.result.split(",")[1];
    pendingResume = { name: file.name, base64, type: file.type };
    setResumeUI(file.name);
  };
  reader.readAsDataURL(file);
});

document.getElementById("f-resume-clear").addEventListener("click", () => {
  pendingResume = null;
  document.getElementById("f-resume-input").value = "";
  clearResumeUI();
  browser.storage.local.remove("resume");
});

function setResumeUI(name) {
  document.getElementById("f-resume-name").textContent = name;
  document.getElementById("f-resume-name").classList.remove("hidden");
  document.getElementById("f-resume-clear").classList.remove("hidden");
  document.getElementById("f-resume-btn").textContent = "Replace…";
}

function clearResumeUI() {
  hide("f-resume-name");
  hide("f-resume-clear");
  document.getElementById("f-resume-btn").textContent = "Choose PDF…";
}

function restoreResumeUI(resume) {
  if (resume?.name) setResumeUI(resume.name);
}

// ─── Setup form ──────────────────────────────────────────────────────────────

document.getElementById("setup-save").addEventListener("click", saveProfile);

async function saveProfile() {
  const firstName = val("f-firstName");
  const lastName  = val("f-lastName");
  if (!firstName || !lastName) {
    show("setup-error");
    return;
  }
  hide("setup-error");

  const raceChecked = Array.from(
    document.querySelectorAll('#f-race-group input[type="checkbox"]:checked')
  ).map(cb => cb.value);

  const profile = {
    firstName,
    lastName,
    name:        `${firstName} ${lastName}`,
    email:       val("f-email")          || null,
    phone:       val("f-phone")          || null,
    location:    val("f-location")       || null,
    linkedin:    val("f-linkedin")       || null,
    github:      val("f-github")         || null,
    website:     val("f-website")        || null,
    workAuth:    selVal("f-workauth")    || null,
    sponsorship: selVal("f-sponsorship") || null,
    inPerson:    selVal("f-inperson")    || null,
    pronouns:    val("f-pronouns")       || null,
    gender:      selVal("f-gender")      || null,
    race:        raceChecked.join(", ")  || null,
    veteran:     selVal("f-veteran")     || null,
    disability:  selVal("f-disability")  || null,
  };

  const writes = { profile };
  if (pendingResume) writes.resume = pendingResume;
  await browser.storage.local.set(writes);

  const { resume } = await browser.storage.local.get("resume");
  hide("view-setup");
  showMain(profile, resume);
}

// ─── Edit button ─────────────────────────────────────────────────────────────

document.getElementById("edit-btn").addEventListener("click", () => {
  browser.storage.local.get(["profile", "resume"]).then(({ profile, resume }) => {
    setVal("f-firstName", profile?.firstName ?? "");
    setVal("f-lastName",  profile?.lastName  ?? "");
    setVal("f-email",     profile?.email     ?? "");
    setVal("f-phone",     profile?.phone     ?? "");
    setVal("f-location",  profile?.location  ?? "");
    setVal("f-linkedin",  profile?.linkedin  ?? "");
    setVal("f-github",    profile?.github    ?? "");
    setVal("f-website",   profile?.website   ?? "");
    setSelVal("f-workauth",    profile?.workAuth    ?? "");
    setSelVal("f-sponsorship", profile?.sponsorship ?? "");
    setSelVal("f-inperson",    profile?.inPerson    ?? "");
    setVal("f-pronouns",      profile?.pronouns  ?? "");
    setSelVal("f-gender",     profile?.gender    ?? "");
    setSelVal("f-veteran",    profile?.veteran   ?? "");
    setSelVal("f-disability", profile?.disability ?? "");

    // Restore race checkboxes
    const savedRace = new Set((profile?.race ?? "").split(",").map(s => s.trim()).filter(Boolean));
    document.querySelectorAll('#f-race-group input[type="checkbox"]').forEach(cb => {
      cb.checked = savedRace.has(cb.value);
    });
    restoreResumeUI(resume);
    hide("view-main");
    hide("edit-btn");
    show("view-setup");
  });
});

// ─── Main view ───────────────────────────────────────────────────────────────

function showMain(profile, resume) {
  document.getElementById("profile-name").textContent =
    profile.name ?? `${profile.firstName} ${profile.lastName}`;

  if (resume?.name) {
    document.getElementById("resume-status-name").textContent = resume.name;
    show("resume-status");
  } else {
    hide("resume-status");
  }

  show("view-main");
  show("edit-btn");

  browser.tabs.query({ active: true, currentWindow: true }).then(tabs => {
    const url   = tabs[0]?.url ?? "";
    const tabId = tabs[0]?.id;
    hide("page-checking");

    if (isAshbyPage(url)) {
      show("page-ashby");
      document.getElementById("autofill-btn").addEventListener("click", () =>
        doAutofill(tabId, profile)
      );
    } else {
      show("page-other");
    }
  });
}

// ─── Autofill ─────────────────────────────────────────────────────────────────

async function doAutofill(tabId, profile) {
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isAshbyPage(url) {
  try {
    const host = new URL(url).hostname;
    return host.endsWith(".ashbyhq.com") || host === "ashbyhq.com";
  } catch { return false; }
}

function show(id) { document.getElementById(id)?.classList.remove("hidden"); }
function hide(id) { document.getElementById(id)?.classList.add("hidden"); }
function val(id)  { return document.getElementById(id)?.value.trim() ?? ""; }
function selVal(id) { return document.getElementById(id)?.value ?? ""; }
function setVal(id, v) { const el = document.getElementById(id); if (el) el.value = v; }
function setSelVal(id, v) { const el = document.getElementById(id); if (el) el.value = v; }
