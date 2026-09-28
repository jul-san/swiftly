// Workday adapter (<tenant>.wdN.myworkdayjobs.com / myworkdaysite.com).
//
// Workday applications happen after the candidate signs in, as a multi-step
// flow ("My Information", "My Experience", "Application Questions",
// "Voluntary Disclosures", "Self Identify", "Review"). Swiftly fills the step
// that is on screen when the user clicks Autofill and can be run again on
// each later step; it never clicks Next/Submit and never touches the
// sign-in / create-account pages.
//
// Workday tenants run two DOM generations:
//   • data-automation-id on inputs/containers (legalNameSection_firstName,
//     addressSection_city, formField-*, dateSectionMonth-input, …)
//   • semantic ids "section--field" with <label for> (name--legalName--firstName,
//     address--city, workExperience-3--jobTitle, education-1--school, …)
// Dropdowns are button[aria-haspopup=listbox] opening a document-level
// listbox; searchable prompts (source, school, field of study, skills) are
// multiSelectContainer widgets that search on Enter.

(function () {
  // Tokens found in data-automation-id / id / name → canonical key.
  const HINTS = [
    [/legalName(Section)?[_-]+firstName|^firstName$/i, "personal.firstName"],
    [/legalName(Section)?[_-]+lastName|^lastName$/i, "personal.lastName"],
    [/legalName(Section)?[_-]+middleName/i, "personal.middleName"],
    [/(^|[-_])email(Address)?$/i, "personal.email"],
    [/phone-number$|phoneNumber--phoneNumber$|^phoneNumber$/i, "personal.phone"],
    [/address(Section)?[_-]+addressLine1$/i, "personal.addressLine1"],
    [/address(Section)?[_-]+city$/i, "personal.city"],
    [/address(Section)?[_-]+postalCode$/i, "personal.postalCode"],
    [/address(Section)?[_-]+countryRegion$/i, "personal.state"],
    [/^countryDropdown$|^country--country$|address(Section)?[_-]+country$/i, "personal.country"],
    [/^source--source$|^sourceDropdown$|formField-source(Prompt)?$/i, "preferences.referralSource"],
    [/linkedinQuestion|linkedInAccount/i, "personal.linkedinURL"],
    [/file-upload-input-ref|resumeAttachments/i, "documents.resume"],
    [/--jobTitle$|^jobTitle$/i, "experience.title"],
    [/--companyName$|^companyName$|^company$/i, "experience.company"],
    [/workExperience-\d+--location$|^location$/i, "experience.location"],
    [/--currentlyWorkHere$|^currentlyWorkHere$/i, "experience.current"],
    [/--roleDescription$|^description$/i, "experience.description"],
    [/workExperience-\d+--startDate|^startDate/i, "experience.startDate"],
    [/workExperience-\d+--endDate|^endDate/i, "experience.endDate"],
    [/--school(Name)?$|^school$|schoolItem/i, "education.institution"],
    [/education-\d+--degree$|^degree$/i, "education.degree"],
    [/--fieldOfStudy$|field-of-study|^fieldOfStudy$/i, "education.fieldOfStudy"],
    [/--gradeAverage$|^gpa$/i, "education.gpa"],
    [/firstYearAttended/i, "education.startDate"],
    [/lastYearAttended/i, "education.endDate"],
  ];

  const SKIP = /phone-device-type|phoneType|countryPhoneCode|phone-code|preferredCheck|preferredName--|password|verifyPassword|createAccountCheckbox/i;

  function identifiers(el) {
    const auto = el.getAttribute("data-automation-id") || "";
    const container = el.closest("[data-automation-id^='formField-']")?.getAttribute("data-automation-id") || "";
    return [el.id || "", auto, el.getAttribute("name") || "", container].filter(Boolean);
  }

  function sectionInfo(el) {
    const ids = identifiers(el).join(" ");
    let m = ids.match(/\b(workExperience|education)-(\d+)--/);
    let kind = m?.[1];
    if (!kind) {
      const block = el.closest("[data-automation-id^='workExperience-'], [data-automation-id^='education-']");
      if (block) kind = block.getAttribute("data-automation-id").split("-")[0];
    }
    if (!kind) return null;
    const doc = el.ownerDocument;
    // Workday's numbers are internal; index blocks by on-page order instead.
    const blockIds = [];
    for (const node of doc.querySelectorAll(`[id^='${kind}-'], [data-automation-id^='${kind}-']`)) {
      const key = ((node.id || node.getAttribute("data-automation-id")).match(new RegExp(`^${kind}-(\\d+)`)) ?? [])[1];
      if (key != null && !blockIds.includes(key)) blockIds.push(key);
    }
    const own = (ids.match(new RegExp(`${kind}-(\\d+)`)) ?? [])[1];
    const index = own != null ? blockIds.indexOf(own) : 0;
    return { kind: kind === "workExperience" ? "experience" : "education", index: Math.max(0, index) };
  }

  function stepName(doc) {
    const active = doc.querySelector("[data-automation-id='progressBarActiveStep']");
    if (active) return swiftlyText(active.lastElementChild ?? active).replace(/^current step \d+ of \d+\s*/i, "");
    return swiftlyText(doc.querySelector("[data-automation-id='applyFlowPage'] h2, main h2")) || null;
  }

  function isSelfIdentifyStep(doc) {
    return /self[- ]?identif/i.test(stepName(doc) ?? "") || !!doc.querySelector("[data-automation-id*='selfIdentifiedDisability']");
  }

  const adapter = {
    id: "workday",
    canHandle(loc, doc) {
      return !!doc.querySelector("[data-automation-id='applyFlowPage'], [data-automation-id^='legalNameSection'], [data-automation-id='progressBar']");
    },
    blockedReason(doc) {
      const visible = (sel) => [...doc.querySelectorAll(sel)].some(swiftlyIsRendered);
      if (visible("input[type=password], [data-automation-id='signInSubmitButton'], [data-automation-id='createAccountSubmitButton'], [data-automation-id='signInContent'], [data-automation-id='createAccountContent']")) {
        return "Sign in to Workday first. Swiftly fills the application once you're on a form step.";
      }
      if (visible("[data-automation-id='applyManually'], [data-automation-id='autofillWithResume']") && !visible("input:not([type=hidden]):not([type=file])")) {
        return "Choose how to apply (for example, Apply Manually), then run Swiftly on the form.";
      }
      return null;
    },
    formRoot(doc) {
      return doc.querySelector("[data-automation-id='applyFlowPage']") ?? doc.querySelector("main") ?? doc.body;
    },
    stepName,
    shouldSkipElement(el) {
      if (identifiers(el).some(i => SKIP.test(i))) return true;
      // Self-identification forms ask for a name + date as a signature.
      if (isSelfIdentifyStep(el.ownerDocument) && el.tagName === "INPUT" && !/^(checkbox|radio)$/.test(el.type)) return true;
      return false;
    },
    labelFor(el) {
      if (el.labels?.length || el.getAttribute("aria-labelledby")) return null; // generic handling is exact here
      const container = el.closest("[data-automation-id^='formField-']");
      const label = container?.querySelector("label, legend");
      if (label) return swiftlyText(label);
      return null;
    },
    detectCustomFields(root) {
      const out = [];
      for (const box of root.querySelectorAll("[data-automation-id='multiSelectContainer']")) {
        const input = box.querySelector("input[data-automation-id='searchBox'], input");
        if (!input || !swiftlyIsRendered(input)) continue;
        const container = box.closest("[data-automation-id^='formField-']") ?? box.parentElement;
        const selected = [...(container?.querySelectorAll("[data-automation-id='selectedItem']") ?? [])].map(s => swiftlyText(s)).filter(Boolean);
        const labelEl = input.labels?.[0] ?? container?.querySelector("label, legend");
        out.push(customField({
          kind: "combobox", widget: "workdayPrompt", element: input, searchInput: input, members: [input],
          inputType: "combobox", name: input.name || "", idAttr: input.id || "",
          automationId: container?.getAttribute("data-automation-id") || "", ariaLabel: input.getAttribute("aria-label") || "",
          placeholder: input.getAttribute("placeholder") || "",
          label: cleanLabel(swiftlyText(labelEl)),
          required: input.getAttribute("aria-required") === "true" || /\*/.test(labelEl?.textContent ?? ""),
          currentValue: selected.join(", "), isEmpty: !selected.length,
        }));
      }
      return out;
    },
    hintFor(f) {
      for (const id of identifiers(f.element).concat(f.automationId || [])) {
        for (const [re, key] of HINTS) if (re.test(id)) return key;
      }
      return null;
    },
    sectionOf(f) {
      return sectionInfo(f.element);
    },
    datePartOf(f) {
      const ids = identifiers(f.element).join(" ") + " " + (f.ariaLabel || "");
      if (/dateSectionMonth|\bMonth\b/.test(ids)) return "month";
      if (/dateSectionYear|\bYear\b|YearAttended/.test(ids)) return "year";
      if (/dateSectionDay|\bDay\b/.test(ids)) return "day";
      return null;
    },
    // Creates empty Work Experience / Education blocks so there is somewhere
    // to put profile entries. Only "Add" buttons of those sections are used.
    async prepare({ doc, profile, log }) {
      const wanted = { experience: Math.min((profile?.experience ?? []).length, 5), education: Math.min((profile?.education ?? []).length, 5) };
      for (const [kind, prefix, labelRe] of [["experience", "workExperience", /work experience/i], ["education", "education", /^(add )?education$/i]]) {
        for (let guard = 0; guard < 6; guard++) {
          const existing = new Set([...doc.querySelectorAll(`[id^='${prefix}-'], [data-automation-id^='${prefix}-']`)]
            .map(n => ((n.id || n.getAttribute("data-automation-id")).match(new RegExp(`^${prefix}-(\\d+)`)) ?? [])[1]).filter(Boolean));
          if (existing.size >= wanted[kind]) break;
          const addButton = [...doc.querySelectorAll("button")].find(b => {
            if (!swiftlyIsRendered(b)) return false;
            const aria = b.getAttribute("aria-label") || "";
            if (/^add\b/i.test(aria) && labelRe.test(aria.replace(/^add\s*/i, ""))) return true;
            if (!/^add( another)?$/i.test(swiftlyText(b))) return false;
            const group = b.closest("[role=group], section, fieldset, [data-automation-id]");
            const heading = group?.querySelector("h2, h3, h4, legend, [role=heading]");
            return heading ? labelRe.test(swiftlyText(heading)) : false;
          });
          if (!addButton) break;
          log(`Workday: adding a ${kind} block`);
          realisticClick(addButton);
          await swiftlySleep(500);
        }
      }
    },
    interactionDelayMs: 250, // Workday re-renders and validates on blur
    settle: { quietMs: 500, maxMs: 3000 },
    resumeSettle: { quietMs: 1000, maxMs: 8000 },
  };

  registerSwiftlyAdapter(adapter);
})();
