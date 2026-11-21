import OfficeCore
import SwiftUI

/// 팀장 자리: 사내 메일함. 업무 공지, 근태 요청·승인, 이월 보고, 주간 피드백.
struct MailPanel: View {
    @Bindable var model: AppModel
    @State private var showSent = false

    private var office: Office { model.office }

    var body: some View {
        if let id = model.selectedMailID, let mail = office.mails.first(where: { $0.id == id }) {
            MailReader(model: model, mail: mail)
        } else {
            list
        }
    }

    private var list: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 12) {
                PanelHeader(title: "사내 메일함", subtitle: "\(Cast.managerName) 팀장 자리") { model.closePanel() }
                if office.canSubmitWeekly {
                    Button("금요일 주간보고서 쓰기") { model.panel = .weekly }
                        .buttonStyle(PrimaryButtonStyle())
                }
                if office.canRequestLunch {
                    Button("점심 요청 메일 보내기") { model.run { _ = try $0.requestLunch() } }
                        .buttonStyle(SecondaryButtonStyle())
                }
                Picker("", selection: $showSent) {
                    Text(office.unreadCount > 0 ? "받은 메일 (\(office.unreadCount))" : "받은 메일").tag(false)
                    Text("보낸 메일").tag(true)
                }
                .pickerStyle(.segmented)
                .labelsHidden()
            }
            .padding(20)

            let mails = showSent ? office.sent : office.inbox
            ScrollView {
                LazyVStack(spacing: 0) {
                    if mails.isEmpty {
                        Text("메일이 없습니다.").font(UI.body).foregroundStyle(UI.inkSoft).padding(30)
                    }
                    ForEach(mails) { mail in
                        Button {
                            model.office.markRead(mail.id)
                            model.selectedMailID = mail.id
                        } label: {
                            MailRow(mail: mail, myName: office.profile.name, sent: showSent)
                        }
                        .buttonStyle(.plain)
                        Divider().padding(.leading, 20)
                    }
                }
            }
        }
    }
}

struct MailRow: View {
    var mail: Mail
    var myName: String
    var sent: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Circle()
                .fill(mail.isRead || sent ? Color.clear : UI.green)
                .frame(width: 9, height: 9)
                .padding(.top, 7)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                HStack {
                    Text(mail.kind.tag)
                        .font(UI.font(12, weight: .bold))
                        .foregroundStyle(UI.green)
                        .padding(.horizontal, 7).padding(.vertical, 2)
                        .background(UI.greenSoft, in: Capsule())
                    Text(sent ? "받는 사람: \(mail.to.displayName(myName: myName))" : mail.from.displayName(myName: myName))
                        .font(UI.small).foregroundStyle(UI.inkSoft)
                    Spacer()
                    Text("\(mail.sentAt.dayKey.month)/\(mail.sentAt.dayKey.day) \(mail.sentAt.hm)")
                        .font(UI.small.monospacedDigit()).foregroundStyle(UI.inkSoft)
                }
                Text(mail.subject)
                    .font(UI.font(15, weight: mail.isRead || sent ? .regular : .bold))
                    .foregroundStyle(UI.ink)
                    .lineLimit(2)
                if !mail.isRead, !sent {
                    Text("안 읽음").font(UI.font(12)).foregroundStyle(UI.green)
                }
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
        .contentShape(Rectangle())
    }
}

/// 메일 한 통. 밝은 종이색 위에 제목, 보낸 사람, 본문을 또렷하게.
struct MailReader: View {
    @Bindable var model: AppModel
    var mail: Mail

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    Button {
                        model.selectedMailID = nil
                    } label: {
                        Label("메일함", systemImage: "chevron.left")
                    }
                    .buttonStyle(SecondaryButtonStyle())
                    Spacer()
                    Button { model.selectedMailID = nil; model.closePanel() } label: {
                        Image(systemName: "xmark").font(UI.font(14, weight: .bold)).frame(width: 32, height: 32)
                            .background(UI.paperDeep, in: Circle())
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(UI.inkSoft)
                    .accessibilityLabel("패널 닫기")
                }
                VStack(alignment: .leading, spacing: 12) {
                    Text(mail.subject).font(UI.font(21, weight: .bold)).foregroundStyle(UI.ink)
                        .fixedSize(horizontal: false, vertical: true)
                    VStack(alignment: .leading, spacing: 3) {
                        Text("보낸 사람  \(mail.from.displayName(myName: model.office.profile.name))")
                        Text("받는 사람  \(mail.to.displayName(myName: model.office.profile.name))")
                        Text("보낸 시각  \(mail.sentAt.dayKey.koreanShort) \(mail.sentAt.hm)")
                    }
                    .font(UI.small).foregroundStyle(UI.inkSoft)
                    if mail.kind == .weeklyFeedback, let source = mail.replySource {
                        Callout(kind: source == .solar ? .info : .notice,
                                title: source == .solar ? "Upstage Solar가 쓴 답장" : "Solar 미연결 · 정해진 문구의 기본 답장",
                                detail: source == .solar ? nil : "설정에서 UPSTAGE_API_KEY를 넣으면\n보고서를 읽고 쓴 답장을 받습니다.")
                    }
                    Divider()
                    Text(mail.body)
                        .font(UI.font(16))
                        .lineSpacing(5)
                        .foregroundStyle(UI.ink)
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(20)
                .background(mail.isWarm ? Color(red: 1, green: 0.985, blue: 0.95) : Color.white, in: RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(UI.line))
            }
            .padding(20)
        }
    }
}
