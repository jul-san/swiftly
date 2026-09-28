import Foundation
import PDFKit

struct ResumeTextExtractor {

    // The resume's text read two ways: rebuilt from glyph positions (columns separated by
    // tabs, see `layoutText`), then PDFKit's own `page.string`. Callers should parse each
    // and keep the better result: the rebuilt text depends on glyph bounds, which some
    // PDFs report in ways this reconstruction doesn't expect.
    nonisolated func extractCandidates(from url: URL) -> Result<[String], ParsingError> {
        guard url.pathExtension.lowercased() == "pdf" else {
            return .failure(.unsupportedFileType)
        }

        guard let document = PDFDocument(url: url) else {
            return .failure(.invalidFile)
        }

        var layoutPages: [String] = []
        var plainPages: [String] = []
        for i in 0..<document.pageCount {
            guard let page = document.page(at: i) else { continue }
            let plain = page.string ?? ""
            if !plain.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                plainPages.append(plain)
            }
            let layout = layoutText(for: page) ?? plain
            if !layout.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                layoutPages.append(layout)
            }
        }

        // Pages are joined with a single newline: a job whose bullets continue onto the
        // next page is still one entry.
        let layout = layoutPages.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
        let plain = plainPages.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)

        guard max(layout.count, plain.count) >= 100 else {
            return .failure(.noExtractableText)
        }

        return .success(layout == plain || layout.count < 100 ? [plain] : [layout, plain])
    }

    // MARK: - Layout reconstruction

    private struct Glyph {
        let text: String
        let bounds: CGRect
        let ordinal: Int          // position in PDFKit's reading order
        let spaceBefore: Bool     // PDFKit put whitespace between this glyph and the previous one
    }

    private struct Row {
        var minY: CGFloat
        var maxY: CGFloat
        var glyphs: [Glyph]
    }

    // `page.string` follows the PDF's drawing order, which for LaTeX (Jake's Resume) and
    // Word resumes often separates a right-aligned date or location from the text it sits
    // beside, or puts it on the same line with nothing marking the gap. Rebuilding the text
    // from glyph positions keeps each visual row together and marks a wide horizontal gap
    // with a tab, so the parser can tell "Company<TAB>City, ST" columns apart.
    // Returns nil when PDFKit gives no usable glyph bounds, so the caller falls back to
    // `page.string`.
    private nonisolated func layoutText(for page: PDFPage) -> String? {
        guard let string = page.string, !string.isEmpty else { return nil }
        let raw = string as NSString

        var glyphs: [Glyph] = []
        var pendingSpace = false
        var index = 0
        while index < raw.length {
            let range = raw.rangeOfComposedCharacterSequence(at: index)
            index = NSMaxRange(range)
            let text = raw.substring(with: range)
            if text.rangeOfCharacter(from: CharacterSet.whitespacesAndNewlines.inverted) == nil {
                pendingSpace = true
                continue
            }
            let bounds = page.characterBounds(at: range.location)
            guard bounds.height > 0, bounds.width >= 0, !bounds.isNull, !bounds.isInfinite else { continue }
            glyphs.append(Glyph(text: text, bounds: bounds, ordinal: glyphs.count, spaceBefore: pendingSpace))
            pendingSpace = false
        }

        guard glyphs.count >= 20 else { return nil }
        return buildRows(from: glyphs).map(rowText).joined(separator: "\n")
    }

    // Groups glyphs into visual rows: top to bottom (PDF space has its origin at the bottom
    // left), with a glyph joining the current row when their vertical extents overlap by
    // more than half of the smaller height. Overlap rather than a shared baseline keeps a
    // smaller bullet glyph on the same row as its text.
    private nonisolated func buildRows(from glyphs: [Glyph]) -> [Row] {
        let sorted = glyphs.sorted {
            if $0.bounds.midY != $1.bounds.midY { return $0.bounds.midY > $1.bounds.midY }
            return $0.bounds.minX < $1.bounds.minX
        }
        var rows: [Row] = []
        for glyph in sorted {
            if var row = rows.last {
                let overlap = min(row.maxY, glyph.bounds.maxY) - max(row.minY, glyph.bounds.minY)
                if overlap > 0.5 * min(glyph.bounds.height, row.maxY - row.minY) {
                    row.glyphs.append(glyph)
                    rows[rows.count - 1] = row
                    continue
                }
            }
            rows.append(Row(minY: glyph.bounds.minY, maxY: glyph.bounds.maxY, glyphs: [glyph]))
        }
        return rows
    }

    // Joins a row's glyphs left to right. A gap wider than 1.5x the row's typical glyph
    // height is a column break (tab); otherwise PDFKit's own spacing decides, falling back
    // to the gap width when the glyphs weren't adjacent in PDFKit's reading order.
    private nonisolated func rowText(_ row: Row) -> String {
        let glyphs = row.glyphs.sorted { $0.bounds.minX < $1.bounds.minX }
        let heights = glyphs.map { $0.bounds.height }.sorted()
        let height = heights[heights.count / 2]

        var text = glyphs[0].text
        for (previous, glyph) in zip(glyphs, glyphs.dropFirst()) {
            let gap = glyph.bounds.minX - previous.bounds.maxX
            if gap > 1.5 * height {
                text += "\t"
            } else if glyph.ordinal == previous.ordinal + 1 {
                if glyph.spaceBefore { text += " " }
            } else if gap > 0.15 * height {
                text += " "
            }
            text += glyph.text
        }
        return text
    }
}
