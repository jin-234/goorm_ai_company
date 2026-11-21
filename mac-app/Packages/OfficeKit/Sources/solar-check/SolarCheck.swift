import Foundation
import OfficeCore

/// 터미널에서 Solar 실제 응답을 확인하는 도구.
///
/// 사용법 (mac-app 폴더에서):
///   scripts/solar-check.sh                 기획서 예시 PT로 확인
///   scripts/solar-check.sh "전사문 …"      직접 넣은 전사문으로 확인
@main
struct SolarCheck {
    static let samplePT = """
    3단계 필수 업무는 지원서 최종 검토입니다. 오후 3시까지 오탈자를 확인하고 제출본을 저장하겠습니다. \
    2단계 당일 업무는 포트폴리오 한 문단 초안입니다. 오후 5시까지 문단을 쓰겠습니다. \
    1단계 이월 가능 업무는 관심 기업 세 곳 저장입니다. 퇴근 전까지 링크를 모으겠습니다.
    """

    static func main() async {
        let cwd = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
        var candidates: [URL] = []
        var folder = cwd
        for _ in 0..<4 {
            candidates.append(folder.appendingPathComponent(".env"))
            folder = folder.deletingLastPathComponent()
        }
        if let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first {
            candidates.append(support.appendingPathComponent("AIBossOffice/.env"))
        }

        let resolved = SolarSettings.resolve(envFiles: candidates)
        print("주소: \(resolved.config.baseURL.absoluteString)")
        print("모델: \(resolved.config.model)")
        print("키:   \(resolved.maskedKey ?? "없음") · 읽은 곳: \(resolved.source.label)")
        print("")

        let arguments = CommandLine.arguments.dropFirst()
        let transcript = arguments.isEmpty ? samplePT : arguments.joined(separator: " ")
        let client = SolarClient(config: resolved.config)

        print("① 아침 PT 전사문 → 업무 체크리스트")
        print("전사문: \(transcript)")
        print("")
        do {
            let started = Date()
            let drafts = try await client.checklist(transcript: transcript)
            print(String(format: "응답 시간 %.1f초 · 업무 %d건", Date().timeIntervalSince(started), drafts.count))
            printDrafts(drafts)
        } catch {
            report(error)
            print("")
            print("참고: Solar 없이 기기 안 규칙으로 정리하면 아래와 같습니다.")
            printDrafts(PTParser.parse(transcript))
            exit(1)
        }

        print("")
        print("② 주간보고서 → 상사 답장")
        let weekly = WeeklyReport(
            weekOf: DayKey(Date()).mondayOfWeek(),
            completed: "지원서 최종 검토를 끝내고 제출본을 저장했습니다.\n포트폴리오 소개 문단 초안을 썼습니다.",
            incomplete: "관심 기업 세 곳 저장은 두 곳만 했습니다. 채용 공고를 읽는 데 시간이 더 걸렸습니다.",
            nextGoals: "포트폴리오 프로젝트 설명 두 개 쓰기\n관심 기업 다섯 곳 정리")
        do {
            let started = Date()
            let reply = try await client.weeklyReply(report: weekly, name: "김서울")
            print(String(format: "응답 시간 %.1f초", Date().timeIntervalSince(started)))
            print("제목: \(reply.subject)")
            print("짚은 성취: \(reply.achievement)")
            print("본문:")
            print(reply.body)
        } catch {
            report(error)
            exit(1)
        }
    }

    static func printDrafts(_ drafts: [TaskDraft]) {
        for draft in drafts {
            let level = draft.level?.label ?? "확인 필요"
            let due = draft.due.map(Clock.hm) ?? "확인 필요"
            print("  · 업무명: \(draft.title ?? "확인 필요")")
            print("    중요도: \(level) | 마감: \(due) | 완료 기준: \(draft.doneCriteria ?? "확인 필요")")
        }
    }

    static func report(_ error: SolarError) {
        print("실패: \(error.title)")
        print(error.guidance)
        print(error.canRetry ? "다시 시도할 수 있습니다." : "설정을 고친 뒤 다시 실행해 주세요.")
    }
}
