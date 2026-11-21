import OfficeScreens
import OfficeCore
import SwiftUI

/// 설정: Solar 키, 카메라, 시연 초기화.
struct SettingsView: View {
    @Bindable var model: AppModel
    var inSheet = false
    @Environment(\.dismiss) private var dismiss
    @State private var key = ""
    @State private var checking = false
    @State private var checkResult: String?
    @State private var checkFailed = false
    @State private var confirmReset = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    Text("설정").font(UI.title)
                    Spacer()
                    if inSheet { Button("닫기") { dismiss() }.keyboardShortcut(.cancelAction) }
                }
                solarCard
                Card {
                    Text("카메라").font(UI.heading)
                    Toggle("카메라로 출근과 착석 확인", isOn: $model.useCamera)
                        .font(UI.body)
                    Text("끄면 내 책상에서 자리 상태를 직접 바꿉니다(카메라 없는 시연용).\n영상은 저장하거나 보내지 않고 이 맥 안에서만 판단합니다.")
                        .font(UI.small).foregroundStyle(UI.inkSoft)
                }
                Card {
                    Text("글자").font(UI.heading)
                    Toggle("글자 크게 (125%)", isOn: Binding(get: { model.textScale > 1 },
                                                          set: { model.textScale = $0 ? 1.25 : 1 }))
                        .font(UI.body)
                    Text("위 막대와 오른쪽 패널(내 책상, 메일함, 퇴근 점검, 주간보고)의 글자를 키웁니다.")
                        .font(UI.small).foregroundStyle(UI.inkSoft)
                }
                ModelSettingsCard()
                Card {
                    Text("시연").font(UI.heading)
                    Text("이번 주 월요일 08:55, 입사 전 상태로 되돌립니다.\n메일과 기록이 모두 지워집니다.")
                        .font(UI.small).foregroundStyle(UI.inkSoft)
                    Button("처음부터 다시") { confirmReset = true }
                        .buttonStyle(SecondaryButtonStyle())
                        .confirmationDialog("처음부터 다시 시작할까요?", isPresented: $confirmReset) {
                            Button("모두 지우고 다시 시작", role: .destructive) {
                                model.resetDemo()
                                dismiss()
                            }
                        }
                }
            }
            .padding(24)
        }
        .frame(width: 560, height: 680)
        .background(UI.paper)
    }

    private var solarCard: some View {
        Card {
            Text("Upstage Solar").font(UI.heading)
            Text("아침 PT 업무 정리와 주간보고 답장에 씁니다.\n필요한 설정은 UPSTAGE_API_KEY 하나입니다.")
                .font(UI.small).foregroundStyle(UI.inkSoft)
            HStack {
                Text("지금 키").font(UI.body).foregroundStyle(UI.inkSoft)
                Text(model.solar.maskedKey ?? "없음").font(UI.bodyBold.monospaced())
                Spacer()
                Text(model.solar.source.label).font(UI.small).foregroundStyle(UI.inkSoft).lineLimit(1).truncationMode(.middle)
            }
            Text("모델 \(model.solar.config.model) · \(model.solar.config.baseURL.absoluteString)")
                .font(UI.small).foregroundStyle(UI.inkSoft)
            SecureField("새 키 붙여넣기", text: $key)
                .officeField()
                .font(UI.body)
            HStack {
                Button("키 저장") {
                    do {
                        try model.saveSolarKey(key)
                        key = ""
                        checkResult = "저장했습니다. (\(AppPaths.supportEnv.path))"
                        checkFailed = false
                    } catch {
                        checkResult = "저장하지 못했습니다: \(error.localizedDescription)"
                        checkFailed = true
                    }
                }
                .buttonStyle(SecondaryButtonStyle())
                .disabled(key.trimmingCharacters(in: .whitespaces).isEmpty)
                Button("연결 확인") { Task { await check() } }
                    .buttonStyle(SecondaryButtonStyle())
                    .disabled(checking || model.solarClient() == nil)
                if checking { ProgressView().controlSize(.small) }
            }
            if let checkResult {
                Callout(kind: checkFailed ? .warning : .info, title: checkResult, detail: nil)
            }
            Text("Solar는 사용량에 따라 요금이 나오는 클라우드 API입니다.\n키는 이 맥의 앱 설정 폴더에만 저장합니다.")
                .font(UI.small).foregroundStyle(UI.inkSoft)
        }
    }

    private func check() async {
        guard let client = model.solarClient() else { return }
        checking = true
        defer { checking = false }
        do {
            let modelName = try await client.ping()
            checkResult = "연결됐습니다. 응답한 모델: \(modelName)"
            checkFailed = false
        } catch {
            checkResult = "\(error.title)\n\(error.guidance)"
            checkFailed = true
        }
    }
}
