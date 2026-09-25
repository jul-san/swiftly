//
//  AppDelegate.swift
//  Swiftly
//
//  Created by Julian Sanchez on 9/23/26.
//

import Cocoa

// Background-only app — no window needed. All UI lives in the Safari extension
// popup; this process only hosts the extension's native message handler
// (SafariWebExtensionHandler) and the shared App Group profile store.
// LSUIElement in Info.plist keeps it out of the Dock and app switcher.
@main
class AppDelegate: NSObject, NSApplicationDelegate {

    func applicationSupportsSecureRestorableState(_ app: NSApplication) -> Bool {
        true
    }
}
