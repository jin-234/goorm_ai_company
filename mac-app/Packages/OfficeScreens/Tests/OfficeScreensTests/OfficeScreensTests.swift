import OfficeCore
import Testing
@testable import OfficeScreens

@Suite("화면 상태")
struct OfficeScreensTests {
    @Test("예시 PT를 기기 안 규칙으로 읽으면 3건이 빈칸 없이 채워진다")
    func samplePTDrafts() {
        let office = OfficeSamples.morningPT(withDrafts: true)
        #expect(office.day.phase == .morningPT)
        #expect(office.day.draftSource == .localRules)
        #expect(office.day.drafts.count == 3)
        #expect(office.day.drafts.map(\.level) == [.mustFinish, .sameDay, .carryable])
        #expect(office.day.drafts.first?.due == 15 * 60)
        #expect(office.confirmBlocker == nil)
    }

    @Test("지각 예시는 지각으로 기록된다")
    func late() {
        let office = OfficeSamples.morningPT(withDrafts: false, late: true)
        #expect(office.day.isLate)
        #expect(office.monthStats.late == 1)
    }

    @Test("확인 필요 줄은 제목 없이 업무별 줄만")
    func blockerRows() {
        let rows = MorningPTView.blockerRows(.draftIncomplete(["· 1번째 업무: 업무명", "· 검토: 마감"]))
        #expect(rows == "· 1번째 업무: 업무명\n· 검토: 마감")
    }

    @Test("녹음 시간 표시")
    func timeText() {
        #expect(MorningPTView.timeText(0) == "0:00")
        #expect(MorningPTView.timeText(65.9) == "1:05")
    }
}
