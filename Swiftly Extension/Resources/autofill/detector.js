// Field detection: turns the page's form controls into plain `DetectedField`
// descriptions (label, identifiers, control kind, options, current value,
// required, repeatable section) without modifying anything.
//
// ATS adapters contribute structure-specific knowledge through hooks
// (labels for custom widgets, section indices, extra widgets such as Ashby's
// Yes/No buttons); everything else here is generic DOM/ARIA reading.

/* global cleanLabel, normalizeText */

// ─── Small DOM helpers ────────────────────────────────────────────────────

function swiftlyText(el) {
  if (!el) return "";
  // innerText respects visibility (hidden "*" spans stay out) where available.
  const t = (el.innerText ?? el.textContent ?? "");
  return t.replace(/\s+/g, " ").trim();
}

// querySelectorAll that also descends into open shadow roots.
function swiftlyQueryAll(root, selector) {
  const out = [...root.querySelectorAll(selector)];
  const walker = (root.ownerDocument ?? root).createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let node = walker.currentNode;
  while (node) {
    if (node.shadowRoot) out.push(...swiftlyQueryAll(node.shadowRoot, selector));
    node = walker.nextNode();
  }
  return out;
}

function swiftlyIsRendered(el) {
  if (!el || !el.isConnected) return false;
  if (el.closest("[hidden], [aria-hidden='true'], template")) return false;
  const style = el.ownerDocument.defaultView?.getComputedStyle(el);
  if (style && (style.display === "none" || style.visibility === "hidden")) return false;
  // Covers display:none ancestors too: their descendants have no client rects.
  return el.getClientRects().length > 0;
}

function textById(doc, ids) {
  return (ids ?? "").split(/\s+/).filter(Boolean)
    .map(id => swiftlyText(doc.getElementById(id)))
    .filter(Boolean).join(" ");
}

// Question text for a single control, from the most to least explicit source.
function resolveControlLabel(el, adapter) {
  const doc = el.ownerDocument;
  const fromAdapter = adapter?.labelFor?.(el);
  if (fromAdapter) return cleanLabel(fromAdapter);
  const labelledBy = textById(doc, el.getAttribute("aria-labelledby"));
  if (labelledBy) return cleanLabel(labelledBy);
  const labels = el.labels ? [...el.labels] : [];
  const labelText = [...new Set(labels.map(l => swiftlyText(l)).filter(Boolean))]
    .filter(t => !/^(attach|upload|browse|choose file|enter manually)$/i.test(t))
    .join(" ");
  if (labelText) return cleanLabel(labelText);
  const aria = el.getAttribute("aria-label");
  if (aria && !/^(attach|search|toggle flyout)$/i.test(aria)) return cleanLabel(aria);
  // Widgets wrapped in a labelled group (Greenhouse's file upload: role=group aria-labelledby).
  const group = el.parentElement?.closest("[role=group][aria-labelledby], [role=group][aria-label]");
  if (group && group.querySelectorAll("input:not([type=hidden]), select, textarea").length <= 2) {
    const t = textById(doc, group.getAttribute("aria-labelledby")) || group.getAttribute("aria-label");
    if (t) return cleanLabel(t);
  }
  const legend = el.closest("fieldset")?.querySelector(":scope > legend");
  if (legend && el.closest("fieldset").querySelectorAll("input, select, textarea").length === 1) return cleanLabel(swiftlyText(legend));
  return cleanLabel(containerQuestionText(el, [el]));
}

// Question text for a group of radios/checkboxes/buttons.
function resolveGroupLabel(members, adapter) {
  const first = members[0];
  const doc = first.ownerDocument;
  const fromAdapter = adapter?.groupLabelFor?.(members);
  if (fromAdapter) return cleanLabel(fromAdapter);
  const container = commonAncestor(members);
  for (let el = container, depth = 0; el && depth < 4; el = el.parentElement, depth++) {
    const role = el.getAttribute?.("role");
    if (el.tagName === "FIELDSET") {
      const legend = el.querySelector(":scope > legend");
      if (legend) return cleanLabel(swiftlyText(legend));
    }
    if (role === "radiogroup" || role === "group" || el.tagName === "FIELDSET") {
      const lb = textById(doc, el.getAttribute("aria-labelledby"));
      if (lb) return cleanLabel(lb);
      const al = el.getAttribute("aria-label");
      if (al) return cleanLabel(al);
    }
  }
  return cleanLabel(containerQuestionText(container, members));
}

function commonAncestor(elements) {
  let container = elements[0].parentElement;
  while (container && !elements.every(e => container.contains(e))) container = container.parentElement;
  return container ?? elements[0].ownerDocument.body;
}

// Fallback: nearest text that precedes the control(s) within a small
// ancestor that holds only this question (so neighbouring questions or long
// EEO descriptions never leak in).
function containerQuestionText(start, members) {
  const memberSet = new Set(members);
  const optionTexts = new Set(members.flatMap(m => [...(m.labels ?? [])].map(l => swiftlyText(l))));
  let el = start.parentElement ?? start;
  for (let depth = 0; depth < 5 && el && el.tagName !== "FORM" && el.tagName !== "BODY"; depth++, el = el.parentElement) {
    const controls = [...el.querySelectorAll("input:not([type=hidden]), select, textarea, [role=combobox], button[aria-haspopup]")]
      .filter(c => !memberSet.has(c) && !(c.getAttribute("aria-hidden") === "true"));
    if (controls.some(c => !members.some(m => m.contains(c) || c.contains(m)))) break; // another question starts here
    const heading = el.querySelector(":scope > label, :scope > legend, :scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > p, :scope > span, :scope > div > label, :scope > [class*='label']");
    const candidate = heading && !members.some(m => heading.contains(m)) ? swiftlyText(heading) : "";
    if (candidate && !optionTexts.has(candidate) && candidate.length <= 300) return candidate;
  }
  return "";
}

function nearbyText(el) {
  let node = el.parentElement;
  for (let i = 0; i < 3 && node; i++, node = node.parentElement) {
    const t = swiftlyText(node);
    if (t && t.length < 200) return t;
  }
  return "";
}

function isRequired(el, groupMembers) {
  const targets = groupMembers ?? [el];
  if (targets.some(t => t.required || t.getAttribute?.("aria-required") === "true")) return true;
  const fs = targets[0].closest?.("fieldset, [role=radiogroup], [role=group]");
  if (fs && (fs.getAttribute("aria-required") === "true")) return true;
  // Workday puts aria-required on a plain div wrapping its radios.
  if (groupMembers && targets[0].parentElement?.closest("[aria-required='true']")) return true;
  const labelEl = el.labels?.[0] ?? (el.id ? el.ownerDocument.getElementById(`${el.id}-label`) : null);
  if (labelEl && /\*/.test(labelEl.textContent)) return true;
  return false;
}

// ─── Field construction ───────────────────────────────────────────────────

const SKIPPED_INPUT_TYPES = new Set(["hidden", "submit", "button", "image", "reset", "password", "search", "range", "color"]);

function baseField(el, extra) {
  return {
    element: el,
    tagName: el.tagName.toLowerCase(),
    inputType: (el.getAttribute("type") || (el.tagName === "TEXTAREA" ? "textarea" : el.tagName === "SELECT" ? "select" : "text")).toLowerCase(),
    name: el.getAttribute("name") || "",
    idAttr: el.id || "",
    automationId: el.getAttribute("data-automation-id") || el.closest("[data-automation-id]")?.getAttribute("data-automation-id") || "",
    ariaLabel: el.getAttribute("aria-label") || "",
    placeholder: el.getAttribute("placeholder") || "",
    autocomplete: el.getAttribute("autocomplete") || "",
    ...extra,
  };
}

// A DetectedField for a widget an adapter recognizes itself (Yes/No button
// pairs, Workday prompts). Identifier fields default to empty so the catalog
// can read every field the same way.
function customField(fields) {
  return {
    tagName: fields.element.tagName.toLowerCase(),
    name: "", idAttr: "", automationId: "", ariaLabel: "", placeholder: "", autocomplete: "",
    nearbyText: "",
    ...fields,
  };
}

function isComboboxInput(el) {
  return el.getAttribute("role") === "combobox" || (el.getAttribute("aria-autocomplete") === "list" && el.hasAttribute("aria-expanded"));
}

function comboboxCurrentValue(el) {
  const reactSelect = el.closest(".select__control, [class*='select__control']");
  if (reactSelect) {
    const single = reactSelect.querySelector("[class*='single-value'], [class*='multi-value__label']");
    return single ? swiftlyText(single) : "";
  }
  return el.value ?? "";
}

// Returns DetectedField[] for every fillable control under `root`.
function detectFields(root, adapter = null) {
  const fields = [];
  const seen = new Set();
  const skip = (el) => adapter?.shouldSkipElement?.(el) || el.closest("[data-swiftly-ignore]");

  // Adapter-specific widgets first (they may wrap native controls).
  for (const custom of adapter?.detectCustomFields?.(root) ?? []) {
    for (const el of custom.members ?? [custom.element]) seen.add(el);
    fields.push(custom);
  }

  // Radio / checkbox groups.
  const groups = new Map();
  for (const input of swiftlyQueryAll(root, "input[type=radio], input[type=checkbox]")) {
    if (seen.has(input) || skip(input) || input.disabled) continue;
    const fs = input.closest("fieldset, [role=radiogroup], [role=group]");
    const key = input.name ? `${input.type}:${input.name}` : fs ? fs : input;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(input);
  }
  for (const members of groups.values()) {
    members.forEach(m => seen.add(m));
    const type = members[0].type;
    const optionLabel = (m) => cleanLabel(swiftlyText(m.labels?.[0]) || m.getAttribute("aria-label") || m.value || "");
    if (type === "checkbox" && members.length === 1) {
      const el = members[0];
      const own = optionLabel(el);
      const groupLabel = resolveGroupLabel(members, adapter);
      fields.push(baseField(el, {
        kind: "checkbox",
        label: groupLabel && groupLabel !== own ? `${groupLabel} ${own}`.trim() : own,
        optionLabel: own,
        members,
        required: isRequired(el, members),
        currentValue: el.checked ? "checked" : "",
        isEmpty: !el.checked,
      }));
      continue;
    }
    const label = resolveGroupLabel(members, adapter);
    fields.push(baseField(members[0], {
      kind: type === "radio" ? "radio" : "checkboxGroup",
      label,
      members,
      options: members.map(m => ({ element: m, text: optionLabel(m) })),
      required: isRequired(members[0], members),
      currentValue: members.filter(m => m.checked).map(optionLabel).join(", "),
      isEmpty: !members.some(m => m.checked),
    }));
  }

  // Text inputs, textareas, native selects, comboboxes, files.
  for (const el of swiftlyQueryAll(root, "input, textarea, select, button[aria-haspopup='listbox']")) {
    if (seen.has(el) || skip(el) || el.disabled || (el.readOnly && el.type !== "file" && !isComboboxInput(el))) continue;
    const type = (el.getAttribute("type") || "").toLowerCase();
    if (el.tagName === "INPUT" && SKIPPED_INPUT_TYPES.has(type)) continue;
    if (el.tagName === "INPUT" && (type === "radio" || type === "checkbox")) continue;
    // Unlabelled validation shims (React Select's hidden "required" input).
    if (el.getAttribute("aria-hidden") === "true" || (el.tabIndex === -1 && !el.id && !el.name && type !== "file")) continue;
    if (type !== "file" && !swiftlyIsRendered(el)) continue;
    seen.add(el);

    const label = resolveControlLabel(el, adapter);
    let field;
    if (type === "file") {
      field = baseField(el, { kind: "file", currentValue: el.files?.length ? el.files[0].name : "", isEmpty: !el.files?.length });
    } else if (el.tagName === "SELECT") {
      const options = [...el.options].map((o, i) => ({ index: i, text: cleanLabel(o.textContent), value: o.value }));
      const selected = el.selectedIndex >= 0 ? el.options[el.selectedIndex] : null;
      const empty = !selected || !selected.value || /^(select|choose|please select|--)/i.test(selected.textContent.trim());
      field = baseField(el, { kind: "select", options, currentValue: empty ? "" : selected.textContent.trim(), isEmpty: empty, multiple: el.multiple });
    } else if (el.tagName === "BUTTON") {
      const current = swiftlyText(el);
      const empty = !current || /^(select one|select|choose|none selected)$/i.test(current);
      field = baseField(el, { kind: "combobox", widget: "listboxButton", inputType: "listbox", currentValue: empty ? "" : current, isEmpty: empty });
    } else if (isComboboxInput(el)) {
      const reactSelect = !!el.closest("[class*='select__control']");
      const current = comboboxCurrentValue(el);
      field = baseField(el, { kind: "combobox", widget: reactSelect ? "reactSelect" : "ariaCombobox", inputType: "combobox", currentValue: current, isEmpty: !current.trim() });
    } else {
      field = baseField(el, { kind: "text", multiline: el.tagName === "TEXTAREA", currentValue: el.value ?? "", isEmpty: !(el.value ?? "").trim() });
    }
    field.label = label;
    field.nearbyText = label ? "" : nearbyText(el);
    field.required = isRequired(el);
    fields.push(field);
  }

  // Let the adapter refine (section indices, hints, date parts).
  for (const f of fields) {
    f.section = adapter?.sectionOf?.(f) ?? null;
    f.hintKey = adapter?.hintFor?.(f) ?? null;
    f.datePart = adapter?.datePartOf?.(f) ?? genericDatePart(f);
  }
  return fields;
}

// "Start date month" / "Year" → a part of a date; "month & year" → the whole date.
function genericDatePart(f) {
  const t = `${normalizeText(f.label)} ${normalizeText(f.ariaLabel)} ${(f.idAttr || "").toLowerCase()}`;
  const month = /\bmonth\b/.test(t), year = /\byear\b/.test(t), day = /\bday\b/.test(t);
  if (month + year + day !== 1) return null;
  return month ? "month" : year ? "year" : "day";
}

// Short, value-free description for logs.
function describeField(f) {
  const kind = f.kind === "combobox" ? `combobox/${f.widget}` : f.kind;
  const label = (f.label || f.ariaLabel || f.placeholder || f.name || f.idAttr || "(no label)").slice(0, 90);
  return { label, type: kind };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { detectFields, describeField, customField, swiftlyText, swiftlyQueryAll };
}
