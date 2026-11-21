import Foundation
import OfficeCore

/// 미리보기·화면 확인용 사무실 상태. 실제 앱 상태와 같은 메서드로 만든다.
public enum OfficeSamples {
    /// 이번 주 월요일, 입사를 마친 김서울.
    public static func onboarded() -> Office {
        var office = Office(startingAt: Office.demoStart())
        office.completeOnboarding(name: "김서울")
        return office
    }

    /// 출근 전. `minute`는 자정 기준 분(예: 8*60+58).
    public static func beforeCheckIn(minute: Int) -> Office {
        var office = onboarded()
        office.advance(to: office.today.at(minute))
        return office
    }

    /// 출근해서 아침 PT 중. `withDrafts`면 기획서 예시 PT로 기기 안 규칙 초안까지 만든다.
    public static func morningPT(withDrafts: Bool, late: Bool = false) -> Office {
        var office = beforeCheckIn(minute: late ? 9 * 60 + 12 : 8 * 60 + 58)
        _ = try? office.checkIn()
        guard withDrafts else { return office }
        office.setTranscript(MorningPTView.samplePT)
        office.replaceDrafts(PTParser.parse(MorningPTView.samplePT, workEnd: office.profile.workEnd),
                             source: .localRules)
        return office
    }
}
