import Foundation
import WebKit

/// Serves the desktop window's web resources from the app bundle over a custom
/// URL scheme instead of `file://`.
///
/// This exists because `desktop.js`, `profile-ui.js` and `profile-format.js` are
/// ES modules (shared verbatim with the Safari extension popup, which loads
/// `popup.js` the same way). WebKit fetches module scripts with CORS semantics,
/// and a `file://` page has an opaque origin, so every `import` is blocked — the
/// page would render its static HTML and then sit on the "Loading…" view forever
/// because no script ever ran. The extension popup is unaffected because Safari
/// serves it from a real `safari-web-extension://` origin; this handler gives the
/// desktop window an equivalent one.
final class AppResourceSchemeHandler: NSObject, WKURLSchemeHandler {

    /// Must not collide with a scheme WebKit already handles internally.
    static let scheme = "swiftly-resource"
    static let host = "app"

    /// URL for a file in the bundle's resource directory, e.g. `desktop.html`.
    static func url(forResource name: String) -> URL? {
        URL(string: "\(scheme)://\(host)/\(name)")
    }

    private let root: URL? = Bundle.main.resourceURL?.standardizedFileURL

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url, let root else {
            task.didFailWithError(URLError(.badURL))
            return
        }

        // Percent-decoded, traversal-checked resolution: the path is attacker-
        // reachable only from our own bundled HTML, but a stray `../` should
        // still never escape the resource directory.
        let relativePath = url.path.removingPercentEncoding ?? url.path
        let resolved = root.appendingPathComponent(relativePath).standardizedFileURL
        guard resolved.path.hasPrefix(root.path + "/") else {
            task.didFailWithError(URLError(.noPermissionsToReadFile))
            return
        }

        guard let data = try? Data(contentsOf: resolved) else {
            task.didFailWithError(URLError(.fileDoesNotExist))
            return
        }

        // Responding synchronously keeps this free of the usual
        // use-after-`stopURLSchemeTask` hazard: `start` completes the task
        // before it can return and be stopped. Bundle resources are small
        // enough that reading them inline costs nothing.
        let response = URLResponse(
            url: url,
            mimeType: Self.mimeType(forPathExtension: resolved.pathExtension),
            expectedContentLength: data.count,
            textEncodingName: "utf-8"
        )
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {
        // Nothing to cancel: `start` always finishes synchronously.
    }

    // Module scripts are also subject to a strict MIME check, so `.js` must be
    // served as a JavaScript type — not `application/octet-stream`.
    private static func mimeType(forPathExtension ext: String) -> String {
        switch ext.lowercased() {
        case "html", "htm": return "text/html"
        case "css": return "text/css"
        case "js", "mjs": return "text/javascript"
        case "json": return "application/json"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "svg": return "image/svg+xml"
        case "woff2": return "font/woff2"
        default: return "application/octet-stream"
        }
    }
}
