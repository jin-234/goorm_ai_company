import Foundation
import OfficeCore
import OfficeScreens

/// 자동 점검용 대본. 환경변수 AIBOSS_SCRIPT 에 단계를 ';'로 이어 주면 차례로 실행한다.
///
/// 예: AIBOSS_SCRIPT="reset;onboard;shot 01-door;checkin;wait 7;shot 02-in"
/// `shot 이름`은 ~/Library/Caches/AIBossOffice/test/shot-request 파일에 이름을 쓰고,
/// 바깥의 캡처 도구가 창을 찍은 뒤 파일을 지우면 다음 단계로 간다.
@MainActor
enum DemoScript {
    static var requestFile: URL {
        // 여러 시험이 동시에 돌 때 서로의 촬영 요청을 가로채지 않게 실행마다 파일을 따로 준다.
        if let path = ProcessInfo.processInfo.environment["AIBOSS_SHOT_FILE"], !path.isEmpty {
            return URL(fileURLWithPath: path)
        }
        return FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Caches/AIBossOffice/test/shot-request")
    }

    static func runIfRequested(_ model: AppModel) {
        guard let script = ProcessInfo.processInfo.environment["AIBOSS_SCRIPT"], !script.isEmpty else { return }
        let steps = script.split(separator: ";").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        Task {
            try? await Task.sleep(for: .seconds(1.5))
            for step in steps {
                await run(step, model)
            }
            if ProcessInfo.processInfo.environment["AIBOSS_QUIT"] == "1" {
                try? await Task.sleep(for: .seconds(0.5))
                exit(0)
            }
        }
    }

    private static func run(_ step: String, _ model: AppModel) async {
        let parts = step.split(separator: " ", maxSplits: 1).map(String.init)
        let command = parts[0]
        let argument = parts.count > 1 ? parts[1] : ""
        print("대본: \(step)")
        switch command {
        case "reset": model.resetDemo()
        case "onboard": model.completeOnboarding(name: argument.isEmpty ? "김서울" : argument)
        case "panel":
            let panels: [String: Panel] = ["checkIn": .checkIn, "meeting": .meeting, "desk": .desk, "mail": .mail,
                                           "checkout": .checkout, "overtime": .overtime, "off": .off, "weekly": .weekly]
            model.panel = panels[argument]
        case "close": model.closePanel()
        case "checkin": model.checkInWithoutCamera()
        case "transcript":
            model.office.setTranscript(MorningPTView.samplePT)
        case "draft":
            model.office.replaceDrafts(PTParser.parse(model.office.day.transcript, workEnd: model.office.profile.workEnd), source: .localRules)
        case "confirm":
            model.run { try $0.confirmTasks() }
            model.didConfirmTasks()
        case "skip": model.skipHour()
        case "done":
            let count = Int(argument) ?? 1
            for task in model.office.openTasks.prefix(count) {
                model.run { $0.setTask(task.id, done: true) }
                model.run { $0.setDeliverable(task.id, text: "결과물: \(task.title) 완료본") }
            }
        case "lunch": model.run { _ = try $0.requestLunch() }
        case "away": model.run { _ = try $0.registerAway(reason: argument.isEmpty ? "물 가지러 자리 비웁니다" : argument) }
        case "back": model.run { $0.returnFromAllowance() }
        case "present": model.setManualPresence(.present)
        case "absent": model.setManualPresence(.absent)
        case "cameraoff": model.setManualPresence(.cameraOff)
        case "checkout":
            var reports: [UUID: CarryReport] = [:]
            for task in model.office.carryReportTargets {
                reports[task.id] = CarryReport(reason: "공고를 읽는 데 시간이 더 걸렸습니다.", plan: "다음 근무일 오전에 링크를 모두 모으겠습니다.")
            }
            model.run { _ = try $0.submitCheckout(carryReports: reports) }
        case "endovertime": model.run { _ = try $0.endOvertimeEarly() }
        case "overtimereview": model.run { _ = try $0.submitOvertimeReview() }
        case "next": model.startNextWorkday()
        case "friday": model.jumpToFriday()
        case "weeklyfill":
            model.office.weeklyDraft.completed = "지원서 최종 검토를 끝내고 제출본을 저장했습니다.\n포트폴리오 소개 문단 초안을 썼습니다."
            model.office.weeklyDraft.incomplete = "관심 기업 세 곳 저장은 두 곳만 했습니다.\n공고를 읽는 데 시간이 더 걸렸습니다."
            model.office.weeklyDraft.nextGoals = "포트폴리오 프로젝트 설명 두 개 쓰기\n관심 기업 다섯 곳 정리"
        case "weeklysubmit": model.submitWeekly()
        case "weeklyfallback":
            if let report = model.office.weeklyAwaitingReply {
                await model.requestWeeklyReply(for: report, allowFallback: true)
            }
        case "mail":
            let index = Int(argument) ?? 0
            model.panel = .mail
            if model.office.inbox.indices.contains(index) {
                let mail = model.office.inbox[index]
                model.office.markRead(mail.id)
                model.selectedMailID = mail.id
            }
        case "mailclose": model.selectedMailID = nil
        case "say": model.show(argument.replacingOccurrences(of: "/", with: "\n"))
        case "mailfeedback":
            model.panel = .mail
            if let mail = model.office.inbox.first(where: { $0.kind == .weeklyFeedback }) {
                model.office.markRead(mail.id)
                model.selectedMailID = mail.id
            }
        case "org": model.showOrgChart = true
        case "orgclose": model.showOrgChart = false
        case "wait":
            try? await Task.sleep(for: .seconds(Double(argument) ?? 1))
            return
        case "shot":
            try? await Task.sleep(for: .seconds(1.4))
            await shot(argument)
            return
        default:
            print("대본: 모르는 단계 \(command)")
        }
        try? await Task.sleep(for: .seconds(0.4))
    }

    private static func shot(_ name: String) async {
        let file = requestFile
        try? FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? name.write(to: file, atomically: true, encoding: .utf8)
        // 바깥 도구가 찍고 지울 때까지 기다린다(최대 10초).
        for _ in 0..<100 {
            try? await Task.sleep(for: .seconds(0.1))
            if !FileManager.default.fileExists(atPath: file.path) { return }
        }
        try? FileManager.default.removeItem(at: file)
    }
}
