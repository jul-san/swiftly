# Autofill: research notes and architecture

Internal summary of how Greenhouse, Ashby, Gem and Workday forms are built and
how Swiftly's autofill engine handles them. Written September 2026.

## What the forms look like

**Research sources.** Five Greenhouse postings (Together AI, DV Trading,
Figma, Robinhood and Anthropic's board) were read through the public boards
API, which gives exact labels, field names, types and options. A saved copy
of the live DV Trading form showed the DOM. For Ashby and Workday, public
documentation and open-source autofill projects supplied the DOM
conventions. Gem's form renders in JavaScript and publishes no form schema.
This session's network could not open the live job sites, so Ashby, Gem and
Workday are not yet verified against a saved live page.
Workday's My Information and My Experience steps were checked against saved
live pages in late September 2026 (`tests/fixtures/workday-myinfo-snapshot.html`,
`workday-myexp-snapshot.html`); its other steps are still unverified.

| | Greenhouse (job-boards) | Ashby | Gem | Workday |
|---|---|---|---|---|
| Stable ids | `first_name`, `last_name`, `preferred_name`, `email`, `phone`, `resume`, `cover_letter`, `candidate-location`, `school--N`, `degree--N`, `discipline--N`, `start-month--N`, `end-year--N`, `gender`, `race`, `hispanic_ethnicity`, `veteran_status`, `disability_status`; custom questions are `question_<id>` | `_systemfield_name/email/resume/location/eeoc_*`; custom questions use UUIDs | none | `data-automation-id` (older tenants) or `section--field` ids such as `name--legalName--firstName` and `workExperience-3--jobTitle` |
| Labels | `<label for>` plus `aria-labelledby`; a `*` span marks required fields | `.ashby-application-form-question-title` in a field entry | `<label for>` / legends | `<label for>` or the label inside the `formField-*` container |
| Required | `aria-required="true"` | `required` / title class | `*` / `required` | `aria-required` / `<abbr>*</abbr>` |
| Dropdowns | **React Select** comboboxes (classNamePrefix `select`) for every single-select, including yes/no, EEOC, school and months | radios for short lists, combobox for long ones | ARIA combobox + listbox | `button[aria-haspopup=listbox]` opening a body-level listbox; searchable prompts that search on Enter |
| Multi-select | `fieldset.checkbox` + legend | checkboxes | checkboxes | multiselect prompts |
| Booleans | a single-select with two options, often long ("Yes, I am currently…") | Yes/No button pair | Yes/No toggle buttons | dropdown or radio |
| Location | async React Select typeahead with hidden lat/long | typeahead combobox | text | address fields |
| Resume | hidden `input#resume` inside `role=group aria-labelledby` | `_systemfield_resume`, plus a separate "Autofill from resume" upload | file input | `file-upload-input-ref` on the My Experience step |
| Flow | one page; the embed version lives in an iframe on company sites | one page, with conditional questions | one page | sign-in, then a multi-step flow; Next is never pressed |

**Wording varies between employers for the same question**:
- Authorization: "legally authorized to work in the country where the job is located", "legally work authorized to work in the US", "authorized for any employer / not authorized / authorized for current employer only".
- Sponsorship: plain yes/no; three options (now, future, no); "No sponsorship needed / Sponsorship required".
- Graduation: exact month and year, or range options ("May - Aug 2027", "Jan 2028 or later").
- Attestations and screening questions that Swiftly must not answer: privacy-policy consent, previous employment, conflicts of interest, government-official affiliation, non-compete, age.

## Engine

```
content.js → engine.runAutofill
  detector.detectFields   DOM → DetectedField (label, ids, kind, options, section, date part, required, value)
  catalog.classifyField   signals → { key, confidence } | blocked
  catalog.resolveAnswer   profile → answer (text | boolean | degree | date | category), never invented
  matching.chooseOption   answer + option texts → one confident option, or none
  filler.*                native setter + events; React Select / ARIA / Workday listboxes; radios; buttons; files
  adapters/*              ATS structure only: form root, id hints, sections, custom widgets, skip rules
```

- **Confidence.** Each field is scored from its ATS id hint (0.97), autocomplete (0.95), label (0.9), aria-label, name/id tokens (0.82), placeholder and nearby text. Agreeing signals add a little. A competing key within 0.08 knocks the score down by 0.3. Swiftly fills at 0.80 or above, and at 0.85 or above for eligibility and EEO questions.
- **Options.** Yes/no options are read by polarity (yes, no or decline). If two options share the polarity Swiftly wants, the question counts as ambiguous and is skipped. Degrees are compared by level and then by type (science or arts). Dates can match month names, numbers or range options. Locations have to match both city and state.
- **Dynamic forms.** After a pass that filled anything, Swiftly waits for the DOM to settle and scans again. Only controls it hasn't seen before are processed, and it stops after 5 passes or once a pass fills nothing.
- **Logs** (`console.debug`, prefixed `[Swiftly]`): each field's label, control type, mapped key, confidence, action and reason. Values are never logged.

## What Swiftly deliberately leaves for the user

- Attestations, consents and signatures (terms, privacy, "I certify", GDPR).
- Employer-specific screening: previously worked here, non-compete, clearance, government official, relatives, referrer name, age.
- Demographic questions with no profile field: sexual orientation, transgender, date of birth, citizenship, "veteran or active member".
- EEO gender, race, veteran and disability questions, unless the profile holds an explicit answer. A single-choice race question with several stored races only picks "Two or more". Hispanic is answered only when the user listed it.
- Eligibility questions about a country other than the US.
- Essays, "if yes/other, please specify" follow-ups, years of experience, work-arrangement preference, cover letters, and any question whose options don't match unambiguously.
- Anything that already has a value.

## Testing

`npm install && npm test` runs pure unit tests (matching, catalog) and headless-Chromium DOM tests. The DOM tests serve fixtures under real ATS hostnames and inject content scripts in manifest order. The Greenhouse fixture runs real React and React Select. `greenhouse-snapshot.html` is the real job-boards markup with the employer name removed. `workday-myinfo-snapshot.html` is the real Workday My Information markup, with an emulation script for its listbox popups and prompts. On macOS, run `npx playwright install chromium` once first.
