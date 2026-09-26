import AppKit
import UniformTypeIdentifiers
import WebKit

/// Presents the system open panel for `<input type="file">` in the desktop
/// window (the resume card's "Choose PDF…" / "Replace…" buttons).
///
/// Unlike Safari, a bare WKWebView on macOS shows no file picker of its own:
/// clicking a file input silently does nothing unless the web view's
/// `uiDelegate` implements `runOpenPanelWith`. The app must also be entitled
/// to read user-selected files (`ENABLE_USER_SELECTED_FILES = readonly`),
/// or the sandbox refuses to show the panel.
final class FilePickerUIDelegate: NSObject, WKUIDelegate {

    func webView(
        _ webView: WKWebView,
        runOpenPanelWith parameters: WKOpenPanelParameters,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping ([URL]?) -> Void
    ) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        // Mirrors the input's `accept=".pdf"`; resumes are PDF-only for now.
        panel.allowedContentTypes = [.pdf]

        guard let window = webView.window else {
            completionHandler(panel.runModal() == .OK ? panel.urls : nil)
            return
        }
        panel.beginSheetModal(for: window) { response in
            completionHandler(response == .OK ? panel.urls : nil)
        }
    }
}
