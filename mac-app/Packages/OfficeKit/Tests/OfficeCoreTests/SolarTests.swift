import Foundation
import Testing
@testable import OfficeCore

/// 네트워크 없이 Solar 응답을 흉내 낸다. 시험마다 다른 호스트 이름을 써서 서로 섞이지 않게 한다.
final class StubProtocol: URLProtocol, @unchecked Sendable {
    struct Stub {
        var status: Int = 200
        var body: Data = Data()
        var error: URLError?
    }

    private static let lock = NSLock()
    nonisolated(unsafe) private static var stubs: [String: Stub] = [:]
    nonisolated(unsafe) private static var requests: [String: URLRequest] = [:]
    nonisolated(unsafe) private static var bodies: [String: Data] = [:]

    static func set(_ stub: Stub, host: String) {
        lock.lock(); defer { lock.unlock() }
        stubs[host] = stub
    }

    static func captured(host: String) -> (request: URLRequest, body: [String: Any])? {
        lock.lock(); defer { lock.unlock() }
        guard let request = requests[host] else { return nil }
        let json = bodies[host].flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any]
        return (request, json ?? [:])
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let host = request.url?.host ?? ""
        var body = request.httpBody ?? Data()
        if body.isEmpty, let stream = request.httpBodyStream {
            stream.open()
            defer { stream.close() }
            var buffer = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable {
                let read = stream.read(&buffer, maxLength: buffer.count)
                if read <= 0 { break }
                body.append(buffer, count: read)
            }
        }
        Self.lock.lock()
        Self.requests[host] = request
        Self.bodies[host] = body
        let stub = Self.stubs[host]
        Self.lock.unlock()

        guard let stub else {
            client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse))
            return
        }
        if let error = stub.error {
            client?.urlProtocol(self, didFailWithError: error)
            return
        }
        let response = HTTPURLResponse(url: request.url!, statusCode: stub.status, httpVersion: "HTTP/1.1",
                                       headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: stub.body)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

func stubClient(host: String, key: String? = "test-key-1234567890") -> SolarClient {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [StubProtocol.self]
    let config = SolarConfig(apiKey: key, baseURL: URL(string: "https://\(host)/v1")!)
    return SolarClient(config: config, session: URLSession(configuration: configuration))
}

/// Chat Completions 응답 모양. 구조화 출력은 content에 JSON 문자열로 들어온다.
func completion(content: String, finish: String = "stop") -> Data {
    let object: [String: Any] = [
        "id": "cmpl-test",
        "model": "solar-pro4-260806",
        "choices": [["index": 0, "finish_reason": finish, "message": ["role": "assistant", "content": content]]],
    ]
    return try! JSONSerialization.data(withJSONObject: object)
}

func errorBody(code: String, message: String = "오류") -> Data {
    try! JSONSerialization.data(withJSONObject: ["error": ["message": message, "type": "invalid_request_error", "code": code]])
}

@Suite("Solar 연동")
struct SolarClientTests {
    static let checklistJSON = """
    {"tasks":[
      {"title":"지원서 최종 검토","priority":3,"deadline":"15:00","done_criteria":"오탈자를 확인하고 제출본을 저장"},
      {"title":"포트폴리오 한 문단 초안","priority":2,"deadline":"17:00","done_criteria":"문단을 쓰기"},
      {"title":"관심 기업 세 곳 저장","priority":1,"deadline":"18:00","done_criteria":"링크를 모으기"}
    ]}
    """

    @Test func 전사문을_보내고_체크리스트를_받는다() async throws {
        let host = "checklist-ok.test"
        StubProtocol.set(.init(body: completion(content: Self.checklistJSON)), host: host)
        let drafts = try await stubClient(host: host).checklist(transcript: PTParserTests.sample)

        #expect(drafts.count == 3)
        #expect(drafts[0].title == "지원서 최종 검토")
        #expect(drafts[0].level == .mustFinish)
        #expect(drafts[0].due == 15 * 60)
        #expect(drafts[0].doneCriteria == "오탈자를 확인하고 제출본을 저장")
        #expect(drafts[2].level == .carryable)

        let sent = try #require(StubProtocol.captured(host: host))
        #expect(sent.request.url?.absoluteString == "https://\(host)/v1/chat/completions")
        #expect(sent.request.httpMethod == "POST")
        #expect(sent.request.value(forHTTPHeaderField: "Authorization") == "Bearer test-key-1234567890")
        #expect(sent.body["model"] as? String == "solar-pro4")
        let format = try #require(sent.body["response_format"] as? [String: Any])
        #expect(format["type"] as? String == "json_schema")
        let schema = try #require(format["json_schema"] as? [String: Any])
        #expect(schema["strict"] as? Bool == true)
        #expect(schema["name"] as? String == "morning_pt_checklist")
        let messages = try #require(sent.body["messages"] as? [[String: String]])
        #expect(messages.count == 2)
        #expect(messages[0]["role"] == "system")
        #expect(messages[1]["content"]?.contains("지원서 최종 검토") == true)
        #expect(messages[1]["content"]?.contains("퇴근 시각: 18:00") == true)
    }

    @Test func 응답_형식은_모든_칸을_필수로_하고_null을_허용한다() throws {
        let schema = SolarPrompts.checklistSchema
        #expect(schema["additionalProperties"] as? Bool == false)
        let properties = try #require(schema["properties"] as? [String: Any])
        let tasks = try #require(properties["tasks"] as? [String: Any])
        let item = try #require(tasks["items"] as? [String: Any])
        #expect(item["additionalProperties"] as? Bool == false)
        #expect(Set(item["required"] as? [String] ?? []) == ["title", "priority", "deadline", "done_criteria"])
        let fields = try #require(item["properties"] as? [String: [String: Any]])
        for name in ["title", "priority", "deadline", "done_criteria"] {
            let types = try #require(fields[name]?["type"] as? [String])
            #expect(types.contains("null"))
        }
        // 보낼 수 있는 JSON이어야 한다.
        #expect(JSONSerialization.isValidJSONObject(schema))
        #expect(JSONSerialization.isValidJSONObject(SolarPrompts.weeklySchema))
    }

    @Test func 없는_값과_범위를_벗어난_값은_확인_필요로_둔다() throws {
        let json = """
        {"tasks":[
          {"title":"자격증 기출 풀이","priority":null,"deadline":null,"done_criteria":null},
          {"title":"  ","priority":5,"deadline":"오후 3시","done_criteria":""}
        ]}
        """
        let drafts = try SolarClient.decodeChecklist(json)
        #expect(drafts[0].title == "자격증 기출 풀이")
        #expect(drafts[0].level == nil && drafts[0].due == nil && drafts[0].doneCriteria == nil)
        #expect(drafts[0].missingFields == ["중요도", "마감", "완료 기준"])
        #expect(drafts[1].title == nil)
        #expect(drafts[1].level == nil)
        #expect(drafts[1].due == nil)
        #expect(drafts[1].doneCriteria == nil)
    }

    @Test func 키가_없으면_요청을_보내지_않는다() async {
        let host = "missing-key.test"
        await #expect(throws: SolarError.missingKey) {
            try await stubClient(host: host, key: nil).checklist(transcript: "아무 말")
        }
        await #expect(throws: SolarError.missingKey) {
            try await stubClient(host: host, key: "   ").checklist(transcript: "아무 말")
        }
        #expect(StubProtocol.captured(host: host) == nil)
    }

    @Test func 인증_실패를_구분한다() async {
        let host = "unauthorized.test"
        StubProtocol.set(.init(status: 401, body: errorBody(code: "invalid_api_key")), host: host)
        await #expect(throws: SolarError.unauthorized(code: "invalid_api_key")) {
            try await stubClient(host: host).checklist(transcript: "아무 말")
        }
        #expect(SolarError.unauthorized(code: nil).needsKeySetup)
        #expect(SolarError.unauthorized(code: nil).canRetry == false)
    }

    @Test func 막힌_키와_지역_불일치를_구분한다() async {
        let blocked = "blocked.test"
        StubProtocol.set(.init(status: 401, body: errorBody(code: "api_key_is_blocked")), host: blocked)
        await #expect(throws: SolarError.blocked(code: "api_key_is_blocked")) {
            try await stubClient(host: blocked).ping()
        }
        let suspended = "suspended.test"
        StubProtocol.set(.init(status: 403, body: errorBody(code: "api_key_is_not_allowed")), host: suspended)
        await #expect(throws: SolarError.blocked(code: "api_key_is_not_allowed")) {
            try await stubClient(host: suspended).ping()
        }
        let region = "region.test"
        StubProtocol.set(.init(status: 403, body: errorBody(code: "data_residency_region_mismatch")), host: region)
        await #expect(throws: SolarError.regionMismatch) {
            try await stubClient(host: region).ping()
        }
    }

    @Test func 응답_시간_초과를_구분한다() async {
        let host = "timeout.test"
        StubProtocol.set(.init(error: URLError(.timedOut)), host: host)
        await #expect(throws: SolarError.timeout) {
            try await stubClient(host: host).checklist(transcript: "아무 말")
        }
        let gateway = "gateway-timeout.test"
        StubProtocol.set(.init(status: 504, body: errorBody(code: "gateway_timeout")), host: gateway)
        await #expect(throws: SolarError.timeout) {
            try await stubClient(host: gateway).checklist(transcript: "아무 말")
        }
        #expect(SolarError.timeout.canRetry)
        #expect(SolarError.timeout.guidance.contains("그대로 남아 있습니다"))
    }

    @Test func 인터넷_끊김과_서버_오류와_한도_초과() async {
        let offline = "offline.test"
        StubProtocol.set(.init(error: URLError(.notConnectedToInternet)), host: offline)
        await #expect(throws: SolarError.offline) { try await stubClient(host: offline).ping() }

        let server = "server.test"
        StubProtocol.set(.init(status: 500, body: errorBody(code: "internal_server_error")), host: server)
        await #expect(throws: SolarError.server(status: 500)) { try await stubClient(host: server).ping() }

        let rate = "rate.test"
        StubProtocol.set(.init(status: 429, body: errorBody(code: "too_many_requests")), host: rate)
        await #expect(throws: SolarError.rateLimited) { try await stubClient(host: rate).ping() }

        let usage = "usage.test"
        StubProtocol.set(.init(status: 429, body: errorBody(code: "usage_limit_exceeded")), host: usage)
        await #expect(throws: SolarError.usageLimit) { try await stubClient(host: usage).ping() }
        #expect(SolarError.rateLimited.canRetry)
        #expect(SolarError.usageLimit.canRetry == false)

        let bad = "bad-model.test"
        StubProtocol.set(.init(status: 400, body: errorBody(code: "invalid_request_body", message: "model not found")), host: bad)
        await #expect(throws: SolarError.badRequest(code: "invalid_request_body", message: "model not found")) {
            try await stubClient(host: bad).ping()
        }
    }

    @Test func 잘린_응답과_읽을_수_없는_응답() async {
        let cut = "truncated.test"
        StubProtocol.set(.init(body: completion(content: "{\"tasks\":[{\"title\":\"지원", finish: "length")), host: cut)
        await #expect(throws: SolarError.truncated) {
            try await stubClient(host: cut).checklist(transcript: "아무 말")
        }
        let garbage = "garbage.test"
        StubProtocol.set(.init(body: completion(content: "죄송하지만 정리할 수 없습니다")), host: garbage)
        await #expect(throws: SolarError.malformed("체크리스트 형식이 예상과 다릅니다")) {
            try await stubClient(host: garbage).checklist(transcript: "아무 말")
        }
        let html = "html.test"
        StubProtocol.set(.init(body: Data("<html>점검 중</html>".utf8)), host: html)
        await #expect(throws: SolarError.malformed("응답 형식이 예상과 다릅니다")) {
            try await stubClient(host: html).checklist(transcript: "아무 말")
        }
    }

    @Test func 주간보고서를_보내고_답장을_받는다() async throws {
        let host = "weekly-ok.test"
        let reply = """
        {"subject":"[주간 피드백] 지원서 제출본 저장","body":"주간보고서 잘 읽었습니다.\\n지원서 최종 검토를 끝낸 점이 좋았습니다.\\n\\n한정민 드림","achievement":"지원서 최종 검토"}
        """
        StubProtocol.set(.init(body: completion(content: reply)), host: host)
        let report = WeeklyReport(weekOf: monday, completed: "지원서 최종 검토를 끝냈습니다.",
                                  incomplete: "관심 기업 저장은 두 곳만 했습니다.", nextGoals: "포트폴리오 설명 쓰기")
        let result = try await stubClient(host: host).weeklyReply(report: report, name: "김서울")
        #expect(result.subject == "[주간 피드백] 지원서 제출본 저장")
        #expect(result.achievement == "지원서 최종 검토")
        #expect(result.body.hasSuffix("한정민 드림"))

        let sent = try #require(StubProtocol.captured(host: host))
        let messages = try #require(sent.body["messages"] as? [[String: String]])
        // 사용자가 직접 쓴 보고서 본문을 그대로 보낸다.
        #expect(messages[1]["content"]?.contains("지원서 최종 검토를 끝냈습니다.") == true)
        #expect(messages[1]["content"]?.contains("3. 다음 주 목표") == true)
        #expect(messages[0]["content"]?.contains("성취 한 가지") == true)
    }

    @Test func 연결_확인은_응답한_모델_이름을_돌려준다() async throws {
        let host = "ping.test"
        StubProtocol.set(.init(body: completion(content: "확인")), host: host)
        #expect(try await stubClient(host: host).ping() == "solar-pro4-260806")
    }

    @Test func 모든_오류에_안내_문구가_있다() {
        let all: [SolarError] = [
            .missingKey, .unauthorized(code: nil), .blocked(code: nil), .regionMismatch, .timeout, .offline,
            .rateLimited, .usageLimit, .badRequest(code: nil, message: "x"), .server(status: 503),
            .truncated, .malformed("x"), .cancelled,
        ]
        for error in all {
            #expect(!error.title.isEmpty)
            #expect(!error.guidance.isEmpty)
        }
        // 키 누락, 인증 실패, 응답 시간 초과는 제목이 서로 다르다.
        #expect(Set([SolarError.missingKey.title, SolarError.unauthorized(code: nil).title, SolarError.timeout.title]).count == 3)
    }
}

@Suite("Solar 키 읽기")
struct SolarSettingsTests {
    @Test func env_형식을_읽는다() {
        let values = EnvFile.parse("""
        # 주석
        UPSTAGE_API_KEY=up_abc123

        export UPSTAGE_MODEL="solar-mini4"
        EMPTY=
        QUOTED='따옴표 값'
        WITH_COMMENT=값 # 뒤 주석
        잘못된 줄
        """)
        #expect(values["UPSTAGE_API_KEY"] == "up_abc123")
        #expect(values["UPSTAGE_MODEL"] == "solar-mini4")
        #expect(values["EMPTY"] == "")
        #expect(values["QUOTED"] == "따옴표 값")
        #expect(values["WITH_COMMENT"] == "값")
        #expect(values.count == 5)
    }

    @Test func 키_하나만_넣으면_나머지는_기본값() {
        let resolved = SolarSettings.resolve(environment: ["UPSTAGE_API_KEY": "up_only_key_123456"], envFiles: [])
        #expect(resolved.config.apiKey == "up_only_key_123456")
        #expect(resolved.config.baseURL.absoluteString == "https://api.upstage.ai/v1")
        #expect(resolved.config.model == "solar-pro4")
        #expect(resolved.config.timeout == 30)
        #expect(resolved.source == .environment)
        #expect(resolved.maskedKey == "up_o…3456")
    }

    @Test func 환경변수가_env_파일보다_먼저다() throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("office-env-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: folder) }
        let file = folder.appendingPathComponent(".env")
        try "UPSTAGE_API_KEY=file_key_12345678\nUPSTAGE_MODEL=solar-mini4\n".write(to: file, atomically: true, encoding: .utf8)

        let fromFile = SolarSettings.resolve(environment: [:], envFiles: [folder.appendingPathComponent("없음.env"), file])
        #expect(fromFile.config.apiKey == "file_key_12345678")
        #expect(fromFile.config.model == "solar-mini4")
        #expect(fromFile.source == .envFile(file))

        let fromEnvironment = SolarSettings.resolve(environment: ["UPSTAGE_API_KEY": "env_key_12345678"], envFiles: [file])
        #expect(fromEnvironment.config.apiKey == "env_key_12345678")
        #expect(fromEnvironment.source == .environment)
    }

    @Test func 키가_없거나_비어_있으면_없음() {
        let none = SolarSettings.resolve(environment: ["UPSTAGE_API_KEY": "  "], envFiles: [])
        #expect(none.config.hasKey == false)
        #expect(none.source == .none)
        #expect(none.maskedKey == nil)
    }

    @Test func 키를_파일에_저장하면_다른_값은_그대로다() throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("office-env-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: folder) }
        let file = folder.appendingPathComponent(".env")
        try EnvFile.write(key: "UPSTAGE_API_KEY", value: "first_key", to: file)
        try "# 메모\nUPSTAGE_MODEL=solar-mini4\nUPSTAGE_API_KEY=first_key\n".write(to: file, atomically: true, encoding: .utf8)
        try EnvFile.write(key: "UPSTAGE_API_KEY", value: "second_key", to: file)

        let text = try String(contentsOf: file, encoding: .utf8)
        #expect(text == "# 메모\nUPSTAGE_MODEL=solar-mini4\nUPSTAGE_API_KEY=second_key\n")
        let permissions = try FileManager.default.attributesOfItem(atPath: file.path)[.posixPermissions] as? Int
        #expect(permissions == 0o600)
    }
}
