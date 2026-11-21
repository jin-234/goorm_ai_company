import OfficeScreens
import SwiftUI

/// 설정 안의 음성 전사 모델 칸. 옆 세션의 WhisperModelSection을 카드로 감싼다.
struct ModelSettingsCard: View {
    var body: some View {
        Card {
            WhisperModelSection()
        }
    }
}
