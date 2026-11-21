import OfficeScreens
import OfficeCore
import SwiftUI

/// 입사. 첫날 꼭 알아야 할 하루 흐름 세 단계만 보여 준다. 세부 근태 기준·지각비·카메라 설명은 [인사] 메일로.
struct OnboardingView: View {
    @Bindable var model: AppModel
    @State private var name = "김서울"

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("가상회사 입사 안내").font(UI.font(28, weight: .heavy)).foregroundStyle(UI.ink)
                Text("목표는 내가 정하고,\n회사는 출근·마감·보고를 챙겨 줍니다.\n나를 뺀 팀장과 동료는 모두 AI입니다.")
                    .font(UI.font(17)).foregroundStyle(UI.inkSoft)

                // 첫날 꼭 알아야 할 하루 흐름만 세 단계로. 지각비·자리 비움 같은 세부 규칙은 [인사] 메일에 있다.
                Card {
                    Text("하루는 이렇게 흘러갑니다").font(UI.heading)
                    step(1, "09:00 출근", "문 앞에서 출근 버튼을 누릅니다.")
                    step(2, "아침 PT", "회의실에서 오늘 할 일을 말로 정합니다.")
                    step(3, "18:00 퇴근 점검", "끝낸 일을 체크하고 퇴근합니다.")
                }
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: "lock.fill").font(UI.font(13, weight: .bold)).foregroundStyle(UI.green).padding(.top, 2)
                    Text("카메라 영상과 녹음은 저장하거나 보내지 않습니다.\n자세한 근태 기준은 입사 후 메일함 [인사] 메일에 있습니다.")
                        .font(UI.body).foregroundStyle(UI.inkSoft).fixedSize(horizontal: false, vertical: true)
                }
                VStack(alignment: .leading, spacing: 6) {
                    Text("이름").font(UI.bodyBold)
                    TextField("이름", text: $name)
                        .officeField()
                        .font(UI.font(17))
                }
                Button("확인했습니다 · 입사하기") { model.completeOnboarding(name: name) }
                    .buttonStyle(PrimaryButtonStyle())
                    .keyboardShortcut(.defaultAction)
                    .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            .padding(28)
        }
        .frame(width: 560, height: 600)
        .background(UI.paper)
    }

    private func step(_ number: Int, _ title: String, _ detail: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Text("\(number)")
                .font(UI.font(15, weight: .heavy)).foregroundStyle(.white)
                .frame(width: 28, height: 28)
                .background(UI.green, in: Circle())
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(UI.bodyBold).foregroundStyle(UI.ink)
                Text(detail).font(UI.body).foregroundStyle(UI.inkSoft).fixedSize(horizontal: false, vertical: true)
            }
        }
        .accessibilityElement(children: .combine)
    }
}
