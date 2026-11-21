import Foundation
import Testing
@testable import OfficeCore

/// 근무를 시작한 뒤 퇴근 점검(18:00)까지 보낸다. `done`에 넣은 단계의 업무는 끝낸 것으로 한다.
func officeAtCheckout(done levels: Set<TaskLevel>) throws -> Office {
    var office = try workingOffice()
    office.advance(to: monday.at(16 * 60))
    for level in levels {
        office.setTask(task(office, level).id, done: true)
        office.setDeliverable(task(office, level).id, text: "결과물 메모")
    }
    while office.canSkipHour { office.skipHour() }
    #expect(office.day.phase == .checkoutReview)
    #expect(office.now.hm == "18:00")
    return office
}

@Suite("18:00 퇴근 점검")
struct CheckoutTests {
    @Test func 모두_끝냈으면_정시_퇴근() throws {
        var office = try officeAtCheckout(done: [.mustFinish, .sameDay, .carryable])
        #expect(office.carryReportTargets.isEmpty)
        #expect(office.overtimeTargets.isEmpty)
        #expect(try office.submitCheckout() == .offAllDone)
        #expect(office.day.phase == .off)
        #expect(office.day.checkoutAt?.hm == "18:00")
        #expect(office.pendingCarry.isEmpty)
        #expect(office.inbox.contains { $0.subject == "[근태] 퇴근 확인 18:00" })
        #expect(office.seatStatus == .off)
    }

    @Test func 일단계만_남으면_이월_보고_후_정시_퇴근() throws {
        var office = try officeAtCheckout(done: [.mustFinish, .sameDay])
        let target = try #require(office.carryReportTargets.first)
        #expect(target.title == "관심 기업 세 곳 저장")
        #expect(office.overtimeTargets.isEmpty)

        // 미완료 이유와 다음 근무일 계획이 없으면 제출할 수 없다.
        #expect(throws: OfficeError.carryReportMissing(["관심 기업 세 곳 저장"])) {
            try office.submitCheckout()
        }
        #expect(throws: OfficeError.self) {
            try office.submitCheckout(carryReports: [target.id: CarryReport(reason: "시간 부족", plan: " ")])
        }
        #expect(office.day.phase == .checkoutReview)

        let report = CarryReport(reason: "공고를 읽는 데 시간이 더 걸렸습니다", plan: "오전 10시까지 세 곳을 저장하겠습니다")
        #expect(try office.submitCheckout(carryReports: [target.id: report]) == .offWithCarry(count: 1))
        #expect(office.day.phase == .off)

        // 보고 메일은 내가 보내고, 접수 메일을 받는다.
        let sent = try #require(office.sent.first { $0.kind == .carryReport })
        #expect(sent.body.contains("공고를 읽는 데 시간이 더 걸렸습니다"))
        #expect(sent.body.contains("오전 10시까지 세 곳을 저장하겠습니다"))
        #expect(office.inbox.contains { $0.kind == .carryAccepted })

        #expect(task(office, .carryable).status == .carried)
        #expect(office.pendingCarry.count == 1)
        #expect(office.pendingCarry[0].carriedFrom == monday)
        #expect(office.pendingCarry[0].carryCount == 1)
        #expect(office.pendingCarry[0].status == .open)
    }

    @Test func 이단계가_남으면_저녁시간과_추가근무() throws {
        var office = try officeAtCheckout(done: [.mustFinish, .carryable])
        #expect(office.overtimeTargets.map(\.title) == ["포트폴리오 한 문단 초안"])
        #expect(try office.submitCheckout() == .overtimeAssigned(count: 1, carried: 0))
        #expect(office.day.phase == .dinner)
        let dinner = try #require(office.activeAllowance)
        #expect(dinner.kind == .dinner)
        #expect(dinner.start.hm == "18:00" && dinner.end.hm == "19:00")
        #expect(office.seatStatus == .dinner(until: dinner.end))
        #expect(office.isMonitoring == false)
        let mail = try #require(office.inbox.first { $0.kind == .overtimeAssigned })
        #expect(mail.subject == "[근태] 추가근무 배정 19:00~22:00")
        #expect(mail.body.contains("3단계 업무부터 진행합니다"))

        // 저녁시간에 자리가 비어도 기록하지 않는다.
        office.observe(.absent)
        #expect(office.day.awaySpans.isEmpty)

        // 한 시간 뒤 19:00에 추가근무가 시작되고 착석 확인을 재개한다.
        office.observe(.present)
        let result = office.skipHour()
        #expect(result?.to.hm == "19:00")
        #expect(office.day.phase == .overtime)
        #expect(office.activeAllowance == nil)
        #expect(office.isMonitoring)
    }

    @Test func 이삼단계가_함께_남아도_추가근무는_한_구간이고_삼단계가_먼저() throws {
        var office = try officeAtCheckout(done: [])
        let carryTarget = try #require(office.carryReportTargets.first)
        #expect(office.overtimeTargets.map(\.level) == [.mustFinish, .sameDay])

        // 1단계는 추가근무 대상이 아니다. 이월 보고가 있어야 한다.
        #expect(throws: OfficeError.self) { try office.submitCheckout() }
        let outcome = try office.submitCheckout(carryReports: [
            carryTarget.id: CarryReport(reason: "2·3단계에 시간을 썼습니다", plan: "내일 오전에 저장하겠습니다"),
        ])
        #expect(outcome == .overtimeAssigned(count: 2, carried: 1))
        #expect(office.day.allowances.filter { $0.kind == .dinner }.count == 1)
        #expect(office.overtimeTasks.map(\.title) == ["지원서 최종 검토", "포트폴리오 한 문단 초안"])
        #expect(office.pendingCarry.map(\.title) == ["관심 기업 세 곳 저장"])
        #expect(office.inbox.filter { $0.kind == .overtimeAssigned }.count == 1)
    }

    @Test func 점검을_늦게_제출하면_바로_추가근무로_이어진다() throws {
        var office = try officeAtCheckout(done: [.carryable])
        // 점검 화면을 둔 채 실제 시간이 흘러 19:20이 되었다.
        office.advance(to: monday.at(19 * 60 + 20))
        #expect(office.day.phase == .checkoutReview)
        try office.submitCheckout()
        #expect(office.day.phase == .overtime)
        #expect(office.day.events.contains { $0.kind == .overtimeStart && $0.at.hm == "19:00" })
    }

    @Test func 퇴근_시각에_열려_있던_허용과_자리_비움은_닫는다() throws {
        var office = try workingOffice()
        office.advance(to: monday.at(17 * 60 + 40))
        office.observe(.absent)
        office.advance(to: monday.at(17 * 60 + 50))
        try office.registerAway(reason: "전화")
        office.advance(to: monday.at(18 * 60 + 2))
        #expect(office.day.phase == .checkoutReview)
        #expect(office.activeAllowance == nil)
        #expect(office.day.allowances.first?.endedAt?.hm == "18:00")
        #expect(office.day.awaySpans.allSatisfy { $0.end != nil })
        #expect(office.unauthorizedAwayMinutes == 10)
    }

    @Test func 점검_중에도_결과물을_올리고_완료할_수_있다() throws {
        var office = try officeAtCheckout(done: [.mustFinish, .carryable])
        let remaining = task(office, .sameDay)
        office.setDeliverable(remaining.id, text: "portfolio.md 3문단")
        office.setTask(remaining.id, done: true)
        #expect(try office.submitCheckout() == .offAllDone)
        #expect(task(office, .sameDay).deliverable == "portfolio.md 3문단")
        // 퇴근 뒤에는 바꿀 수 없다.
        office.setTask(remaining.id, done: false)
        #expect(task(office, .sameDay).isDone)
    }
}

@Suite("19:00~22:00 추가근무")
struct OvertimeTests {
    func officeInOvertime() throws -> Office {
        var office = try officeAtCheckout(done: [.carryable])
        try office.submitCheckout()
        office.skipHour()
        #expect(office.day.phase == .overtime)
        return office
    }

    @Test func 종료_시각까지_못_끝낸_업무는_다음_근무일로_이월() throws {
        var office = try officeInOvertime()
        office.setTask(task(office, .mustFinish).id, done: true)
        var times: [String] = []
        while office.canSkipHour {
            office.skipHour()
            times.append(office.now.hm)
        }
        #expect(times == ["20:00", "21:00", "22:00"])
        #expect(office.day.phase == .overtimeReview)

        #expect(try office.submitOvertimeReview() == .ranToEnd)
        #expect(office.day.phase == .off)
        #expect(office.day.overtime == .ranToEnd)
        #expect(task(office, .sameDay).status == .carried)
        #expect(office.pendingCarry.map(\.title) == ["포트폴리오 한 문단 초안"])
        #expect(office.inbox.contains { $0.subject.contains("추가근무 종료 및 이월 1건") })
    }

    @Test func 종료_점검에서_결과물을_올리면_완료로_친다() throws {
        var office = try officeInOvertime()
        while office.canSkipHour { office.skipHour() }
        for item in office.overtimeTasks {
            office.setDeliverable(item.id, text: "완료본")
            office.setTask(item.id, done: true)
        }
        #expect(try office.submitOvertimeReview() == .completed)
        #expect(office.pendingCarry.isEmpty)
    }

    @Test func 모두_끝내고_일찍_마치면_정상_종료() throws {
        var office = try officeInOvertime()
        office.advance(to: monday.at(20 * 60 + 15))
        for item in office.overtimeTasks { office.setTask(item.id, done: true) }
        #expect(try office.endOvertimeEarly() == .completed)
        #expect(office.day.phase == .off)
        #expect(office.day.checkoutAt?.hm == "20:15")
        #expect(office.day.events.contains { $0.kind == .supplementMissed } == false)
        #expect(office.inbox.contains { $0.subject == "[근태] 추가근무 종료 확인 20:15" })
    }

    @Test func 남은_업무를_두고_먼저_종료하면_보충근무_미이행() throws {
        var office = try officeInOvertime()
        office.advance(to: monday.at(20 * 60 + 30))
        #expect(try office.endOvertimeEarly() == .abandoned)
        #expect(office.day.overtime == .abandoned)
        #expect(office.day.events.contains { $0.kind == .supplementMissed })
        #expect(office.pendingCarry.count == 2)
        // 이월 목록도 3단계가 먼저다.
        #expect(office.pendingCarry.map(\.level) == [.mustFinish, .sameDay])
        #expect(office.inbox.contains { $0.kind == .supplementMissed && $0.body.contains("보충근무 미이행으로 기록합니다") })
    }

    @Test func 저녁시간에_추가근무_없이_가도_보충근무_미이행() throws {
        var office = try officeAtCheckout(done: [.carryable])
        try office.submitCheckout()
        #expect(office.day.phase == .dinner)
        #expect(try office.endOvertimeEarly() == .abandoned)
        #expect(office.day.phase == .off)
    }

    @Test func 추가근무_중에도_자리_비움을_확인한다() throws {
        var office = try officeInOvertime()
        office.observe(.absent)
        office.advance(to: monday.at(19 * 60 + 9))
        #expect(office.unauthorizedAwayMinutes == 9)
        let away = try office.registerAway(reason: "물 가지러 자리 비웁니다")
        #expect(away.end.hm == "19:24")
        // 추가근무 중에는 점심을 요청할 수 없다.
        #expect(throws: OfficeError.self) { try office.requestLunch() }
    }
}

@Suite("이월과 다음 근무일")
struct NextDayTests {
    @Test func 이월된_업무가_다음_근무일_목록에_들어간다() throws {
        var office = try officeAtCheckout(done: [.mustFinish, .sameDay])
        let target = try #require(office.carryReportTargets.first)
        try office.submitCheckout(carryReports: [target.id: CarryReport(reason: "시간 부족", plan: "오전에 끝냄")])
        #expect(office.canStartNextWorkday)
        office.startNextWorkday()

        let tuesday = DayKey(year: 2026, month: 11, day: 17)
        #expect(office.today == tuesday)
        #expect(office.now.hm == "08:55")
        #expect(office.day.phase == .beforeCheckIn)
        #expect(office.pendingCarry.isEmpty)
        #expect(office.day.drafts.count == 1)
        #expect(office.day.drafts[0].title == "관심 기업 세 곳 저장")
        #expect(office.day.drafts[0].carriedFrom == monday)
        #expect(office.day.drafts[0].isComplete)

        let record = try #require(office.history.last)
        #expect(record.date == monday)
        #expect(record.attendance == .onTime)
        #expect(record.doneTasks.count == 2)
        #expect(record.carriedTasks.count == 1)

        let notice = try #require(office.inbox.first { $0.kind == .notice && $0.subject.contains("11월 17일(화)") })
        #expect(notice.body.contains("이월된 업무 1건"))

        // 새 업무와 합쳐 확정한다.
        try office.checkIn()
        office.replaceDrafts([TaskDraft(title: "자기소개서 첫 문단", level: .sameDay, due: 14 * 60, doneCriteria: "초안 저장")],
                             source: .manual)
        try office.confirmTasks()
        #expect(office.day.tasks.count == 2)
        #expect(office.day.tasks.contains { $0.carriedFrom == monday && $0.carryCount == 1 })
    }

    @Test func 두_번_이월하면_처음_날짜와_횟수를_유지한다() throws {
        var office = try officeAtCheckout(done: [.mustFinish, .sameDay])
        var target = try #require(office.carryReportTargets.first)
        try office.submitCheckout(carryReports: [target.id: CarryReport(reason: "시간 부족", plan: "내일")])
        office.startNextWorkday()
        try office.checkIn()
        try office.confirmTasks()
        while office.canSkipHour { office.skipHour() }
        target = try #require(office.carryReportTargets.first)
        try office.submitCheckout(carryReports: [target.id: CarryReport(reason: "또 밀림", plan: "모레")])
        #expect(office.pendingCarry[0].carriedFrom == monday)
        #expect(office.pendingCarry[0].carryCount == 2)
    }

    @Test func 결근한_날의_이월_업무도_사라지지_않는다() throws {
        var office = try officeAtCheckout(done: [.mustFinish, .sameDay])
        let target = try #require(office.carryReportTargets.first)
        try office.submitCheckout(carryReports: [target.id: CarryReport(reason: "시간 부족", plan: "내일")])
        office.startNextWorkday()
        // 화요일에 출근하지 않았다.
        while office.canSkipHour { office.skipHour() }
        #expect(office.day.absentCandidate)
        office.startNextWorkday()
        #expect(office.today == DayKey(year: 2026, month: 11, day: 18))
        #expect(office.day.drafts.map(\.title) == ["관심 기업 세 곳 저장"])
        #expect(office.history.map(\.attendance) == [.onTime, .absentCandidate])
    }

    @Test func 근무_중에는_다음_근무일로_넘어갈_수_없다() throws {
        var office = try workingOffice()
        #expect(office.canStartNextWorkday == false)
        office.startNextWorkday()
        #expect(office.today == monday)
    }

    @Test func 금요일_다음_근무일은_월요일() throws {
        var office = makeOffice(on: friday)
        try office.checkIn()
        while office.canSkipHour { office.skipHour() }
        try office.submitCheckout()
        office.startNextWorkday()
        #expect(office.today == DayKey(year: 2026, month: 11, day: 23))
        #expect(office.today.weekdayName == "월")
    }
}

@Suite("금요일 주간보고")
struct WeeklyReportTests {
    let report = WeeklyReport(weekOf: monday,
                              completed: "지원서 최종 검토를 끝내고 제출본을 저장했습니다.",
                              incomplete: "관심 기업 저장은 두 곳만 했습니다. 공고 읽는 데 시간이 걸렸습니다.",
                              nextGoals: "포트폴리오 프로젝트 설명 두 개 쓰기")

    @Test func 금요일에만_제출한다() throws {
        var office = try workingOffice()
        #expect(office.canSubmitWeekly == false)
        #expect(throws: OfficeError.weeklyNotFriday) { try office.submitWeeklyReport(report) }
    }

    @Test func 출근하고_세_칸을_모두_써야_제출된다() throws {
        var office = makeOffice(on: friday)
        #expect(office.canSubmitWeekly == false)
        #expect(throws: OfficeError.self) { try office.submitWeeklyReport(report) }
        try office.checkIn()
        #expect(office.canSubmitWeekly)

        var empty = report
        empty.nextGoals = "  "
        #expect(throws: OfficeError.weeklyIncomplete(["다음 주 목표"])) { try office.submitWeeklyReport(empty) }

        let submitted = try office.submitWeeklyReport(report)
        #expect(submitted.submittedAt?.hm == "08:55")
        #expect(office.day.weeklySubmitted)
        let mail = try #require(office.sent.first { $0.kind == .weeklyReport })
        #expect(mail.subject == "[주간보고] 11월 3주차 · 김서울")
        #expect(mail.body.contains("1. 이번 주 완료한 업무와 결과물"))
        #expect(mail.body.contains("2. 미완료 업무와 이유"))
        #expect(mail.body.contains("3. 다음 주 목표"))
        #expect(throws: OfficeError.weeklyAlreadySubmitted) { try office.submitWeeklyReport(report) }
    }

    @Test func 상사_답장은_따뜻한_메일로_한_번만_들어온다() throws {
        var office = makeOffice(on: friday)
        try office.checkIn()
        let submitted = try office.submitWeeklyReport(report)
        #expect(office.weeklyAwaitingReply?.id == submitted.id)

        let reply = LocalWeeklyReply.make(report: submitted, name: "김서울")
        #expect(reply.achievement == "지원서 최종 검토를 끝내고 제출본을 저장했습니다")
        #expect(reply.body.contains("포트폴리오 프로젝트 설명 두 개 쓰기"))
        #expect(reply.body.hasSuffix("한정민 드림"))

        office.receiveWeeklyFeedback(reportID: submitted.id, subject: reply.subject, body: reply.body, source: .localTemplate)
        office.receiveWeeklyFeedback(reportID: submitted.id, subject: reply.subject, body: reply.body, source: .solar)
        let feedback = office.inbox.filter { $0.kind == .weeklyFeedback }
        #expect(feedback.count == 1)
        #expect(feedback[0].isWarm)
        #expect(feedback[0].replySource == .localTemplate)
        #expect(office.weeklyAwaitingReply == nil)
        // 평소 업무 메일은 따뜻한 문체로 표시하지 않는다.
        #expect(office.mails.filter { $0.kind != .weeklyFeedback }.allSatisfy { !$0.isWarm })
    }

    @Test func 금요일_장면으로_바로_가면_남은_업무를_이월한다() throws {
        var office = try workingOffice()
        office.advance(to: monday.at(11 * 60))
        office.setTask(task(office, .mustFinish).id, done: true)
        #expect(office.canJumpToFriday)
        office.jumpToFriday()
        #expect(office.today == friday)
        #expect(office.now.hm == "08:55")
        #expect(office.day.phase == .beforeCheckIn)
        #expect(office.day.drafts.count == 2)
        #expect(office.history.map(\.date) == [monday])
        // 건너뛴 날은 결근으로 세지 않는다.
        #expect(office.monthStats == MonthStats())
        #expect(office.canJumpToFriday == false)
        let notice = try #require(office.inbox.first { $0.kind == .notice && $0.subject.contains("11월 20일(금)") })
        #expect(notice.body.contains("주간보고서"))
    }

    @Test func 글머리_기호를_떼고_첫_줄을_읽는다() {
        #expect(LocalWeeklyReply.firstLine("- 지원서 제출.\n- 포트폴리오") == "지원서 제출")
        #expect(LocalWeeklyReply.firstLine("\n\n1. 자격증 접수\n2. 기출 풀이") == "자격증 접수")
        #expect(LocalWeeklyReply.firstLine("   ") == nil)
    }
}

@Suite("상태 저장")
struct PersistenceTests {
    @Test func 저장했다가_다시_읽어도_같다() throws {
        var office = try officeAtCheckout(done: [.mustFinish])
        let target = try #require(office.carryReportTargets.first)
        try office.submitCheckout(carryReports: [target.id: CarryReport(reason: "이유", plan: "계획")])
        let data = try JSONEncoder().encode(office)
        let restored = try JSONDecoder().decode(Office.self, from: data)
        #expect(restored == office)
        #expect(restored.day.phase == .dinner)
    }
}
