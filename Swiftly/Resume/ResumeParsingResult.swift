import Foundation

enum ParsingError: Error, LocalizedError {
    case unsupportedFileType
    case noExtractableText
    case insufficientData(String)
    case invalidFile

    var errorDescription: String? {
        switch self {
        case .unsupportedFileType:
            return "Unsupported file type. Please upload a PDF resume."
        case .noExtractableText:
            return "No text could be extracted from this PDF. It may consist of scanned images. Try a text-based PDF."
        case .insufficientData(let detail):
            return "Could not parse a complete profile: \(detail). Please check the resume and try again."
        case .invalidFile:
            return "The file could not be read. Please try again."
        }
    }
}

struct ResumeParsingResult {
    let profile: ApplicantProfile
    let warnings: [String]
}
