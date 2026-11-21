import Foundation
import Testing
@testable import OfficeCore

@Suite("아침 PT 규칙 읽기 (Solar 미연결 시)")
struct PTParserTests {
    /// 기획서의 발표 양식 예시.
    static let sample = """
    3단계 필수 업무는 지원서 최종 검토입니다. 오후 3시까지 오탈자를 확인하고 제출본을 저장하겠습니다.
    2단계 당일 업무는 포트폴리오 한 문단 초안입니다. 오후 5시까지 문단을 쓰겠습니다.
    1단계 이월 가능 업무는 관심 기업 세 곳 저장입니다. 퇴근 전까지 링크를 모으겠습니다.
    """

    @Test func 기획서_예시가_올바른_칸에_들어간다() {
        let drafts = PTParser.parse(Self.sample)
        #expect(drafts.count == 3)

        // 3단계 · 오후 3시 · 제출본 저장
        #expect(drafts[0].title == "지원서 최종 검토")
        #expect(drafts[0].level == .mustFinish)
        #expect(drafts[0].due == 15 * 60)
        #expect(drafts[0].doneCriteria == "오탈자를 확인하고 제출본을 저장")

        #expect(drafts[1].title == "포트폴리오 한 문단 초안")
        #expect(drafts[1].level == .sameDay)
        #expect(drafts[1].due == 17 * 60)
        #expect(drafts[1].doneCriteria == "문단을 쓰기")

        #expect(drafts[2].title == "관심 기업 세 곳 저장")
        #expect(drafts[2].level == .carryable)
        #expect(drafts[2].due == 18 * 60)
        #expect(drafts[2].doneCriteria == "링크를 모으기")

        #expect(drafts.filter { !$0.isComplete }.isEmpty)
    }

    @Test func 마침표_없는_음성_전사도_읽는다() {
        let spoken = "삼 단계 필수 업무는 지원서 최종 검토입니다 오후 세 시까지 오탈자를 확인하고 제출본을 저장하겠습니다 이 단계 당일 업무는 포트폴리오 한 문단 초안입니다 오후 다섯 시까지 문단을 쓰겠습니다 일 단계 이월 가능 업무는 관심 기업 세 곳 저장입니다 퇴근 전까지 링크를 모으겠습니다"
        let drafts = PTParser.parse(spoken)
        #expect(drafts.map(\.title) == ["지원서 최종 검토", "포트폴리오 한 문단 초안", "관심 기업 세 곳 저장"])
        #expect(drafts.map(\.level) == [.mustFinish, .sameDay, .carryable])
        #expect(drafts.map(\.due) == [15 * 60, 17 * 60, 18 * 60])
        #expect(drafts[0].doneCriteria == "오탈자를 확인하고 제출본을 저장")
    }

    @Test func 낮은_단계부터_말해도_높은_단계가_위로_온다() {
        let text = "1단계 업무는 링크 정리입니다. 3단계 업무는 지원서 제출입니다. 오전 11시까지 제출하겠습니다."
        let drafts = PTParser.parse(text)
        #expect(drafts.map(\.level) == [.mustFinish, .carryable])
        #expect(drafts[0].title == "지원서 제출")
        #expect(drafts[0].due == 11 * 60)
        #expect(drafts[0].doneCriteria == "제출")
    }

    @Test func 전사문에_없는_값은_비워_둔다() {
        // 마감과 완료 기준을 말하지 않았다.
        let drafts = PTParser.parse("2단계 당일 업무는 자격증 기출 풀이입니다.")
        #expect(drafts.count == 1)
        #expect(drafts[0].title == "자격증 기출 풀이")
        #expect(drafts[0].level == .sameDay)
        #expect(drafts[0].due == nil)
        #expect(drafts[0].doneCriteria == nil)
        #expect(drafts[0].missingFields == ["마감", "완료 기준"])
    }

    @Test func 단계를_말하지_않으면_중요도를_추측하지_않는다() {
        let drafts = PTParser.parse("안녕하세요. 오늘은 이력서 사진을 바꾸겠습니다. 오후 4시까지 자기소개서 초안을 쓰겠습니다. 감사합니다.")
        #expect(drafts.count == 2)
        #expect(drafts.allSatisfy { $0.level == nil })
        #expect(drafts[0].title == "오늘은 이력서 사진을 바꾸기")
        #expect(drafts[1].title == "자기소개서 초안을 쓰기")
        #expect(drafts[1].due == 16 * 60)
    }

    @Test func 순서를_안내하는_말은_업무가_아니다() {
        let text = "3단계부터 1단계 순서로 말씀드리겠습니다. 3단계 필수 업무는 면접 답변 정리입니다. 오후 2시까지 다섯 문항을 쓰겠습니다."
        let drafts = PTParser.parse(text)
        #expect(drafts.count == 1)
        #expect(drafts[0].title == "면접 답변 정리")
        #expect(drafts[0].due == 14 * 60)
        #expect(drafts[0].doneCriteria == "다섯 문항을 쓰기")
    }

    @Test func 여러_가지_마감_표현() {
        func due(_ text: String) -> Int? { PTParser.deadline(in: text, workEnd: 18 * 60)?.minutes }
        #expect(due("오후 3시까지 끝냅니다") == 15 * 60)
        #expect(due("오후 3시 30분까지") == 15 * 60 + 30)
        #expect(due("세 시 반까지") == 15 * 60 + 30)
        #expect(due("오전 10시까지") == 10 * 60)
        #expect(due("11시까지") == 11 * 60)
        // 오전·오후를 말하지 않은 1~8시는 오후로 읽는다.
        #expect(due("4시까지") == 16 * 60)
        #expect(due("15시까지") == 15 * 60)
        #expect(due("15:30까지") == 15 * 60 + 30)
        #expect(due("저녁 7시 전에") == 19 * 60)
        #expect(due("낮 12시까지") == 12 * 60)
        #expect(due("퇴근 전까지") == 18 * 60)
        #expect(due("오늘 안에") == 18 * 60)
        #expect(due("점심 전까지") == 12 * 60)
        #expect(due("오전 중으로") == 12 * 60)
        // '시간'은 시각이 아니다.
        #expect(due("3시간 동안 풀겠습니다") == nil)
        #expect(due("문단을 쓰겠습니다") == nil)
    }

    @Test func 하겠다는_말을_완료_기준_문구로() {
        #expect(PTParser.actionPhrase("오탈자를 확인하고 제출본을 저장하겠습니다.") == "오탈자를 확인하고 제출본을 저장")
        #expect(PTParser.actionPhrase("문단을 쓰겠습니다") == "문단을 쓰기")
        #expect(PTParser.actionPhrase("링크를 모으겠습니다") == "링크를 모으기")
        #expect(PTParser.actionPhrase("정리를 하겠습니다") == "정리를 하기")
        #expect(PTParser.actionPhrase("메일을 보내도록 하겠습니다") == "메일을 보내기")
        #expect(PTParser.actionPhrase("세 문제를 풀 예정입니다") == "세 문제를 풀 예정입니다")
        #expect(PTParser.actionPhrase("제출할 예정입니다") == "제출")
        #expect(PTParser.actionPhrase("초안 완성") == "초안 완성")
    }

    @Test func 빈_전사문() {
        #expect(PTParser.parse("").isEmpty)
        #expect(PTParser.parse("   \n ").isEmpty)
        #expect(PTParser.parse("안녕하세요. 감사합니다.").isEmpty)
    }

    @Test func 문장_나누기() {
        #expect(PTParser.sentences(of: "첫 문장입니다. 둘째 문장입니다.셋째") == ["첫 문장입니다", "둘째 문장입니다", "셋째"])
        #expect(PTParser.sentences(of: "교재 3.5장을 읽겠습니다") == ["교재 3.5장을 읽겠습니다"])
        #expect(PTParser.sentences(of: "검토입니다 오후 3시까지 저장하겠습니다") == ["검토입니다", "오후 3시까지 저장하겠습니다"])
    }
}
