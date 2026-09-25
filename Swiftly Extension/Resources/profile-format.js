// Pure formatting helpers shared by the Info page. Kept separate from DOM code
// in profile-ui.js so it stays trivially testable.

export function formatDateRange(start, end, current) {
  const s = (start || "").trim();
  const e = current ? "Present" : (end || "").trim();
  if (s && e) return `${s} – ${e}`;
  return s || e || "";
}

// ─── Missing-field counting (accordion header indicator) ──────────────────
//
// Only counts user-editable text inputs and bullet textareas — never
// checkboxes, selects, or chip lists — per the accordion counter's scope.

function isBlank(value) {
  return (value ?? "").toString().trim() === "";
}

function isBlankBullets(bullets) {
  return !(bullets ?? []).some((b) => !isBlank(b));
}

export function countMissingPersonalFields(personal) {
  return [
    personal?.fullName,
    personal?.email,
    personal?.phone,
    personal?.location,
    personal?.linkedinURL,
    personal?.githubURL,
    personal?.website,
  ].filter(isBlank).length;
}

export function countMissingEducationFields(education) {
  return (education ?? []).reduce((sum, e) => sum + [
    e.institution, e.degree, e.fieldOfStudy, e.location,
    e.startDate, e.graduationDate ?? e.endDate, e.gpa,
  ].filter(isBlank).length, 0);
}

export function countMissingExperienceFields(experience) {
  return (experience ?? []).reduce((sum, e) => sum
    + [e.title, e.company, e.location, e.startDate, e.endDate].filter(isBlank).length
    + (isBlankBullets(e.bullets) ? 1 : 0), 0);
}

export function countMissingProjectFields(projects) {
  return (projects ?? []).reduce((sum, p) => sum
    + [p.name, p.url].filter(isBlank).length
    + (isBlankBullets(p.bullets) ? 1 : 0), 0);
}

export function formatMissingFieldsLabel(count) {
  if (count === 0) return "Complete";
  return `${count} field${count === 1 ? "" : "s"} missing`;
}
