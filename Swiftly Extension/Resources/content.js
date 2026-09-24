browser.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action === "autofill") {
    autofill(request.profile, request.resume ?? null).then(sendResponse);
    return true;
  }
});

async function autofill(profile, resume) {
  const fullName = profile.name ?? [profile.firstName, profile.lastName].filter(Boolean).join(" ");
  let filled = 0;

  // ── Resume file first — let Ashby parse it and pre-populate fields ────────

  if (resume?.base64) {
    const fileInput = findResumeInput();
    if (fileInput) {
      const didFill = await fillFileInput(fileInput, resume);
      if (didFill) {
        filled++;
        await waitForResumeProcessing();
      }
    }
  }

  // ── Text inputs ───────────────────────────────────────────────────────────

  const textMappings = [
    {
      value: fullName,
      signals: ["_systemfieldname", "fullname", "full name", "full_name", "yourname", "applicantname", "candidatename"],
    },
    {
      value: profile.firstName,
      signals: ["firstname", "first name", "first_name", "fname", "givenname", "given name"],
    },
    {
      value: profile.lastName,
      signals: ["lastname", "last name", "last_name", "lname", "familyname", "family name", "surname"],
    },
    {
      value: profile.email,
      signals: ["_systemfieldemail", "email", "email address", "emailaddress", "e-mail", "emailid"],
    },
    {
      value: profile.phone,
      signals: ["phone", "phone number", "phonenumber", "mobile", "telephone", "cell", "cellphone"],
    },
    {
      value: profile.location,
      signals: ["location", "city", "address", "city state", "citystate", "currentlocation", "current location", "where are you located"],
    },
    {
      value: profile.pronouns,
      signals: ["pronouns", "your pronouns", "preferred pronouns"],
    },
    {
      value: profile.linkedin,
      signals: ["linkedin", "linkedinurl", "linkedinprofile", "linkedin profile", "linkedin url"],
    },
    {
      value: profile.github,
      signals: ["github", "githuburl", "githubprofile", "github profile"],
    },
    {
      value: profile.website,
      signals: ["website", "personalwebsite", "personal website", "portfoliourl", "portfolio", "personalsite", "homepage"],
    },
  ];

  for (const { value, signals } of textMappings) {
    if (!value) continue;
    const input = findTextInput(signals);
    if (input && !input.value.trim()) {
      fillInput(input, value);
      filled++;
    }
  }

  // ── Radio buttons ─────────────────────────────────────────────────────────

  const radioMappings = [
    {
      value: profile.workAuth,
      questionSignals: ["authorized to work", "authorized to be employed", "legally authorized", "work authorization", "eligible to work", "right to work"],
    },
    {
      value: profile.sponsorship,
      questionSignals: ["sponsorship", "visa sponsorship", "require sponsorship", "need sponsorship", "require a visa"],
    },
    {
      value: profile.gender,
      questionSignals: ["gender identity", "gender", "what is your gender"],
    },
    {
      value: profile.veteran,
      questionSignals: ["veteran status", "veteran", "protected veteran", "military status"],
    },
    {
      value: profile.disability,
      questionSignals: ["disability", "disabled", "disability status"],
    },
    // EEOC standard system fields (Ashby-specific)
    {
      value: profile.gender,
      systemFieldSignals: ["_systemfield_eeoc_gender"],
    },
    {
      value: profile.veteran,
      systemFieldSignals: ["_systemfield_eeoc_veteran_status"],
    },
  ];

  for (const mapping of radioMappings) {
    if (!mapping.value) continue;
    if (fillRadioInGroup(mapping.questionSignals ?? null, mapping.systemFieldSignals ?? null, mapping.value)) {
      filled++;
    }
  }

  // ── Ashby Yes/No widgets ─────────────────────────────────────────────────

  const yesNoMappings = [
    {
      value: profile.workAuth,
      questionSignals: ["authorized to work", "authorized to be employed", "legally authorized", "work authorization", "eligible to work", "right to work"],
    },
    {
      value: profile.sponsorship,
      questionSignals: ["sponsorship", "visa sponsorship", "require sponsorship", "need sponsorship", "require a visa"],
    },
    {
      value: profile.inPerson,
      questionSignals: ["work from our office", "work from the office", "work in our office", "work in person", "work on site", "work onsite", "days per week", "in-person", "in person"],
    },
  ];

  for (const { value, questionSignals } of yesNoMappings) {
    if (!value) continue;
    if (fillAshbyYesNo(questionSignals, value)) {
      filled++;
      await new Promise(r => setTimeout(r, 120)); // React needs a tick between clicks
    }
  }

  // ── Checkboxes ────────────────────────────────────────────────────────────

  if (profile.race) {
    const raceValues = profile.race.split(",").map(s => s.trim()).filter(Boolean);
    const raceFilled = fillCheckboxesInGroup(
      ["race", "ethnicity", "race ethnicity", "racial identity"],
      null,
      raceValues
    );
    filled += raceFilled;

    // EEOC race system field (single-choice radio — maps multi-select to one category)
    if (fillEeocRace(raceValues)) filled++;
  }

  return { filled };
}

// ─── Resume processing wait ───────────────────────────────────────────────────

async function waitForResumeProcessing() {
  // Always wait at least 4 s for Ashby's API call to complete and populate fields.
  await new Promise(r => setTimeout(r, 4000));

  // Then wait for the DOM to go quiet (1.5 s with no mutations), max 6 s more.
  return new Promise(resolve => {
    let settleTimer = null;

    const done = () => {
      if (settleTimer) clearTimeout(settleTimer);
      clearTimeout(maxTimer);
      observer.disconnect();
      resolve();
    };

    const resetSettle = () => {
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(done, 1500);
    };

    const maxTimer = setTimeout(done, 6000);
    const observer = new MutationObserver(resetSettle);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    resetSettle();
  });
}

// ─── Text input detection ────────────────────────────────────────────────────

function findTextInput(signals) {
  const inputs = document.querySelectorAll(
    'input[type="text"], input[type="email"], input[type="tel"], input[type="url"], input:not([type])'
  );
  for (const input of inputs) {
    if (matchesSignals(input, signals)) return input;
  }
  return null;
}

function matchesSignals(input, signals) {
  const candidates = [
    input.name,
    input.id,
    input.placeholder,
    input.getAttribute("aria-label"),
    getLabelText(input),
  ]
    .filter(Boolean)
    .map(s => s.toLowerCase().replace(/[-_\s]/g, ""));

  for (const signal of signals) {
    const normalized = signal.replace(/[-_\s]/g, "");
    if (candidates.some(c => c === normalized)) return true;
    if (normalized.length >= 8 && candidates.some(c => c.includes(normalized))) return true;
  }
  return false;
}

function getLabelText(input) {
  if (input.id) {
    try {
      const label = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
      if (label) return label.textContent.trim();
    } catch {}
  }
  const closest = input.closest("label");
  if (closest) return closest.textContent.trim();
  const labelledBy = input.getAttribute("aria-labelledby");
  if (labelledBy) {
    const el = document.getElementById(labelledBy);
    if (el) return el.textContent.trim();
  }
  return null;
}

// ─── Radio group detection and filling ───────────────────────────────────────

function getRadioGroups() {
  const groups = new Map(); // name → radio[]
  for (const radio of document.querySelectorAll('input[type="radio"]')) {
    if (!groups.has(radio.name)) groups.set(radio.name, []);
    groups.get(radio.name).push(radio);
  }
  return groups;
}

function getGroupContainerText(radios) {
  // Collect option labels so we can subtract them from the container text.
  const optionLabels = radios
    .map(r => getLabelText(r)?.trim() ?? "")
    .filter(Boolean);

  // Find the lowest common container for all radios in this group.
  let container = radios[0].parentElement;
  while (container && !radios.every(r => container.contains(r))) {
    container = container.parentElement;
  }
  if (!container) return null;

  // Try aria-labelledby first — the most reliable when present.
  const labelId = container.getAttribute("aria-labelledby");
  if (labelId) {
    const lel = document.getElementById(labelId);
    if (lel) return lel.textContent.trim();
  }

  // Walk ancestors looking for aria-labelledby or legend.
  let el = container.parentElement;
  for (let depth = 0; depth < 6 && el; depth++, el = el.parentElement) {
    const lid = el.getAttribute("aria-labelledby");
    if (lid) {
      const lel = document.getElementById(lid);
      if (lel) return lel.textContent.trim();
    }
    const legend = el.querySelector(":scope > legend");
    if (legend) return legend.textContent.trim();
  }

  // Main strategy: take the container's full text content and subtract all
  // known option label strings. What remains is the question text.
  // This works regardless of DOM nesting depth.
  let text = container.textContent?.trim() ?? "";
  for (const opt of optionLabels) {
    // Remove every occurrence, case-insensitively.
    text = text.replace(new RegExp(opt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), " ");
  }
  text = text.replace(/\s+/g, " ").trim();

  if (text.length > 5 && text.length < 400) return text;
  return null;
}

// Maps common gender values to alternate forms used in EEOC fields
const genderAliases = { man: "male", woman: "female", male: "man", female: "woman" };

function fillRadioInGroup(questionSignals, systemFieldSignals, answerValue) {
  const normalized = answerValue.toLowerCase().replace(/[-_\s]/g, "");
  const alias = genderAliases[normalized] ?? null;
  const groups = getRadioGroups();

  for (const [name, radios] of groups) {
    let groupMatches = false;

    // Match via Ashby system field name (e.g. _systemfield_eeoc_gender)
    if (systemFieldSignals) {
      const normName = name.toLowerCase().replace(/[-_\s]/g, "");
      groupMatches = systemFieldSignals.some(s => normName.includes(s.replace(/[-_\s]/g, "")));
    }

    // Match via surrounding question text
    if (!groupMatches && questionSignals) {
      const containerText = (getGroupContainerText(radios) ?? "").toLowerCase().replace(/[-_\s]/g, "");
      if (containerText) {
        groupMatches = questionSignals.some(s => containerText.includes(s.replace(/[-_\s]/g, "")));
      }
    }

    if (!groupMatches) continue;

    // Find the option whose label best matches the stored answer (or its alias)
    for (const radio of radios) {
      const label = getLabelText(radio) ?? "";
      const labelNorm = label.toLowerCase().replace(/[-_\s]/g, "");
      const matches = (norm) => labelNorm === norm || labelNorm.startsWith(norm) || norm.startsWith(labelNorm);
      if (matches(normalized) || (alias && matches(alias))) {
        if (!radio.checked) {
          radio.click();
          radio.dispatchEvent(new Event("change", { bubbles: true }));
        }
        return true;
      }
    }
  }
  return false;
}

// ─── Checkbox group detection and filling ────────────────────────────────────

function fillCheckboxesInGroup(questionSignals, systemFieldSignals, answerValues) {
  // Find the container element that holds checkboxes for the target question
  const allCheckboxes = document.querySelectorAll('input[type="checkbox"]');
  let matched = 0;
  const normalizedAnswers = answerValues.map(v => v.toLowerCase().replace(/[-_\s]/g, ""));

  for (const checkbox of allCheckboxes) {
    const label = getLabelText(checkbox) ?? "";
    const labelNorm = label.toLowerCase().replace(/[-_\s]/g, "");
    if (!labelNorm) continue;

    // Only act on checkboxes that match one of the target values
    const valueMatch = normalizedAnswers.some(a => labelNorm === a || labelNorm.startsWith(a) || a.startsWith(labelNorm));
    if (!valueMatch) continue;

    // Confirm this checkbox's group matches the question signals
    const siblingCheckboxes = Array.from(document.querySelectorAll(`input[type="checkbox"][name="${checkbox.name}"]`));
    const containerText = (getGroupContainerText(siblingCheckboxes.length > 1 ? siblingCheckboxes : [checkbox]) ?? "").toLowerCase().replace(/[-_\s]/g, "");
    let groupMatches = false;
    if (systemFieldSignals) {
      const normName = checkbox.name.toLowerCase().replace(/[-_\s]/g, "");
      groupMatches = systemFieldSignals.some(s => normName.includes(s.replace(/[-_\s]/g, "")));
    }
    if (!groupMatches && questionSignals && containerText) {
      groupMatches = questionSignals.some(s => containerText.includes(s.replace(/[-_\s]/g, "")));
    }
    if (!groupMatches) continue;

    if (!checkbox.checked) {
      checkbox.click();
      checkbox.dispatchEvent(new Event("change", { bubbles: true }));
    }
    matched++;
  }
  return matched;
}

// ─── EEOC race radio (single-choice, system field) ───────────────────────────

function fillEeocRace(raceValues) {
  const sample = document.querySelector('input[type="radio"][name*="_systemfield_eeoc_race"]');
  if (!sample) return false;

  const radios = Array.from(
    document.querySelectorAll(`input[type="radio"][name="${CSS.escape(sample.name)}"]`)
  );
  if (!radios.length) return false;

  const nonPnta = raceValues.filter(v => !v.match(/prefer|decline/i));

  let keyword;
  if (nonPnta.length === 0) {
    keyword = "decline";
  } else if (nonPnta.length >= 2 || raceValues.some(v => /two or more/i.test(v))) {
    keyword = "two or more";
  } else {
    const v = nonPnta[0].toLowerCase();
    if      (v.includes("hispanic") || v.includes("latino"))          keyword = "hispanic";
    else if (v.includes("white"))                                      keyword = "white";
    else if (v.includes("black")    || v.includes("african"))         keyword = "black";
    else if (v.includes("pacific")  || v.includes("hawaiian"))        keyword = "pacific";
    else if (v.includes("asian"))                                      keyword = "asian";
    else if (v.includes("indian")   || v.includes("alaska") ||
             v.includes("indigenous"))                                 keyword = "american indian";
    else return false;
  }

  for (const radio of radios) {
    const label = (getLabelText(radio) ?? "").toLowerCase();
    if (label.includes(keyword)) {
      if (!radio.checked) {
        radio.click();
        radio.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return true;
    }
  }
  return false;
}

// ─── Ashby Yes/No widget ─────────────────────────────────────────────────────

function fillAshbyYesNo(questionSignals, answerValue) {
  const norm = answerValue.toLowerCase().replace(/[-_\s]/g, "");
  const option = norm === "yes" ? "yes" : norm === "no" ? "no" : null;
  if (!option) return false;

  const containers = document.querySelectorAll(".ashby-application-form-input-yesno");
  for (const container of containers) {
    const fieldEntry = container.closest("[data-field-path]");
    const fieldPath = fieldEntry?.getAttribute("data-field-path");
    let questionText = null;

    if (fieldPath) {
      try {
        const label = document.querySelector(`label[for="${CSS.escape(fieldPath)}"]`);
        if (label) questionText = label.textContent.trim();
      } catch {}
    }
    if (!questionText) {
      const label = fieldEntry?.querySelector("label");
      if (label) questionText = label.textContent.trim();
    }
    if (!questionText) continue;

    const normalizedQ = questionText.toLowerCase().replace(/[-_\s]/g, "");
    const groupMatches = questionSignals.some(s => normalizedQ.includes(s.replace(/[-_\s]/g, "")));
    if (!groupMatches) continue;

    const btn = container.querySelector(`button[data-option="${option}"]`);
    if (!btn) continue;
    if (btn.getAttribute("aria-pressed") !== "true") btn.click();
    return true;
  }
  return false;
}

// ─── File input detection ────────────────────────────────────────────────────

function findResumeInput() {
  const fileInputs = document.querySelectorAll('input[type="file"]');
  for (const input of fileInputs) {
    if (matchesSignals(input, ["_systemfieldresume", "resume", "cv", "curriculumvitae", "uploadresume", "uploadcv"])) return input;
    const nearbyText = getNearbyText(input);
    if (nearbyText && ["resume", "cv"].some(s => nearbyText.includes(s))) return input;
  }
  if (fileInputs.length === 1) return fileInputs[0];
  return null;
}

function getNearbyText(input) {
  let el = input.parentElement;
  for (let i = 0; i < 4 && el; i++, el = el.parentElement) {
    const text = el.textContent?.toLowerCase().replace(/[-_\s]/g, "") ?? "";
    if (text) return text;
  }
  return null;
}

// ─── Input filling ───────────────────────────────────────────────────────────

function fillInput(input, value) {
  let proto = Object.getPrototypeOf(input);
  let nativeSetter = null;
  while (proto) {
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc?.set) { nativeSetter = desc.set; break; }
    proto = Object.getPrototypeOf(proto);
  }

  if (nativeSetter) {
    nativeSetter.call(input, value);
  } else {
    input.value = value;
  }

  input.dispatchEvent(new InputEvent("input",  { bubbles: true, data: value }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

async function fillFileInput(input, resume) {
  try {
    const bytes = atob(resume.base64);
    const arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    const file = new File([arr], resume.name, { type: resume.type || "application/pdf" });

    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new Event("input",  { bubbles: true }));
    return true;
  } catch {
    return false;
  }
}
