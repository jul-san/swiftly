import Foundation
import PDFKit

struct ResumeTextExtractor {

    nonisolated func extract(from url: URL) -> Result<String, ParsingError> {
        guard url.pathExtension.lowercased() == "pdf" else {
            return .failure(.unsupportedFileType)
        }

        guard let document = PDFDocument(url: url) else {
            return .failure(.invalidFile)
        }

        var pageTexts: [String] = []
        for i in 0..<document.pageCount {
            guard let page = document.page(at: i) else { continue }
            if let text = page.string, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                pageTexts.append(text)
            }
        }

        let combined = pageTexts.joined(separator: "\n\n")
        let trimmed = combined.trimmingCharacters(in: .whitespacesAndNewlines)

        guard trimmed.count >= 100 else {
            return .failure(.noExtractableText)
        }

        return .success(trimmed)
    }
}
