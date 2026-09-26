//
//  AppDelegate.swift
//  Swiftly
//
//  Created by Julian Sanchez on 9/23/26.
//

import Cocoa
import WebKit

// The Swiftly desktop app: a normal windowed application with a home screen
// and the same profile editor as the Safari extension popup. The window's
// content is Resources/desktop.html, which reuses the popup's own CSS and
// profile editor (profile-editor.js, built on profile-ui.js / profile-format.js)
// so both surfaces share one visual language and one editing layer. Profile reads/writes
// go through DesktopWebBridge -> ProfileMessageHandler -> the shared App Group
// ApplicantProfileStore, so the desktop app and the Safari extension operate
// on the same profile.
@main
class AppDelegate: NSObject, NSApplicationDelegate {

    private var window: NSWindow?
    private let bridge = DesktopWebBridge()
    private let resourceHandler = AppResourceSchemeHandler()

    // AppKit's `@main` default implementation for NSApplicationDelegate is only
    // `exit(NSApplicationMain(...))`, and NSApplicationMain installs a delegate
    // exclusively by loading the main nib/storyboard named in Info.plist. Swiftly
    // builds its UI entirely in code and ships neither, so the inherited entry
    // point started the event loop with `NSApp.delegate == nil`: no launch
    // callback, no menu, no window — just a Dock icon that did nothing. (UIKit's
    // `@main` instantiates the delegate for you, which is why this only broke
    // once the companion app moved from UIKit to AppKit.) Build the delegate and
    // start the run loop ourselves instead.
    static func main() {
        let app = NSApplication.shared
        app.delegate = sharedDelegate
        app.setActivationPolicy(.regular)
        app.run()
    }

    // NSApplication.delegate is a weak reference, so the delegate needs an owner
    // that outlives the call above.
    private static let sharedDelegate = AppDelegate()

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.mainMenu = Self.makeMainMenu()
        showMainWindow()
    }

    // Clicking the Dock icon when the app has no visible window (the window
    // was closed, or the app was already running with nothing on screen)
    // goes through here rather than applicationDidFinishLaunching, which only
    // ever fires once per process. Without this, a click on the Dock icon of
    // an already-running-but-windowless Swiftly silently did nothing.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showMainWindow()
        return true
    }

    private func showMainWindow() {
        if let window {
            window.makeKeyAndOrderFront(nil)
            NSApp.activate()
            return
        }

        let configuration = WKWebViewConfiguration()
        configuration.userContentController.add(bridge, name: DesktopWebBridge.messageHandlerName)
        configuration.setURLSchemeHandler(resourceHandler, forURLScheme: AppResourceSchemeHandler.scheme)

        // Note: this web view needs the app's `com.apple.security.network.client`
        // entitlement even though it only ever loads bundled resources. In a
        // sandboxed app WebKit's WebContent/Networking XPC services are launched
        // under the app's sandbox, and without outgoing-network access they fail
        // to start: the web view then renders nothing (an empty gray window) and
        // reports `webViewWebContentProcessDidTerminate` immediately.
        let webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 720, height: 820), configuration: configuration)

        let newWindow = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 720, height: 820),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        newWindow.title = "Swiftly"
        newWindow.minSize = NSSize(width: 480, height: 480)
        newWindow.center()
        newWindow.contentView = webView
        // We keep this window alive for the app's lifetime in `self.window` so
        // it can be re-shown (with its already-loaded state) on the next Dock
        // reopen; without this, AppKit's default release-on-close would free
        // it out from under that strong reference.
        newWindow.isReleasedWhenClosed = false
        self.window = newWindow

        // The window outlives any one editing session, and the user can edit
        // the same profile in the Safari extension in between. Each time the
        // window comes forward, have the page re-read the shared store (see
        // `__swiftlyRefresh` in desktop.js) so it never edits a stale copy.
        NotificationCenter.default.addObserver(
            forName: NSWindow.didBecomeKeyNotification,
            object: newWindow,
            queue: .main
        ) { [weak webView] _ in
            MainActor.assumeIsolated {
                webView?.evaluateJavaScript("window.__swiftlyRefresh && window.__swiftlyRefresh();")
            }
        }

        newWindow.makeKeyAndOrderFront(nil)

        // Loaded over AppResourceSchemeHandler.scheme rather than as a file URL
        // so the page has a real origin and its ES modules can load.
        if let url = AppResourceSchemeHandler.url(forResource: "desktop.html") {
            webView.load(URLRequest(url: url))
        }

        NSApp.activate()
    }

    // Closing the window now just hides it (see isReleasedWhenClosed above) —
    // Swiftly behaves like a normal Mac app that stays running and reopens
    // from the Dock, rather than quitting whenever its one window closes.
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false
    }

    func applicationSupportsSecureRestorableState(_ app: NSApplication) -> Bool {
        true
    }

    // A regular foreground app needs at least a minimal menu bar — without
    // one there is no Quit/Cmd+Q and no Edit menu for the web view's text
    // fields. This is deliberately bare-bones (no custom UI polish needed).
    private static func makeMainMenu() -> NSMenu {
        let main = NSMenu()

        let appMenuItem = NSMenuItem()
        main.addItem(appMenuItem)
        let appMenu = NSMenu()
        appMenuItem.submenu = appMenu
        appMenu.addItem(withTitle: "About Swiftly", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(withTitle: "Hide Swiftly", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(withTitle: "Quit Swiftly", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")

        let editMenuItem = NSMenuItem()
        main.addItem(editMenuItem)
        let editMenu = NSMenu(title: "Edit")
        editMenuItem.submenu = editMenu
        editMenu.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        editMenu.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
        editMenu.addItem(NSMenuItem.separator())
        editMenu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")

        let windowMenuItem = NSMenuItem()
        main.addItem(windowMenuItem)
        let windowMenu = NSMenu(title: "Window")
        windowMenuItem.submenu = windowMenu
        windowMenu.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        NSApp.windowsMenu = windowMenu

        return main
    }
}
