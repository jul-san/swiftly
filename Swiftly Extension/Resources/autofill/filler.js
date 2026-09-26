// DOM mutation: sets values on the controls the detector found, using the
// same events a person's interaction would produce so React/Vue/Workday state
// picks the change up. Never submits, never clicks buttons other than the
// dropdown/option/choice controls being answered.

/* global chooseOption, swiftlyText, swiftlyIsRendered */

const swiftlySleep = (ms) => new Promise(r => setTimeout(r, ms));

// Assigns through the prototype's native setter so React's value tracker
// sees a real change (plain `el.value = x` is swallowed by controlled inputs).
function setNativeValue(el, value) {
  let proto = Object.getPrototypeOf(el);
  while (proto) {
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc?.set) { desc.set.call(el, value); return; }
    proto = Object.getPrototypeOf(proto);
  }
  el.value = value;
}

function fire(el, type, init = {}) {
  const view = el.ownerDocument.defaultView;
  let event;
  if (/^(mouse|click|dblclick)/.test(type)) event = new view.MouseEvent(type, { bubbles: true, cancelable: true, composed: true, button: 0, buttons: type === "mousedown" ? 1 : 0, view, ...init });
  else if (/^pointer/.test(type) && view.PointerEvent) event = new view.PointerEvent(type, { bubbles: true, cancelable: true, composed: true, pointerType: "mouse", isPrimary: true, button: 0, ...init });
  else if (/^key/.test(type)) event = new view.KeyboardEvent(type, { bubbles: true, cancelable: true, composed: true, ...init });
  else if (type === "input") event = new view.InputEvent("input", { bubbles: true, composed: true, inputType: "insertText", data: init.data ?? null });
  else if (type === "focus" || type === "blur") event = new view.FocusEvent(type, { bubbles: false, composed: true });
  else if (type === "focusin" || type === "focusout") event = new view.FocusEvent(type, { bubbles: true, composed: true });
  else event = new view.Event(type, { bubbles: true, cancelable: true, composed: true });
  el.dispatchEvent(event);
}

// A full pointer + mouse + click sequence, as a person's click would produce.
function realisticClick(el) {
  fire(el, "pointerover"); fire(el, "mouseover");
  fire(el, "pointerdown"); fire(el, "mousedown");
  el.focus?.({ preventScroll: true });
  fire(el, "pointerup"); fire(el, "mouseup");
  el.click();
}

function pressKey(el, key) {
  const codes = { Enter: 13, Escape: 27, ArrowDown: 40, Tab: 9 };
  const init = { key, code: key, keyCode: codes[key] ?? 0, which: codes[key] ?? 0 };
  fire(el, "keydown", init);
  fire(el, "keyup", init);
}

// ─── Text ────────────────────────────────────────────────────────────────

function fillText(el, value) {
  el.focus?.({ preventScroll: true });
  fire(el, "focusin");
  setNativeValue(el, value);
  fire(el, "input", { data: value });
  fire(el, "change");
  fire(el, "focusout");
  el.blur?.();
  return (el.value ?? "") === value || (el.type === "number" && Number(el.value) === Number(value));
}

// ─── Native <select> ───────────────────────────────────────────────────────

function fillNativeSelect(select, optionIndex) {
  const option = select.options[optionIndex];
  if (!option) return false;
  select.focus?.({ preventScroll: true });
  if (typeof HTMLSelectElement !== "undefined") {
    const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(select), "value");
    desc?.set ? desc.set.call(select, option.value) : (select.value = option.value);
  } else {
    select.value = option.value;
  }
  select.selectedIndex = optionIndex;
  fire(select, "input");
  fire(select, "change");
  select.blur?.();
  return select.selectedIndex === optionIndex;
}

// ─── Radio / checkbox ───────────────────────────────────────────────────────

function setChecked(input, checked) {
  if (input.checked === checked) return true;
  const target = swiftlyIsRendered(input) ? input : (input.labels?.[0] ?? input);
  realisticClick(target);
  if (input.checked !== checked) {
    // Some frameworks swallow synthetic clicks on visually hidden inputs.
    const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "checked");
    desc?.set ? desc.set.call(input, checked) : (input.checked = checked);
    fire(input, "click");
    fire(input, "input");
    fire(input, "change");
  }
  return input.checked === checked;
}

// ─── Dropdown / combobox widgets ─────────────────────────────────────────

// Visible option elements for an open dropdown belonging to `field`.
function findOpenOptions(field) {
  const doc = field.element.ownerDocument;
  const el = field.element;
  const lists = [];
  const controls = el.getAttribute("aria-controls") || el.getAttribute("aria-owns");
  if (controls) for (const id of controls.split(/\s+/)) { const l = doc.getElementById(id); if (l) lists.push(l); }
  if (field.widget === "reactSelect") {
    const container = el.closest("[class*='select-shell'], [class*='select__container'], .select") ?? el.closest("[class*='container']");
    const menu = container?.querySelector("[class*='select__menu']") ?? doc.querySelector("[class*='select__menu-portal'] [class*='select__menu']");
    if (menu) lists.push(menu);
  }
  if (!lists.length) {
    // Popups rendered at the document root (Workday, Radix, Headless UI…).
    lists.push(...[...doc.querySelectorAll("[role=listbox]")].filter(swiftlyIsRendered));
  }
  const options = [];
  for (const list of lists) {
    const found = list.querySelectorAll("[role=option], [class*='select__option'], [data-automation-id=promptOption], li");
    for (const o of found) {
      if (!swiftlyIsRendered(o)) continue;
      if (o.getAttribute("aria-disabled") === "true") continue;
      if (options.some(x => x.el === o || x.el.contains(o) || o.contains(x.el))) continue;
      const text = (o.getAttribute("data-automation-label") || swiftlyText(o)).trim();
      if (text) options.push({ el: o, text });
    }
  }
  return options;
}

async function waitForOptions(field, timeoutMs = 2500) {
  const start = Date.now();
  let last = [];
  while (Date.now() - start < timeoutMs) {
    last = findOpenOptions(field);
    if (last.length && !last.every(o => /^(loading|searching|no (options|results|matches))/i.test(o.text))) return last;
    await swiftlySleep(100);
  }
  return last.filter(o => !/^(loading|searching|no (options|results|matches))/i.test(o.text));
}

function openDropdown(field) {
  const el = field.element;
  if (field.widget === "reactSelect") {
    const control = el.closest("[class*='select__control']") ?? el;
    el.focus({ preventScroll: true });
    fire(control, "mousedown");
    if (el.getAttribute("aria-expanded") !== "true") pressKey(el, "ArrowDown");
  } else if (field.widget === "listboxButton") {
    realisticClick(el);
  } else {
    el.focus?.({ preventScroll: true });
    realisticClick(el);
    if (el.getAttribute("aria-expanded") !== "true") pressKey(el, "ArrowDown");
  }
}

function closeDropdown(field) {
  pressKey(field.element, "Escape");
  if (field.widget !== "listboxButton") field.element.blur?.();
}

// Typed search for typeahead comboboxes (locations, schools, countries).
function typeQuery(field, query) {
  const input = field.searchInput ?? field.element;
  input.focus?.({ preventScroll: true });
  setNativeValue(input, query);
  fire(input, "input", { data: query });
}

// Opens the widget, reads its options, picks the confident one and clicks it.
// Returns { ok, reason, optionText }.
async function fillDropdown(field, answer, { query } = {}) {
  openDropdown(field);
  let options = await waitForOptions(field, query ? 400 : 1500);
  let choice = chooseOption(options.map(o => o.text), answer);

  // Long or async lists (schools, locations) only show matches after typing.
  if (choice.index === -1 && query && (field.widget !== "listboxButton" || field.searchInput)) {
    typeQuery(field, query);
    // Workday prompts search on Enter; React Select / ARIA comboboxes filter as you type.
    if (field.widget === "workdayPrompt" || field.widget === "listboxButton") pressKey(field.searchInput ?? field.element, "Enter");
    await swiftlySleep(250);
    options = await waitForOptions(field, 3000);
    choice = chooseOption(options.map(o => o.text), answer);
  }

  if (choice.index === -1) {
    if (query && (field.widget !== "listboxButton" || field.searchInput)) typeQuery(field, ""); // don't leave half-typed text behind
    closeDropdown(field);
    return { ok: false, skip: options.length > 0, reason: options.length ? choice.reason : "no options appeared" };
  }
  const option = options[choice.index];
  const clickable = option.el.querySelector("[data-automation-id=promptOption], [role=radio], input[type=radio]") ?? option.el;
  realisticClick(clickable);
  await swiftlySleep(120);
  if (field.widget === "listboxButton" || field.widget === "workdayPrompt") closeDropdown(field);
  return { ok: true, reason: choice.reason, optionText: option.text, confidence: choice.confidence };
}

// ─── Button groups (Ashby Yes/No and similar) ─────────────────────────────

function fillButtonGroup(field, optionIndex) {
  const btn = field.options[optionIndex]?.element;
  if (!btn) return false;
  const pressed = () => btn.getAttribute("aria-pressed") === "true" || btn.getAttribute("aria-checked") === "true" || /\b(active|selected)\b/.test(btn.className);
  if (!pressed()) realisticClick(btn);
  return true;
}

// ─── Files ───────────────────────────────────────────────────────────────

function fillFile(input, resume) {
  try {
    const bytes = atob(resume.base64);
    const arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    const view = input.ownerDocument.defaultView;
    const file = new view.File([arr], resume.name || "resume.pdf", { type: resume.type || "application/pdf" });
    const dt = new view.DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    fire(input, "input");
    fire(input, "change");
    return input.files?.length === 1;
  } catch {
    return false;
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { setNativeValue, fillText, fillNativeSelect, setChecked, fillDropdown, fillButtonGroup, fillFile, realisticClick };
}
