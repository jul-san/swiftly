// DOM rendering for the Info/Profile accordion. Pure formatting logic lives in
// profile-format.js; this file only builds/updates elements and wires events.

import { bulletsToText, textToBullets } from "./profile-format.js";

function el(tag, className, children) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const child of children ?? []) {
    if (child == null) continue;
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random()}`;
}

// ─── Field copy button (compact, icon-only) ───────────────────────────────

export function createCopyButton(getText) {
  const btn = el("button", "field-copy-btn", ["⧉"]);
  btn.type = "button";
  btn.title = "Copy";
  btn.addEventListener("click", async (e) => {
    e.stopPropagation();
    e.preventDefault();
    const text = getText();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return;
    }
    btn.textContent = "✓";
    btn.classList.add("copy-btn-done");
    setTimeout(() => {
      btn.textContent = "⧉";
      btn.classList.remove("copy-btn-done");
    }, 1100);
  });
  return btn;
}

// ─── Accordion ────────────────────────────────────────────────────────────

export function createAccordion({ title, defaultOpen = false }) {
  const section = el("section", "accordion");

  const countEl = el("span", "accordion-count");
  const titleGroup = el("span", "accordion-title-group", [
    el("span", "accordion-title", [title]),
    countEl,
  ]);
  const toggle = el("button", "accordion-toggle", [
    titleGroup,
    el("span", "accordion-chevron"),
  ]);
  toggle.type = "button";
  toggle.setAttribute("aria-expanded", String(defaultOpen));

  const header = el("div", "accordion-header", [toggle]);

  const bodyWrap = el("div", "accordion-body-wrap");
  const body = el("div", "accordion-body");
  bodyWrap.append(body);
  section.append(header, bodyWrap);

  function setExpanded(open) {
    section.classList.toggle("expanded", open);
    toggle.setAttribute("aria-expanded", String(open));
  }

  function setCount(text, { complete = false } = {}) {
    countEl.textContent = text ?? "";
    countEl.classList.toggle("accordion-count-complete", complete);
  }

  toggle.addEventListener("click", () => setExpanded(!section.classList.contains("expanded")));
  setExpanded(defaultOpen);

  return { section, body, setExpanded, setCount };
}

// ─── Labeled field helpers ────────────────────────────────────────────────

export function selectField({ label, value, options, onChange }) {
  const wrap = el("label", "mini-field");
  wrap.append(el("span", "mini-field-label", [label]));
  const select = el("select", "field-select");
  for (const [optValue, optLabel] of options) {
    const opt = el("option", null, [optLabel]);
    opt.value = optValue;
    if ((value ?? "") === optValue) opt.selected = true;
    select.append(opt);
  }
  select.addEventListener("change", () => onChange(select.value));
  wrap.append(select);
  return wrap;
}

export function raceCheckboxGroup(options, selectedCsv, onChange) {
  const selected = new Set((selectedCsv || "").split(",").map(s => s.trim()).filter(Boolean));
  const wrap = el("div", "checkbox-group");
  for (const value of options) {
    const label = el("label", "checkbox-option");
    const input = el("input");
    input.type = "checkbox";
    input.checked = selected.has(value);
    input.addEventListener("change", () => {
      if (input.checked) selected.add(value); else selected.delete(value);
      onChange([...selected].join(", "));
    });
    label.append(input, el("span", null, [value]));
    wrap.append(label);
  }
  return wrap;
}

export function labeledInput({ label, value, placeholder, type = "text", onInput }) {
  const wrap = el("label", "mini-field");
  const input = el("input", "field-input");
  input.type = type;
  input.value = value ?? "";
  if (placeholder) input.placeholder = placeholder;
  input.addEventListener("input", () => onInput(input.value));

  const head = el("div", "mini-field-head", [
    el("span", "mini-field-label", [label]),
    createCopyButton(() => input.value),
  ]);

  wrap.append(head, input);
  return wrap;
}

export function checkboxField({ label, checked, onChange }) {
  const wrap = el("label", "inline-checkbox");
  const input = el("input");
  input.type = "checkbox";
  input.checked = !!checked;
  input.addEventListener("change", () => onChange(input.checked));
  wrap.append(input, el("span", null, [label]));
  return wrap;
}

// ─── Bullets textarea (one field, one line per bullet) ────────────────────

export function createBulletsTextarea(bullets, onChange) {
  const wrap = el("label", "mini-field");

  const textarea = el("textarea", "field-input bullets-textarea");
  textarea.placeholder = "• Built a multi-threaded Rust server to process incoming JSON\n• Developed a TCP/IP processing service…";
  textarea.rows = 4;
  textarea.value = bulletsToText(bullets);
  textarea.addEventListener("input", () => onChange(textToBullets(textarea.value)));
  // Enter starts the next line with its own bullet marker.
  textarea.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    textarea.setRangeText("\n• ", textarea.selectionStart, textarea.selectionEnd, "end");
    textarea.dispatchEvent(new Event("input"));
  });

  const head = el("div", "mini-field-head", [
    el("span", "mini-field-label", ["Bullet points"]),
    createCopyButton(() => textarea.value),
  ]);

  wrap.append(head, textarea);
  return wrap;
}

// ─── Chip list (skills categories) ────────────────────────────────────────

export function createChipList(items, placeholder, onChange) {
  const list = [...(items ?? [])];
  const wrap = el("div", "chip-list");

  function emit() { onChange(list); }

  function render() {
    wrap.innerHTML = "";
    const chips = el("div", "chip-row");
    list.forEach((text, i) => {
      const chip = el("span", "chip", [text]);
      const x = el("button", "chip-remove", ["✕"]);
      x.type = "button";
      x.addEventListener("click", () => { list.splice(i, 1); render(); emit(); });
      chip.append(x);
      chips.append(chip);
    });
    wrap.append(chips);

    const input = el("input", "field-input chip-input");
    input.type = "text";
    input.placeholder = placeholder;
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === ",") {
        e.preventDefault();
        const v = input.value.trim();
        if (v) { list.push(v); input.value = ""; render(); emit(); }
      }
    });
    input.addEventListener("blur", () => {
      const v = input.value.trim();
      if (v) { list.push(v); input.value = ""; render(); emit(); }
    });
    wrap.append(input);
  }

  render();
  return wrap;
}

// ─── Personal information ─────────────────────────────────────────────────

export function renderPersonalFields(personal, onPatch) {
  const wrap = el("div", "section-fields");
  wrap.append(
    labeledInput({
      label: "Full name", value: personal.fullName, placeholder: "Jordan Lee",
      onInput: (v) => onPatch({ fullName: v }),
    }),
    labeledInput({
      label: "Preferred first name", value: personal.preferredName, placeholder: "Optional",
      onInput: (v) => onPatch({ preferredName: v || null }),
    }),
    labeledInput({
      label: "Email", value: personal.email, placeholder: "jordan@email.com", type: "email",
      onInput: (v) => onPatch({ email: v }),
    }),
    labeledInput({
      label: "Phone", value: personal.phone, placeholder: "(555) 123-4567", type: "tel",
      onInput: (v) => onPatch({ phone: v }),
    }),
    labeledInput({
      label: "Location", value: personal.location, placeholder: "San Francisco, CA",
      onInput: (v) => onPatch({ location: v }),
    }),
    labeledInput({
      label: "LinkedIn", value: personal.linkedinURL, placeholder: "linkedin.com/in/…", type: "url",
      onInput: (v) => onPatch({ linkedinURL: v }),
    }),
    labeledInput({
      label: "GitHub", value: personal.githubURL, placeholder: "github.com/…", type: "url",
      onInput: (v) => onPatch({ githubURL: v }),
    }),
    labeledInput({
      label: "Portfolio / website", value: personal.website, placeholder: "yoursite.dev", type: "url",
      onInput: (v) => onPatch({ website: v }),
    }),
  );
  return wrap;
}

// ─── Generic repeatable section (education / experience / projects) ──────

export function renderRepeatableList({
  items, createEntry, summary, renderFields, addLabel, emptyHint, onChange,
}) {
  const list = [...(items ?? [])];
  const wrap = el("div", "entry-list");

  function emit() { onChange(list); }

  function render() {
    wrap.innerHTML = "";

    if (list.length === 0) {
      wrap.append(el("p", "hint entry-empty-hint", [emptyHint]));
    }

    list.forEach((entry, i) => {
      const card = el("div", "entry-card");
      const { title, subtitle, meta } = summary(entry);

      const head = el("div", "entry-card-head");
      const summaryText = el("div", "entry-card-summary", [
        el("div", "entry-card-title", [title || "Untitled"]),
        subtitle ? el("div", "entry-card-subtitle", [subtitle]) : null,
        meta ? el("div", "entry-card-meta", [meta]) : null,
      ]);
      const headControls = el("span", "entry-card-controls", [
        el("span", "accordion-chevron entry-chevron"),
      ]);
      head.append(summaryText, headControls);

      const bodyWrap = el("div", "accordion-body-wrap");
      const body = el("div", "accordion-body entry-card-body");
      bodyWrap.append(body);

      function patchEntry(patch) {
        Object.assign(entry, patch);
        const s = summary(entry);
        summaryText.querySelector(".entry-card-title").textContent = s.title || "Untitled";
        emit();
      }

      body.append(renderFields(entry, patchEntry));

      const footer = el("div", "entry-card-footer");
      const del = el("button", "btn-delete-entry", ["Delete"]);
      del.type = "button";
      del.addEventListener("click", () => {
        list.splice(i, 1);
        render();
        emit();
      });
      footer.append(del);
      body.append(footer);

      card.append(head, bodyWrap);
      card.addEventListener("click", (e) => {
        if (e.target.closest(".accordion-body-wrap") || e.target.closest(".field-copy-btn")) return;
        card.classList.toggle("expanded");
      });
      wrap.append(card);
    });

    const addBtn = el("button", "btn-add-entry", [addLabel]);
    addBtn.type = "button";
    addBtn.addEventListener("click", () => {
      const entry = createEntry();
      list.push(entry);
      render();
      emit();
      wrap.querySelector(".entry-card:last-of-type")?.classList.add("expanded");
    });
    wrap.append(addBtn);
  }

  render();
  return wrap;
}

// ─── Skills ────────────────────────────────────────────────────────────────

export function renderSkillsFields(skills, onPatch) {
  const wrap = el("div", "section-fields");
  const categories = [
    ["languages", "Programming languages", "e.g. Python"],
    ["frameworks", "Frameworks", "e.g. React"],
    ["tools", "Tools & technologies", "e.g. Docker"],
    ["other", "Other skills", "e.g. Agile"],
  ];
  for (const [key, label, placeholder] of categories) {
    const field = el("div", "mini-field");
    field.append(el("span", "mini-field-label", [label]));
    field.append(createChipList(skills[key], placeholder, (list) => onPatch({ [key]: list })));
    wrap.append(field);
  }
  return wrap;
}

// ─── Section factories used by popup.js ───────────────────────────────────

export function buildEducationFields(entry, patchEntry) {
  const wrap = el("div", "section-fields");
  wrap.append(
    labeledInput({ label: "School", value: entry.institution, placeholder: "University name", onInput: v => patchEntry({ institution: v }) }),
    labeledInput({ label: "Degree", value: entry.degree, placeholder: "B.S.", onInput: v => patchEntry({ degree: v }) }),
    labeledInput({ label: "Major / field of study", value: entry.fieldOfStudy, placeholder: "Computer Science", onInput: v => patchEntry({ fieldOfStudy: v }) }),
    labeledInput({ label: "Location", value: entry.location, placeholder: "City, State", onInput: v => patchEntry({ location: v }) }),
  );
  const row = el("div", "mini-field-row");
  row.append(
    labeledInput({ label: "Start", value: entry.startDate, placeholder: "Aug 2023", onInput: v => patchEntry({ startDate: v }) }),
    labeledInput({ label: "Graduation", value: entry.graduationDate ?? entry.endDate, placeholder: "May 2027", onInput: v => patchEntry({ graduationDate: v }) }),
  );
  wrap.append(row);
  wrap.append(labeledInput({ label: "GPA", value: entry.gpa, placeholder: "3.8", onInput: v => patchEntry({ gpa: v }) }));
  wrap.append(checkboxField({ label: "Currently attending / planned", checked: entry.currentOrPlanned, onChange: v => patchEntry({ currentOrPlanned: v }) }));
  return wrap;
}

export function buildExperienceFields(entry, patchEntry) {
  const wrap = el("div", "section-fields");
  wrap.append(
    labeledInput({ label: "Job title", value: entry.title, placeholder: "Software Engineering Intern", onInput: v => patchEntry({ title: v }) }),
    labeledInput({ label: "Company", value: entry.company, placeholder: "Company name", onInput: v => patchEntry({ company: v }) }),
    labeledInput({ label: "Location", value: entry.location, placeholder: "City, State", onInput: v => patchEntry({ location: v }) }),
  );
  const row = el("div", "mini-field-row");
  row.append(
    labeledInput({ label: "Start", value: entry.startDate, placeholder: "May 2026", onInput: v => patchEntry({ startDate: v }) }),
    labeledInput({ label: "End", value: entry.endDate, placeholder: "Aug 2026", onInput: v => patchEntry({ endDate: v }) }),
  );
  wrap.append(row);
  wrap.append(checkboxField({ label: "I currently work here", checked: entry.current, onChange: v => patchEntry({ current: v }) }));
  wrap.append(createBulletsTextarea(entry.bullets, (bullets) => patchEntry({ bullets })));
  return wrap;
}

export function buildProjectFields(entry, patchEntry) {
  const wrap = el("div", "section-fields");
  wrap.append(
    labeledInput({ label: "Project name", value: entry.name, placeholder: "Starlink Observer", onInput: v => patchEntry({ name: v }) }),
    labeledInput({ label: "URL / repository", value: entry.url, placeholder: "github.com/…", type: "url", onInput: v => patchEntry({ url: v }) }),
  );
  const field = el("div", "mini-field");
  field.append(el("span", "mini-field-label", ["Technologies"]));
  field.append(createChipList(entry.technologies, "e.g. TypeScript", (list) => patchEntry({ technologies: list })));
  wrap.append(field);

  wrap.append(createBulletsTextarea(entry.bullets, (bullets) => patchEntry({ bullets })));
  return wrap;
}

export { uid };
