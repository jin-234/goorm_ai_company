import Foundation

/// `.env` 형식 읽기. `KEY=VALUE` 한 줄씩.
public enum EnvFile {
    public static func parse(_ text: String) -> [String: String] {
        var values: [String: String] = [:]
        for rawLine in text.split(whereSeparator: \.isNewline) {
            var line = rawLine.trimmingCharacters(in: .whitespaces)
            guard !line.isEmpty, !line.hasPrefix("#") else { continue }
            if line.hasPrefix("export ") { line = String(line.dropFirst("export ".count)) }
            guard let equals = line.firstIndex(of: "=") else { continue }
            let key = line[..<equals].trimmingCharacters(in: .whitespaces)
            var value = line[line.index(after: equals)...].trimmingCharacters(in: .whitespaces)
            if value.count >= 2,
               (value.hasPrefix("\"") && value.hasSuffix("\"")) || (value.hasPrefix("'") && value.hasSuffix("'")) {
                value = String(value.dropFirst().dropLast())
            } else if let comment = value.range(of: " #") {
                value = value[..<comment.lowerBound].trimmingCharacters(in: .whitespaces)
            }
            guard !key.isEmpty else { continue }
            values[key] = value
        }
        return values
    }

    public static func load(_ url: URL) -> [String: String]? {
        guard let text = try? String(contentsOf: url, encoding: .utf8) else { return nil }
        return parse(text)
    }

    /// 다른 값은 그대로 두고 한 항목만 바꿔 쓴다. 파일 권한은 소유자만 읽고 쓰게 한다.
    public static func write(key: String, value: String, to url: URL) throws {
        var lines: [String] = []
        var replaced = false
        if let text = try? String(contentsOf: url, encoding: .utf8) {
            for line in text.split(omittingEmptySubsequences: false, whereSeparator: \.isNewline) {
                let trimmed = line.trimmingCharacters(in: .whitespaces)
                let bare = trimmed.hasPrefix("export ") ? String(trimmed.dropFirst("export ".count)) : trimmed
                if bare.hasPrefix("\(key)=") {
                    lines.append("\(key)=\(value)")
                    replaced = true
                } else {
                    lines.append(String(line))
                }
            }
        }
        if !replaced { lines.append("\(key)=\(value)") }
        while lines.last == "" { lines.removeLast() }
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try (lines.joined(separator: "\n") + "\n").write(to: url, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    }
}

/// Solar 키를 어디서 읽었는지.
public enum SolarKeySource: Sendable, Equatable {
    case environment
    case envFile(URL)
    case none

    public var label: String {
        switch self {
        case .environment: "환경변수 UPSTAGE_API_KEY"
        case .envFile(let url): ".env 파일 (\(url.path))"
        case .none: "없음"
        }
    }
}

public struct ResolvedSolar: Sendable, Equatable {
    public var config: SolarConfig
    public var source: SolarKeySource

    public init(config: SolarConfig, source: SolarKeySource) {
        self.config = config
        self.source = source
    }

    /// 화면에 보여 줄 가린 키. 예: up_a…9xQ2
    public var maskedKey: String? {
        guard let key = config.apiKey, !key.isEmpty else { return nil }
        guard key.count > 8 else { return String(repeating: "•", count: key.count) }
        return "\(key.prefix(4))…\(key.suffix(4))"
    }
}

public enum SolarSettings {
    public static let keyName = "UPSTAGE_API_KEY"
    public static let baseURLName = "UPSTAGE_BASE_URL"
    public static let modelName = "UPSTAGE_MODEL"
    public static let timeoutName = "UPSTAGE_TIMEOUT"

    /// 환경변수를 먼저 보고, 없으면 `.env` 파일 후보를 차례로 본다.
    /// Solar 전용 설정은 `UPSTAGE_API_KEY` 하나면 충분하다. 주소와 모델은 필요할 때만 바꾼다.
    public static func resolve(environment: [String: String] = ProcessInfo.processInfo.environment,
                               envFiles: [URL] = []) -> ResolvedSolar {
        var config = SolarConfig()
        var source = SolarKeySource.none

        var layers: [(values: [String: String], source: SolarKeySource)] = [(environment, .environment)]
        for url in envFiles {
            if let values = EnvFile.load(url) { layers.append((values, .envFile(url))) }
        }

        for layer in layers {
            guard let key = clean(layer.values[keyName]) else { continue }
            config.apiKey = key
            source = layer.source
            break
        }
        // 주소·모델·시간은 키와 같은 곳에 있지 않아도 먼저 찾은 값을 쓴다.
        for layer in layers {
            if config.baseURL == SolarConfig.defaultBaseURL,
               let text = clean(layer.values[baseURLName]), let url = URL(string: text), url.scheme != nil {
                config.baseURL = url
            }
            if config.model == SolarConfig.defaultModel, let model = clean(layer.values[modelName]) {
                config.model = model
            }
            if config.timeout == SolarConfig.defaultTimeout,
               let text = clean(layer.values[timeoutName]), let seconds = TimeInterval(text), seconds >= 3 {
                config.timeout = seconds
            }
        }
        return ResolvedSolar(config: config, source: source)
    }

    private static func clean(_ value: String?) -> String? {
        guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else { return nil }
        return trimmed
    }
}

/// Solar에 연결하지 못했을 때 쓰는 주간보고 기본 답장.
/// AI가 쓴 글이 아니라 정해진 문구에 보고서의 한 줄을 넣은 것이므로 화면에서 그렇게 표시한다.
public enum LocalWeeklyReply {
    public static func make(report: WeeklyReport, name: String) -> WeeklyReply {
        let achievement = firstLine(report.completed) ?? "이번 주에 끝낸 업무"
        let goal = firstLine(report.nextGoals)
        // 한 줄이 길면 화면 폭에서 엉뚱한 곳이 꺾이므로 의미 단위로 직접 줄을 나눈다.
        var lines = [
            "주간보고서 잘 읽었습니다.",
            "",
            "“\(achievement)”,",
            "이 일을 이번 주에 끝까지 해낸 점을 먼저 짚고 싶습니다.",
            "정해 둔 일을 결과물로 남기는 것이 가장 어려운데,",
            "그 일을 해냈습니다.",
            "",
            "미완료로 적은 업무는 이유를 함께 적어 주어",
            "상황을 이해했습니다.",
        ]
        if let goal {
            lines.append("다음 주에는 “\(goal)”부터")
            lines.append("작은 단위로 나눠 시작해 보면 좋겠습니다.")
        }
        lines.append("")
        lines.append("한 주 동안 수고 많았습니다.")
        lines.append("")
        lines.append("\(Cast.managerName) 드림")
        return WeeklyReply(subject: "[주간 피드백] \(name) 사원 주간보고 확인",
                           body: lines.joined(separator: "\n"),
                           achievement: achievement)
    }

    /// 글머리 기호와 번호를 떼어 낸 첫 줄.
    static func firstLine(_ text: String) -> String? {
        for rawLine in text.split(whereSeparator: \.isNewline) {
            var line = rawLine.trimmingCharacters(in: .whitespaces)
            while let first = line.first, "-·•*–—▪◦".contains(first) || first == " " {
                line.removeFirst()
            }
            if let match = line.range(of: "^\\d+[.)]\\s*", options: .regularExpression) {
                line.removeSubrange(match)
            }
            line = line.trimmingCharacters(in: CharacterSet.whitespaces.union(CharacterSet(charactersIn: ".。")))
            if !line.isEmpty { return line }
        }
        return nil
    }
}
