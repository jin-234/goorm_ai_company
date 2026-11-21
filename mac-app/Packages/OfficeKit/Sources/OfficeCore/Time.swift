import Foundation

/// 회사 시각은 한국 시각으로 고정한다.
public enum KST {
    public static let timeZone = TimeZone(identifier: "Asia/Seoul")!

    public static let calendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        calendar.locale = Locale(identifier: "ko_KR")
        calendar.firstWeekday = 2
        return calendar
    }()
}

/// 달력의 하루. 근무일을 구분하는 기준이다.
public struct DayKey: Hashable, Codable, Comparable, Sendable, CustomStringConvertible {
    public var year: Int
    public var month: Int
    public var day: Int

    public init(year: Int, month: Int, day: Int) {
        self.year = year
        self.month = month
        self.day = day
    }

    public init(_ date: Date) {
        let parts = KST.calendar.dateComponents([.year, .month, .day], from: date)
        self.init(year: parts.year ?? 1970, month: parts.month ?? 1, day: parts.day ?? 1)
    }

    /// 이 날 자정에서 `minutes`분 지난 시각.
    public func at(_ minutes: Int) -> Date {
        var parts = DateComponents()
        parts.year = year
        parts.month = month
        parts.day = day
        parts.hour = 0
        parts.minute = 0
        parts.second = 0
        let midnight = KST.calendar.date(from: parts) ?? Date(timeIntervalSince1970: 0)
        return midnight.addingTimeInterval(TimeInterval(minutes * 60))
    }

    public func at(hour: Int, minute: Int = 0) -> Date {
        at(hour * 60 + minute)
    }

    /// 1 = 일요일 … 7 = 토요일
    public var weekday: Int {
        KST.calendar.component(.weekday, from: at(12 * 60))
    }

    public var isWeekend: Bool { weekday == 1 || weekday == 7 }
    public var isFriday: Bool { weekday == 6 }

    public var weekdayName: String {
        ["일", "월", "화", "수", "목", "금", "토"][max(0, min(6, weekday - 1))]
    }

    public func adding(days: Int) -> DayKey {
        let moved = KST.calendar.date(byAdding: .day, value: days, to: at(12 * 60)) ?? at(12 * 60)
        return DayKey(moved)
    }

    /// 다음 근무일. 토요일과 일요일은 건너뛴다.
    public func nextWorkday() -> DayKey {
        var next = adding(days: 1)
        while next.isWeekend { next = next.adding(days: 1) }
        return next
    }

    /// 이 날이 속한 주의 월요일.
    public func mondayOfWeek() -> DayKey {
        let offset = (weekday + 5) % 7
        return adding(days: -offset)
    }

    /// 주간보고 제목에 쓰는 주차. 그 주 월요일이 속한 달을 기준으로 센다. 예: 11월 3주차
    public var weekLabel: String {
        let monday = mondayOfWeek()
        return "\(monday.month)월 \((monday.day - 1) / 7 + 1)주차"
    }

    public var description: String {
        String(format: "%04d-%02d-%02d", year, month, day)
    }

    /// 예: 11월 16일(월)
    public var koreanShort: String { "\(month)월 \(day)일(\(weekdayName))" }

    /// 예: 2026년 11월 16일 월요일
    public var koreanLong: String { "\(year)년 \(month)월 \(day)일 \(weekdayName)요일" }

    public static func < (lhs: DayKey, rhs: DayKey) -> Bool {
        (lhs.year, lhs.month, lhs.day) < (rhs.year, rhs.month, rhs.day)
    }
}

public extension Date {
    /// 한국 시각 기준, 자정에서 지난 분.
    var minuteOfDay: Int {
        let parts = KST.calendar.dateComponents([.hour, .minute], from: self)
        return (parts.hour ?? 0) * 60 + (parts.minute ?? 0)
    }

    /// 예: 09:05
    var hm: String { Clock.hm(minuteOfDay) }

    var dayKey: DayKey { DayKey(self) }
}

public enum Clock {
    /// 분을 "HH:MM"으로.
    public static func hm(_ minutes: Int) -> String {
        let clamped = max(0, minutes)
        return String(format: "%02d:%02d", (clamped / 60) % 24, clamped % 60)
    }

    /// "HH:MM"(또는 "H:MM")을 분으로. 형식이 틀리면 nil.
    public static func minutes(fromHM text: String) -> Int? {
        let parts = text.trimmingCharacters(in: .whitespaces).split(separator: ":")
        guard parts.count == 2, let hour = Int(parts[0]), let minute = Int(parts[1]),
              (0...24).contains(hour), (0..<60).contains(minute) else { return nil }
        let total = hour * 60 + minute
        return total <= 24 * 60 ? total : nil
    }

    /// 예: 오후 3시, 오후 3시 30분
    public static func korean(_ minutes: Int) -> String {
        let hour = (minutes / 60) % 24
        let minute = minutes % 60
        let half = hour < 12 ? "오전" : "오후"
        let hour12 = hour % 12 == 0 ? 12 : hour % 12
        return minute == 0 ? "\(half) \(hour12)시" : "\(half) \(hour12)시 \(minute)분"
    }

    /// 분 길이를 읽기 쉬운 말로. 예: 1시간 5분
    public static func duration(_ minutes: Int) -> String {
        let value = max(0, minutes)
        if value < 60 { return "\(value)분" }
        return value % 60 == 0 ? "\(value / 60)시간" : "\(value / 60)시간 \(value % 60)분"
    }
}
