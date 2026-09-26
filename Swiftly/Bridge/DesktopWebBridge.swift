import WebKit

/// Bridges the desktop app's WKWebView (Resources/desktop.html + desktop.js) to
/// the same `ProfileMessageHandler` the Safari extension uses, so both surfaces
/// stay backed by one `ApplicantProfileStore` via the shared App Group — no
/// separate desktop-only profile logic.
///
/// JS calls `window.webkit.messageHandlers.swiftlyNative.postMessage({ id, action, ... })`
/// and this replies by calling back into the page to resolve the pending
/// promise for that `id` (see `nativeMessage()` in desktop.js).
final class DesktopWebBridge: NSObject, WKScriptMessageHandler {

    static let messageHandlerName = "swiftlyNative"

    private let handler = ProfileMessageHandler()
    private let queue = DispatchQueue(label: "com.swiftly.desktopBridge")

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard
            let webView = message.webView,
            let body = message.body as? [String: Any],
            let requestId = body["id"],
            let action = body["action"] as? String
        else { return }

        // Resume parsing does real work (PDF extraction); keep it off the main
        // thread so the window stays responsive while it runs.
        queue.async { [handler] in
            let result = handler.handle(action: action, message: body)
            DispatchQueue.main.async {
                Self.resolve(webView: webView, requestId: requestId, result: result)
            }
        }
    }

    // Ships the result as base64-encoded JSON rather than interpolating it
    // into the JS source directly, so arbitrary resume/profile text (quotes,
    // line separators, etc.) can never break out of the evaluated script.
    private static func resolve(webView: WKWebView, requestId: Any, result: [String: Any]) {
        guard
            let data = try? JSONSerialization.data(withJSONObject: result)
        else { return }

        let idLiteral = (requestId as? NSNumber)?.stringValue ?? "null"
        let payload = data.base64EncodedString()
        let script = "window.__swiftlyResolve && window.__swiftlyResolve(\(idLiteral), \"\(payload)\");"
        webView.evaluateJavaScript(script)
    }
}
