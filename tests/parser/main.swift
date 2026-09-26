import Foundation

// Resume parser tests. Run with `npm run test:parser` (or tests/parser/run.sh).
//
// The fixtures are synthetic resumes written in the text layout ResumeTextExtractor
// produces: one line per visual row, with a tab where a row has a wide gap between
// columns ("Company<TAB>City, ST"). Each one mirrors a real layout: Jake's Resume and
// its common variants, a Word resume, and a Google Docs resume. None contains a real
// applicant's details.

let fixturesDirectory = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "tests/parser/fixtures")

var currentTest = ""
var checks = 0
var failures = 0

func test(_ name: String, _ body: () -> Void) {
    currentTest = name
    body()
}

func expect<T: Equatable>(_ actual: T, _ expected: T, _ what: String, line: UInt = #line) {
    checks += 1
    if actual != expected {
        failures += 1
        print("FAIL [\(currentTest)] \(what) (main.swift:\(line))\n    expected: \(expected)\n    actual:   \(actual)")
    }
}

func parse(_ text: String) -> ResumeParsingResult? {
    switch ResumeParser().parse(text: text, filename: "resume.pdf") {
    case .success(let result):
        return result
    case .failure(let error):
        failures += 1
        print("FAIL [\(currentTest)] parse failed: \(error)")
        return nil
    }
}

func fixture(_ name: String) -> ApplicantProfile? {
    let url = fixturesDirectory.appendingPathComponent(name)
    guard let text = try? String(contentsOf: url, encoding: .utf8) else {
        failures += 1
        print("FAIL [\(currentTest)] missing fixture \(url.path)")
        return nil
    }
    return parse(text)?.profile
}

// MARK: - Jake's Resume

test("Jake's Resume template: title row first, then organization row") {
    guard let p = fixture("jakes-resume.txt") else { return }
    expect(p.personal.fullName, "Jake Ryan", "name")
    expect(p.personal.firstName, "Jake", "first name")
    expect(p.personal.lastName, "Ryan", "last name")
    expect(p.personal.email, "jake@su.edu", "email")
    expect(p.personal.phone, "123-456-7890", "phone")
    expect(p.personal.linkedinURL, "https://linkedin.com/in/jake", "LinkedIn")
    expect(p.personal.githubURL, "https://github.com/jake", "GitHub")
    expect(p.personal.website, nil, "no personal website")

    expect(p.education.count, 2, "education entries")
    expect(p.education.first?.institution, "Southwestern University", "institution")
    expect(p.education.first?.location, "Georgetown, TX", "school location")
    expect(p.education.first?.degree, "Bachelor of Arts", "degree")
    expect(p.education.first?.fieldOfStudy, "Computer Science, Minor in Business", "field of study")
    expect(p.education.first?.startDate, "Aug. 2018", "start date")
    expect(p.education.first?.endDate, "May 2021", "end date")
    expect(p.education.last?.institution, "Blinn College", "second institution")
    expect(p.education.last?.degree, "Associate’s", "associate degree")

    expect(p.experience.map(\.title), ["Undergraduate Research Assistant",
                                       "Information Technology Support Specialist",
                                       "Artificial Intelligence Research Assistant"], "titles")
    expect(p.experience.map(\.company), ["Texas A&M University", "Southwestern University",
                                         "Southwestern University"], "companies")
    expect(p.experience.map(\.location), ["College Station, TX", "Georgetown, TX", "Georgetown, TX"], "locations")
    expect(p.experience.map(\.bullets.count), [3, 3, 6], "bullets stay with their job")
    expect(p.experience.first?.current, true, "Present job is current")
    expect(p.experience.first?.startDate, "June 2020", "start date")
    expect(p.experience.first?.endDate, nil, "current job has no end date")
    expect(p.experience.last?.endDate, "July 2019", "end date")

    expect(p.projects.map(\.name), ["Gitlytics", "Simple Paintball"], "projects")
    expect(p.projects.first?.technologies, ["Python", "Flask", "React", "PostgreSQL", "Docker"], "project technologies")
    expect(p.projects.first?.bullets.count, 4, "project bullets")

    expect(p.skills.languages, ["Java", "Python", "C/C++", "SQL (Postgres)", "JavaScript", "HTML/CSS", "R"], "languages")
    expect(p.skills.frameworks, ["React", "Node.js", "Flask", "JUnit", "WordPress", "Material-UI", "FastAPI",
                                 "pandas", "NumPy", "Matplotlib"], "frameworks and libraries")
    expect(p.skills.tools.first, "Git", "developer tools")
    expect(p.skills.tools.count, 9, "developer tools count")
}

test("Jake's Resume, company row first, with Leadership and a combined skills heading") {
    guard let p = fixture("jakes-company-first.txt") else { return }
    expect(p.personal.fullName, "Alex Rivera", "all-caps name is title-cased")
    expect(p.personal.phone, "(555)-010-2233", "phone")
    expect(p.personal.email, "alex.rivera@example.com", "email")
    expect(p.personal.website, "https://alexrivera.dev", "website on the same line as the email")
    expect(p.personal.githubURL, "https://github.com/alexrivera-dev", "GitHub")

    expect(p.education.map(\.institution), ["Gulf Coast State University", "Northern Lights University"], "schools")
    expect(p.education.first?.degree, "B.S.", "degree")
    expect(p.education.first?.fieldOfStudy, "Computer Science", "field")
    expect(p.education.first?.graduationDate, "Expected December 2031", "expected graduation")
    expect(p.education.first?.currentOrPlanned, true, "expected degree is current")
    expect(p.education.last?.startDate, "March 2029", "exchange start")
    expect(p.education.last?.endDate, "June 2029", "exchange end")
    expect(p.education.last?.location, "Oslo, Norway", "exchange location")

    expect(p.experience.map(\.company), ["Harbor Analytics", "Bluewater Health", "Cedar Research Lab"],
           "companies (Leadership entries are not jobs)")
    expect(p.experience.map(\.title), ["Software Test Engineering Intern", "Software Engineering Intern",
                                       "Software Development Intern"], "titles")
    expect(p.experience.map(\.bullets.count), [1, 3, 2], "wrapped bullets are rejoined, not split")
    expect(p.experience.first?.bullets.first,
           "Writing integration tests in Java and Python for web, firmware, and device software.", "ligature expanded")
    expect(p.experience[1].bullets.first?.hasSuffix("using a shared calendar service and nightly conflict reports."),
           true, "wrapped bullet joined")

    expect(p.projects.map(\.name), ["BookSwap"], "project")
    expect(p.projects.first?.bullets.count, 2, "project bullets")

    expect(p.skills.languages, ["C++", "Python", "Java", "TypeScript", "SQL", "C"], "generic Skills: list of languages")
    expect(p.skills.tools, ["Angular", "React", "Next.js", "MongoDB", "Django", "Docker", "AWS"], "technologies")
    expect(p.skills.other.contains("Hiking"), true, "interests")
}

test("Jake's Resume, title and stack on one row, GPA column, regions instead of cities") {
    guard let p = fixture("title-with-stack.txt") else { return }
    expect(p.personal.email, nil, "no email is invented")
    expect(p.personal.phone, nil, "no phone is invented")

    expect(p.education.count, 1, "one school")
    expect(p.education.first?.institution, "Ivy League University", "institution")
    expect(p.education.first?.location, "Northeast US", "right-hand column is the location")
    expect(p.education.first?.degree, "B.S.", "degree")
    expect(p.education.first?.fieldOfStudy, "Electrical Engineering and Computer Science", "field")
    expect(p.education.first?.gpa, "3.80/4.00", "GPA")
    expect(p.education.first?.graduationDate, "May 2032", "graduation")
    expect(p.education.first?.details.count, 2, "detail bullets, wrapped coursework rejoined")

    expect(p.experience.map(\.title), ["Machine Learning Researcher", "Software Engineer", "Undergraduate Researcher"],
           "title without the tech stack")
    expect(p.experience.map(\.company), ["Large Public Research University",
                                         "Early-Stage Startup — Venture-Backed",
                                         "University School of Engineering and Applied Science"],
           "organization row; a dash inside a name doesn't split it")
    expect(p.experience.first?.location, "Asia", "region")
    expect(p.experience.first?.bullets.count, 2, "bullets")

    expect(p.projects.map(\.name), ["Transit Delay Tracker (Startup Project)", "Systems Programming Projects"], "projects")
    expect(p.projects.first?.technologies, ["Python", "FastAPI", "PostgreSQL", "S3 (boto3)"], "year column is not a technology")
    expect(p.skills.frameworks, ["FastAPI", "React", "Node.js", "Next.js", "TailwindCSS",
                                 "NumPy", "Pandas", "scikit-learn", "PyTorch", "OpenCV"], "frameworks + libraries")
}

// MARK: - Word and Google Docs layouts

test("Word layout: company and dates, then title, team and city; \"o\" bullets") {
    guard let p = fixture("word-layout.txt") else { return }
    expect(p.personal.fullName, "Morgan Lee", "name")
    expect(p.personal.location, "Denver, CO", "location from the contact line")
    expect(p.personal.phone, "(555) 010 4455", "phone")
    expect(p.personal.website, "https://morganlee.me", "website")
    expect(p.personal.linkedinURL, "https://linkedin.com/in/morgan-lee/", "LinkedIn")

    expect(p.education.map(\.institution), ["Front Range University", "Lakeside Polytechnic Institute"], "schools")
    expect(p.education.first?.degree, "Bachelor of Science", "degree")
    expect(p.education.first?.location, "Denver, CO", "location from the degree row")
    expect(p.education.first?.awards.count, 3, "awards list split, wrapped line rejoined")
    expect(p.education.first?.details, ["Relevant Coursework: Data Structures and Algorithms, Operating Systems, Computer Architecture."],
           "coursework detail")

    expect(p.experience.map(\.company), ["Mesa Applied Research Center", "Northwind Pharma", "Summit Aerospace"], "companies")
    expect(p.experience.map(\.title), ["Incoming Software Engineering Intern", "Software Engineering Intern",
                                       "Software Engineering Intern"], "titles")
    expect(p.experience.map(\.teamsOrGroups), [["Secure Communications"], ["AI Search (patientguide.example.com)"],
                                               ["Systems Engineering Group, Flight Test"]], "team after the title")
    expect(p.experience.map(\.location), ["Austin, TX", "Boston, MA", "Huntsville, AL"], "locations")
    expect(p.experience.first?.startDate, "Summer 2031 (May – August)", "season date kept whole")
    expect(p.experience[1].bullets.count, 2, "\"o\" bullets")

    expect(p.projects.map(\.name), ["Chess CLI", "Pocket Deck"], "projects")
    expect(p.projects.last?.technologies, ["Raspberry Pi 5", "Linux (Ubuntu)", "AutoCAD", "3D Printing"], "technologies")
    expect(p.skills.tools, ["Git", "Docker", "Node.js", "Atlassian Suite (Jira, BitBucket, Confluence, etc.)", "CMake"],
           "commas inside parentheses stay in one item")
}

test("Google Docs layout: one-row headers with dashes, teams inside one job, planned degree") {
    guard let p = fixture("google-docs-layout.txt") else { return }
    expect(p.personal.fullName, "Sam Patel", "name beside a right-hand contact column")
    expect(p.personal.email, "sam.patel@example.net", "email")
    expect(p.personal.website, "https://samp.me", "website")
    expect(p.personal.location, nil, "a comma'd tagline is not a location")

    expect(p.education.count, 2, "planned degree and current degree")
    expect(p.education.first?.institution, "", "no school invented for the planned degree")
    expect(p.education.first?.degree, "Prospective Master’s Degree", "planned degree")
    expect(p.education.first?.startDate, "Expected Start Aug 2032", "planned start")
    expect(p.education.first?.currentOrPlanned, true, "planned")
    expect(p.education.last?.institution, "Great Plains University", "institution before the dash")
    expect(p.education.last?.degree, "B.S.", "degree after the dash")
    expect(p.education.last?.graduationDate, "Expected Grad May 2032", "expected graduation")
    expect(p.education.last?.awards.count, 2, "awards")

    expect(p.experience.map(\.company), ["Orbital Robotics", "Riverside Applied Physics Center", "Evergreen Biotech"], "companies")
    expect(p.experience.map(\.location), ["Portland, OR", "Richmond, VA", "Seattle, WA"], "locations")
    expect(p.experience.first?.current, true, "current")
    expect(p.experience[1].teamsOrGroups, ["Defense Systems Sector (DSS) - Command Communications Group (CCG)",
                                           "Space Systems Sector (SSS) - Ground Applications Group (GAG)"],
           "team rows stay in the same job")
    expect(p.experience[1].bullets.count, 3, "bullets from both teams")

    expect(p.projects.map(\.name), ["Matrixy", "Chess CLI"], "projects")
    expect(p.projects.map(\.technologies), [["Rust"], ["C++20"]], "technology after the dash; link label ignored")
    expect(p.skills.tools.contains("PostgreSQL"), true, "Tools/Technologies category")
    expect(p.skills.frameworks.first, "LangChain", "Frameworks/Libraries category")
}

// MARK: - Plain text and edge cases

test("Plain text without column tabs, minimal resume, unusual dates") {
    guard let result = parse((try? String(contentsOf: fixturesDirectory.appendingPathComponent("plain-minimal.txt"), encoding: .utf8)) ?? "")
    else { return }
    let p = result.profile
    expect(p.personal.fullName, "Taylor Brooks", "name")
    expect(p.personal.phone, "555.010.7788", "phone")
    expect(p.personal.email, nil, "missing email stays missing")
    expect(p.personal.website, nil, "missing website stays missing")
    expect(p.experience.map(\.company), ["Acme Logistics", "Corner Café"], "companies")
    expect(p.experience.map(\.title), ["Warehouse Associate", "Barista"], "titles")
    expect(p.experience.first?.startDate, "05/2022", "numeric start")
    expect(p.experience.first?.endDate, "08/2023", "numeric end")
    expect(p.experience.last?.startDate, "2019", "year-only start")
    expect(p.experience.last?.endDate, "2022", "year-only end")
    expect(p.education.first?.institution, "Riverside Community College", "school")
    expect(p.education.first?.degree, "Associate of Science", "degree")
    expect(p.education.first?.fieldOfStudy, "Business", "field")
    expect(p.education.first?.graduationDate, "Summer 2024", "season graduation")
    expect(p.projects.isEmpty, true, "no projects section")
    expect(p.skills.languages.isEmpty && p.skills.other.isEmpty, true, "no skills section")
}

test("Bullets split from their glyph and wrapped lines are repaired") {
    let text = """
    Jordan Kim
    jordan@example.com
    Experience
    Globex\tRemote
    Backend Engineer\tJan 2020 – Mar 2022
    •
    Shipped the billing service.
    • Cut p99 latency by 40% by moving hot paths to a
    write-through cache.
    Education
    Metro State University\tMay 2019
    """
    guard let p = parse(text)?.profile else { return }
    expect(p.experience.first?.bullets, ["Shipped the billing service.",
                                         "Cut p99 latency by 40% by moving hot paths to a write-through cache."], "bullets")
    expect(p.experience.first?.location, "Remote", "location")
}

test("A second role under the same organization keeps the company") {
    let text = """
    Riley Chen
    Experience
    Initech\tDallas, TX
    Senior Engineer\tJan 2023 – Present
    • Led the payments team.
    Software Engineer\tJun 2020 – Dec 2022
    • Built the invoicing API.
    """
    guard let p = parse(text)?.profile else { return }
    expect(p.experience.map(\.company), ["Initech", "Initech"], "company carried over")
    expect(p.experience.map(\.title), ["Senior Engineer", "Software Engineer"], "titles")
    expect(p.experience.map(\.bullets.count), [1, 1], "bullets per role")
}

test("Duplicate entries are dropped and pronouns don't break the name") {
    let text = """
    Casey Nguyen (they/them)
    Experience
    Umbrella Corp – Data Analyst\tMay 2021 – Aug 2021
    • Built dashboards.
    Umbrella Corp – Data Analyst\tMay 2021 – Aug 2021
    • Built dashboards.
    """
    guard let p = parse(text)?.profile else { return }
    expect(p.personal.fullName, "Casey Nguyen", "name without pronouns")
    expect(p.experience.count, 1, "duplicate removed")
}

test("Text with no education or experience is an error, not a crash") {
    switch ResumeParser().parse(text: "Just a name\nand a line of text") {
    case .success: expect(false, true, "should fail")
    case .failure(let error):
        if case .insufficientData = error { expect(true, true, "insufficient data") }
        else { expect("\(error)", "insufficientData", "error kind") }
    }
    switch ResumeParser().parse(text: "   \n  ") {
    case .success: expect(false, true, "should fail")
    case .failure(let error):
        if case .noExtractableText = error { expect(true, true, "no text") }
        else { expect("\(error)", "noExtractableText", "error kind") }
    }
}

print("\(checks) checks, \(failures) failures")
exit(failures == 0 ? 0 : 1)
