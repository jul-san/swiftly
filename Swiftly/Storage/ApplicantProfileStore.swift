import Foundation

protocol ProfileStoring {
    func loadProfile() throws -> ApplicantProfile?
    func saveProfile(_ profile: ApplicantProfile) throws
    func deleteProfile() throws
}

final class ApplicantProfileStore: ProfileStoring {

    // Key includes schema version so stale data is ignored after a model change.
    private static let defaultsKey = "com.swiftly.applicantProfile.v1"

    // The App Group both the app and the Safari extension are entitled to (see
    // Swiftly.entitlements / Swiftly Extension.entitlements). Its UserDefaults
    // suite is the single source of truth for the profile on both surfaces.
    static let appGroupID = "group.repo.Swiftly"

    private let defaults: UserDefaults
    private let encoder = ApplicantProfileStore.makeEncoder()
    private let decoder = ApplicantProfileStore.makeDecoder()

    // Dates are encoded as Unix seconds so the Safari extension (JavaScript) can read
    // them directly with `new Date(seconds * 1000)` without reimplementing Swift's
    // reference-date epoch.
    static func makeEncoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .secondsSince1970
        return encoder
    }

    static func makeDecoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .secondsSince1970
        return decoder
    }

    // Use the shared App Group suite so the Safari extension can read the same data.
    // Falls back to .standard if the App Group isn't registered (e.g., first run on
    // a device where the group hasn't been provisioned yet).
    init(defaults: UserDefaults = UserDefaults(suiteName: ApplicantProfileStore.appGroupID) ?? .standard) {
        self.defaults = defaults
    }

    func loadProfile() throws -> ApplicantProfile? {
        guard let data = defaults.data(forKey: Self.defaultsKey) else { return nil }
        return try decoder.decode(ApplicantProfile.self, from: data)
    }

    func saveProfile(_ profile: ApplicantProfile) throws {
        let data = try encoder.encode(profile)
        defaults.set(data, forKey: Self.defaultsKey)
    }

    func deleteProfile() throws {
        defaults.removeObject(forKey: Self.defaultsKey)
    }
}
