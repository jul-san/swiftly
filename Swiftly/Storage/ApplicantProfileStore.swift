import Foundation

protocol ProfileStoring {
    func loadProfile() throws -> ApplicantProfile?
    func saveProfile(_ profile: ApplicantProfile) throws
    func deleteProfile() throws
}

final class ApplicantProfileStore: ProfileStoring {

    // Key includes schema version so stale data is ignored after a model change.
    private static let defaultsKey = "com.swiftly.applicantProfile.v1"

    private let defaults: UserDefaults
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    // Use the shared App Group suite so the Safari extension can read the same data.
    // Falls back to .standard if the App Group isn't registered (e.g., first run on
    // a device where the group hasn't been provisioned yet).
    init(defaults: UserDefaults = UserDefaults(suiteName: "group.repo.Swiftly") ?? .standard) {
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
