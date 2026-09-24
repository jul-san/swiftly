import SafariServices
import os.log

class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {

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
            switch action {
            case "getProfile": responsePayload = handleGetProfile()
            default:           responsePayload = ["error": "unknown action '\(action)'"]
            }
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

    private func handleGetProfile() -> [String: Any] {
        let defaults = UserDefaults(suiteName: "group.repo.Swiftly") ?? .standard
        guard
            let data = defaults.data(forKey: "com.swiftly.applicantProfile.v1"),
            let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let personal = json["personal"] as? [String: Any],
            let fullName = personal["fullName"] as? String,
            !fullName.isEmpty
        else {
            return ["hasProfile": false]
        }

        return [
            "hasProfile": true,
            "name":       fullName,
            "firstName":  personal["firstName"] as? String ?? "",
            "lastName":   personal["lastName"]  as? String ?? "",
            "email":      personal["email"]     as? String ?? "",
            "phone":      personal["phone"]     as? String ?? "",
        ]
    }
}
