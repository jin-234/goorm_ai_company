import Foundation

/// 사내 메일 문구.
/// 일상 업무 메일은 감정 표현을 줄인 단정한 문체로 쓴다.
/// 따뜻한 문체는 주간보고 답장에만 쓴다.
enum MailTemplates {

    // MARK: 입사와 공지

    static func welcome(name: String, profile: EmployeeProfile, at: Date) -> Mail {
        let start = Clock.hm(profile.workStart)
        let end = Clock.hm(profile.workEnd)
        let body = """
        \(name) 사원의 입사를 확인합니다.

        근무시간은 평일 \(start)~\(end)입니다.
        출근은 카메라 앞에 앉아 출근 버튼을 누르면 기록합니다.
        \(start) 이후 출근은 지각으로 기록합니다.
        당일 출근 기록이 없으면 결근 후보로 기록합니다.

        점심은 사내 메일로 요청하면 1시간을 부여합니다.
        자리 비움은 사유를 등록하면 건당 15분을 부여합니다.
        허용 시간이 끝난 뒤에도 자리가 비어 있으면 근무 중 자리 비움으로 기록합니다.

        \(end) 퇴근 점검 때 2·3단계 업무가 남으면
        저녁시간 뒤 19:00~22:00에 추가근무를 합니다.

        지각 1회는 1점, 무단결근 1회는 3점입니다.
        월 누적 2점까지 0원, 초과 1점당 1,000원, 월 최대 5,000원입니다.
        시연에서는 예상액으로만 표시하고 청구하지 않습니다.

        카메라는 자리에 사람이 보이는지만 판단합니다.
        영상은 저장하거나 보내지 않습니다.
        마이크는 회의실 아침 PT에서만 씁니다.
        이 맥 안에서 글로 옮긴 뒤 녹음은 지웁니다.
        업무 정리와 주간 피드백은 Upstage Solar를 쓰며,
        이때 전사문과 보고서 글만 보냅니다.
        """
        return Mail(sentAt: at, from: .hr, to: .me, kind: .welcome,
                    subject: "[인사] 입사 안내 및 근태 기준", body: body)
    }

    static func morningNotice(day: DayKey, profile: EmployeeProfile, carried: [WorkTask], at: Date) -> Mail {
        var lines = [
            "\(day.koreanShort) 근무 안내입니다.",
            "",
            "\(Clock.hm(profile.workStart)) 회의실에서 아침 PT를 진행합니다.",
            "3단계 업무부터 1단계 순서로 발표합니다.",
            "확정한 업무 목록을 \(Clock.hm(profile.workEnd)) 퇴근 점검에 사용합니다.",
        ]
        if !carried.isEmpty {
            lines.append("")
            lines.append("이월된 업무 \(carried.count)건이 오늘 목록에 포함되어 있습니다.")
            lines.append(contentsOf: carried.map { "· \($0.level.short) \($0.title)" })
        }
        if day.isFriday {
            lines.append("")
            lines.append("오늘은 금요일입니다.")
            lines.append("퇴근 전까지 주간보고서를 작성해 제출합니다.")
        }
        return Mail(sentAt: at, from: .manager, to: .me, kind: .notice,
                    subject: "[공지] \(day.koreanShort) 근무 안내", body: lines.joined(separator: "\n"))
    }

    // MARK: 근태

    static func lateRecorded(checkIn: Date, profile: EmployeeProfile, stats: MonthStats, at: Date) -> Mail {
        let body = """
        출근 시각은 \(checkIn.hm)입니다.
        기준 시각(\(Clock.hm(profile.workStart)))보다 늦어 지각으로 기록합니다.

        이번 달 누적 \(stats.points)점입니다. (지각 \(stats.late)회, 결근 후보 \(stats.absent)회)
        지각비 예상액은 \(LateFee.won(stats.estimatedFee))입니다.
        시연용 예상액이며 청구하지 않습니다.
        """
        return Mail(sentAt: at, from: .hr, to: .me, kind: .attendance,
                    subject: "[근태] 지각 기록 \(checkIn.hm)", body: body)
    }

    static func absentCandidate(day: DayKey, profile: EmployeeProfile, stats: MonthStats, at: Date) -> Mail {
        let body = """
        \(day.koreanShort) \(Clock.hm(profile.workEnd))까지 출근 기록이 없습니다.
        결근 후보로 기록합니다.

        이번 달 누적 \(stats.points)점입니다. (지각 \(stats.late)회, 결근 후보 \(stats.absent)회)
        지각비 예상액은 \(LateFee.won(stats.estimatedFee))입니다.
        월말에 기록을 확인하고 정정한 뒤 확정합니다.
        """
        return Mail(sentAt: at, from: .hr, to: .me, kind: .attendance,
                    subject: "[근태] 결근 후보 기록 \(day.koreanShort)", body: body)
    }

    static func lunchRequest(name: String, at: Date) -> Mail {
        let body = """
        점심을 요청합니다.
        요청 시각은 \(at.hm)입니다.

        \(name) 드림
        """
        return Mail(sentAt: at, from: .me, to: .manager, kind: .lunchRequest,
                    subject: "[근태] 점심 요청 \(at.hm)", body: body, isRead: true)
    }

    static func lunchApproval(allowance: Allowance, at: Date) -> Mail {
        let body = """
        점심 요청을 승인합니다.

        허용 시간은 \(allowance.start.hm)부터 \(allowance.end.hm)까지입니다.
        이 시간에는 착석 확인을 쉽니다.
        \(allowance.end.hm)부터 착석 확인을 재개합니다.
        """
        return Mail(sentAt: at, from: .manager, to: .me, kind: .lunchApproval,
                    subject: "[근태] 점심 승인 \(allowance.start.hm)~\(allowance.end.hm)", body: body)
    }

    // MARK: 업무

    static func tasksConfirmed(tasks: [WorkTask], profile: EmployeeProfile, at: Date) -> Mail {
        var lines = ["오늘 업무 \(tasks.count)건을 확정했습니다.", ""]
        for task in tasks {
            lines.append("· \(task.level.label) | \(task.title)")
            lines.append("  마감 \(Clock.hm(task.due)) · 완료 기준: \(task.doneCriteria)")
        }
        lines.append("")
        lines.append("\(Clock.hm(profile.workEnd)) 퇴근 점검에서 이 목록으로 판단합니다.")
        return Mail(sentAt: at, from: .manager, to: .me, kind: .tasksConfirmed,
                    subject: "[업무] 오늘 업무 \(tasks.count)건 확정", body: lines.joined(separator: "\n"))
    }

    static func carryReport(name: String, tasks: [WorkTask], reports: [UUID: CarryReport], at: Date) -> Mail {
        var lines = ["1단계 업무 \(tasks.count)건의 이월을 보고합니다.", ""]
        for task in tasks {
            let report = reports[task.id] ?? CarryReport()
            lines.append("· \(task.title)")
            lines.append("  미완료 이유: \(report.reason.trimmingCharacters(in: .whitespacesAndNewlines))")
            lines.append("  다음 근무일 계획: \(report.plan.trimmingCharacters(in: .whitespacesAndNewlines))")
        }
        lines.append("")
        lines.append("\(name) 드림")
        return Mail(sentAt: at, from: .me, to: .manager, kind: .carryReport,
                    subject: "[업무] 1단계 업무 이월 보고 \(tasks.count)건", body: lines.joined(separator: "\n"), isRead: true)
    }

    static func carryAccepted(tasks: [WorkTask], nextDay: DayKey, at: Date) -> Mail {
        var lines = ["이월 보고를 접수했습니다.", "아래 업무를 다음 근무일로 이월합니다.", ""]
        lines.append(contentsOf: tasks.map { "· \($0.level.short) \($0.title)" })
        lines.append("")
        lines.append("다음 근무일은 \(nextDay.koreanShort)입니다.")
        lines.append("그날 업무 목록에 포함됩니다.")
        return Mail(sentAt: at, from: .manager, to: .me, kind: .carryAccepted,
                    subject: "[업무] 이월 접수 \(tasks.count)건", body: lines.joined(separator: "\n"))
    }

    static func offConfirmed(done: Int, carried: Int, at: Date) -> Mail {
        var lines: [String] = []
        if carried == 0 {
            lines.append("오늘 확정한 업무 \(done)건을 모두 완료했습니다.")
        } else {
            lines.append("오늘 업무 \(done)건을 완료했고 1단계 \(carried)건을 이월했습니다.")
        }
        lines.append("퇴근을 확인합니다. 퇴근 시각은 \(at.hm)입니다.")
        return Mail(sentAt: at, from: .manager, to: .me, kind: .offConfirmed,
                    subject: "[근태] 퇴근 확인 \(at.hm)", body: lines.joined(separator: "\n"))
    }

    static func offWithoutTasks(at: Date) -> Mail {
        let body = """
        오늘은 아침 PT에서 확정한 업무가 없습니다.
        아침 PT 미진행으로 기록합니다.
        퇴근을 확인합니다. 퇴근 시각은 \(at.hm)입니다.
        """
        return Mail(sentAt: at, from: .manager, to: .me, kind: .offConfirmed,
                    subject: "[근태] 퇴근 확인 \(at.hm) · 아침 PT 미진행", body: body)
    }

    static func overtimeAssigned(tasks: [WorkTask], profile: EmployeeProfile, at: Date) -> Mail {
        let dinner = "\(Clock.hm(profile.workEnd))~\(Clock.hm(profile.overtimeStart))"
        let overtime = "\(Clock.hm(profile.overtimeStart))~\(Clock.hm(profile.overtimeEnd))"
        var lines = [
            "2·3단계 업무 \(tasks.count)건이 완료되지 않았습니다.",
            "",
            "저녁시간은 \(dinner)입니다.",
            "추가근무는 \(overtime)입니다.",
            "3단계 업무부터 진행합니다.",
            "",
        ]
        lines.append(contentsOf: tasks.map { "· \($0.level.label) | \($0.title)" })
        lines.append("")
        lines.append("\(Clock.hm(profile.overtimeEnd))까지 끝내지 못한 업무는 다음 근무일로 이월합니다.")
        lines.append("먼저 종료하면 보충근무 미이행으로 기록합니다.")
        return Mail(sentAt: at, from: .manager, to: .me, kind: .overtimeAssigned,
                    subject: "[근태] 추가근무 배정 \(overtime)", body: lines.joined(separator: "\n"))
    }

    static func overtimeCompleted(done: [WorkTask], at: Date) -> Mail {
        var lines = ["추가근무 대상 업무를 모두 완료했습니다.", ""]
        lines.append(contentsOf: done.map { "· \($0.level.short) \($0.title)" })
        lines.append("")
        lines.append("퇴근을 확인합니다. 퇴근 시각은 \(at.hm)입니다.")
        return Mail(sentAt: at, from: .manager, to: .me, kind: .overtimeResult,
                    subject: "[근태] 추가근무 종료 확인 \(at.hm)", body: lines.joined(separator: "\n"))
    }

    static func overtimeRanToEnd(carried: [WorkTask], nextDay: DayKey, profile: EmployeeProfile, at: Date) -> Mail {
        var lines = [
            "\(Clock.hm(profile.overtimeEnd)) 추가근무를 종료합니다.",
            "끝내지 못한 업무 \(carried.count)건을 다음 근무일로 이월합니다.",
            "",
        ]
        lines.append(contentsOf: carried.map { "· \($0.level.short) \($0.title)" })
        lines.append("")
        lines.append("다음 근무일은 \(nextDay.koreanShort)입니다.")
        return Mail(sentAt: at, from: .manager, to: .me, kind: .overtimeResult,
                    subject: "[업무] 추가근무 종료 및 이월 \(carried.count)건", body: lines.joined(separator: "\n"))
    }

    static func supplementMissed(carried: [WorkTask], nextDay: DayKey, profile: EmployeeProfile, at: Date) -> Mail {
        var lines = [
            "추가근무 종료 시각 \(Clock.hm(profile.overtimeEnd)) 전에 근무를 종료했습니다.",
            "보충근무 미이행으로 기록합니다.",
            "",
            "남은 업무 \(carried.count)건을 다음 근무일로 이월합니다.",
        ]
        lines.append(contentsOf: carried.map { "· \($0.level.short) \($0.title)" })
        lines.append("")
        lines.append("다음 근무일은 \(nextDay.koreanShort)입니다.")
        return Mail(sentAt: at, from: .manager, to: .me, kind: .supplementMissed,
                    subject: "[근태] 보충근무 미이행 기록 \(at.hm)", body: lines.joined(separator: "\n"))
    }

    // MARK: 주간보고

    static func weeklyReport(name: String, report: WeeklyReport, day: DayKey, at: Date) -> Mail {
        let body = report.bodyText + "\n\n\(name) 드림"
        return Mail(sentAt: at, from: .me, to: .manager, kind: .weeklyReport,
                    subject: "[주간보고] \(day.weekLabel) · \(name)", body: body, isRead: true)
    }
}
