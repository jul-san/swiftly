// Page entry point. The autofill logic lives in autofill/*.js (loaded before
// this file by manifest.json); this file only answers the popup.
//
// Runs in every frame of supported ATS hosts (all_frames), so an application
// embedded as an iframe on a company's careers site works too. Frames without
// an application form stay silent so the frame that has one answers.

let swiftlyRunning = false;

function swiftlyApplicationHere() {
  const adapter = pickAdapter(location, document);
  if (!adapter) return null;
  if (adapter.blockedReason?.(document)) return adapter;
  const root = adapter.formRoot?.(document);
  const hasControls = !!root?.querySelector("input:not([type=hidden]), textarea, select, button[aria-haspopup='listbox']");
  return hasControls ? adapter : null;
}

// A report for a run that filled nothing, in the shape runAutofill returns.
function emptyReport(extra) {
  return { supported: true, filled: 0, fields: [], needsAttention: [], ...extra };
}

browser.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action === "detect") {
    const adapter = swiftlyApplicationHere();
    if (!adapter) return false; // let another frame answer
    sendResponse({ provider: adapter.id, blocked: adapter.blockedReason?.(document) ?? null });
    return false;
  }

  if (request.action === "autofill") {
    if (!swiftlyApplicationHere()) return false;
    if (swiftlyRunning) {
      sendResponse(emptyReport({ busy: true }));
      return false;
    }
    swiftlyRunning = true;
    runAutofill({ profile: request.profile, resume: request.resume ?? null })
      .then(sendResponse)
      .catch(err => {
        console.error("[Swiftly] autofill failed:", err?.message ?? err);
        sendResponse(emptyReport({ error: "Autofill hit an unexpected error on this page." }));
      })
      .finally(() => { swiftlyRunning = false; });
    return true;
  }
  return false;
});
