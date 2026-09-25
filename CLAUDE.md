# CLAUDE.md

## Product Overview

**Swiftly** is a Safari Web Extension plus companion Apple app that reduces repetitive work in job applications.

The MVP has two core capabilities:

1. A user uploads a resume once. Swiftly parses it into a structured applicant profile containing contact information, education, work experience, projects, and skills.
2. When the user opens a supported job application page in Safari, Swiftly detects application fields and, only after the user explicitly clicks an autofill action, fills fields for which it has reliable profile data.

The first supported ATS for the MVP is **Ashby**. Do not generalize to every ATS until the Ashby flow works end-to-end.

The MVP should prove this flow:

`Resume PDF -> extract text -> parse structured profile -> review/save profile -> open Ashby application -> detect fields -> user clicks Autofill -> populate supported fields`

Prioritize a small, reliable vertical slice over broad ATS coverage or sophisticated AI features.

## Example Resume and Target Data

The development resume used to define expected parsing behavior contains these major sections:

- Contact/profile information
- Education
- Experience
- Selected Projects
- Skills and Interests

The parser must be generic and must never hard-code the example applicant's values. The example is only a fixture for determining what kinds of information the data model must represent.

Real resumes may contain:

- name, email, phone, personal website, LinkedIn URL, GitHub URL
- multiple education entries, including planned/future education
- degree, field of study, institution, graduation date, GPA, awards, and details
- multiple jobs with company, title, location, date range, optional team/group information, and bullet points
- projects with name, URL/repository, technologies, and bullet points
- categorized skills such as languages, tools/technologies, frameworks/libraries, and other skills/interests

Preserve useful information rather than aggressively normalizing it away.

## MVP Scope

### In scope

- Safari Web Extension
- Companion app/onboarding UI
- PDF resume upload
- Local resume text extraction
- Structured resume parsing
- Structured applicant profile
- Profile review/edit UI before autofill
- Local persistence of the parsed profile
- Ashby application-page detection
- Detection and mapping of common application fields
- User-triggered autofill
- Filling high-confidence fields
- Clear reporting of fields Swiftly could not fill

### Out of scope for the first MVP

Do not implement these unless explicitly requested:

- Chrome or Firefox support
- automatic job discovery
- automatic application submission
- applying to jobs without user interaction
- mass application/bot behavior
- cover-letter generation
- automatically answering arbitrary free-response application questions
- Greenhouse, Lever, Workday, or other ATS integrations before Ashby works
- cloud accounts/authentication
- cloud resume storage
- payments/subscriptions
- analytics infrastructure
- backend services unless a local architecture genuinely cannot support a requirement

## Safety and Product Rules

Job applications can contain consequential information. Autofill must be transparent and user-controlled.

- Never submit an application automatically.
- Never click a final Submit/Apply button for the user.
- Never fabricate information missing from the resume/profile.
- Never infer sensitive demographic answers.
- Never guess answers for EEO, disability, veteran status, work authorization, sponsorship, salary, demographic, or similar questions.
- Such answers may only be filled if the user has explicitly stored an answer for that purpose.
- Treat unknown fields as unknown rather than guessing.
- Prefer leaving a field blank over inserting a low-confidence value.
- The user must initiate autofill with a click.
- The user must be able to inspect and change the parsed profile.
- Do not overwrite a non-empty application field unless explicitly requested.

## Existing Repository

The repository contains two Xcode targets:

- `Swiftly/` — companion Apple app
- `Swiftly Extension/` — Safari Web Extension

The generated project currently uses UIKit/WebKit for the companion app and a Manifest V3 Safari Web Extension.

Important extension components include:

- `background.js` — extension service worker/background logic
- `content.js` — page-level DOM interaction
- `popup.html` / `popup.js` — Safari toolbar popup
- `SafariWebExtensionHandler.swift` — native bridge between extension JavaScript and native Swift code

Keep the existing project buildable while incrementally replacing template behavior.

## Development Principles

- Build the simplest end-to-end implementation first.
- Prefer native Apple frameworks and browser APIs over dependencies.
- Do not introduce a dependency without explaining why it is necessary.
- Keep parsing, storage, DOM detection, field mapping, and DOM mutation as separate responsibilities.
- Favor small testable functions over large controllers/scripts.
- Do not silently change Xcode deployment targets, bundle identifiers, signing settings, entitlements, or capabilities.
- Do not commit, push, create branches, or modify remote Git configuration unless explicitly asked.
- Before large architectural changes, explain the proposed change and affected files.
- Avoid unrelated refactors while implementing a feature.
- After meaningful code changes, build the relevant Xcode target when tooling permits and report build errors rather than hiding them.

# Phase 1: Resume Parsing

Resume parsing is the first implementation milestone. Do not start Ashby autofill until a resume can reliably become a structured profile.

## Upload Flow

The intended onboarding experience is:

1. User launches Swiftly.
2. Swiftly explains that the resume will be parsed to create an autofill profile.
3. User chooses a PDF resume using the system file picker.
4. Swiftly extracts text from the PDF locally.
5. Swiftly parses the extracted text into `ApplicantProfile`.
6. Swiftly displays the parsed profile for review.
7. User can correct/add/remove values.
8. User explicitly saves the profile.
9. The profile becomes available to the Safari extension.

For the MVP, prefer local processing. A normal text-based PDF should not need to leave the device.

## PDF Extraction

Prefer Apple's `PDFKit` for text-based PDFs.

Keep extraction separate from semantic parsing:

`PDF URL -> ResumeTextExtractor -> String -> ResumeParser -> ApplicantProfile`

This separation allows later support for DOCX, pasted text, OCR, or alternate parsers without changing the profile model.

If a PDF contains little or no extractable text, return a clear parsing error. Do not add OCR to the MVP unless explicitly requested.

## Canonical Profile Model

Use a single canonical model shared conceptually by resume parsing and application autofill. Exact Swift syntax may evolve, but the domain model should approximately represent:

```text
ApplicantProfile
  personal
    fullName
    firstName
    middleName?
    lastName
    email?
    phone?
    location?
    website?
    linkedinURL?
    githubURL?

  education[]
    institution
    degree?
    fieldOfStudy?
    location?
    startDate?
    endDate?
    graduationDate?
    currentOrPlanned?
    gpa?
    awards[]
    details[]

  experience[]
    company
    title
    location?
    startDate?
    endDate?
    current
    teamsOrGroups[]
    bullets[]

  projects[]
    name
    url?
    technologies[]
    bullets[]

  skills
    languages[]
    tools[]
    frameworks[]
    other[]

  sourceMetadata
    originalFilename?
    parsedAt
    schemaVersion
```

Use `Codable` models so the profile can be serialized. Prefer typed structures over `[String: Any]` in native code.

Dates on resumes are often incomplete (`May 2027`, `Aug 2026 – Present`). Preserve useful original date strings instead of forcing every date into an exact day.

## Parsing Strategy

Start deterministic. Do not make an LLM/API a hard dependency for MVP parsing.

Suggested pipeline:

1. Normalize whitespace and line endings without destroying section boundaries.
2. Identify likely section headings.
3. Parse personal/contact data.
4. Parse education entries.
5. Parse experience entries.
6. Parse project entries.
7. Parse skills/categories.
8. Validate the result.
9. Present it to the user for correction.

Use heuristics that are understandable and testable, including:

- email recognition
- URL recognition
- phone recognition
- date/date-range patterns
- known section-heading variants
- bullet boundaries
- grouping lines between section headings

Do not build parsing logic around exact company names, universities, projects, or values from the sample resume.

## Parsing Confidence and Provenance

Where useful, internally distinguish values that were parsed confidently from ambiguous values. Parser output may include diagnostics such as:

```text
ParsedField<T>
  value
  confidence
  sourceText
```

The saved canonical profile should remain straightforward. Low-confidence values should be surfaced for review rather than silently treated as correct.

## Parser Validation

At minimum, validate that:

- a name was found
- duplicate entries are not accidentally created
- email and URLs are syntactically plausible when present
- empty experience/project entries are discarded
- a parsing failure is represented as an error/result rather than a crash

Parsing must tolerate missing sections. A resume without projects or skills is still valid.

# Storage

For the MVP, keep applicant data local.

Use a storage abstraction such as:

```text
ApplicantProfileStore
  loadProfile()
  saveProfile(profile)
  deleteProfile()
```

The rest of the app should depend on this abstraction rather than directly reading/writing `UserDefaults` throughout the codebase.

Because the Safari extension and containing app need access to the same profile, use an Apple-supported shared container mechanism such as an App Group where appropriate.

Keep the serialized profile versioned so schema changes can be migrated later.

Do not store the raw resume indefinitely unless there is a concrete product requirement. The structured profile is the important artifact.

# Phase 2: Ashby Autofill

After parsing/storage works, implement one ATS well: Ashby.

## Extension Flow

The intended interaction is:

1. User navigates to an Ashby-hosted application form.
2. `content.js` determines whether the page is a supported application page.
3. Swiftly inspects the DOM and identifies candidate form controls.
4. The extension obtains the saved applicant profile through the appropriate extension/native/shared-storage path.
5. The user clicks **Autofill with Swiftly**.
6. Swiftly maps supported DOM fields to canonical profile fields.
7. Swiftly fills only mappings with sufficient confidence.
8. Swiftly dispatches the appropriate DOM events so the site's framework recognizes changes.
9. Swiftly reports what it filled and what still needs attention.
10. The user reviews the application and submits it manually.

## DOM Field Representation

Do not scatter arbitrary selector logic throughout `content.js`.

Normalize discovered controls into a representation similar to:

```text
DetectedField
  element
  tagName
  inputType
  name
  id
  label
  placeholder
  autocomplete
  ariaLabel
  nearbyText
  required
  currentValue
```

Field detection and field filling should be separate operations.

## Field Mapping

Map page fields to semantic keys such as:

```text
personal.firstName
personal.lastName
personal.fullName
personal.email
personal.phone
personal.location
personal.linkedinURL
personal.githubURL
personal.website
education[0].institution
education[0].degree
education[0].fieldOfStudy
```

For the first Ashby iteration, focus on high-value, low-ambiguity fields:

- first name
- last name
- full name when applicable
- email
- phone
- location/address only when the profile contains appropriate data
- LinkedIn
- GitHub
- personal website

Do not try to solve every education/experience widget immediately. Once basic identity fields work reliably, add structured education and experience forms incrementally.

## Mapping Signals

Use multiple DOM signals rather than depending on a single CSS selector:

- associated `<label>` text
- `name`
- `id`
- `placeholder`
- `autocomplete`
- `aria-label`
- nearby descriptive text
- input type

Prefer semantic attributes over brittle generated class names.

Keep Ashby-specific detection/mapping isolated from generic mapping logic so another ATS can eventually implement the same conceptual interface.

A useful conceptual boundary is:

```text
ApplicationAdapter
  canHandle(page)
  detectFields(page)
  mapFields(detectedFields, profile)
  fill(mappedFields)
```

For the MVP there may only be `AshbyAdapter`, but additional ATS adapters should not require rewriting the profile/parser.

## DOM Mutation

Modern forms may use React or other controlled inputs. Setting `element.value` alone may not be sufficient.

When filling a field:

- preserve existing non-empty user input by default
- set the value using a method compatible with the control
- dispatch appropriate `input` and/or `change` events with bubbling when required
- handle selects separately from text inputs
- never trigger form submission

Do not simulate arbitrary user actions beyond what is necessary to populate the field.

# Suggested Module Boundaries

As the code grows, aim for responsibilities resembling:

```text
Swiftly/
  Models/
    ApplicantProfile.swift
  Resume/
    ResumeTextExtractor.swift
    ResumeParser.swift
    ResumeParsingResult.swift
  Storage/
    ApplicantProfileStore.swift
  UI/
    ResumeUpload...
    ProfileReview...

Swiftly Extension/
  Resources/
    content.js
    background.js
    popup.html
    popup.js
    autofill/
      fieldDetector.js
      fieldMapper.js
      fieldFiller.js
      ashbyAdapter.js
```

Do not reorganize the repository merely to match this tree. Introduce folders/files only as implementation requires them and ensure Xcode target membership remains correct.

# Testing Strategy

Parsing and mapping logic should be testable without manually running the entire extension every time.

## Resume Parser Tests

Create fixtures representing:

- the provided example resume
- resume with no projects
- resume with no skills section
- one-page minimal resume
- multiple education entries
- `Present` employment
- unusual but valid date formats
- missing email/website

Tests should assert structured results, not merely that parsing does not crash.

For the provided example fixture, expected high-level behavior includes:

- recognize the applicant name and contact links
- recognize multiple education entries separately
- recognize each work-experience organization separately
- keep each job's bullets associated with the correct job
- recognize separate projects rather than merging them
- categorize programming languages, tools/technologies, and frameworks/libraries

Fixture-specific expected values belong only in tests. Production parsing must remain generic.

## Autofill Tests

Keep sanitized/local HTML fixtures representing Ashby forms when practical.

Test that:

- labels map to expected canonical keys
- unrelated inputs are ignored
- existing values are preserved
- missing profile values do not produce fabricated values
- filling dispatches appropriate events
- no code path submits the form

# Error Handling

Represent expected failures clearly. Important cases include:

- unsupported file type
- PDF with no extractable text
- parser cannot identify enough information
- profile not yet created
- corrupted/outdated saved profile
- unsupported website
- Ashby page changed and expected fields cannot be detected
- application field has no confident mapping

Errors shown to users should explain what they can do next.

Developer logs may contain diagnostics but must not unnecessarily dump the user's entire resume/profile.

# Privacy

Treat resumes and applicant profiles as private user data.

- Prefer on-device parsing and storage for the MVP.
- Do not send resume contents to an external API unless a feature explicitly requires it and the user understands that behavior.
- Do not log complete resumes or complete applicant profiles in production.
- Request only Safari extension permissions necessary for the supported workflow.
- Avoid broad host permissions when narrower permissions can accomplish the MVP.

# MVP Milestones

Implement in this order unless explicitly directed otherwise.

## Milestone 1 — Data Model

Create the canonical `ApplicantProfile` model and representative test fixture.

## Milestone 2 — PDF Extraction

Allow a user/developer fixture PDF to be converted into normalized text with clear error handling.

## Milestone 3 — Resume Parser

Parse normalized text into the profile model and validate it against representative resumes.

## Milestone 4 — Profile Review and Persistence

Build the minimal UI needed to upload a resume, inspect/edit parsed information, and save it locally/shared with the extension.

## Milestone 5 — Ashby Detection

Recognize a supported Ashby application page and inspect its form fields without modifying them.

## Milestone 6 — Basic Autofill

Add the explicit Autofill action and fill high-confidence personal/contact fields.

## Milestone 7 — Structured Fields

Incrementally support education and experience fields after basic autofill is reliable.

## Milestone 8 — Hardening

Add fixtures/tests for parsing edge cases and Ashby DOM variations, improve diagnostics, and ensure no automatic submission is possible.

# Definition of MVP Done

The MVP is successful when a new user can:

1. install/run Swiftly,
2. upload a normal text-based PDF resume,
3. see a reasonably accurate structured profile,
4. correct parsing mistakes and save the profile,
5. open a supported Ashby application in Safari,
6. explicitly trigger Swiftly autofill,
7. see common supported fields populated correctly,
8. manually complete unsupported/ambiguous fields,
9. review the application,
10. submit it themselves.

The goal is not a universal autonomous job-application agent. The goal is a trustworthy resume-to-Ashby autofill workflow that establishes the architecture for future ATS support.

# When Implementing Tasks

When asked to implement a feature:

1. Inspect the relevant existing files before editing.
2. State the smallest implementation plan when the change spans multiple components.
3. Reuse the canonical profile model instead of creating parallel representations.
4. Keep platform-specific concerns behind clear boundaries.
5. Avoid unrelated cleanup/refactors.
6. Add or update tests for deterministic parsing/mapping logic when feasible.
7. Build/check the affected target after changes when possible.
8. Report exactly what changed, what was tested, and any remaining limitations.

When requirements are ambiguous, prefer behavior that is safer, more local/private, easier to test, and narrower in MVP scope.
