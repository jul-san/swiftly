// Greenhouse adapter. Covers both Greenhouse front ends:
//   • job-boards.greenhouse.io (current, React/Remix): stable ids
//     (#first_name, #email, #resume, #school--0, #question_<id>), React Select
//     comboboxes (classNamePrefix "select") for every dropdown, checkbox
//     fieldsets for multi-selects, intl-tel-input phone with a Country picker.
//   • boards.greenhouse.io (legacy) and its /embed/job_app iframe: native
//     inputs/selects named job_application[...] and education[...][N].
// Only structure lives here; wording is matched by the shared catalog.

(function () {
  const STANDARD_IDS = {
    first_name: "personal.firstName",
    last_name: "personal.lastName",
    preferred_name: "personal.preferredName",
    email: "personal.email",
    phone: "personal.phone",
    resume: "documents.resume",
    cover_letter: "documents.coverLetter",
    "candidate-location": "personal.location",
    location: "personal.location",
    gender: "eeo.gender",
    race: "eeo.race",
    hispanic_ethnicity: "eeo.hispanic",
    veteran_status: "eeo.veteran",
    disability_status: "eeo.disability",
  };

  // Repeatable blocks: "school--0", "start-year--1", "company-name-0",
  // legacy "education[school_name][0]" / "education_school_name_0".
  const SECTION_FIELDS = [
    [/^(school|education[_\[]school(_name)?)/, "education", "education.institution"],
    [/^(degree|education[_\[]degree)/, "education", "education.degree"],
    [/^(discipline|education[_\[]discipline)/, "education", "education.fieldOfStudy"],
    [/^(start-(month|year)|education[_\[]start)/, "education", "education.startDate"],
    [/^(end-(month|year)|education[_\[]end)/, "education", "education.endDate"],
    [/^(company-name|employment[_\[]company)/, "experience", "experience.company"],
    [/^(title|employment[_\[]title)-?/, "experience", "experience.title"],
    [/^(start-date-(month|year)|employment[_\[]start)/, "experience", "experience.startDate"],
    [/^(end-date-(month|year)|employment[_\[]end)/, "experience", "experience.endDate"],
    [/^(current-role|employment[_\[]current)/, "experience", "experience.current"],
  ];

  function ident(f) {
    return (f.idAttr || f.name || "").replace(/^job_application\[(.*)\]$/, "$1");
  }

  function sectionMatch(f) {
    const id = ident(f);
    const inEducation = f.element.closest(".education--container, .education, #education_section, [id*=education]");
    const inEmployment = f.element.closest(".employment--container, .employment, #employment_section, [id*=employment]");
    if (!inEducation && !inEmployment && !/--\d+$|\[\d+\]$|_\d+$|-\d+$/.test(id)) return null;
    for (const [re, kind, key] of SECTION_FIELDS) {
      if (!re.test(id)) continue;
      if (kind === "education" && inEmployment) continue;
      if (kind === "experience" && inEducation) continue;
      const m = id.match(/(?:--|-|_|\[)(\d+)\]?$/);
      return { kind, key, index: m ? parseInt(m[1], 10) : 0 };
    }
    // Unknown field inside a section still belongs to it (index by block order).
    if (inEducation || inEmployment) {
      const kind = inEducation ? "education" : "experience";
      const block = f.element.closest(`.${kind === "education" ? "education" : "employment"}--form`);
      const blocks = block ? [...block.parentElement.children].filter(c => c.classList.contains(block.classList[0])) : [];
      return { kind, key: null, index: block ? Math.max(0, blocks.indexOf(block)) : 0 };
    }
    return null;
  }

  const adapter = {
    id: "greenhouse",
    canHandle(loc, doc) {
      return !!doc.querySelector("#application-form, #application_form, form[action*='greenhouse']");
    },
    formRoot(doc) {
      return doc.querySelector("#application-form, #application_form, form.application--form") ?? doc.querySelector("form") ?? doc.body;
    },
    shouldSkipElement(el) {
      // intl-tel-input's own country search; the React Select "Country" is used instead.
      if (el.closest(".iti__dropdown-content, .iti__country-container")) return true;
      // "Enter manually" resume/cover-letter textareas.
      if (/^(resume_text|cover_letter_text)$/.test(el.id)) return true;
      return false;
    },
    hintFor(f) {
      const id = ident(f);
      if (id === "country" && f.element.closest(".phone-input, fieldset")) return "personal.country";
      if (STANDARD_IDS[id]) return STANDARD_IDS[id];
      const s = sectionMatch(f);
      return s?.key ?? null;
    },
    sectionOf(f) {
      const s = sectionMatch(f);
      return s ? { kind: s.kind, index: s.index } : null;
    },
    datePartOf(f) {
      const id = ident(f);
      if (/month/.test(id)) return "month";
      if (/year/.test(id)) return "year";
      return null;
    },
    resumeSettle: { quietMs: 600, maxMs: 4000 },
  };

  (globalThis.SWIFTLY_ADAPTERS || (globalThis.SWIFTLY_ADAPTERS = [])).push(adapter);
})();
