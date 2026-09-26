import SafariServices
import os.log

// Bridges Safari's native-messaging protocol to the shared ProfileMessageHandler,
// which also backs the desktop app's WKWebView bridge (DesktopWebBridge) so both
// surfaces read/write the same profile through identical logic.
class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {

    private let handler = ProfileMessageHandler()

    func beginRequest(with context: NSExtensionContext) {
        let item = context.inputItems.first as? NSExtensionItem
        let message: Any?
        if #available(iOS 15.0, macOS 11.0, *) {
            message = item?.userInfo?[SFExtensionMessageKey]
        } else {
            message = item?.userInfo?["message"]
        }

        let responsePayload: [String: Any]
        if let dict = message as? [String: Any], let action = dict["action"] as? String {
            responsePayload = handler.handle(action: action, message: dict)
        } else {
            responsePayload = ["error": "unrecognized message"]
        }

        let response = NSExtensionItem()
        if #available(iOS 15.0, macOS 11.0, *) {
            response.userInfo = [SFExtensionMessageKey: responsePayload]
        } else {
            response.userInfo = ["message": responsePayload]
        }
        context.completeRequest(returningItems: [response], completionHandler: nil)
    }
}
