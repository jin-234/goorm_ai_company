import Foundation
import Testing
@testable import OfficeCore

// 2026-11-16은 월요일이다.
let monday = DayKey(year: 2026, month: 11, day: 16)
let friday = DayKey(year: 2026, month: 11, day: 20)

func makeOffice(at minutes: Int = 8 * 60 + 55, on day: DayKey = monday) -> Office {
    var office = Office(startingAt: day.at(minutes))
    office.completeOnboarding(name: "김서울")
    return office
}

/// 기획서 예시 PT의 업무 세 건.
func sampleDrafts() -> [TaskDraft] {
    [
        TaskDraft(title: "지원서 최종 검토", level: .mustFinish, due: 15 * 60, doneCriteria: "오탈자를 확인하고 제출본을 저장"),
        TaskDraft(title: "포트폴리오 한 문단 초안", level: .sameDay, due: 17 * 60, doneCriteria: "문단을 쓰기"),
        TaskDraft(title: "관심 기업 세 곳 저장", level: .carryable, due: 18 * 60, doneCriteria: "링크를 모으기"),
    ]
}

/// 출근하고 예시 업무를 확정해 근무를 시작한 상태.
func workingOffice() throws -> Office {
    var office = makeOffice()
    try office.checkIn()
    office.replaceDrafts(sampleDrafts(), source: .manual)
    try office.confirmTasks()
    return office
}

func task(_ office: Office, _ level: TaskLevel) -> WorkTask {
    office.day.tasks.first { $0.level == level }!
}

@Suite("날짜와 시각")
struct TimeTests {
    @Test func 요일과_다음_근무일() {
        #expect(monday.weekdayName == "월")
        #expect(friday.isFriday)
        #expect(monday.nextWorkday() == DayKey(year: 2026, month: 11, day: 17))
        // 금요일 다음 근무일은 월요일이다.
        #expect(friday.nextWorkday() == DayKey(year: 2026, month: 11, day: 23))
        #expect(DayKey(year: 2026, month: 11, day: 21).isWeekend)
        #expect(DayKey(year: 2026, month: 11, day: 19).mondayOfWeek() == monday)
        #expect(DayKey(year: 2026, month: 11, day: 22).mondayOfWeek() == monday)
    }

    @Test func 달이_바뀌는_근무일() {
        let lastFriday = DayKey(year: 2026, month: 10, day: 30)
        #expect(lastFriday.isFriday)
        #expect(lastFriday.nextWorkday() == DayKey(year: 2026, month: 11, day: 2))
        #expect(DayKey(year: 2026, month: 12, day: 31).nextWorkday() == DayKey(year: 2027, month: 1, day: 1))
    }

    @Test func 시각_표기() {
        #expect(monday.at(9 * 60 + 5).hm == "09:05")
        #expect(monday.at(18 * 60).minuteOfDay == 1080)
        #expect(Clock.minutes(fromHM: "15:00") == 900)
        #expect(Clock.minutes(fromHM: "9:30") == 570)
        #expect(Clock.minutes(fromHM: "25:00") == nil)
        #expect(Clock.minutes(fromHM: "오후 3시") == nil)
        #expect(Clock.korean(15 * 60) == "오후 3시")
        #expect(Clock.korean(9 * 60 + 30) == "오전 9시 30분")
        #expect(Clock.duration(65) == "1시간 5분")
        #expect(monday.koreanShort == "11월 16일(월)")
        #expect(monday.weekLabel == "11월 3주차")
    }

    @Test func 시연_시작은_이번_주_월요일_0855() {
        let wednesday = DayKey(year: 2026, month: 11, day: 18).at(14 * 60)
        let start = Office.demoStart(realNow: wednesday)
        #expect(DayKey(start) == monday)
        #expect(start.hm == "08:55")
        // 토요일(본선 날)에 켜도 그 주 월요일에서 시작한다.
        let saturday = DayKey(year: 2026, month: 11, day: 21).at(10 * 60)
        #expect(DayKey(Office.demoStart(realNow: saturday)) == monday)
    }
}

@Suite("출근과 지각")
struct CheckInTests {
    @Test func 정시_전_출근은_정상() throws {
        var office = makeOffice(at: 8 * 60 + 55)
        let result = try office.checkIn()
        #expect(result == .onTime)
        #expect(office.day.phase == .morningPT)
        #expect(office.day.checkInAt?.hm == "08:55")
        #expect(office.day.isLate == false)
        #expect(office.presence == .present)
    }

    @Test func 아홉시_정각은_정상이고_아홉시_일분은_지각() throws {
        var onTime = makeOffice(at: 9 * 60)
        #expect(try onTime.checkIn() == .onTime)

        // 09:00:59도 분 단위로 보면 09:00이라 정상이다.
        var almost = makeOffice()
        almost.advance(to: monday.at(9 * 60).addingTimeInterval(59))
        #expect(try almost.checkIn() == .onTime)

        var late = makeOffice(at: 9 * 60 + 1)
        #expect(try late.checkIn() == .late)
        #expect(late.day.isLate)
        #expect(late.day.events.contains { $0.kind == .late })
        #expect(late.inbox.contains { $0.subject.contains("지각 기록 09:01") })
        #expect(late.monthStats == MonthStats(late: 1, absent: 0))
    }

    @Test func 출근은_하루에_한_번() throws {
        var office = makeOffice()
        try office.checkIn()
        #expect(throws: OfficeError.self) { try office.checkIn() }
    }

    @Test func 출근_기록_없이_퇴근_시각이_되면_결근_후보() throws {
        var office = makeOffice()
        // 08:55에서 정각마다 보내면 퇴근 시각 18:00에 닿는다(정각에 딱 맞으니 '멈춤' 안내는 없다).
        var last: Office.SkipResult?
        while office.canSkipHour { last = office.skipHour() }
        #expect(office.now.hm == "18:00")
        #expect(last?.stoppedFor == nil)
        #expect(office.day.absentCandidate)
        #expect(office.day.attendance == .absentCandidate)
        #expect(office.seatStatus == .absentCandidate)
        #expect(office.canCheckIn == false)
        #expect(throws: OfficeError.self) { try office.checkIn() }
        #expect(office.inbox.contains { $0.subject.contains("결근 후보") })
        // 무단결근 1회는 3점, 2점을 넘는 1점에 1,000원.
        #expect(office.monthStats.points == 3)
        #expect(office.monthStats.estimatedFee == 1_000)

        #expect(office.canStartNextWorkday)
        office.startNextWorkday()
        #expect(office.today == DayKey(year: 2026, month: 11, day: 17))
        #expect(office.history.last?.attendance == .absentCandidate)
        #expect(office.monthStats.points == 3)
    }

    @Test func 늦게라도_퇴근_시각_전이면_출근할_수_있다() throws {
        var office = makeOffice()
        for _ in 0..<5 { office.skipHour() }
        #expect(office.now.hm == "14:00")
        #expect(try office.checkIn() == .late)
    }
}

@Suite("지각비 예상액")
struct LateFeeTests {
    @Test func 기획서_기준() {
        // 월 누적 2점까지 0원
        #expect(LateFee.estimate(late: 0, absent: 0) == 0)
        #expect(LateFee.estimate(late: 1, absent: 0) == 0)
        #expect(LateFee.estimate(late: 2, absent: 0) == 0)
        // 지각 3회는 1,000원, 지각 5회는 3,000원
        #expect(LateFee.estimate(late: 3, absent: 0) == 1_000)
        #expect(LateFee.estimate(late: 5, absent: 0) == 3_000)
        // 무단결근 1회는 3점
        #expect(LateFee.points(late: 0, absent: 1) == 3)
        #expect(LateFee.estimate(late: 0, absent: 1) == 1_000)
        #expect(LateFee.estimate(late: 1, absent: 1) == 2_000)
        // 월 최대 5,000원
        #expect(LateFee.estimate(late: 7, absent: 0) == 5_000)
        #expect(LateFee.estimate(late: 30, absent: 4) == 5_000)
        #expect(LateFee.won(3_000) == "3,000원")
    }

    @Test func 달이_바뀌면_새로_센다() throws {
        // 10월 30일(금) 지각 후 다음 근무일은 11월 2일.
        var office = makeOffice(at: 9 * 60 + 10, on: DayKey(year: 2026, month: 10, day: 30))
        try office.checkIn()
        #expect(office.monthStats.late == 1)
        while office.canSkipHour { office.skipHour() }
        try office.submitCheckout()
        office.startNextWorkday()
        #expect(office.today == DayKey(year: 2026, month: 11, day: 2))
        #expect(office.monthStats == MonthStats())
    }
}

@Suite("아침 PT와 업무 확정")
struct MorningPTTests {
    @Test func 출근_전에는_확정할_수_없다() {
        var office = makeOffice()
        office.replaceDrafts(sampleDrafts(), source: .manual)
        #expect(throws: OfficeError.self) { try office.confirmTasks() }
    }

    @Test func 확인_필요_칸이_남으면_확정할_수_없다() throws {
        var office = makeOffice()
        try office.checkIn()
        #expect(office.confirmBlocker == .noTasks)

        office.replaceDrafts([
            TaskDraft(title: "지원서 최종 검토", level: .mustFinish, due: nil, doneCriteria: "제출본 저장"),
            TaskDraft(title: nil, level: nil, due: 17 * 60, doneCriteria: nil),
        ], source: .solar)
        guard case .draftIncomplete(let rows) = office.confirmBlocker else {
            Issue.record("확인 필요 칸이 있는데 막지 않았다")
            return
        }
        #expect(rows.count == 2)
        #expect(rows[0].contains("지원서 최종 검토") && rows[0].contains("마감"))
        #expect(rows[1].contains("2번째 업무") && rows[1].contains("업무명") && rows[1].contains("중요도") && rows[1].contains("완료 기준"))
        #expect(throws: OfficeError.self) { try office.confirmTasks() }
        #expect(office.day.phase == .morningPT)
    }

    @Test func 수정하고_확정한_목록으로_근무를_시작한다() throws {
        var office = makeOffice()
        try office.checkIn()
        // 낮은 단계부터 넣어도 3단계가 맨 위로 온다.
        office.replaceDrafts(Array(sampleDrafts().reversed()), source: .solar)
        // 사용자가 중요도와 마감을 고친다.
        office.day.drafts[0].level = .sameDay
        office.day.drafts[0].due = 16 * 60
        try office.confirmTasks()

        #expect(office.day.phase == .working)
        #expect(office.day.tasks.map(\.title) == ["지원서 최종 검토", "관심 기업 세 곳 저장", "포트폴리오 한 문단 초안"])
        #expect(office.day.tasks.map(\.level) == [.mustFinish, .sameDay, .sameDay])
        #expect(office.day.tasks[1].due == 16 * 60)
        #expect(office.inbox.contains { $0.kind == .tasksConfirmed })
        // 확정한 뒤에는 다시 확정할 수 없다.
        #expect(throws: OfficeError.self) { try office.confirmTasks() }
    }

    @Test func 초안을_다시_만들어도_이월_업무는_남는다() throws {
        var office = makeOffice()
        try office.checkIn()
        office.day.drafts = [TaskDraft(title: "어제 남은 일", level: .sameDay, due: 600, doneCriteria: "끝내기",
                                       carriedFrom: monday.adding(days: -3), carryCount: 1)]
        office.replaceDrafts(sampleDrafts(), source: .localRules)
        #expect(office.day.drafts.count == 4)
        #expect(office.day.drafts[0].isCarried)
        // 이월 업무는 뺄 수 없다.
        office.removeDraft(office.day.drafts[0].id)
        #expect(office.day.drafts.count == 4)
        office.removeDraft(office.day.drafts[1].id)
        #expect(office.day.drafts.count == 3)
    }
}

@Suite("점심과 자리 비움")
struct AllowanceTests {
    @Test func 점심은_메일로_요청하고_한_시간을_받는다() throws {
        var office = try workingOffice()
        office.advance(to: monday.at(12 * 60 + 10))
        let lunch = try office.requestLunch()
        #expect(lunch.start.hm == "12:10")
        #expect(lunch.end.hm == "13:10")
        #expect(office.seatStatus == .lunch(until: lunch.end))
        #expect(office.isMonitoring == false)
        #expect(office.sent.contains { $0.kind == .lunchRequest })
        let approval = office.inbox.first { $0.kind == .lunchApproval }
        #expect(approval?.subject == "[근태] 점심 승인 12:10~13:10")
        // 하루 한 번.
        office.returnFromAllowance()
        #expect(throws: OfficeError.lunchAlreadyUsed) { try office.requestLunch() }
    }

    @Test func 점심_중_자리가_비어도_기록하지_않는다() throws {
        var office = try workingOffice()
        office.advance(to: monday.at(12 * 60 + 10))
        try office.requestLunch()
        office.observe(.absent)
        office.advance(to: monday.at(12 * 60 + 50))
        #expect(office.day.awaySpans.isEmpty)
        #expect(office.unauthorizedAwayMinutes == 0)
    }

    @Test func 허용_시간이_끝난_뒤에도_비어_있으면_근무_중_자리_비움() throws {
        var office = try workingOffice()
        office.advance(to: monday.at(10 * 60 + 20))
        let away = try office.registerAway(reason: "물 가지러 자리 비웁니다")
        #expect(away.end.hm == "10:35")
        #expect(office.seatStatus == .away(until: away.end, reason: "물 가지러 자리 비웁니다"))
        office.observe(.absent)

        // 실제 시간이 흘러 10:35를 지난다.
        office.advance(to: monday.at(10 * 60 + 34))
        #expect(office.day.awaySpans.isEmpty)
        office.advance(to: monday.at(10 * 60 + 40))
        #expect(office.activeAllowance == nil)
        let span = try #require(office.openSpan(.unauthorized))
        // 허용이 끝난 10:35부터 센다.
        #expect(span.start.hm == "10:35")
        #expect(office.unauthorizedAwayMinutes == 5)
        #expect(office.seatStatus == .unauthorizedAway(since: span.start))

        office.observe(.present)
        #expect(office.openSpan(.unauthorized) == nil)
        #expect(office.day.awaySpans.first?.end?.hm == "10:40")
        #expect(office.seatStatus == .seated)
    }

    @Test func 시연_시간을_건너뛰어도_등록된_종료_시각에_만료한다() throws {
        var office = try workingOffice()
        office.advance(to: monday.at(10 * 60 + 20))
        try office.registerAway(reason: "물 가지러 자리 비웁니다")
        office.observe(.absent)
        let result = office.skipHour()
        #expect(result?.to.hm == "11:00")
        let away = try #require(office.day.allowances.first)
        #expect(away.endedAt?.hm == "10:35")
        // 건너뛴 시간에는 카메라로 본 것이 없으므로 자리 비움을 세지 않는다.
        #expect(office.day.awaySpans.isEmpty)
        #expect(office.presence == .unknown)
        // 건너뛴 뒤에도 자리가 비어 있으면 그때부터 센다.
        office.observe(.absent)
        #expect(office.openSpan(.unauthorized)?.start.hm == "11:00")
    }

    @Test func 한_시간_점심도_건너뛴_뒤_정확히_끝난다() throws {
        var office = try workingOffice()
        office.advance(to: monday.at(12 * 60 + 10))
        try office.requestLunch()
        // 다음 정각 13:00에 먼저 선다. 점심은 아직 10분 남았다.
        office.skipHour()
        #expect(office.now.hm == "13:00")
        #expect(office.activeAllowance != nil)
        // 한 번 더 건너뛰어도 점심은 등록된 종료 시각 13:10에 정확히 끝난 것으로 남는다.
        office.skipHour()
        #expect(office.now.hm == "14:00")
        #expect(office.activeAllowance == nil)
        #expect(office.day.allowances.first?.endedAt?.hm == "13:10")
        #expect(office.day.events.contains { $0.kind == .lunchEnd && $0.at.hm == "13:10" })
    }

    @Test func 사유_없이는_자리_비움을_등록할_수_없다() throws {
        var office = try workingOffice()
        #expect(throws: OfficeError.emptyReason) { try office.registerAway(reason: "   ") }
        try office.registerAway(reason: "화장실")
        // 허용 시간 안에서는 다시 요청할 수 없다.
        #expect(throws: OfficeError.allowanceActive) { try office.registerAway(reason: "전화") }
        #expect(throws: OfficeError.allowanceActive) { try office.requestLunch() }
    }

    @Test func 먼저_복귀하면_착석_확인을_재개한다() throws {
        var office = try workingOffice()
        office.advance(to: monday.at(11 * 60))
        try office.registerAway(reason: "택배 받기")
        office.advance(to: monday.at(11 * 60 + 5))
        office.returnFromAllowance()
        #expect(office.activeAllowance == nil)
        #expect(office.day.allowances.first?.endedAt?.hm == "11:05")
        #expect(office.isMonitoring)
        // 건당 15분이므로 다시 등록할 수 있다.
        let again = try office.registerAway(reason: "전화 받기")
        #expect(again.end.hm == "11:20")
    }

    @Test func 등록_없이_자리를_비우면_바로_기록한다() throws {
        var office = try workingOffice()
        office.advance(to: monday.at(14 * 60))
        office.observe(.absent)
        office.advance(to: monday.at(14 * 60 + 12))
        #expect(office.unauthorizedAwayMinutes == 12)
        // 자리 비움 중에 사유를 등록하면 그때까지만 센다.
        try office.registerAway(reason: "급한 전화")
        #expect(office.day.awaySpans.first?.end?.hm == "14:12")
        office.advance(to: monday.at(14 * 60 + 20))
        #expect(office.unauthorizedAwayMinutes == 12)
    }

    @Test func 카메라_꺼짐은_자리_비움과_따로_기록한다() throws {
        var office = try workingOffice()
        office.advance(to: monday.at(15 * 60))
        office.observe(.cameraOff)
        #expect(office.seatStatus == .cameraOff)
        office.advance(to: monday.at(15 * 60 + 8))
        #expect(office.cameraOffMinutes == 8)
        #expect(office.unauthorizedAwayMinutes == 0)
        #expect(office.day.events.contains { $0.kind == .cameraOff })
        office.observe(.present)
        #expect(office.openSpan(.cameraOff) == nil)
        #expect(office.day.events.contains { $0.kind == .cameraOn })
    }

    @Test func 근무를_시작하기_전에는_자리_비움을_세지_않는다() throws {
        var office = makeOffice()
        try office.checkIn()
        office.observe(.absent)
        office.advance(to: monday.at(9 * 60 + 20))
        #expect(office.day.awaySpans.isEmpty)
        #expect(office.seatStatus == .emptyBeforeWork)
    }

    @Test func 퇴근_시각이_가까우면_허용도_퇴근_시각에_끝난다() throws {
        var office = try workingOffice()
        office.advance(to: monday.at(17 * 60 + 30))
        let lunch = try office.requestLunch()
        #expect(lunch.end.hm == "18:00")
    }
}

@Suite("가상 시계")
struct ClockTests {
    @Test func 한_시간씩_가다가_퇴근_점검에서_멈춘다() throws {
        var office = try workingOffice()
        #expect(office.now.hm == "08:55")
        var times: [String] = []
        var stops: [String?] = []
        while office.canSkipHour {
            let result = office.skipHour()
            times.append(office.now.hm)
            stops.append(result?.stoppedFor)
        }
        // 08:55는 다음 정각(09:00)까지 30분이 안 남아 10:00으로 간다. 이후로는 정각마다.
        #expect(times == ["10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00"])
        // 정각마다 서므로 18:00에도 딱 맞아 '멈춤' 안내 없이 퇴근 점검이 열린다.
        #expect(stops.allSatisfy { $0 == nil })
        #expect(office.day.phase == .checkoutReview)
        // 점검을 제출하기 전에는 시간을 건너뛸 수 없다.
        #expect(office.skipHour() == nil)
    }

    @Test func 어중간한_시각에서도_다음_정각으로_간다() throws {
        var office = makeOffice(at: 9 * 60 + 20)
        try office.checkIn()
        office.replaceDrafts(sampleDrafts(), source: .manual)
        try office.confirmTasks()
        #expect(office.skipHour()?.to.hm == "10:00")
        #expect(office.skipHour()?.to.hm == "11:00")
    }

    @Test func 정각에_딱_맞으면_멈춘_것으로_치지_않는다() throws {
        var office = makeOffice(at: 9 * 60)
        try office.checkIn()
        office.replaceDrafts(sampleDrafts(), source: .manual)
        try office.confirmTasks()
        for _ in 0..<8 { office.skipHour() }
        #expect(office.now.hm == "17:00")
        let result = office.skipHour()
        #expect(result?.to.hm == "18:00")
        #expect(result?.stoppedFor == nil)
        #expect(office.day.phase == .checkoutReview)
    }

    @Test func 실제로_흐른_시간도_퇴근_점검을_연다() throws {
        var office = try workingOffice()
        office.advance(to: monday.at(17 * 60 + 59))
        #expect(office.day.phase == .working)
        office.advance(to: monday.at(18 * 60).addingTimeInterval(1))
        #expect(office.day.phase == .checkoutReview)
        #expect(office.day.events.contains { $0.kind == .checkoutReview && $0.at.hm == "18:00" })
    }

    @Test func 시계는_뒤로_가지_않고_하루를_넘기지_않는다() throws {
        var office = makeOffice()
        office.advance(to: monday.at(8 * 60))
        #expect(office.now.hm == "08:55")
        office.advance(to: monday.adding(days: 2).at(10 * 60))
        #expect(office.today == monday)
        #expect(office.now.hm == "23:59")
    }

    @Test func 아침_PT_없이_퇴근_시각이_되면_미진행으로_기록한다() throws {
        var office = makeOffice()
        try office.checkIn()
        while office.canSkipHour { office.skipHour() }
        #expect(office.day.phase == .checkoutReview)
        #expect(office.day.noMorningPT)
        #expect(try office.submitCheckout() == .offNoTasks)
        #expect(office.day.phase == .off)
        #expect(office.inbox.contains { $0.subject.contains("아침 PT 미진행") })
    }

    @Test func 이월된_업무를_PT에서_다시_말해도_두_번_들어가지_않는다() throws {
        var office = Office(startingAt: DayKey(year: 2026, month: 11, day: 16).at(8 * 60 + 55))
        office.day.drafts = [TaskDraft(title: "관심 기업 세 곳 저장", level: .carryable, due: 18 * 60,
                                       doneCriteria: "링크 모으기", carriedFrom: DayKey(year: 2026, month: 11, day: 13), carryCount: 1)]
        office.replaceDrafts([TaskDraft(title: "관심기업 세 곳 저장", level: .carryable, due: 18 * 60, doneCriteria: "링크"),
                              TaskDraft(title: "포트폴리오 한 문단", level: .sameDay, due: 17 * 60, doneCriteria: "문단")],
                             source: .localRules)
        #expect(office.day.drafts.map(\.title) == ["관심 기업 세 곳 저장", "포트폴리오 한 문단"])
        #expect(office.day.drafts.first?.isCarried == true)
    }
}
