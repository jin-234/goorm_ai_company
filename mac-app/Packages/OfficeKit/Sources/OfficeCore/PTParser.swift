import Foundation

/// 아침 PT 전사문을 기기 안 규칙으로 읽어 업무 초안을 만든다.
///
/// Solar에 연결하지 못했을 때 쓰는 간이 정리다. AI가 아니라 정해진 규칙이므로
/// 양식("3단계 필수 업무는 ~입니다. 오후 3시까지 ~하겠습니다.")에 가깝게 말할수록 잘 읽는다.
/// 전사문에 없는 값은 nil로 두어 화면에 '확인 필요'로 보이게 한다.
public enum PTParser {

    public static func parse(_ transcript: String, workEnd: Int = WorkRules.defaultWorkEnd) -> [TaskDraft] {
        let text = normalize(transcript)
        guard !text.isEmpty else { return [] }

        let markers = levelMarkers(in: text)
        var drafts: [TaskDraft] = []

        if markers.isEmpty {
            for sentence in sentences(of: text) {
                if let draft = draft(fromFreeSentence: sentence, workEnd: workEnd) {
                    drafts.append(draft)
                }
            }
        } else {
            for (index, marker) in markers.enumerated() {
                let end = index + 1 < markers.count ? markers[index + 1].range.lowerBound : text.endIndex
                let segment = String(text[marker.range.upperBound..<end])
                drafts.append(draft(fromSegment: segment, level: marker.level, workEnd: workEnd))
            }
        }

        // 중요도가 높은 순서로. 단계를 모르는 업무는 뒤에 둔다.
        return drafts.enumerated().sorted { lhs, rhs in
            let left = lhs.element.level?.rawValue ?? 0
            let right = rhs.element.level?.rawValue ?? 0
            return left != right ? left > right : lhs.offset < rhs.offset
        }.map(\.element)
    }

    // MARK: - 단계 표시 찾기

    struct LevelMarker {
        var level: TaskLevel
        var range: Range<String.Index>
    }

    static func levelMarkers(in text: String) -> [LevelMarker] {
        // "3단계부터 1단계 순서로 말씀드리겠습니다" 같은 안내 말은 업무가 아니다.
        let pattern = "(3|2|1|삼|이|일|세|두|한|쓰리|투|원)\\s*단계(?!\\s*(?:부터|까지|순서|순으로|에서|별로))"
        return matches(pattern, in: text).compactMap { match in
            guard let whole = Range(match.range, in: text),
                  let numberRange = Range(match.range(at: 1), in: text) else { return nil }
            let level: TaskLevel
            switch String(text[numberRange]) {
            case "3", "삼", "세", "쓰리": level = .mustFinish
            case "2", "이", "두", "투": level = .sameDay
            default: level = .carryable
            }
            return LevelMarker(level: level, range: whole)
        }
    }

    // MARK: - 구간 → 초안

    static func draft(fromSegment raw: String, level: TaskLevel, workEnd: Int) -> TaskDraft {
        let body = stripLead(raw)
        let due = deadline(in: body, workEnd: workEnd)?.minutes
        let parts = sentences(of: body)
        guard let first = parts.first else { return TaskDraft(level: level, due: due) }

        let title: String
        if let noun = nominalTitle(removingDeadline(from: first, workEnd: workEnd)) {
            title = noun
        } else {
            title = actionPhrase(removingDeadline(from: first, workEnd: workEnd))
        }
        let criteria = parts.dropFirst()
            .map { actionPhrase(removingDeadline(from: $0, workEnd: workEnd)) }
            .filter { !$0.isEmpty }
            .joined(separator: ", ")

        return TaskDraft(title: title.isEmpty ? nil : title,
                         level: level,
                         due: due,
                         doneCriteria: criteria.isEmpty ? nil : criteria)
    }

    static func draft(fromFreeSentence sentence: String, workEnd: Int) -> TaskDraft? {
        let fillers = ["안녕하세요", "안녕하십니까", "시작하겠습니다", "말씀드리겠습니다", "발표하겠습니다",
                       "이상입니다", "감사합니다", "수고하셨습니다", "아침 PT", "아침 피티"]
        if fillers.contains(where: { sentence.contains($0) }) { return nil }
        let due = deadline(in: sentence, workEnd: workEnd)?.minutes
        let cleaned = removingDeadline(from: sentence, workEnd: workEnd)
        let title = nominalTitle(cleaned) ?? actionPhrase(cleaned)
        guard title.count >= 2 else { return nil }
        return TaskDraft(title: title, level: nil, due: due, doneCriteria: nil)
    }

    /// "필수 업무는 지원서 최종 검토입니다" → "지원서 최종 검토입니다"
    static func stripLead(_ raw: String) -> String {
        var text = raw.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines.union(CharacterSet(charactersIn: ",:·-")))
        // 단계 이름 뒤에 바로 붙은 조사: "3단계는 …", "3단계로는 …"
        text = replacing("^(?:로는|으로는|는|은)\\s+", in: text, with: "")
        // 단계 설명과 '업무는' 같은 말머리
        let lead = "^(?:필수\\s*마감|필수|당일\\s*완료|당일|이월\\s*가능)?\\s*(?:(?:업무|과제|할\\s*일)\\s*(?:로는|는|은)?)?\\s*"
        text = replacing(lead, in: text, with: "")
        return text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// "지원서 최종 검토입니다" → "지원서 최종 검토". 명사로 끝나는 문장이 아니면 nil.
    static func nominalTitle(_ sentence: String) -> String? {
        let text = trimSentence(sentence)
        let pattern = "^(.+?)\\s*(?:입니다|이에요|예요|이고요|이구요|이며|이고)$"
        guard let match = matches(pattern, in: text).first,
              let range = Range(match.range(at: 1), in: text) else { return nil }
        let title = String(text[range]).trimmingCharacters(in: .whitespacesAndNewlines)
        return title.isEmpty ? nil : title
    }

    /// 하겠다는 말을 끝내는 조건 문구로 바꾼다.
    /// "오탈자를 확인하고 제출본을 저장하겠습니다" → "오탈자를 확인하고 제출본을 저장"
    /// "문단을 쓰겠습니다" → "문단을 쓰기"
    static func actionPhrase(_ sentence: String) -> String {
        let text = trimSentence(sentence)
        guard !text.isEmpty else { return "" }

        // "보내도록 하겠습니다" → "보내기"
        if let match = matches("^(.*\\S)도록\\s*하겠(?:습니다|어요)$", in: text).first,
           let range = Range(match.range(at: 1), in: text) {
            return String(text[range]) + "기"
        }

        let doEndings = "(?:하겠습니다|하겠어요|할게요|할\\s*예정입니다|할\\s*계획입니다|하려고\\s*합니다|하려\\s*합니다|할\\s*겁니다|할\\s*것입니다|할\\s*거예요|합니다)"
        if let match = matches("^(.*?)(\\s*)\(doEndings)$", in: text).first,
           let stemRange = Range(match.range(at: 1), in: text),
           let gapRange = Range(match.range(at: 2), in: text) {
            let stem = String(text[stemRange])
            guard !stem.isEmpty else { return text }
            // "정리를 하겠습니다"처럼 띄어 쓴 경우는 "정리를 하기"
            return text[gapRange].isEmpty ? stem : stem + " 하기"
        }

        if let match = matches("^(.*\\S)겠(?:습니다|어요)$", in: text).first,
           let range = Range(match.range(at: 1), in: text) {
            return String(text[range]) + "기"
        }
        return text
    }

    // MARK: - 마감

    struct Deadline {
        var minutes: Int
        var range: Range<String.Index>
    }

    private static let hourWords: [String: Int] = [
        "한": 1, "두": 2, "세": 3, "네": 4, "다섯": 5, "여섯": 6,
        "일곱": 7, "여덟": 8, "아홉": 9, "열": 10, "열한": 11, "열두": 12,
    ]

    private static let minuteWords: [String: Int] = [
        "십": 10, "십오": 15, "이십": 20, "삼십": 30, "사십": 40, "사십오": 45, "오십": 50,
    ]

    /// 문장에서 가장 먼저 나오는 마감 표현을 찾는다.
    static func deadline(in text: String, workEnd: Int) -> Deadline? {
        var found: [Deadline] = []
        let untilWords = "(?:까지|전까지|이전까지|전에|이전에|안에|안으로)"

        // 오후 3시까지, 세 시 반까지, 15시 30분까지
        let clock = "(오전|오후|아침|저녁|낮|밤)?\\s*(\\d{1,2}|열한|열두|다섯|여섯|일곱|여덟|아홉|열|한|두|세|네)\\s*시(?!간)\\s*(?:(\\d{1,2}|사십오|십오|삼십|이십|사십|오십|십)\\s*분|(반))?\\s*\(untilWords)"
        for match in matches(clock, in: text) {
            guard let range = Range(match.range, in: text),
                  let hourRange = Range(match.range(at: 2), in: text) else { continue }
            let hourText = String(text[hourRange])
            guard let rawHour = Int(hourText) ?? hourWords[hourText], (0...24).contains(rawHour) else { continue }
            let half = Range(match.range(at: 1), in: text).map { String(text[$0]) }
            var minute = 0
            if let minuteRange = Range(match.range(at: 3), in: text) {
                let minuteText = String(text[minuteRange])
                minute = Int(minuteText) ?? minuteWords[minuteText] ?? 0
            } else if Range(match.range(at: 4), in: text) != nil {
                minute = 30
            }
            guard (0..<60).contains(minute) else { continue }
            found.append(Deadline(minutes: resolveHour(rawHour, half: half) * 60 + minute, range: range))
        }

        // 15:00까지
        for match in matches("(\\d{1,2}):(\\d{2})\\s*\(untilWords)", in: text) {
            guard let range = Range(match.range, in: text),
                  let hourRange = Range(match.range(at: 1), in: text),
                  let minuteRange = Range(match.range(at: 2), in: text),
                  let hour = Int(text[hourRange]), let minute = Int(text[minuteRange]),
                  (0...23).contains(hour), (0..<60).contains(minute) else { continue }
            found.append(Deadline(minutes: hour * 60 + minute, range: range))
        }

        // 퇴근 전까지, 오늘 안에
        let endOfDay = "퇴근\\s*(?:시간)?\\s*(?:전까지|전에|까지|전)|(?:오늘|금일)\\s*(?:안에|안으로|중으로|중에|내로|까지)"
        for match in matches(endOfDay, in: text) {
            guard let range = Range(match.range, in: text) else { continue }
            found.append(Deadline(minutes: workEnd, range: range))
        }

        // 점심 전까지, 오전 중으로, 정오까지
        let noon = "(?:점심|오전)\\s*(?:시간)?\\s*(?:전까지|전에|까지|중으로|중에|안에|안으로)|정오\\s*(?:까지|전까지|전에)"
        for match in matches(noon, in: text) {
            guard let range = Range(match.range, in: text) else { continue }
            found.append(Deadline(minutes: 12 * 60, range: range))
        }

        return found.min { $0.range.lowerBound < $1.range.lowerBound }
    }

    /// 오전·오후를 말하지 않은 시각은 근무시간에 맞춰 읽는다. 1~8시는 오후, 9~11시는 오전.
    static func resolveHour(_ hour: Int, half: String?) -> Int {
        switch half {
        case "오후", "저녁", "밤":
            return hour < 12 ? hour + 12 : hour
        case "오전", "아침":
            return hour == 12 ? 0 : hour
        case "낮":
            return hour < 8 ? hour + 12 : hour
        default:
            if hour >= 13 { return hour }
            return hour <= 8 ? hour + 12 : hour
        }
    }

    static func removingDeadline(from sentence: String, workEnd: Int) -> String {
        guard let found = deadline(in: sentence, workEnd: workEnd) else { return sentence }
        var text = sentence
        text.removeSubrange(found.range)
        return replacing("\\s{2,}", in: text, with: " ").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    // MARK: - 문장 다루기

    static func normalize(_ text: String) -> String {
        let unified = text
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\u{00A0}", with: " ")
        return replacing("[ \\t]{2,}", in: unified, with: " ").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// 문장 단위로 나눈다. 음성 전사에는 마침표가 없을 수 있어 말끝도 함께 본다.
    static func sentences(of text: String) -> [String] {
        // 마침표 뒤에 공백이 없을 때는 "3.5"처럼 숫자가 이어지는 경우를 나누지 않는다.
        let separator = "(?<=[.!?。])\\s+|(?<=[.!?。])(?=[^\\d\\s])|\\n+|(?<=니다)\\s+|(?<=어요)\\s+|(?<=게요)\\s+|(?<=예요)\\s+"
        let expression = regex(separator)
        let whole = NSRange(text.startIndex..., in: text)
        var pieces: [String] = []
        var cursor = text.startIndex
        expression.enumerateMatches(in: text, range: whole) { match, _, _ in
            guard let match, match.range.length > 0 || match.range.location > 0,
                  let range = Range(match.range, in: text), range.lowerBound >= cursor else { return }
            pieces.append(String(text[cursor..<range.lowerBound]))
            cursor = range.upperBound
        }
        pieces.append(String(text[cursor...]))
        return pieces.map(trimSentence).filter { !$0.isEmpty }
    }

    static func trimSentence(_ text: String) -> String {
        text.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines.union(CharacterSet(charactersIn: ".!?。,·")))
    }

    // MARK: - 정규식 도우미

    private static func regex(_ pattern: String) -> NSRegularExpression {
        // 패턴은 모두 이 파일에 고정된 상수라 실패하지 않는다.
        (try? NSRegularExpression(pattern: pattern)) ?? NSRegularExpression()
    }

    private static func matches(_ pattern: String, in text: String) -> [NSTextCheckingResult] {
        regex(pattern).matches(in: text, range: NSRange(text.startIndex..., in: text))
    }

    private static func replacing(_ pattern: String, in text: String, with template: String) -> String {
        regex(pattern).stringByReplacingMatches(in: text, range: NSRange(text.startIndex..., in: text), withTemplate: template)
    }
}
