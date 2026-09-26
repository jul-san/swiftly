// Ashby adapter (jobs.ashbyhq.com and embedded Ashby forms).
//
// Ashby structure: each question is a field entry
// (.ashby-application-form-field-entry, carrying data-field-path) whose title
// is a <label class="ashby-application-form-question-title" for=path>. System
// fields have stable paths (_systemfield_name, _systemfield_email,
// _systemfield_resume, _systemfield_location, _systemfield_eeoc_*); custom
// questions use generated ids. Booleans render as a Yes/No button pair,
// single selects as radios or a combobox, multi-selects as checkboxes, and
// Location as a typeahead combobox. A separate "Autofill from resume" upload
// sits above the form and must never be mistaken for the resume field.

(function () {
  const SYSTEM_FIELDS = {
    _systemfield_name: "personal.fullName",
    _systemfield_email: "personal.email",
    _systemfield_phone: "personal.phone",
    _systemfield_resume: "documents.resume",
    _systemfield_cover_letter: "documents.coverLetter",
    _systemfield_location: "personal.location",
    _systemfield_linkedin: "personal.linkedinURL",
    _systemfield_github: "personal.githubURL",
    _systemfield_website: "personal.website",
    _systemfield_eeoc_gender: "eeo.gender",
    _systemfield_eeoc_race: "eeo.race",
    _systemfield_eeoc_veteran_status: "eeo.veteran",
    _systemfield_eeoc_disability_status: "eeo.disability",
  };

  const ENTRY = ".ashby-application-form-field-entry, [data-field-path], [class*='_fieldEntry']";

  function entryOf(el) {
    return el.closest(ENTRY);
  }

  function entryTitle(entry) {
    if (!entry) return "";
    const t = entry.querySelector(".ashby-application-form-question-title, label, [class*='question-title'], legend");
    return t ? swiftlyText(t) : "";
  }

  function pathOf(f) {
    const entry = entryOf(f.element);
    return entry?.getAttribute("data-field-path") || f.name || f.idAttr || "";
  }

  const adapter = {
    id: "ashby",
    canHandle(loc, doc) {
      return !!doc.querySelector(".ashby-application-form-container, .ashby-application-form-field-entry, [id^='_systemfield_']");
    },
    formRoot(doc) {
      return doc.querySelector(".ashby-application-form-container, form") ?? doc.body;
    },
    shouldSkipElement(el) {
      // The "Autofill from resume" uploader is a separate parser, not the resume answer.
      return !!el.closest(".ashby-application-form-autofill-input-root, [class*='autofill-input'], [class*='AutofillInput']");
    },
    labelFor(el) {
      const entry = entryOf(el);
      if (!entry) return null;
      // Only use the entry title when the entry holds a single question control.
      const controls = entry.querySelectorAll("input:not([type=hidden]):not([type=radio]):not([type=checkbox]), textarea, select");
      return controls.length <= 1 ? entryTitle(entry) || null : null;
    },
    groupLabelFor(members) {
      const entry = entryOf(members[0]);
      return entry && members.every(m => entry.contains(m)) ? entryTitle(entry) || null : null;
    },
    // Yes/No boolean widget: two buttons inside a field entry.
    detectCustomFields(root) {
      const out = [];
      for (const entry of root.querySelectorAll(ENTRY)) {
        const yesno = entry.querySelector(".ashby-application-form-input-yesno, [class*='yesno'], [class*='YesNo']") ?? entry;
        const buttons = [...yesno.querySelectorAll("button")].filter(b => /^(yes|no)$/i.test(swiftlyText(b)) || b.hasAttribute("data-option"));
        if (buttons.length < 2 || entry.querySelector("input[type=radio], input[type=checkbox]")) continue;
        const pressed = buttons.find(b => b.getAttribute("aria-pressed") === "true" || /\b(active|selected|_active)/.test(b.className));
        out.push({
          kind: "buttonGroup",
          element: buttons[0],
          members: buttons,
          options: buttons.map(b => ({ element: b, text: swiftlyText(b) || b.getAttribute("data-option") })),
          tagName: "button",
          inputType: "yesno",
          name: entry.getAttribute("data-field-path") || "",
          idAttr: "",
          automationId: "",
          ariaLabel: "",
          placeholder: "",
          autocomplete: "",
          label: cleanLabel(entryTitle(entry)),
          nearbyText: "",
          required: !!entry.querySelector("[class*='required']") || /\*\s*$/.test(entryTitle(entry)),
          currentValue: pressed ? swiftlyText(pressed) : "",
          isEmpty: !pressed,
        });
      }
      return out;
    },
    hintFor(f) {
      const path = pathOf(f);
      for (const [prefix, key] of Object.entries(SYSTEM_FIELDS)) {
        if (path === prefix || f.idAttr === prefix || f.name === prefix || (f.name || "").startsWith(prefix)) return key;
      }
      return null;
    },
    interactionDelayMs: 120, // Ashby re-renders between clicks
    resumeSettle: { quietMs: 800, maxMs: 5000 },
  };

  (globalThis.SWIFTLY_ADAPTERS || (globalThis.SWIFTLY_ADAPTERS = [])).push(adapter);
})();
