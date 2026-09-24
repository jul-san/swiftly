import Foundation

struct PersonalInfo: Codable {
    var fullName: String
    var firstName: String?
    var middleName: String?
    var lastName: String?
    var email: String?
    var phone: String?
    var location: String?
    var website: String?
    var linkedinURL: String?
    var githubURL: String?
    var pronouns: String?
    var genderIdentity: String?
    var raceEthnicity: String?
    var workAuthorization: String?
    var requiresSponsorship: String?
    var veteranStatus: String?
    var disabilityStatus: String?

    init(fullName: String = "") {
        self.fullName = fullName
    }
}

struct EducationEntry: Codable, Identifiable {
    var id: UUID
    var institution: String
    var degree: String?
    var fieldOfStudy: String?
    var location: String?
    var startDate: String?
    var endDate: String?
    var graduationDate: String?
    var currentOrPlanned: Bool
    var gpa: String?
    var awards: [String]
    var details: [String]

    init(institution: String) {
        self.id = UUID()
        self.institution = institution
        self.currentOrPlanned = false
        self.awards = []
        self.details = []
    }
}

struct ExperienceEntry: Codable, Identifiable {
    var id: UUID
    var company: String
    var title: String
    var location: String?
    var startDate: String?
    var endDate: String?
    var current: Bool
    var teamsOrGroups: [String]
    var bullets: [String]

    init(company: String, title: String = "") {
        self.id = UUID()
        self.company = company
        self.title = title
        self.current = false
        self.teamsOrGroups = []
        self.bullets = []
    }
}

struct ProjectEntry: Codable, Identifiable {
    var id: UUID
    var name: String
    var url: String?
    var technologies: [String]
    var bullets: [String]

    init(name: String) {
        self.id = UUID()
        self.name = name
        self.technologies = []
        self.bullets = []
    }
}

struct SkillsSection: Codable {
    var languages: [String]
    var tools: [String]
    var frameworks: [String]
    var other: [String]

    init() {
        self.languages = []
        self.tools = []
        self.frameworks = []
        self.other = []
    }
}

struct SourceMetadata: Codable {
    var originalFilename: String?
    var parsedAt: Date
    var schemaVersion: Int

    init(originalFilename: String? = nil, parsedAt: Date = Date(), schemaVersion: Int = 1) {
        self.originalFilename = originalFilename
        self.parsedAt = parsedAt
        self.schemaVersion = schemaVersion
    }
}

struct ApplicantProfile: Codable {
    var personal: PersonalInfo
    var education: [EducationEntry]
    var experience: [ExperienceEntry]
    var projects: [ProjectEntry]
    var skills: SkillsSection
    var sourceMetadata: SourceMetadata

    init(personal: PersonalInfo, sourceMetadata: SourceMetadata) {
        self.personal = personal
        self.education = []
        self.experience = []
        self.projects = []
        self.skills = SkillsSection()
        self.sourceMetadata = sourceMetadata
    }
}
