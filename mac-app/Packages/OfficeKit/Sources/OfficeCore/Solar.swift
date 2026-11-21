import Foundation

// MARK: - 설정

/// Upstage Solar 연결 설정.
/// 처음 실행하는 사람은 `UPSTAGE_API_KEY`만 넣으면 된다. 나머지는 여기 기본값을 쓴다.
public struct SolarConfig: Sendable, Equatable {
    public static let defaultBaseURL = URL(string: "https://api.upstage.ai/v1")!
    public static let defaultModel = "solar-pro4"
    public static let defaultTimeout: TimeInterval = 30

    public var apiKey: String?
    public var baseURL: URL
    public var model: String
    public var timeout: TimeInterval

    public init(apiKey: String? = nil, baseURL: URL = SolarConfig.defaultBaseURL,
                model: String = SolarConfig.defaultModel, timeout: TimeInterval = SolarConfig.defaultTimeout) {
        self.apiKey = apiKey
        self.baseURL = baseURL
        self.model = model
        self.timeout = timeout
    }

    public var hasKey: Bool {
        !(apiKey ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

// MARK: - 오류

public enum SolarError: Error, Equatable, Sendable {
    /// `UPSTAGE_API_KEY`가 없음.
    case missingKey
    /// 키가 틀렸거나 삭제됨.
    case unauthorized(code: String?)
    /// 키는 맞지만 크레딧이나 결제 수단이 없어 막힘.
    case blocked(code: String?)
    /// 한국 리전 전용 조직의 키.
    case regionMismatch
    /// 응답 시간 초과.
    case timeout
    /// 인터넷에 연결되지 않음.
    case offline
    /// 분당 요청 한도 초과.
    case rateLimited
    /// 월 사용 한도 도달.
    case usageLimit
    /// 요청 형식 오류. 모델 이름이 틀렸을 때도 여기로 온다.
    case badRequest(code: String?, message: String)
    case server(status: Int)
    /// 응답이 중간에 잘림.
    case truncated
    /// 응답을 읽을 수 없음.
    case malformed(String)
    case cancelled

    /// 화면에 보이는 한 줄 제목.
    public var title: String {
        switch self {
        case .missingKey: "Solar 키가 없습니다"
        case .unauthorized: "Solar 인증에 실패했습니다"
        case .blocked: "Solar 키가 막혀 있습니다"
        case .regionMismatch: "Solar 접속 지역이 맞지 않습니다"
        case .timeout: "Solar 응답 시간이 초과되었습니다"
        case .offline: "인터넷에 연결되지 않았습니다"
        case .rateLimited: "Solar 요청이 잠시 몰렸습니다"
        case .usageLimit: "Solar 월 사용 한도에 도달했습니다"
        case .badRequest: "Solar가 요청을 받아들이지 않았습니다"
        case .server: "Solar 서버에 문제가 있습니다"
        case .truncated: "Solar 응답이 중간에 끊겼습니다"
        case .malformed: "Solar 응답을 읽지 못했습니다"
        case .cancelled: "요청을 취소했습니다"
        }
    }

    /// 무엇을 하면 되는지. 의미 단위로 줄을 나눈다.
    public var guidance: String {
        switch self {
        case .missingKey:
            "설정에서 UPSTAGE_API_KEY를 넣어 주세요.\n작성한 내용은 그대로 남아 있습니다."
        case .unauthorized:
            "키가 틀렸거나 삭제된 키입니다.\n설정에서 키를 다시 확인해 주세요."
        case .blocked:
            "Upstage 콘솔에서 크레딧과 결제 수단을 확인해 주세요.\n새 키를 만들어도 해결되지 않습니다."
        case .regionMismatch:
            "한국 리전 전용 키입니다.\nUPSTAGE_BASE_URL을 https://kr.api.upstage.ai/v1 로 바꿔 주세요."
        case .timeout:
            "작성한 내용은 그대로 남아 있습니다.\n잠시 뒤 다시 시도해 주세요."
        case .offline:
            "네트워크 연결을 확인한 뒤\n다시 시도해 주세요."
        case .rateLimited:
            "1분쯤 기다린 뒤\n다시 시도해 주세요."
        case .usageLimit:
            "Upstage 콘솔에서 월 한도를 확인해 주세요.\n다시 시도해도 해결되지 않습니다."
        case .badRequest(_, let message):
            "모델 이름이나 요청 형식을 확인해 주세요.\n(\(message))"
        case .server(let status):
            "잠시 뒤 다시 시도해 주세요.\n(상태 코드 \(status))"
        case .truncated:
            "전사문이 너무 길 수 있습니다.\n다시 시도해 주세요."
        case .malformed(let why):
            "다시 시도해 주세요.\n(\(why))"
        case .cancelled:
            "다시 시도할 수 있습니다."
        }
    }

    /// 같은 요청을 그대로 다시 보내 볼 만한지.
    public var canRetry: Bool {
        switch self {
        case .timeout, .offline, .rateLimited, .server, .truncated, .malformed, .cancelled: true
        case .missingKey, .unauthorized, .blocked, .regionMismatch, .usageLimit, .badRequest: false
        }
    }

    /// 설정에서 키를 고쳐야 하는 문제인지.
    public var needsKeySetup: Bool {
        switch self {
        case .missingKey, .unauthorized: true
        default: false
        }
    }
}

// MARK: - 주간보고 답장

public struct WeeklyReply: Sendable, Equatable, Codable {
    public var subject: String
    public var body: String
    /// 답장에서 짚은 성취 한 가지.
    public var achievement: String

    public init(subject: String, body: String, achievement: String) {
        self.subject = subject
        self.body = body
        self.achievement = achievement
    }
}

// MARK: - 지시문과 응답 형식

/// 체크리스트와 주간보고 답장의 지시문, 응답 형식. 프로젝트에 포함해 둔다.
public enum SolarPrompts {

    public static func checklistSystem(workEnd: Int) -> String {
        """
        당신은 가상회사의 AI 팀장입니다.
        사원이 아침 PT에서 말한 내용을 받아 적은 전사문을 읽고, 오늘 업무 체크리스트 초안을 JSON으로 정리합니다.

        규칙
        1. 전사문에 나온 업무만 적습니다. 업무를 새로 만들거나 합치지 않습니다.
        2. 각 업무는 업무명(title), 중요도(priority), 마감(deadline), 완료 기준(done_criteria)을 가집니다.
        3. 중요도는 사원이 말한 단계를 그대로 씁니다. 3은 필수 마감, 2는 당일 완료, 1은 이월 가능입니다. "삼 단계"처럼 말해도 숫자로 적습니다. 사원이 단계를 말하지 않은 업무는 null로 둡니다. 추측하지 않습니다.
        4. 마감은 24시간 HH:MM 형식입니다. "오후 3시까지"는 "15:00", "오후 5시 반까지"는 "17:30"입니다. "퇴근 전까지"와 "오늘 안에"는 퇴근 시각인 "\(Clock.hm(workEnd))"로 적습니다. 마감을 말하지 않은 업무는 null로 둡니다.
        5. 완료 기준은 사원이 말한 끝내는 조건을 짧게 적습니다. 예: "오탈자를 확인하고 제출본을 저장". 말하지 않았으면 null로 둡니다.
        6. 업무명은 사원이 말한 표현을 살려 짧게 적습니다. "~입니다", "~하겠습니다" 같은 말끝은 뺍니다.
        7. 음성 인식 오류로 보이는 글자는 문맥에 맞게 바로잡되 뜻을 바꾸지 않습니다.
        8. 중요도가 높은 순서(3, 2, 1)로 정렬하고, 중요도가 null인 업무는 맨 뒤에 둡니다.
        9. 인사말처럼 업무가 아닌 말은 무시합니다. 업무가 하나도 없으면 tasks를 빈 배열로 둡니다.
        """
    }

    public static func checklistUser(transcript: String, workEnd: Int) -> String {
        """
        퇴근 시각: \(Clock.hm(workEnd))

        전사문:
        \(transcript.trimmingCharacters(in: .whitespacesAndNewlines))
        """
    }

    public static var checklistSchemaName: String { "morning_pt_checklist" }

    /// 업무명·중요도·마감·완료 기준. 전사문에 없는 값은 null로 받는다.
    public static var checklistSchema: [String: Any] {
        [
            "type": "object",
            "properties": [
                "tasks": [
                    "type": "array",
                    "items": [
                        "type": "object",
                        "properties": [
                            "title": ["type": ["string", "null"], "description": "업무명. 전사문에 없으면 null"],
                            "priority": ["type": ["integer", "null"], "description": "중요도 단계. 1, 2, 3 중 하나. 전사문에 없으면 null"],
                            "deadline": ["type": ["string", "null"], "description": "마감 시각. 24시간 HH:MM. 전사문에 없으면 null"],
                            "done_criteria": ["type": ["string", "null"], "description": "완료 기준. 전사문에 없으면 null"],
                        ],
                        "required": ["title", "priority", "deadline", "done_criteria"],
                        "additionalProperties": false,
                    ],
                ],
            ],
            "required": ["tasks"],
            "additionalProperties": false,
        ]
    }

    public static func weeklySystem(name: String) -> String {
        """
        당신은 가상회사의 \(Cast.managerName) 팀장입니다.
        \(name) 사원이 직접 쓴 주간보고서를 읽고 사내 메일 답장을 씁니다.

        규칙
        1. 보고서의 "이번 주 완료한 업무와 결과물"에서 가장 구체적인 성취 한 가지를 골라, 무엇을 해냈는지 짚습니다. 고른 성취는 achievement에 보고서 표현을 살려 짧게 적습니다.
        2. 보고서에 없는 사실, 숫자, 평가를 지어내지 않습니다.
        3. 따뜻하고 차분한 존댓말로 씁니다. 과장된 칭찬, 느낌표, 이모지를 쓰지 않습니다.
        4. 미완료 업무는 탓하지 않습니다. 사원이 적은 이유를 받아들이고, 다음 주 목표 중 하나를 골라 첫걸음을 한 문장으로 제안합니다.
        5. body는 4~6문장입니다. 문장마다 줄을 바꾸고, 한 줄이 25자를 넘으면 쉼표나 의미가 끊기는 곳에서 줄을 나눕니다. 마지막 줄은 빈 줄 하나 뒤에 "\(Cast.managerName) 드림"입니다.
        6. subject는 "[주간 피드백] "으로 시작하는 한 줄 제목입니다.
        """
    }

    public static func weeklyUser(report: WeeklyReport, name: String) -> String {
        """
        \(name) 사원의 주간보고서:

        \(report.bodyText)
        """
    }

    public static var weeklySchemaName: String { "weekly_report_reply" }

    public static var weeklySchema: [String: Any] {
        [
            "type": "object",
            "properties": [
                "subject": ["type": "string", "description": "[주간 피드백] 으로 시작하는 메일 제목"],
                "body": ["type": "string", "description": "메일 본문. 문장마다 줄바꿈"],
                "achievement": ["type": "string", "description": "답장에서 짚은 성취 한 가지"],
            ],
            "required": ["subject", "body", "achievement"],
            "additionalProperties": false,
        ]
    }
}

// MARK: - 클라이언트

/// Upstage Chat Completions 호출.
/// 키는 앱 프로세스 안에서만 쓰고 화면이나 기록에 남기지 않는다.
public struct SolarClient: Sendable {
    public var config: SolarConfig
    private let session: URLSession

    public init(config: SolarConfig, session: URLSession? = nil) {
        self.config = config
        if let session {
            self.session = session
        } else {
            let configuration = URLSessionConfiguration.ephemeral
            configuration.timeoutIntervalForRequest = config.timeout
            configuration.timeoutIntervalForResource = config.timeout + 5
            configuration.waitsForConnectivity = false
            self.session = URLSession(configuration: configuration)
        }
    }

    /// 아침 PT 전사문에서 업무 체크리스트 초안을 받는다.
    public func checklist(transcript: String, workEnd: Int = WorkRules.defaultWorkEnd) async throws(SolarError) -> [TaskDraft] {
        let content = try await complete(
            system: SolarPrompts.checklistSystem(workEnd: workEnd),
            user: SolarPrompts.checklistUser(transcript: transcript, workEnd: workEnd),
            schemaName: SolarPrompts.checklistSchemaName,
            schema: SolarPrompts.checklistSchema,
            temperature: 0.1,
            maxTokens: 1500)
        return try Self.decodeChecklist(content)
    }

    /// 직접 작성한 주간보고서에 대한 상사 답장을 받는다.
    public func weeklyReply(report: WeeklyReport, name: String) async throws(SolarError) -> WeeklyReply {
        let content = try await complete(
            system: SolarPrompts.weeklySystem(name: name),
            user: SolarPrompts.weeklyUser(report: report, name: name),
            schemaName: SolarPrompts.weeklySchemaName,
            schema: SolarPrompts.weeklySchema,
            temperature: 0.6,
            maxTokens: 900)
        return try Self.decodeWeeklyReply(content)
    }

    /// 키와 모델이 실제로 응답하는지 확인한다. 응답한 모델 이름을 돌려준다.
    public func ping() async throws(SolarError) -> String {
        let body: [String: Any] = [
            "model": config.model,
            "messages": [["role": "user", "content": "연결 확인입니다. '확인'이라고만 답해 주세요."]],
            "max_tokens": 16,
        ]
        let data = try await post(body)
        let envelope = try Self.decodeEnvelope(data)
        return envelope.model ?? config.model
    }

    // MARK: 요청

    private func complete(system: String, user: String, schemaName: String, schema: [String: Any],
                          temperature: Double, maxTokens: Int) async throws(SolarError) -> String {
        let body: [String: Any] = [
            "model": config.model,
            "messages": [
                ["role": "system", "content": system],
                ["role": "user", "content": user],
            ],
            "temperature": temperature,
            "max_tokens": maxTokens,
            "response_format": [
                "type": "json_schema",
                "json_schema": ["name": schemaName, "strict": true, "schema": schema],
            ],
        ]
        let data = try await post(body)
        let envelope = try Self.decodeEnvelope(data)
        guard let choice = envelope.choices.first else { throw .malformed("응답에 선택지가 없습니다") }
        if choice.finishReason == "length" { throw .truncated }
        guard let content = choice.message.content, !content.isEmpty else {
            throw .malformed("응답 본문이 비어 있습니다")
        }
        return content
    }

    private func post(_ body: [String: Any]) async throws(SolarError) -> Data {
        guard let key = config.apiKey?.trimmingCharacters(in: .whitespacesAndNewlines), !key.isEmpty else {
            throw .missingKey
        }
        var request = URLRequest(url: config.baseURL.appendingPathComponent("chat/completions"))
        request.httpMethod = "POST"
        request.timeoutInterval = config.timeout
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        do {
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        } catch {
            throw .malformed("요청을 만들지 못했습니다")
        }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch let error as URLError {
            throw Self.map(error)
        } catch is CancellationError {
            throw .cancelled
        } catch {
            throw .offline
        }

        guard let http = response as? HTTPURLResponse else { throw .malformed("HTTP 응답이 아닙니다") }
        guard (200..<300).contains(http.statusCode) else {
            throw Self.map(status: http.statusCode, body: data)
        }
        return data
    }

    // MARK: 오류 구분

    static func map(_ error: URLError) -> SolarError {
        switch error.code {
        case .timedOut:
            .timeout
        case .cancelled:
            .cancelled
        case .notConnectedToInternet, .networkConnectionLost, .cannotFindHost, .cannotConnectToHost,
             .dnsLookupFailed, .internationalRoamingOff, .dataNotAllowed, .secureConnectionFailed:
            .offline
        default:
            .offline
        }
    }

    /// 상태 코드와 오류 본문의 `code`로 구분한다.
    static func map(status: Int, body: Data) -> SolarError {
        let detail = (try? JSONDecoder().decode(ErrorEnvelope.self, from: body))?.error
        let code = detail?.code
        switch status {
        case 400, 404, 405, 413, 422:
            return .badRequest(code: code, message: detail?.message ?? "상태 코드 \(status)")
        case 401:
            return code == "api_key_is_blocked" ? .blocked(code: code) : .unauthorized(code: code)
        case 403:
            return code == "data_residency_region_mismatch" ? .regionMismatch : .blocked(code: code)
        case 408, 504:
            return .timeout
        case 429:
            return code == "usage_limit_exceeded" ? .usageLimit : .rateLimited
        default:
            return .server(status: status)
        }
    }

    // MARK: 응답 읽기

    struct Envelope: Decodable {
        struct Choice: Decodable {
            struct Message: Decodable {
                var content: String?
            }
            var message: Message
            var finishReason: String?

            enum CodingKeys: String, CodingKey {
                case message
                case finishReason = "finish_reason"
            }
        }
        var model: String?
        var choices: [Choice]
    }

    struct ErrorEnvelope: Decodable {
        struct Detail: Decodable {
            var message: String?
            var type: String?
            var code: String?
        }
        var error: Detail
    }

    static func decodeEnvelope(_ data: Data) throws(SolarError) -> Envelope {
        do {
            return try JSONDecoder().decode(Envelope.self, from: data)
        } catch {
            throw .malformed("응답 형식이 예상과 다릅니다")
        }
    }

    struct ChecklistPayload: Decodable {
        struct Item: Decodable {
            var title: String?
            var priority: Int?
            var deadline: String?
            var doneCriteria: String?

            enum CodingKeys: String, CodingKey {
                case title, priority, deadline
                case doneCriteria = "done_criteria"
            }
        }
        var tasks: [Item]
    }

    /// 구조화 출력(JSON 문자열)을 업무 초안으로 바꾼다.
    /// 범위를 벗어난 중요도나 읽을 수 없는 마감은 nil로 두어 '확인 필요'로 보이게 한다.
    public static func decodeChecklist(_ content: String) throws(SolarError) -> [TaskDraft] {
        guard let data = content.data(using: .utf8) else { throw .malformed("본문을 읽지 못했습니다") }
        let payload: ChecklistPayload
        do {
            payload = try JSONDecoder().decode(ChecklistPayload.self, from: data)
        } catch {
            throw .malformed("체크리스트 형식이 예상과 다릅니다")
        }
        return payload.tasks.map { item in
            let title = item.title?.trimmingCharacters(in: .whitespacesAndNewlines)
            let criteria = item.doneCriteria?.trimmingCharacters(in: .whitespacesAndNewlines)
            return TaskDraft(title: (title ?? "").isEmpty ? nil : title,
                             level: item.priority.flatMap(TaskLevel.init(rawValue:)),
                             due: item.deadline.flatMap(Clock.minutes(fromHM:)),
                             doneCriteria: (criteria ?? "").isEmpty ? nil : criteria)
        }
    }

    public static func decodeWeeklyReply(_ content: String) throws(SolarError) -> WeeklyReply {
        guard let data = content.data(using: .utf8) else { throw .malformed("본문을 읽지 못했습니다") }
        do {
            let reply = try JSONDecoder().decode(WeeklyReply.self, from: data)
            guard !reply.body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                throw SolarError.malformed("답장 본문이 비어 있습니다")
            }
            return reply
        } catch let error as SolarError {
            throw error
        } catch {
            throw .malformed("답장 형식이 예상과 다릅니다")
        }
    }
}
