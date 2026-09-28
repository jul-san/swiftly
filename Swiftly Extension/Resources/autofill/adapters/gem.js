// Gem adapter (jobs.gem.com/<company>/<posting>).
//
// Gem's hosted application is a client-rendered React form with no public
// platform ids: questions are labelled inputs, ARIA comboboxes/listboxes,
// radio groups, checkbox groups and Yes/No button pairs, plus a file input
// for the resume. So this adapter is deliberately thin — it scopes the form,
// recognizes Yes/No button pairs, and leaves recognition to the shared,
// label-driven catalog. No company-specific selectors.

(function () {
  function questionContainer(el) {
    // Nearest ancestor that also contains a label/legend-like title.
    for (let node = el.parentElement, depth = 0; node && depth < 6; node = node.parentElement, depth++) {
      if (node.querySelector(":scope > label, :scope > legend, :scope > div > label, :scope > [id$='-label']")) return node;
    }
    return null;
  }

  const adapter = {
    id: "gem",
    canHandle(loc, doc) {
      return /(^|\.)gem\.com$/.test(loc.hostname) && !!doc.querySelector("form, input[type=file]");
    },
    formRoot(doc) {
      const forms = [...doc.querySelectorAll("form")];
      // The application form is the one with a file input or the most fields.
      return forms.find(f => f.querySelector("input[type=file]"))
        ?? forms.sort((a, b) => b.querySelectorAll("input, textarea, select").length - a.querySelectorAll("input, textarea, select").length)[0]
        ?? doc.body;
    },
    detectCustomFields(root) {
      const out = [];
      const seenContainers = new Set();
      for (const btn of root.querySelectorAll("button")) {
        if (!/^(yes|no)$/i.test(swiftlyText(btn))) continue;
        const container = questionContainer(btn);
        if (!container || seenContainers.has(container)) continue;
        const buttons = [...container.querySelectorAll("button")].filter(b => /^(yes|no)$/i.test(swiftlyText(b)));
        if (buttons.length !== 2 || container.querySelector("input:not([type=hidden]), select, textarea")) continue;
        seenContainers.add(container);
        const title = container.querySelector(":scope > label, :scope > legend, :scope > div > label, :scope > [id$='-label']");
        const pressed = buttons.find(b => b.getAttribute("aria-pressed") === "true" || b.getAttribute("aria-checked") === "true" || b.getAttribute("data-state") === "on");
        out.push(customField({
          kind: "buttonGroup", element: buttons[0], members: buttons,
          options: buttons.map(b => ({ element: b, text: swiftlyText(b) })),
          inputType: "yesno",
          label: cleanLabel(swiftlyText(title)),
          required: /\*/.test(title?.textContent ?? ""),
          currentValue: pressed ? swiftlyText(pressed) : "", isEmpty: !pressed,
        }));
      }
      return out;
    },
    interactionDelayMs: 100,
  };

  registerSwiftlyAdapter(adapter);
})();
