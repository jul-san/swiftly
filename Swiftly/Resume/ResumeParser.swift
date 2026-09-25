import Foundation

struct ResumeParser {

    // MARK: - Section taxonomy

    private enum SectionKind {
        case header
        case summary
        case education
        case experience
        case projects
        case skills
        case other
    }

    private static let sectionKeywords: [(words: [String], kind: SectionKind)] = [
        (["experience", "work experience", "professional experience", "employment",
          "employment history", "work history", "career history", "career"], .experience),
        (["education", "academic background", "academic history", "academic experience",
          "academic qualifications"], .education),
        (["projects", "selected projects", "personal projects", "side projects",
          "notable projects", "key projects", "open source"], .projects),
        (["skills", "technical skills", "skills and interests", "skills & interests",
          "core competencies", "competencies", "technologies", "technical expertise",
          "tools & technologies"], .skills),
        (["summary", "objective", "profile", "professional summary",
          "career objective", "about me", "about"], .summary),
        (["certifications", "certificates", "awards", "honors", "publications",
          "interests", "activities", "volunteer", "volunteering", "languages"], .other),
    ]

    private struct RawSection {
        let kind: SectionKind
        let heading: String
        var lines: [String]
    }

    // MARK: - Public API

    nonisolated func parse(text: String, filename: String? = nil) -> Result<ResumeParsingResult, ParsingError> {
        let lines = normalizeLines(text)
        guard lines.contains(where: { !$0.isEmpty }) else {
            return .failure(.noExtractableText)
        }

        // PDFKit text extraction frequently puts a bullet glyph on its own line, separate
        // from the text that follows it. Re-attach them per-section (never across a section
        // heading) before any entry parsing happens.
        let sections = splitIntoSections(lines).map { section -> RawSection in
            var s = section
            s.lines = mergeBulletMarkerLines(s.lines)
            return s
        }
        var warnings: [String] = []

        let personal = parsePersonalInfo(sections: sections, warnings: &warnings)
        let education = parseEducation(sections: sections)
        let experience = parseExperience(sections: sections)
        let projects = parseProjects(sections: sections)
        let skills = parseSkills(sections: sections)

        if personal.fullName.isEmpty {
            warnings.append("Could not identify an applicant name.")
        }

        if experience.isEmpty && education.isEmpty {
            return .failure(.insufficientData("no experience or education sections found"))
        }

        var profile = ApplicantProfile(
            personal: personal,
            sourceMetadata: SourceMetadata(originalFilename: filename, parsedAt: Date())
        )
        profile.education = education
        profile.experience = experience
        profile.projects = projects
        profile.skills = skills

        return .success(ResumeParsingResult(profile: profile, warnings: warnings))
    }

    // MARK: - Normalization

    private func normalizeLines(_ text: String) -> [String] {
        text.components(separatedBy: .newlines)
            .map { $0.trimmingCharacters(in: .whitespaces) }
    }

    // MARK: - Section splitting

    private func splitIntoSections(_ lines: [String]) -> [RawSection] {
        var sections: [RawSection] = []
        var current = RawSection(kind: .header, heading: "", lines: [])

        for line in lines {
            if let kind = detectSectionHeading(line) {
                sections.append(current)
                current = RawSection(kind: kind, heading: line, lines: [])
            } else {
                current.lines.append(line)
            }
        }
        sections.append(current)

        return sections.filter {
            if case .header = $0.kind { return true }
            return !$0.lines.allSatisfy({ $0.isEmpty })
        }
    }

    private func detectSectionHeading(_ line: String) -> SectionKind? {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        guard trimmed.count >= 3, trimmed.count <= 60 else { return nil }
        guard !trimmed.contains("@"), !trimmed.hasPrefix("http") else { return nil }

        let wordCount = trimmed.components(separatedBy: .whitespaces).filter { !$0.isEmpty }.count
        guard wordCount <= 6 else { return nil }

        let normalized = trimmed
            .lowercased()
            .trimmingCharacters(in: CharacterSet(charactersIn: ":/-– \t"))

        for entry in Self.sectionKeywords {
            if entry.words.contains(normalized) {
                return entry.kind
            }
        }
        return nil
    }

    // MARK: - Personal info

    private func parsePersonalInfo(sections: [RawSection], warnings: inout [String]) -> PersonalInfo {
        var personal = PersonalInfo()

        let headerLines = sections.first(where: {
            if case .header = $0.kind { return true }; return false
        })?.lines ?? []

        let allLines = sections.flatMap { $0.lines }

        personal.email = extractFirst(pattern: Self.emailRegex, from: allLines)
        personal.phone = extractFirst(pattern: Self.phoneRegex, from: allLines)

        // Personal sites on custom domains (e.g. "jane.dev") only ever appear in the
        // header, so that search is scoped there (and email lines excluded, since an
        // address like "jane@pm.me" would otherwise match "pm.me" as a domain).
        let nonEmailHeaderLines = headerLines.filter { !$0.contains("@") }
        let urls = extractAll(pattern: Self.httpsURLRegex, from: allLines)
            + (extractAll(pattern: Self.bareURLRegex, from: allLines)
               + extractAll(pattern: Self.bareDomainRegex, from: nonEmailHeaderLines))
            .map { $0.hasPrefix("http") ? $0 : "https://\($0)" }

        personal.linkedinURL = urls.first { $0.contains("linkedin.com") }
        personal.githubURL = urls.first { $0.contains("github.com") }
        personal.website = urls.first {
            !$0.contains("linkedin.com") && !$0.contains("github.com")
        }

        // Name: first header line that doesn't look like contact data
        let contactChars = CharacterSet(charactersIn: "@/")
        let nameLine = headerLines.first { line in
            guard !line.isEmpty else { return false }
            guard !line.unicodeScalars.contains(where: contactChars.contains) else { return false }
            guard !looksLikePhone(line) else { return false }
            let words = line.components(separatedBy: .whitespaces).filter { !$0.isEmpty }
            return words.count >= 1 && words.count <= 6
        }

        if let raw = nameLine {
            let clean = raw
                .components(separatedBy: "|").first?
                .components(separatedBy: "•").first?
                .trimmingCharacters(in: .whitespaces) ?? raw
            personal.fullName = clean
            splitName(clean, into: &personal)
        }

        personal.location = extractLocation(from: headerLines)
        return personal
    }

    private func splitName(_ name: String, into personal: inout PersonalInfo) {
        let parts = name.components(separatedBy: .whitespaces).filter { !$0.isEmpty }
        switch parts.count {
        case 1:
            personal.firstName = parts[0]
        case 2:
            personal.firstName = parts[0]
            personal.lastName = parts[1]
        default:
            personal.firstName = parts[0]
            personal.middleName = parts.count == 3 ? parts[1] : nil
            personal.lastName = parts.last
        }
    }

    // MARK: - Education

    private func parseEducation(sections: [RawSection]) -> [EducationEntry] {
        guard let section = sections.first(where: {
            if case .education = $0.kind { return true }; return false
        }) else { return [] }

        let groups = groupByEntries(section.lines) { _, line in
            !isBullet(line) && extractDateRange(from: line).1 != nil
        }
        return groups.compactMap { parseEducationEntry($0) }
    }

    private func parseEducationEntry(_ lines: [String]) -> EducationEntry? {
        let headerLines = lines.filter { !isBullet($0) && !$0.isEmpty }
        let bulletLines = lines.filter { isBullet($0) }

        guard !headerLines.isEmpty else { return nil }

        var entry = EducationEntry(institution: "")

        let (mainText, date) = extractDateRange(from: headerLines[0])
        if let d = date { assignDate(d, toEducation: &entry) }

        let dashParts = splitOnDash(mainText)
        var consumed = 1
        if dashParts.count >= 2 {
            entry.institution = dashParts[0]
            parseDegree(dashParts.dropFirst().joined(separator: ", "), into: &entry)
        } else {
            entry.institution = mainText.trimmingCharacters(in: .whitespaces)
            if headerLines.count > 1 {
                parseDegree(headerLines[1], into: &entry)
                consumed = 2
            }
        }

        for line in headerLines.dropFirst(consumed) {
            if line.lowercased().contains("gpa") {
                entry.gpa = entry.gpa ?? extractGPA(from: line)
            } else if entry.location.isNilOrEmpty, looksLikeLocation(line) {
                entry.location = line
            } else {
                entry.details.append(line)
            }
        }

        for line in bulletLines {
            let text = stripBullet(line)
            guard !text.isEmpty else { continue }
            if text.lowercased().contains("gpa") || text.lowercased().contains("grade") {
                entry.gpa = entry.gpa ?? extractGPA(from: text)
            } else if text.lowercased().hasPrefix("award") {
                entry.awards.append(text)
            } else {
                entry.details.append(text)
            }
        }

        return entry.institution.isEmpty ? nil : entry
    }

    private func parseDegree(_ text: String, into entry: inout EducationEntry) {
        let lower = text.lowercased()
        let degreeMarkers = ["b.s", "bs ", "b.a", "ba ", "m.s", "ms ", "m.a", "ma ", "ph.d",
                             "phd", "bachelor", "master", "associate", "doctor", "b.eng",
                             "m.eng", "mba", "b.sc", "m.sc"]
        let hasDegree = degreeMarkers.contains { lower.contains($0) }

        if hasDegree {
            let parts = text.components(separatedBy: ",").map { $0.trimmingCharacters(in: .whitespaces) }
            if parts.count >= 2 {
                entry.degree = parts[0]
                entry.fieldOfStudy = parts[1...].joined(separator: ", ")
            } else if let inRange = text.range(of: " in ", options: .caseInsensitive) {
                entry.degree = String(text[text.startIndex..<inRange.lowerBound])
                entry.fieldOfStudy = String(text[inRange.upperBound...])
            } else {
                entry.degree = text
            }
        } else {
            entry.fieldOfStudy = text
        }
    }

    // MARK: - Experience

    private func parseExperience(sections: [RawSection]) -> [ExperienceEntry] {
        guard let section = sections.first(where: {
            if case .experience = $0.kind { return true }; return false
        }) else { return [] }

        let groups = groupByEntries(section.lines) { _, line in
            !isBullet(line) && extractDateRange(from: line).1 != nil
        }
        return groups.compactMap { parseExperienceEntry($0) }
    }

    private func parseExperienceEntry(_ lines: [String]) -> ExperienceEntry? {
        let headerLines = lines.filter { !isBullet($0) && !$0.isEmpty }
        let bulletLines = lines.filter { isBullet($0) }

        guard !headerLines.isEmpty else { return nil }

        var entry = ExperienceEntry(company: "")

        let (mainText, date) = extractDateRange(from: headerLines[0])
        if let d = date { assignDate(d, toExperience: &entry) }

        var consumed = 1
        let dashParts = splitOnDash(mainText)
        let pipeParts = mainText.components(separatedBy: "|").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }

        if dashParts.count >= 2 {
            entry.company = dashParts[0]
            entry.title = dashParts[1]
            if dashParts.count >= 3 { entry.location = dashParts[2] }
        } else if pipeParts.count >= 2 {
            entry.company = pipeParts[0]
            entry.title = pipeParts[1]
            if pipeParts.count >= 3 { entry.location = pipeParts[2] }
        } else {
            // Fall back to the older convention: company / title / location each on
            // their own line.
            entry.company = mainText.trimmingCharacters(in: .whitespaces)
            if headerLines.count > 1 {
                entry.title = headerLines[1]
                consumed = 2
            }
            if headerLines.count > 2, looksLikeLocation(headerLines[2]) {
                entry.location = headerLines[2]
                consumed = 3
            }
        }

        // Any remaining header lines (e.g. a sector/team name under the job title) don't
        // fit company/title/location — keep them without guessing which field they belong in.
        if headerLines.count > consumed {
            entry.teamsOrGroups.append(contentsOf: headerLines[consumed...])
        }

        entry.bullets = bulletLines.map { stripBullet($0) }.filter { !$0.isEmpty }
        return entry.company.isEmpty ? nil : entry
    }

    // MARK: - Projects

    private func parseProjects(sections: [RawSection]) -> [ProjectEntry] {
        guard let section = sections.first(where: {
            if case .projects = $0.kind { return true }; return false
        }) else { return [] }

        // Project headers rarely carry a date, so a new entry is instead recognized as a
        // non-bulleted line arriving after the current entry has already collected bullets.
        let groups = groupByEntries(section.lines) { current, line in
            !isBullet(line) && current.contains(where: isBullet)
        }
        return groups.compactMap { parseProjectEntry($0) }
    }

    private func parseProjectEntry(_ lines: [String]) -> ProjectEntry? {
        guard let headerLine = lines.first(where: { !$0.isEmpty && !isBullet($0) }) else {
            return nil
        }
        let bulletLines = lines.filter { isBullet($0) }

        var entry = ProjectEntry(name: "")

        // Split on | or · for inline metadata; fall back to a spaced dash
        // ("Name – Tech GitHub") when neither delimiter is present.
        var parts = headerLine
            .components(separatedBy: CharacterSet(charactersIn: "|·"))
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
        if parts.count < 2 {
            let dashParts = splitOnDash(headerLine)
            if dashParts.count >= 2 { parts = dashParts }
        }
        if parts.isEmpty { parts = [headerLine.trimmingCharacters(in: .whitespaces)] }

        entry.name = parts[0]

        for part in parts.dropFirst() {
            if looksLikeURL(part) {
                entry.url = entry.url ?? normalizeURL(part)
            } else {
                let techs = parseTechList(part)
                if !techs.isEmpty {
                    entry.technologies = techs
                }
            }
        }

        // Look for a technologies line in subsequent non-bullet lines
        for line in lines.dropFirst() {
            guard !line.isEmpty, !isBullet(line) else { continue }
            let (main, _) = extractDateRange(from: line)
            let lower = main.lowercased()
            if lower.hasPrefix("tech") || lower.hasPrefix("built with") || lower.hasPrefix("stack") {
                let techText = main.components(separatedBy: ":").dropFirst().joined(separator: ":").trimmingCharacters(in: .whitespaces)
                entry.technologies = parseTechList(techText)
            } else if looksLikeURL(line) {
                entry.url = entry.url ?? normalizeURL(line)
            }
        }

        entry.bullets = bulletLines.map { stripBullet($0) }.filter { !$0.isEmpty }
        return entry.name.isEmpty ? nil : entry
    }

    // MARK: - Skills

    private func parseSkills(sections: [RawSection]) -> SkillsSection {
        guard let section = sections.first(where: {
            if case .skills = $0.kind { return true }; return false
        }) else { return SkillsSection() }

        var skills = SkillsSection()

        for line in section.lines where !line.isEmpty {
            let parts = line.components(separatedBy: ":")
            if parts.count >= 2 {
                let category = parts[0].trimmingCharacters(in: .whitespaces).lowercased()
                let values = parts.dropFirst().joined(separator: ":").trimmingCharacters(in: .whitespaces)
                let items = parseTechList(values)

                if category.contains("language") {
                    skills.languages.append(contentsOf: items)
                } else if category.contains("framework") || category.contains("librar") {
                    skills.frameworks.append(contentsOf: items)
                } else if category.contains("tool") || category.contains("technolog") ||
                          category.contains("platform") || category.contains("software") ||
                          category.contains("infrastructure") {
                    skills.tools.append(contentsOf: items)
                } else {
                    skills.other.append(contentsOf: items)
                }
            } else if isBullet(line) {
                let items = parseTechList(stripBullet(line))
                skills.other.append(contentsOf: items)
            }
        }

        return skills
    }

    // MARK: - Date helpers

    // Matches "Month Year – Month Year" or "Month Year – Present" or "Year – Year"
    private static let dateRangeRegex: NSRegularExpression = {
        let months = "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)"
        let yearOrMonth = "(?:\(months)\\s+)?\\d{4}"
        let endToken = "(?:\(yearOrMonth)|[Pp]resent|[Cc]urrent|[Tt]oday)"
        let pattern = "\(yearOrMonth)\\s*[–—\\-]\\s*\(endToken)"
        return try! NSRegularExpression(pattern: pattern)
    }()

    // Matches standalone "Month Year" (for graduation dates)
    private static let singleDateRegex: NSRegularExpression = {
        let months = "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)"
        return try! NSRegularExpression(pattern: "(?:[Ee]xpected\\s+)?\(months)\\s+\\d{4}")
    }()

    private func extractDateRange(from line: String) -> (String, String?) {
        let range = NSRange(line.startIndex..., in: line)
        if let m = Self.dateRangeRegex.firstMatch(in: line, range: range),
           let r = Range(m.range, in: line) {
            let date = String(line[r])
            let rest = line.replacingCharacters(in: r, with: "")
                .trimmingCharacters(in: CharacterSet(charactersIn: " \t|–—-·,"))
            return (rest, date)
        }
        if let m = Self.singleDateRegex.firstMatch(in: line, range: range),
           let r = Range(m.range, in: line) {
            let date = String(line[r])
            let rest = line.replacingCharacters(in: r, with: "")
                .trimmingCharacters(in: CharacterSet(charactersIn: " \t|–—-·,"))
            return (rest, date)
        }
        return (line, nil)
    }

    private func assignDate(_ dateStr: String, toEducation entry: inout EducationEntry) {
        let sep = CharacterSet(charactersIn: "–—")
        if dateStr.unicodeScalars.contains(where: sep.contains) {
            let parts = dateStr.components(separatedBy: sep).map { $0.trimmingCharacters(in: .whitespaces) }
            if parts.count >= 2 {
                entry.startDate = parts[0].isEmpty ? nil : parts[0]
                let end = parts[1]
                let isPresent = ["present", "current", "today"].contains(end.lowercased())
                entry.currentOrPlanned = isPresent
                entry.endDate = isPresent ? "Present" : (end.isEmpty ? nil : end)
            }
        } else {
            entry.graduationDate = dateStr
            if dateStr.lowercased().contains("expected") { entry.currentOrPlanned = true }
        }
    }

    private func assignDate(_ dateStr: String, toExperience entry: inout ExperienceEntry) {
        let sep = CharacterSet(charactersIn: "–—")
        if dateStr.unicodeScalars.contains(where: sep.contains) {
            let parts = dateStr.components(separatedBy: sep).map { $0.trimmingCharacters(in: .whitespaces) }
            if parts.count >= 2 {
                entry.startDate = parts[0].isEmpty ? nil : parts[0]
                let end = parts[1]
                let isPresent = ["present", "current", "today"].contains(end.lowercased())
                entry.current = isPresent
                entry.endDate = isPresent ? nil : (end.isEmpty ? nil : end)
            }
        } else {
            if entry.startDate == nil { entry.startDate = dateStr }
        }
    }

    // MARK: - Contact extraction

    private static let emailRegex = try! NSRegularExpression(
        pattern: #"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}"#)
    private static let phoneRegex = try! NSRegularExpression(
        pattern: #"(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}"#)
    private static let httpsURLRegex = try! NSRegularExpression(
        pattern: #"https?://[^\s]+"#)
    private static let bareURLRegex = try! NSRegularExpression(
        pattern: #"(?:www\.|linkedin\.com|github\.com)[^\s]*"#)
    // Catches a personal site on a custom domain (e.g. "jane.dev", "jane.me") that isn't
    // prefixed with "www." — scoped to header lines only, see call site.
    private static let bareDomainRegex = try! NSRegularExpression(
        pattern: #"\b[a-zA-Z0-9-]+\.(?:me|dev|io|co|app|xyz|tech|net|org|com)(?:/[^\s]*)?\b"#,
        options: .caseInsensitive)
    private static let gpaRegex = try! NSRegularExpression(
        pattern: #"(?:GPA|G\.P\.A\.)\s*:?\s*(\d+\.\d+)"#, options: .caseInsensitive)
    private static let locationRegex = try! NSRegularExpression(
        pattern: #"[A-Z][a-zA-Z\s]{2,},\s*(?:[A-Z]{2}|[A-Za-z]{3,})"#)

    private func extractFirst(pattern: NSRegularExpression, from lines: [String]) -> String? {
        for line in lines {
            let r = NSRange(line.startIndex..., in: line)
            if let m = pattern.firstMatch(in: line, range: r), let sr = Range(m.range, in: line) {
                return String(line[sr])
            }
        }
        return nil
    }

    private func extractAll(pattern: NSRegularExpression, from lines: [String]) -> [String] {
        var results: [String] = []
        for line in lines {
            let r = NSRange(line.startIndex..., in: line)
            let matches = pattern.matches(in: line, range: r)
            for m in matches {
                if let sr = Range(m.range, in: line) {
                    results.append(String(line[sr]))
                }
            }
        }
        return results
    }

    private func extractGPA(from text: String) -> String? {
        let r = NSRange(text.startIndex..., in: text)
        if let m = Self.gpaRegex.firstMatch(in: text, range: r), m.numberOfRanges > 1,
           let sr = Range(m.range(at: 1), in: text) {
            return String(text[sr])
        }
        return nil
    }

    private func extractLocation(from lines: [String]) -> String? {
        for line in lines {
            guard !line.contains("@") else { continue }
            // Test each "|"-delimited segment on its own, and require it to be exactly
            // "something, something" (one comma) — a real "City, ST" won't have a third
            // comma-separated item, but a tagline like "Backend, Enterprise Tools,
            // Prototyping" will, so this rejects it without needing a city gazetteer.
            for segment in line.components(separatedBy: "|") {
                let trimmed = segment.trimmingCharacters(in: .whitespaces)
                guard trimmed.components(separatedBy: ",").count == 2 else { continue }
                let r = NSRange(trimmed.startIndex..., in: trimmed)
                if let m = Self.locationRegex.firstMatch(in: trimmed, range: r),
                   let sr = Range(m.range, in: trimmed) {
                    return String(trimmed[sr]).trimmingCharacters(in: .whitespacesAndNewlines)
                }
            }
        }
        return nil
    }

    private func looksLikePhone(_ line: String) -> Bool {
        let r = NSRange(line.startIndex..., in: line)
        return Self.phoneRegex.firstMatch(in: line, range: r) != nil
    }

    private func looksLikeURL(_ text: String) -> Bool {
        let r = NSRange(text.startIndex..., in: text)
        if Self.httpsURLRegex.firstMatch(in: text, range: r) != nil { return true }
        return Self.bareURLRegex.firstMatch(in: text, range: r) != nil
    }

    private func looksLikeLocation(_ text: String) -> Bool {
        let r = NSRange(text.startIndex..., in: text)
        return Self.locationRegex.firstMatch(in: text, range: r) != nil
    }

    private func normalizeURL(_ raw: String) -> String {
        raw.hasPrefix("http") ? raw : "https://\(raw)"
    }

    // MARK: - Bullet helpers

    private static let bulletChars: CharacterSet = {
        var cs = CharacterSet()
        for c in "•·–—*▪◦○●" { cs.insert(c.unicodeScalars.first!) }
        return cs
    }()

    private func isBullet(_ line: String) -> Bool {
        guard let first = line.unicodeScalars.first else { return false }
        if Self.bulletChars.contains(first) { return true }
        return line.hasPrefix("- ") || line.hasPrefix("* ")
    }

    private func stripBullet(_ line: String) -> String {
        var s = line.trimmingCharacters(in: .whitespaces)
        if let first = s.unicodeScalars.first, Self.bulletChars.contains(first) {
            s = String(s.dropFirst()).trimmingCharacters(in: .whitespaces)
        } else if s.hasPrefix("- ") || s.hasPrefix("* ") {
            s = String(s.dropFirst(2)).trimmingCharacters(in: .whitespaces)
        }
        return s
    }

    // MARK: - Generic helpers

    // Some PDF exports drop the bullet glyph onto its own line, separated from the text
    // that follows it (e.g. "\u{2022}\nBuilt a thing." instead of "\u{2022} Built a thing.").
    // Re-attach a lone marker line to the non-empty, non-bulleted, dateless lines that
    // follow it, stopping at the next bullet, a blank line, or a line that looks like the
    // start of a new entry (i.e. carries a date).
    private func mergeBulletMarkerLines(_ lines: [String]) -> [String] {
        var result: [String] = []
        var i = 0
        while i < lines.count {
            let line = lines[i]
            if isBullet(line), stripBullet(line).isEmpty {
                var continuation: [String] = []
                var j = i + 1
                while j < lines.count {
                    let next = lines[j]
                    if next.isEmpty || isBullet(next) || extractDateRange(from: next).1 != nil {
                        break
                    }
                    continuation.append(next)
                    j += 1
                    // A line ending in terminal punctuation is a complete sentence — the
                    // bullet is done. Without this, a bullet with no date after it (e.g. in
                    // a Projects section) would swallow the next entry's header line too.
                    if next.hasSuffix(".") || next.hasSuffix("!") || next.hasSuffix("?") {
                        break
                    }
                }
                if !continuation.isEmpty {
                    result.append("• " + continuation.joined(separator: " "))
                    i = j
                    continue
                }
            }
            result.append(line)
            i += 1
        }
        return result
    }

    // Splits on a dash (en dash, em dash, or hyphen) only when it's surrounded by spaces,
    // so hyphenated words like "Part-time" or "C#/.NET" are left intact. Used to pull
    // "Company – Title – Location" or "Institution - Degree" apart when a resume puts them
    // on a single line rather than one field per line.
    private func splitOnDash(_ text: String) -> [String] {
        var unified = text
        for token in [" – ", " — ", " - "] {
            unified = unified.replacingOccurrences(of: token, with: "\u{1}")
        }
        return unified.components(separatedBy: "\u{1}")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
    }

    // Groups a section's lines into entries. A blank line always starts a new entry (when
    // a resume preserves that structure); `isBoundary` additionally recognizes an entry
    // header even when no blank line separates it from the previous entry, which real PDF
    // text extraction frequently fails to preserve.
    private func groupByEntries(_ lines: [String], isBoundary: ([String], String) -> Bool) -> [[String]] {
        var groups: [[String]] = []
        var forceBoundary = false
        for line in lines {
            if line.isEmpty {
                forceBoundary = true
                continue
            }
            let current = groups.last ?? []
            if groups.isEmpty || forceBoundary || isBoundary(current, line) {
                groups.append([line])
            } else {
                groups[groups.count - 1].append(line)
            }
            forceBoundary = false
        }
        return groups
    }

    private func parseTechList(_ text: String) -> [String] {
        text.components(separatedBy: CharacterSet(charactersIn: ",;"))
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty && $0.count <= 40 }
    }
}

private extension Optional where Wrapped == String {
    var isNilOrEmpty: Bool { self == nil || self!.isEmpty }
}
