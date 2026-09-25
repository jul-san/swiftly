import SafariServices
import os.log

class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {

    private let store = ApplicantProfileStore()

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
            case "getProfile":   responsePayload = handleGetProfile()
            case "saveProfile":  responsePayload = handleSaveProfile(dict)
            case "parseResume":  responsePayload = handleParseResume(dict)
            default:             responsePayload = ["error": "unknown action '\(action)'"]
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

    // MARK: - Profile read/write

    private func handleGetProfile() -> [String: Any] {
        guard let profile = try? store.loadProfile() else {
            return ["hasProfile": false]
        }
        return ["hasProfile": true, "profile": encodeProfile(profile)]
    }

    private func handleSaveProfile(_ message: [String: Any]) -> [String: Any] {
        guard
            let profileDict = message["profile"] as? [String: Any],
            let profile = decodeProfile(from: profileDict)
        else {
            return ["success": false, "error": "Invalid profile data."]
        }

        do {
            try store.saveProfile(profile)
            return ["success": true]
        } catch {
            return ["success": false, "error": "Could not save the profile."]
        }
    }

    // MARK: - Resume parsing

    private func handleParseResume(_ message: [String: Any]) -> [String: Any] {
        guard
            let base64 = message["base64"] as? String,
            let data = Data(base64Encoded: base64)
        else {
            return ["success": false, "error": "Invalid resume data."]
        }
        let fileName = message["fileName"] as? String ?? "resume.pdf"

        let tempURL = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
            .appendingPathExtension("pdf")
        defer { try? FileManager.default.removeItem(at: tempURL) }

        do {
            try data.write(to: tempURL)
        } catch {
            return ["success": false, "error": "The uploaded file could not be read."]
        }

        let text: String
        switch ResumeTextExtractor().extract(from: tempURL) {
        case .success(let extracted):
            text = extracted
        case .failure(let error):
            return ["success": false, "error": error.localizedDescription]
        }

        switch ResumeParser().parse(text: text, filename: fileName) {
        case .success(let result):
            do {
                try store.saveProfile(result.profile)
            } catch {
                return ["success": false, "error": "Parsed the resume but couldn't save the profile."]
            }
            return [
                "success": true,
                "profile": encodeProfile(result.profile),
                "warnings": result.warnings,
            ]
        case .failure(let error):
            return ["success": false, "error": error.localizedDescription]
        }
    }

    // MARK: - Codable <-> plist-safe dictionary bridging

    private func encodeProfile(_ profile: ApplicantProfile) -> [String: Any] {
        guard
            let data = try? ApplicantProfileStore.makeEncoder().encode(profile),
            let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return [:] }
        return json
    }

    private func decodeProfile(from dict: [String: Any]) -> ApplicantProfile? {
        guard
            let data = try? JSONSerialization.data(withJSONObject: dict),
            let profile = try? ApplicantProfileStore.makeDecoder().decode(ApplicantProfile.self, from: data)
        else { return nil }
        return profile
    }
}
