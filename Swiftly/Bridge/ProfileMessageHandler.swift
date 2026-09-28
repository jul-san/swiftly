import Foundation

/// Handles the `getProfile` / `saveProfile` / `parseResume` message protocol
/// against the shared `ApplicantProfileStore`.
///
/// This is the single implementation shared by both native surfaces that read
/// and write the applicant profile: the Safari extension's
/// `SafariWebExtensionHandler` (reached via `browser.runtime.sendNativeMessage`)
/// and the desktop app's `DesktopWebBridge` (reached via a `WKScriptMessageHandler`).
/// Keeping the logic here means both surfaces stay backed by one
/// `ApplicantProfileStore` through identical behavior instead of two
/// independently-maintained copies.
struct ProfileMessageHandler {

    private let store: ProfileStoring

    init(store: ProfileStoring = ApplicantProfileStore()) {
        self.store = store
    }

    func handle(action: String, message: [String: Any]) -> [String: Any] {
        switch action {
        case "getProfile":  return handleGetProfile()
        case "saveProfile": return handleSaveProfile(message)
        case "parseResume": return handleParseResume(message)
        default:             return ["error": "unknown action '\(action)'"]
        }
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

    // Returns the parsed profile without saving it. The caller merges in the
    // answers a resume never contains (work eligibility, demographics, address)
    // from the profile it already has and saves that, so a parse can never
    // overwrite them in the shared store.
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

        let texts: [String]
        switch ResumeTextExtractor().extractCandidates(from: tempURL) {
        case .success(let extracted):
            texts = extracted
        case .failure(let error):
            return ["success": false, "error": error.localizedDescription]
        }

        #if DEBUG
        // Which reading of the PDF parsed best, without logging any resume content.
        for (index, text) in texts.enumerated() {
            if case .success(let r) = ResumeParser().parse(text: text, filename: fileName) {
                print("[Swiftly] resume reading \(index): \(text.split(separator: "\n").count) lines, "
                      + "\(r.profile.education.count) education, \(r.profile.experience.count) experience, "
                      + "\(r.profile.projects.count) projects, warnings: \(r.warnings)")
            }
        }
        #endif

        switch ResumeParser().parse(texts: texts, filename: fileName) {
        case .success(let result):
            return [
                "success": true,
                "profile": encodeProfile(result.profile),
                "warnings": result.warnings,
            ]
        case .failure(let error):
            return ["success": false, "error": error.localizedDescription]
        }
    }

    // MARK: - Codable <-> plist/JSON-safe dictionary bridging

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
