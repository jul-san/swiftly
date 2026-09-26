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

    // Every word a section heading may contain. A line is a heading only when all of its
    // words come from this list, so combined headings ("Skills, Technologies, Awards, and
    // Interests", "Technical Skills and Interests") are recognized without listing every
    // combination, while content lines that merely contain "experience" are not.
    private static let headingVocabulary: Set<String> = [
        "education", "academic", "academics", "background", "history", "qualifications",
        "experience", "experiences", "work", "professional", "employment", "career",
        "internship", "internships", "industry", "research", "relevant", "related",
        "projects", "project", "selected", "personal", "side", "notable", "key", "open", "source",
        "skills", "skill", "technical", "technologies", "technology", "tools", "competencies",
        "core", "expertise", "languages", "frameworks", "libraries",
        "summary", "objective", "profile", "about", "me",
        "leadership", "activities", "involvement", "extracurricular", "extracurriculars",
        "volunteer", "volunteering", "service", "community", "campus", "organizations",
        "awards", "honors", "achievements", "certifications", "certificates", "licenses",
        "publications", "presentations", "interests", "hobbies", "coursework", "courses",
        "training", "teaching", "military", "additional", "other", "information",
        "and", "of", "my", "&",
    ]

    private struct RawSection {
        let kind: SectionKind
        let heading: String
        var lines: [String]
    }

    // One entry (a school, a job, a project) as laid out on the page: the header rows
    // naming it, then its bullet and "Label: value" detail lines.
    private struct EntryBlock {
        var headers: [String] = []
        var bullets: [String] = []
    }

    private enum HeaderPartKind {
        case title
        case location
        case plain
        case technologies
    }

    // MARK: - Public API

    nonisolated func parse(text: String, filename: String? = nil) -> Result<ResumeParsingResult, ParsingError> {
        let lines = normalizeLines(text)
        guard lines.contains(where: { !$0.isEmpty }) else {
            return .failure(.noExtractableText)
        }

        // PDF text extraction frequently puts a bullet glyph on its own line and wraps long
        // bullets onto lines with no marker. Repair both per section (never across a
        // section heading) before any entry parsing happens.
        var sections = splitIntoSections(lines).map { section -> RawSection in
            var s = section
            s.lines = mergeBulletMarkerLines(s.lines)
            return s
        }
        let bodyWidth = sections.flatMap { $0.lines }
            .filter { isBullet($0) || isDetailLine($0) }
            .map { $0.count }
            .max() ?? 0
        sections = sections.map { section -> RawSection in
            guard section.kind != .header else { return section }
            var s = section
            s.lines = joinWrappedLines(attachStandaloneDates(s.lines), bodyWidth: bodyWidth)
            return s
        }

        var warnings: [String] = []

        let personal = parsePersonalInfo(sections: sections)
        let education = parseEducation(sections: sections)
        let experience = parseExperience(sections: sections)
        let projects = parseProjects(sections: sections)
        let skills = parseSkills(sections: sections)

        if personal.fullName.isEmpty {
            warnings.append("Could not identify an applicant name.")
        }
        if experience.contains(where: { $0.company.isEmpty || $0.title.isEmpty }) {
            warnings.append("Some experience entries are missing a company or title.")
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

    private static let characterReplacements: [String: String] = [
        "\u{FB00}": "ff", "\u{FB01}": "fi", "\u{FB02}": "fl", "\u{FB03}": "ffi",
        "\u{FB04}": "ffl", "\u{FB05}": "st", "\u{FB06}": "st",
        "\u{00A0}": " ", "\u{2007}": " ", "\u{2009}": " ", "\u{202F}": " ",
        "\u{200B}": "", "\u{200C}": "", "\u{200D}": "", "\u{FEFF}": "", "\u{00AD}": "",
        "\r\n": "\n", "\r": "\n", "\u{2028}": "\n", "\u{2029}": "\n",
    ]

    // Trims each line and collapses runs of spaces, but keeps tabs: the text extractor
    // uses a tab to mark a wide gap between columns ("Company<TAB>City, ST"), which the
    // entry parsers rely on.
    private func normalizeLines(_ text: String) -> [String] {
        var text = text
        for (from, to) in Self.characterReplacements {
            text = text.replacingOccurrences(of: from, with: to)
        }
        return text.components(separatedBy: "\n").map { line in
            line.components(separatedBy: "\t")
                .map { $0.split(separator: " ", omittingEmptySubsequences: true).joined(separator: " ") }
                .filter { !$0.isEmpty }
                .joined(separator: "\t")
        }
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
        guard !trimmed.contains("@"), !trimmed.contains("\t"), !isBullet(trimmed) else { return nil }
        guard trimmed.rangeOfCharacter(from: .decimalDigits) == nil else { return nil }

        let words = trimmed.lowercased()
            .components(separatedBy: CharacterSet(charactersIn: " ,:/-–—").union(.whitespaces))
            .filter { !$0.isEmpty }
        guard !words.isEmpty, words.count <= 6 else { return nil }
        guard words.allSatisfy({ Self.headingVocabulary.contains($0) }) else { return nil }

        let set = Set(words)
        if set.contains("education") || (set.contains("academic") && !set.contains("projects")) {
            return .education
        }
        let experienceWords: Set<String> = ["experience", "experiences", "employment", "work",
                                            "career", "internship", "internships"]
        let activityWords: Set<String> = ["leadership", "volunteer", "volunteering", "activities",
                                          "extracurricular", "extracurriculars", "involvement",
                                          "service", "community", "teaching", "military"]
        if !set.isDisjoint(with: experienceWords) && set.isDisjoint(with: activityWords)
            && !set.contains("projects") && !set.contains("skills") {
            return .experience
        }
        if set.contains("projects") || set.contains("project") || set == ["open", "source"] {
            return .projects
        }
        let skillWords: Set<String> = ["skills", "skill", "technologies", "technology", "tools",
                                       "competencies", "expertise", "frameworks", "libraries"]
        if !set.isDisjoint(with: skillWords) {
            return .skills
        }
        if !set.isDisjoint(with: ["summary", "objective", "profile", "about"]) {
            return .summary
        }
        // A lone connector ("and", "of") is not a heading.
        let meaningful = set.subtracting(["and", "of", "my", "&"])
        return meaningful.isEmpty ? nil : .other
    }

    private func lines(of kind: SectionKind, in sections: [RawSection]) -> [String] {
        sections.filter { $0.kind == kind }.flatMap { $0.lines }
    }

    // MARK: - Personal info

    private func parsePersonalInfo(sections: [RawSection]) -> PersonalInfo {
        var personal = PersonalInfo()

        let headerLines = lines(of: .header, in: sections).filter { !$0.isEmpty }
        let allLines = sections.flatMap { $0.lines }

        personal.email = extractFirst(pattern: Self.emailRegex, from: headerLines)
            ?? extractFirst(pattern: Self.emailRegex, from: allLines)
        personal.phone = extractFirst(pattern: Self.phoneRegex, from: headerLines)
            ?? extractFirst(pattern: Self.phoneRegex, from: allLines)

        // Contact links are read token by token from the header, skipping email addresses,
        // so "jane@pm.me" isn't mistaken for the site "pm.me" while "jane.dev" on the same
        // line is still found.
        let tokens = headerLines.flatMap(contactSegments)
            .flatMap { $0.components(separatedBy: .whitespaces) }
            .map { $0.trimmingCharacters(in: CharacterSet(charactersIn: ",;()[]<>").union(.whitespaces)) }
            .filter { !$0.isEmpty && !$0.contains("@") }
        let urls = tokens.compactMap(contactURL)

        personal.linkedinURL = urls.first { $0.lowercased().contains("linkedin.com") }
            ?? allLines.flatMap { extractAll(pattern: Self.bareURLRegex, from: [$0]) + extractAll(pattern: Self.httpsURLRegex, from: [$0]) }
                .first { $0.lowercased().contains("linkedin.com/in/") }
                .map { normalizeURL(trimURL($0)) }
        personal.githubURL = urls.first { $0.lowercased().contains("github.com") }
        personal.website = urls.first {
            !$0.lowercased().contains("linkedin.com") && !$0.lowercased().contains("github.com")
        }

        // Name: the leftmost segment of the first header line that doesn't look like contact
        // data. Right-hand columns and "|"-separated contact details are separate segments.
        for line in headerLines {
            guard let first = contactSegments(line).first else { continue }
            let candidate = first
                .replacingOccurrences(of: #"\s*\([^)]*\)"#, with: "", options: .regularExpression)
                .trimmingCharacters(in: .whitespaces)
            if isNameCandidate(candidate) {
                let name = isAllCaps(candidate) ? candidate.lowercased().capitalized : candidate
                personal.fullName = name
                splitName(name, into: &personal)
                break
            }
        }

        personal.location = headerLines.flatMap(contactSegments).first(where: looksLikeCityState)
        return personal
    }

    // Splits a header line into its columns and "|" / "•"-separated pieces.
    private func contactSegments(_ line: String) -> [String] {
        line.components(separatedBy: CharacterSet(charactersIn: "\t|•·⋄◇♦"))
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
    }

    private func contactURL(_ token: String) -> String? {
        let token = trimURL(token)
        let r = NSRange(token.startIndex..., in: token)
        if Self.httpsURLRegex.firstMatch(in: token, range: r) != nil
            || Self.bareURLRegex.firstMatch(in: token, range: r) != nil
            || Self.bareDomainRegex.firstMatch(in: token, range: r) != nil {
            return normalizeURL(token)
        }
        return nil
    }

    private func isNameCandidate(_ text: String) -> Bool {
        guard !text.isEmpty, text.count <= 50 else { return false }
        guard text.rangeOfCharacter(from: .letters) != nil else { return false }
        guard text.rangeOfCharacter(from: CharacterSet(charactersIn: "@/:").union(.decimalDigits)) == nil else {
            return false
        }
        guard contactURL(text) == nil, !looksLikeCityState(text) else { return false }
        let words = text.components(separatedBy: .whitespaces).filter { !$0.isEmpty }
        return words.count >= 1 && words.count <= 5
    }

    private func isAllCaps(_ text: String) -> Bool {
        let letters = text.unicodeScalars.filter { CharacterSet.letters.contains($0) }
        return letters.count > 1 && text == text.uppercased()
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

    // MARK: - Entry segmentation

    // Groups a section's lines into entries. Header rows accumulate until the entry's
    // bullets begin; the next header row after bullets starts a new entry. Without bullets
    // in between, a new entry starts once the current header already has its date and
    // either the new row carries a date too (one-row headers) or two rows have been read
    // (Jake's Resume puts each entry on two rows: "School / City" then "Degree / Dates").
    private func segmentEntries(_ lines: [String]) -> [EntryBlock] {
        var blocks: [EntryBlock] = []
        for line in lines where !line.isEmpty {
            if isBullet(line) || isDetailLine(line) {
                if blocks.isEmpty { blocks.append(EntryBlock()) }
                blocks[blocks.count - 1].bullets.append(stripBullet(line))
                continue
            }
            guard let current = blocks.last, !current.headers.isEmpty || !current.bullets.isEmpty else {
                if blocks.isEmpty { blocks.append(EntryBlock()) }
                blocks[blocks.count - 1].headers.append(line)
                continue
            }
            let startsNew: Bool
            if !current.bullets.isEmpty {
                startsNew = true
            } else {
                let headerHasDate = current.headers.contains { dateColumn(in: $0) != nil }
                startsNew = headerHasDate && (dateColumn(in: line) != nil || current.headers.count >= 2)
            }
            if startsNew {
                blocks.append(EntryBlock(headers: [line]))
            } else {
                blocks[blocks.count - 1].headers.append(line)
            }
        }
        return blocks
    }

    // Splits a header row into columns: tab-separated when the extractor preserved the
    // layout, and a date at the very end of a column is split off either way.
    private func columns(of line: String) -> [String] {
        line.components(separatedBy: "\t")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
            .flatMap { column -> [String] in
                if isDate(column) { return [column] }
                if let range = trailingDateRange(in: column) {
                    let rest = String(column[..<range.lowerBound])
                        .trimmingCharacters(in: CharacterSet(charactersIn: " |–—-,·"))
                    let date = String(column[range]).trimmingCharacters(in: .whitespaces)
                    return rest.isEmpty ? [date] : [rest, date]
                }
                return [column]
            }
    }

    private func dateColumn(in line: String) -> String? {
        columns(of: line).first(where: isDate)
    }

    // MARK: - Education

    private func parseEducation(sections: [RawSection]) -> [EducationEntry] {
        let entries = segmentEntries(lines(of: .education, in: sections)).compactMap(parseEducationEntry)
        return deduplicated(entries) { "\($0.institution)|\($0.degree ?? "")|\($0.graduationDate ?? $0.endDate ?? "")" }
    }

    private func parseEducationEntry(_ block: EntryBlock) -> EducationEntry? {
        guard !block.headers.isEmpty else { return nil }
        var entry = EducationEntry(institution: "")

        var leftColumns: [String] = []
        for header in block.headers {
            for (index, column) in columns(of: header).enumerated() {
                if isDate(column) {
                    if entry.startDate == nil && entry.graduationDate == nil { assignDate(column, toEducation: &entry) }
                } else if let gpa = extractGPA(from: column), isGPAColumn(column) {
                    entry.gpa = entry.gpa ?? gpa
                } else if index > 0 && entry.location == nil {
                    entry.location = column
                } else {
                    leftColumns.append(column)
                }
            }
        }

        for column in leftColumns {
            var text = column
            if let gpa = extractGPA(from: text) {
                entry.gpa = entry.gpa ?? gpa
                text = text.replacingOccurrences(of: Self.gpaFragmentPattern, with: "", options: [.regularExpression, .caseInsensitive])
                    .trimmingCharacters(in: CharacterSet(charactersIn: " ,;|–—-"))
            }
            // "Institution - Degree" on one row
            var parts = [text]
            let split = splitOnDash(text).flatMap { $0.components(separatedBy: "|") }
                .map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
            if split.count >= 2, split.contains(where: hasInstitutionKeyword), split.contains(where: hasDegreeMarker) {
                parts = split
            }
            for part in parts {
                if entry.institution.isEmpty && hasInstitutionKeyword(part) {
                    entry.institution = part
                } else if entry.degree == nil && entry.fieldOfStudy == nil
                            && (hasDegreeMarker(part) || !entry.institution.isEmpty) {
                    parseDegree(part, into: &entry)
                } else if entry.institution.isEmpty {
                    entry.institution = part
                } else if entry.location == nil && looksLikeCityState(part) {
                    entry.location = part
                } else {
                    entry.details.append(part)
                }
            }
        }

        for text in block.bullets where !text.isEmpty {
            let lower = text.lowercased()
            if lower.hasPrefix("gpa") || lower.hasPrefix("cumulative gpa") || lower.hasPrefix("grade") {
                entry.gpa = entry.gpa ?? extractGPA(from: text)
            } else if lower.hasPrefix("award") || lower.hasPrefix("honor") || lower.hasPrefix("scholarship") {
                // "Awards: A, B (2023, 2024), C" lists several; a bare sentence is one.
                if let colon = text.firstIndex(of: ":"), text.distance(from: text.startIndex, to: colon) <= 20 {
                    entry.awards += parseTechList(String(text[text.index(after: colon)...]), maxLength: 200)
                } else {
                    entry.awards.append(text)
                }
            } else {
                entry.details.append(text)
            }
        }

        if entry.graduationDate != nil && !entry.currentOrPlanned {
            entry.currentOrPlanned = isFutureDate(entry.graduationDate!)
        }

        return entry.institution.isEmpty && entry.degree == nil ? nil : entry
    }

    private static let degreeAbbreviationRegex = try! NSRegularExpression(
        pattern: #"^((?:[A-Z][A-Za-z]{0,3}\.\s?){1,3}|[BMA][A-Z]{1,2}|MBA|PhD)\s+(?:(?:in|of)\s+)?(.+?)\.?$"#)

    private func parseDegree(_ text: String, into entry: inout EducationEntry) {
        let text = text.trimmingCharacters(in: CharacterSet(charactersIn: " ."))
        let r = NSRange(text.startIndex..., in: text)
        if let m = Self.degreeAbbreviationRegex.firstMatch(in: text, range: r),
           let degree = Range(m.range(at: 1), in: text), let field = Range(m.range(at: 2), in: text) {
            // "B.S. Computer Science", "B.S. in Computer Science", "MS Robotics"
            entry.degree = String(text[degree]).trimmingCharacters(in: .whitespaces)
            entry.fieldOfStudy = String(text[field])
        } else if let inRange = text.range(of: " in ", options: .caseInsensitive) {
            // "Bachelor of Science in Computer Science, Minor in Math"
            entry.degree = String(text[..<inRange.lowerBound])
            entry.fieldOfStudy = String(text[inRange.upperBound...])
        } else if hasDegreeMarker(text), let comma = text.firstIndex(of: ",") {
            entry.degree = String(text[..<comma]).trimmingCharacters(in: .whitespaces)
            entry.fieldOfStudy = String(text[text.index(after: comma)...]).trimmingCharacters(in: .whitespaces)
        } else if hasDegreeMarker(text) {
            entry.degree = text
        } else {
            entry.fieldOfStudy = text
        }
    }

    private static let institutionKeywords: Set<String> = [
        "university", "college", "institute", "school", "academy", "polytechnic",
        "conservatory", "universidad", "université", "universität", "universita", "hochschule",
    ]

    private func hasInstitutionKeyword(_ text: String) -> Bool {
        !words(of: text).isDisjoint(with: Self.institutionKeywords)
    }

    private static let degreeMarkerRegex = try! NSRegularExpression(
        pattern: #"\b(?:[Bb]achelor|[Mm]aster|[Aa]ssociate|[Dd]octor|[Dd]iploma|MBA|Ph\.?\s?D)|(?:^|\s)(?:[BMA]\.?\s?(?:S|A|Sc|Eng|Ed|F\.?A)\.?|B\.?\s?Tech|M\.?\s?Tech|J\.?D\.?)(?=[\s,]|$)"#)

    private func hasDegreeMarker(_ text: String) -> Bool {
        let r = NSRange(text.startIndex..., in: text)
        return Self.degreeMarkerRegex.firstMatch(in: text, range: r) != nil
    }

    // MARK: - Experience

    private func parseExperience(sections: [RawSection]) -> [ExperienceEntry] {
        var blocks: [EntryBlock] = []
        for block in segmentEntries(lines(of: .experience, in: sections)) {
            // A dateless one-row header after a dated entry, with no job title in it, is a
            // team or group within the same job (e.g. two sectors of one internship).
            if let previous = blocks.last, block.headers.count == 1,
               previous.headers.contains(where: { dateColumn(in: $0) != nil }),
               dateColumn(in: block.headers[0]) == nil,
               !block.headers[0].contains("\t"), !block.headers[0].contains("|"),
               !hasTitleKeyword(block.headers[0]) {
                blocks[blocks.count - 1].headers.append(block.headers[0])
                blocks[blocks.count - 1].bullets.append(contentsOf: block.bullets)
                continue
            }
            blocks.append(block)
        }

        var entries: [ExperienceEntry] = []
        for block in blocks {
            guard var entry = parseExperienceEntry(block) else { continue }
            // A second role listed under the same organization ("Vice President<TAB>Dates"
            // with no company row) belongs to the previous entry's company.
            if entry.company.isEmpty, let previous = entries.last {
                entry.company = previous.company
                entry.location = entry.location ?? previous.location
            }
            entries.append(entry)
        }
        return deduplicated(entries) { "\($0.company)|\($0.title)|\($0.startDate ?? "")" }
    }

    private func parseExperienceEntry(_ block: EntryBlock) -> ExperienceEntry? {
        guard !block.headers.isEmpty else { return nil }
        var entry = ExperienceEntry(company: "")

        // Right-hand columns first: dates and locations sit there in most layouts, and a
        // known location keeps a comma'd team name on the left from being read as a city.
        var leftColumns: [String] = []
        for header in block.headers {
            for (index, column) in columns(of: header).enumerated() {
                if isDate(column) {
                    if entry.startDate == nil { assignDate(column, toExperience: &entry) }
                } else if index > 0 && entry.location == nil {
                    entry.location = column
                } else {
                    leftColumns.append(column)
                }
            }
        }

        var titles: [String] = []
        var plain: [String] = []
        for column in leftColumns {
            for (kind, text) in headerParts(column, locationKnown: entry.location != nil) {
                switch kind {
                case .title: titles.append(text)
                case .location: entry.location = entry.location ?? text
                case .plain: plain.append(text)
                case .technologies: break
                }
            }
        }

        if let title = titles.first {
            entry.title = title
            entry.company = plain.first ?? ""
            entry.teamsOrGroups = Array(plain.dropFirst()) + titles.dropFirst()
        } else {
            // No recognizable job title: fall back to "Company" then "Title" in reading
            // order, splitting a lone "Company - Title" column on its dash.
            if plain.count == 1 {
                let dashParts = splitOnDash(plain[0])
                if dashParts.count == 2 { plain = dashParts }
            }
            entry.company = plain.first ?? ""
            entry.title = plain.count > 1 ? plain[1] : ""
            entry.teamsOrGroups = Array(plain.dropFirst(2))
        }

        entry.bullets = block.bullets.filter { !$0.isEmpty }
        return entry.company.isEmpty && entry.title.isEmpty ? nil : entry
    }

    // Breaks one header column into its parts: "Company – Title – City, ST" and
    // "Title | Python, React" both put several fields in one column. A dash only splits
    // the column when one of the pieces is recognizably a title or a location, so a name
    // like "Early-Stage Startup — Venture-Backed" stays whole.
    private func headerParts(_ column: String, locationKnown: Bool) -> [(HeaderPartKind, String)] {
        let pipeParts = column.components(separatedBy: "|")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
        guard let first = pipeParts.first else { return [] }

        var pieces: [(text: String, afterPipe: Bool)] = [(first, false)]
        let dashParts = splitOnDash(first)
        if dashParts.count >= 2,
           dashParts.contains(where: hasTitleKeyword)
            || dashParts.dropFirst().contains(where: looksLikeCityState) {
            pieces = dashParts.map { ($0, false) }
        }
        pieces += pipeParts.dropFirst().map { ($0, true) }

        var locationFound = locationKnown
        return pieces.enumerated().compactMap { index, piece -> (HeaderPartKind, String)? in
            let text = piece.text
            if looksLikeURL(text) { return nil }
            if hasTitleKeyword(text) { return (.title, text) }
            if index > 0 && !locationFound && looksLikeCityState(text) {
                locationFound = true
                return (.location, text)
            }
            // "Researcher | Python, PyTorch": a comma list after a pipe is the tech stack.
            if piece.afterPipe && text.contains(",") { return (.technologies, text) }
            return (.plain, text)
        }
    }

    private static let titleKeywords: Set<String> = [
        "intern", "internship", "engineer", "developer", "programmer", "researcher", "scientist",
        "analyst", "manager", "director", "lead", "head", "president", "vp", "founder",
        "cofounder", "member", "assistant", "associate", "consultant", "specialist",
        "coordinator", "officer", "fellow", "technician", "designer", "architect",
        "administrator", "chair", "chairman", "chairperson", "tutor", "instructor", "teacher",
        "ta", "volunteer", "representative", "contractor", "executive", "ceo", "cto", "cfo",
        "coo", "apprentice", "trainee", "mentor", "advisor", "adviser", "captain", "secretary",
        "treasurer", "editor", "writer", "strategist", "sde", "swe", "co-op", "coop",
        "freelancer", "owner", "partner", "principal", "staff",
    ]

    private func hasTitleKeyword(_ text: String) -> Bool {
        !words(of: text).isDisjoint(with: Self.titleKeywords)
    }

    // MARK: - Projects

    private func parseProjects(sections: [RawSection]) -> [ProjectEntry] {
        let entries = segmentEntries(lines(of: .projects, in: sections)).compactMap(parseProjectEntry)
        return deduplicated(entries) { $0.name.lowercased() }
    }

    private static let linkLabels: Set<String> = [
        "github", "link", "demo", "live", "website", "code", "source", "repo", "repository",
        "site", "app", "paper", "video", "devpost",
    ]

    private func parseProjectEntry(_ block: EntryBlock) -> ProjectEntry? {
        guard let headerLine = block.headers.first else { return nil }
        var entry = ProjectEntry(name: "")

        for (row, header) in block.headers.enumerated() {
            for (index, column) in columns(of: header).enumerated() {
                if isDate(column) || Self.linkLabels.contains(column.lowercased()) { continue }
                if looksLikeURL(column) {
                    entry.url = entry.url ?? normalizeURL(trimURL(column))
                } else if row == 0 && index == 0 {
                    parseProjectName(column, into: &entry)
                } else if let techs = technologiesFromLabel(column) {
                    entry.technologies += techs
                } else if index > 0 {
                    entry.technologies += parseTechList(column)
                } else {
                    entry.bullets.append(column)
                }
            }
        }
        if entry.name.isEmpty {
            entry.name = headerLine.replacingOccurrences(of: "\t", with: " ")
        }

        for text in block.bullets where !text.isEmpty {
            if let techs = technologiesFromLabel(text) {
                entry.technologies += techs
            } else {
                entry.bullets.append(text)
            }
        }
        entry.technologies = uniqued(entry.technologies)
        return entry.name.isEmpty ? nil : entry
    }

    private func parseProjectName(_ column: String, into entry: inout ProjectEntry) {
        // Split on | or · for inline metadata; fall back to a spaced dash
        // ("Name – Tech") when neither delimiter is present.
        var parts = column
            .components(separatedBy: CharacterSet(charactersIn: "|·"))
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
        if parts.count < 2 {
            let dashParts = splitOnDash(column)
            if dashParts.count >= 2 { parts = dashParts }
        }
        guard let name = parts.first else { return }
        entry.name = name

        for part in parts.dropFirst() {
            if looksLikeURL(part) {
                entry.url = entry.url ?? normalizeURL(trimURL(part))
            } else if !Self.linkLabels.contains(part.lowercased()) {
                entry.technologies += parseTechList(part)
            }
        }
    }

    private func technologiesFromLabel(_ text: String) -> [String]? {
        let lower = text.lowercased()
        let labels = ["technologies", "technology", "tech stack", "tech", "built with", "stack", "tools"]
        guard let label = labels.first(where: { lower.hasPrefix($0) }),
              let colon = text.firstIndex(of: ":"),
              text.distance(from: text.startIndex, to: colon) <= label.count + 6 else { return nil }
        return parseTechList(String(text[text.index(after: colon)...]))
    }

    // MARK: - Skills

    private static let programmingLanguages: Set<String> = [
        "c", "c++", "c#", "java", "python", "javascript", "typescript", "go", "golang", "rust",
        "swift", "kotlin", "ruby", "php", "sql", "r", "matlab", "scala", "haskell", "html",
        "css", "html/css", "bash", "shell", "assembly", "verilog", "vhdl", "lua", "perl", "dart",
        "julia", "objective-c", "elixir", "erlang", "ocaml", "f#", "fortran", "cobol", "zig",
        "clojure", "groovy", "powershell", "solidity", "latex", "prolog", "lisp", "scheme",
        "visual basic", "vba", "sas", "stata", "x86", "arm assembly", "cuda", "js", "ts",
    ]

    private func parseSkills(sections: [RawSection]) -> SkillsSection {
        var skills = SkillsSection()
        var currentCategory: String?

        for line in lines(of: .skills, in: sections) where !line.isEmpty {
            for segment in stripBullet(line).components(separatedBy: "\t") where !segment.isEmpty {
                let values: String
                if let colon = segment.firstIndex(of: ":"),
                   segment.distance(from: segment.startIndex, to: colon) <= 40 {
                    currentCategory = String(segment[..<colon]).trimmingCharacters(in: .whitespaces).lowercased()
                    values = String(segment[segment.index(after: colon)...])
                } else {
                    // A line without a label continues the previous category, or is an
                    // uncategorized list when there is none.
                    values = segment
                }
                add(parseTechList(values), category: currentCategory ?? "", to: &skills)
            }
        }

        skills.languages = uniqued(skills.languages)
        skills.tools = uniqued(skills.tools)
        skills.frameworks = uniqued(skills.frameworks)
        skills.other = uniqued(skills.other)
        return skills
    }

    private func add(_ items: [String], category: String, to skills: inout SkillsSection) {
        if category.contains("spoken") || category.contains("human") {
            skills.other += items
        } else if category.contains("language") {
            skills.languages += items
        } else if category.contains("framework") || category.contains("librar") {
            skills.frameworks += items
        } else if ["tool", "technolog", "platform", "software", "infrastructure", "hardware",
                   "database", "cloud", "devops"].contains(where: category.contains) {
            skills.tools += items
        } else if category.isEmpty || category.contains("skill") || category.contains("programming")
                    || category.contains("technical") || category.contains("proficien") {
            // A generic "Skills:" list: programming languages are recognizable by name.
            for item in items {
                if Self.programmingLanguages.contains(item.lowercased()) {
                    skills.languages.append(item)
                } else {
                    skills.other.append(item)
                }
            }
        } else {
            skills.other += items
        }
    }

    // MARK: - Date helpers

    private static let datePattern: String = {
        let month = #"(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?"#
        let season = #"(?:Spring|Summer|Fall|Autumn|Winter)"#
        let year = #"(?:19|20)\d{2}"#
        let monthYear = #"(?:(?:\#(month)|\#(season)),?\s+\#(year)|\d{1,2}/\#(year)|\#(year))"#
        let present = #"(?:Present|Current|Now|Today|Ongoing)"#
        let range = #"(?:\#(monthYear)|\#(month)|\#(season))\s*(?:–|—|-{1,3}|\bto\b)\s*(?:\#(monthYear)|\#(present))"#
        let prefix = #"(?:(?:Expected|Anticipated|Estimated|Est\.|Projected)(?:\s+(?:Start|Grad|Graduation|Completion|End))?:?\s+|(?:Graduated|Graduating|Graduation|Grad|Class of|Since|Starting|Start|Incoming):?\s+)?"#
        return #"\#(prefix)(?:\#(range)|\#(monthYear))(?:\s*\([^)]*\))?"#
    }()

    private static let fullDateRegex = try! NSRegularExpression(
        pattern: #"^\(?\#(datePattern)\)?$"#, options: .caseInsensitive)
    private static let trailingDateRegex = try! NSRegularExpression(
        pattern: #"(?:^|(?<=[\s|,(–—-]))\#(datePattern)$"#, options: .caseInsensitive)
    private static let rangeSeparatorRegex = try! NSRegularExpression(
        pattern: #"\s*(?:–|—|-{1,3}|\bto\b)\s*"#, options: .caseInsensitive)

    private func isDate(_ text: String) -> Bool {
        let r = NSRange(text.startIndex..., in: text)
        return Self.fullDateRegex.firstMatch(in: text, range: r) != nil
    }

    // A date ending a line that has no column break ("Acme Corp May 2024 – Present"). A
    // lone year doesn't count here: too many sentences end in one.
    private func trailingDateRange(in text: String) -> Range<String.Index>? {
        let r = NSRange(text.startIndex..., in: text)
        guard let m = Self.trailingDateRegex.firstMatch(in: text, range: r),
              let range = Range(m.range, in: text) else { return nil }
        let date = text[range]
        guard date.rangeOfCharacter(from: .letters) != nil || date.contains("–") || date.contains("-") || date.contains("/") else {
            return nil
        }
        return range
    }

    // Splits "Aug 2025 – Present" into its two ends. A parenthetical ("Summer 2026
    // (May – August)") stays with the date and never splits it.
    private func dateBounds(_ date: String) -> (start: String, end: String?) {
        let withoutParen = date.replacingOccurrences(of: #"\s*\([^)]*\)"#, with: "", options: .regularExpression)
        guard withoutParen == date else { return (date, nil) }
        let r = NSRange(date.startIndex..., in: date)
        guard let m = Self.rangeSeparatorRegex.firstMatch(in: date, range: r),
              let sep = Range(m.range, in: date) else { return (date, nil) }
        let start = date[..<sep.lowerBound].trimmingCharacters(in: .whitespaces)
        let end = date[sep.upperBound...].trimmingCharacters(in: .whitespaces)
        guard !start.isEmpty, !end.isEmpty else { return (date, nil) }
        return (start, end)
    }

    private func isPresent(_ text: String) -> Bool {
        ["present", "current", "now", "today", "ongoing"].contains(text.lowercased())
    }

    private func assignDate(_ dateStr: String, toEducation entry: inout EducationEntry) {
        let (start, end) = dateBounds(dateStr)
        if let end = end {
            entry.startDate = start
            if isPresent(end) {
                entry.currentOrPlanned = true
                entry.endDate = "Present"
            } else {
                entry.endDate = end
                entry.currentOrPlanned = isFutureDate(end)
            }
        } else {
            let lower = dateStr.lowercased()
            if lower.contains("start") || lower.hasPrefix("incoming") || lower.hasPrefix("since") {
                entry.startDate = dateStr
            } else {
                entry.graduationDate = dateStr
            }
            if ["expected", "anticipated", "estimated", "est.", "projected", "incoming", "start"]
                .contains(where: lower.contains) {
                entry.currentOrPlanned = true
            }
        }
    }

    private func assignDate(_ dateStr: String, toExperience entry: inout ExperienceEntry) {
        let (start, end) = dateBounds(dateStr)
        entry.startDate = start
        if let end = end {
            entry.current = isPresent(end)
            entry.endDate = entry.current ? nil : end
        }
    }

    // True when the last year mentioned in the date is after the current year.
    private func isFutureDate(_ date: String) -> Bool {
        let years = extractAll(pattern: Self.yearRegex, from: [date]).compactMap { Int($0) }
        guard let year = years.last else { return false }
        return year > Calendar.current.component(.year, from: Date())
    }

    // MARK: - Contact extraction

    private static let emailRegex = try! NSRegularExpression(
        pattern: #"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}"#)
    private static let phoneRegex = try! NSRegularExpression(
        pattern: #"(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]{0,2}\d{3}[-.\s]?\d{4}\b"#)
    private static let httpsURLRegex = try! NSRegularExpression(
        pattern: #"https?://[^\s|]+"#)
    private static let bareURLRegex = try! NSRegularExpression(
        pattern: #"(?:www\.|linkedin\.com/|github\.com/)[^\s|]*"#, options: .caseInsensitive)
    // A personal site on a custom domain (e.g. "jane.dev") written without "www." — only
    // ever matched against a single header token, see `contactURL`.
    private static let bareDomainRegex = try! NSRegularExpression(
        pattern: #"^[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*\.(?:com|dev|io|me|co|app|xyz|tech|net|org|ai|site|page|info|us|so|sh)(?:/\S*)?$"#,
        options: .caseInsensitive)
    private static let gpaRegex = try! NSRegularExpression(
        pattern: #"(?:GPA|G\.P\.A\.?)\s*:?\s*(\d\.\d{1,2}(?:\s*/\s*\d(?:\.\d{1,2})?)?)"#, options: .caseInsensitive)
    private static let gpaFragmentPattern = #"\(?\s*(?:Cumulative\s+)?(?:GPA|G\.P\.A\.?)\s*:?\s*\d\.\d{1,2}(?:\s*/\s*\d(?:\.\d{1,2})?)?\s*\)?"#
    private static let yearRegex = try! NSRegularExpression(pattern: #"(?:19|20)\d{2}"#)
    private static let cityStateRegex = try! NSRegularExpression(
        pattern: #"^[A-Z][A-Za-z.'\-]*(?:\s+[A-Z][A-Za-z.'\-]*){0,2},\s*(?:[A-Z]{2}|[A-Z][A-Za-z.'\-]*(?:\s+[A-Z][A-Za-z.'\-]*)?)$"#)

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
            return text[sr].replacingOccurrences(of: " ", with: "")
        }
        return nil
    }

    // A column that is only a GPA ("GPA: 3.9", "(GPA 3.80/4.00)").
    private func isGPAColumn(_ text: String) -> Bool {
        text.replacingOccurrences(of: Self.gpaFragmentPattern, with: "", options: [.regularExpression, .caseInsensitive])
            .trimmingCharacters(in: .whitespaces).isEmpty
    }

    // "City, ST", "City, Country": one comma, a few capitalized words either side. Used
    // where no column position says a piece of text is a location.
    private func looksLikeCityState(_ text: String) -> Bool {
        let r = NSRange(text.startIndex..., in: text)
        return Self.cityStateRegex.firstMatch(in: text, range: r) != nil
    }

    private func looksLikeURL(_ text: String) -> Bool {
        let r = NSRange(text.startIndex..., in: text)
        if Self.httpsURLRegex.firstMatch(in: text, range: r) != nil { return true }
        return Self.bareURLRegex.firstMatch(in: text, range: r) != nil
    }

    private func normalizeURL(_ raw: String) -> String {
        raw.lowercased().hasPrefix("http") ? raw : "https://\(raw)"
    }

    private func trimURL(_ raw: String) -> String {
        raw.trimmingCharacters(in: CharacterSet(charactersIn: ".,;:)(]["))
    }

    // MARK: - Bullet helpers

    private static let bulletChars: CharacterSet = {
        var cs = CharacterSet()
        for c in "•·–—*▪◦○●■□►▸‣⁃➢➤✓✔◆◇♦\u{F0B7}\u{F0A7}\u{F076}\u{F0D8}" { cs.insert(c.unicodeScalars.first!) }
        return cs
    }()

    private func isBullet(_ line: String) -> Bool {
        guard let first = line.unicodeScalars.first else { return false }
        if Self.bulletChars.contains(first) { return true }
        // Word's default second-level bullet is a Courier "o".
        return line.hasPrefix("- ") || line.hasPrefix("* ") || line.hasPrefix("o ") || line == "o"
    }

    private func stripBullet(_ line: String) -> String {
        var s = line.trimmingCharacters(in: .whitespaces)
        if let first = s.unicodeScalars.first, Self.bulletChars.contains(first) {
            s = String(s.dropFirst())
        } else if s.hasPrefix("- ") || s.hasPrefix("* ") || s.hasPrefix("o ") || s == "o" {
            s = String(s.dropFirst())
        }
        return s.replacingOccurrences(of: "\t", with: " ").trimmingCharacters(in: .whitespaces)
    }

    // "Relevant Coursework: …", "Awards: …", "Tech Stack: …" — a short label, a colon,
    // then content. These read like bullets even when they carry no bullet glyph.
    private static let detailLineRegex = try! NSRegularExpression(
        pattern: #"^[A-Z][A-Za-z/&'’ ]{1,32}:\s*[^\s\d]"#)

    private func isDetailLine(_ line: String) -> Bool {
        guard !line.contains("\t") else { return false }
        let r = NSRange(line.startIndex..., in: line)
        guard let m = Self.detailLineRegex.firstMatch(in: line, range: r),
              let range = Range(m.range, in: line) else { return false }
        let label = line[range].split(separator: ":").first ?? ""
        return label.split(separator: " ").count <= 4
    }

    // MARK: - Line repair

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
                    if next.isEmpty || isBullet(next) || dateColumn(in: next) != nil {
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

    // A date alone on a row belongs to the header row above it when that row has none
    // (text extraction sometimes emits a right-aligned date on its own line).
    private func attachStandaloneDates(_ lines: [String]) -> [String] {
        var result: [String] = []
        for line in lines {
            if isDate(line), let previous = result.last, !previous.isEmpty,
               !isBullet(previous), !isDetailLine(previous), dateColumn(in: previous) == nil {
                result[result.count - 1] = previous + "\t" + line
            } else {
                result.append(line)
            }
        }
        return result
    }

    // Re-joins a bullet (or "Label: value" line) that wrapped onto following lines with no
    // marker. A following line continues it when it can't be a header (no column break,
    // date, or "|") and either starts mid-sentence (lowercase, digit, symbol) or the line
    // above ran to the right margin without finishing its sentence. `bodyWidth` is the
    // length of the longest bullet line, standing in for the margin.
    private func joinWrappedLines(_ lines: [String], bodyWidth: Int) -> [String] {
        var result: [String] = []
        var previousIsBody = false
        for line in lines {
            if line.isEmpty {
                result.append(line)
                previousIsBody = false
                continue
            }
            if previousIsBody, let previous = result.last, isContinuation(line, of: previous, bodyWidth: bodyWidth) {
                let joiner = previous.hasSuffix("-") && !previous.hasSuffix(" -") ? "" : " "
                result[result.count - 1] = previous + joiner + line
                continue
            }
            result.append(line)
            previousIsBody = isBullet(line) || isDetailLine(line)
        }
        return result
    }

    private func isContinuation(_ line: String, of previous: String, bodyWidth: Int) -> Bool {
        guard !isBullet(line), !isDetailLine(line), !line.contains("\t"), !line.contains(" | "),
              dateColumn(in: line) == nil else { return false }
        if let first = line.unicodeScalars.first,
           CharacterSet.lowercaseLetters.contains(first)
            || CharacterSet.decimalDigits.contains(first)
            || CharacterSet(charactersIn: "($&%+/,;.—–-").contains(first) {
            return true
        }
        let finished = [".", "!", "?"].contains { previous.hasSuffix($0) }
        return !finished && Double(previous.count) >= Double(bodyWidth) * 0.8
    }

    // MARK: - Generic helpers

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

    private func words(of text: String) -> Set<String> {
        Set(text.lowercased()
            .components(separatedBy: CharacterSet.letters.union(CharacterSet(charactersIn: "-")).inverted)
            .flatMap { word -> [String] in
                // "Co-Chair" counts as both "co-chair" and "chair".
                word.contains("-") ? [word] + word.components(separatedBy: "-") : [word]
            }
            .filter { !$0.isEmpty })
    }

    // Splits a comma/semicolon list, keeping commas inside parentheses with their item:
    // "Atlassian (Jira, Confluence), Git" is two items.
    private func parseTechList(_ text: String, maxLength: Int = 60) -> [String] {
        var items: [String] = []
        var current = ""
        var depth = 0
        for ch in text {
            switch ch {
            case "(", "[": depth += 1; current.append(ch)
            case ")", "]": depth = max(0, depth - 1); current.append(ch)
            case "," where depth == 0, ";" where depth == 0:
                items.append(current); current = ""
            default: current.append(ch)
            }
        }
        items.append(current)
        return items
            .map { $0.trimmingCharacters(in: .whitespaces).trimmingCharacters(in: CharacterSet(charactersIn: ".")) }
            .map { $0.hasPrefix("and ") ? String($0.dropFirst(4)) : $0 }
            .filter { !$0.isEmpty && $0.count <= maxLength && $0.lowercased() != "etc" }
    }

    private func uniqued(_ items: [String]) -> [String] {
        var seen = Set<String>()
        return items.filter { seen.insert($0.lowercased()).inserted }
    }

    private func deduplicated<T>(_ entries: [T], key: (T) -> String) -> [T] {
        var seen = Set<String>()
        return entries.filter { seen.insert(key($0).lowercased()).inserted }
    }
}
