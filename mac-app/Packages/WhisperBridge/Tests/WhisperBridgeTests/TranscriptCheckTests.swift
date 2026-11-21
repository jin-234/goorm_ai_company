import Testing
@testable import WhisperBridge

/// 실험에서 실제로 나온 전사문으로 확인한다.
@Suite("전사문 점검")
struct TranscriptCheckTests {
    let prompt = WhisperTranscriber.morningPTPrompt

    @Test("진짜 발표는 경고 없이 구간을 이어 붙인다")
    func realSpeech() {
        let review = TranscriptCheck.review([
            " 3단계 필수 업무는 지원서 최종 검토입니다.",
            " 오후 3시까지 오탈자를 확인하고 제출본을 저장하겠습니다.",
            " 2단계 당일 업무는 포트폴리오 한 문단 초안입니다.",
            " 1단계 이월 가능 업무는 관심 기업 3곳 저장입니다.",
        ], prompt: prompt)
        #expect(review.warning == nil)
        #expect(review.text.hasPrefix("3단계 필수 업무는"))
        #expect(review.text.contains("검토입니다. 오후 3시까지"))
    }

    @Test("짧은 인사 한마디는 경고하지 않는다")
    func shortSpeech() {
        #expect(TranscriptCheck.review([" 안녕하세요."], prompt: prompt).warning == nil)
        #expect(TranscriptCheck.review([" 오늘은 쉬겠습니다."], prompt: nil).warning == nil)
    }

    @Test("영상 끝인사 문구는 경고한다")
    func knownPhrase() {
        #expect(TranscriptCheck.review([" 구독과 좋아요는 저에게 아주 큰 힘이 됩니다."], prompt: nil).warning != nil)
        #expect(TranscriptCheck.review([" 다음 주에 계속해서 시청해 주시기 바랍니다."], prompt: prompt).warning != nil)
    }

    @Test("되풀이된 구간은 한 번만 남기고 경고한다")
    func repeated() {
        let line = " 이 부분은 업무와 정보가 필요한 것입니다."
        let review = TranscriptCheck.review([line, line, line], prompt: prompt)
        #expect(review.text == "이 부분은 업무와 정보가 필요한 것입니다.")
        #expect(review.warning != nil)

        let apart = TranscriptCheck.review([line, " 다른 문장입니다.", line], prompt: nil)
        #expect(apart.warning != nil)
    }

    @Test("프롬프트를 그대로 읊은 구간은 경고한다")
    func echo() {
        let review = TranscriptCheck.review([" 첫째, 둘째 로 나누어 마감과 완료 기준을 말씀드리겠습니다."], prompt: prompt)
        #expect(review.warning != nil)
        // 단계 이름만 말하는 것은 실제 발표에서도 나온다.
        #expect(TranscriptCheck.review([" 3단계 필수 업무."], prompt: prompt).warning == nil)
    }

    @Test("빈 구간만 있으면 빈 글")
    func empty() {
        #expect(TranscriptCheck.review(["  ", ""], prompt: nil).text.isEmpty)
    }
}
