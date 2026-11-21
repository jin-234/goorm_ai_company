import OfficeCore
import SwiftUI

/// 조직도와 책상 배치. 나를 뺀 모두가 AI라는 것도 함께 보여 준다.
struct OrgChartView: View {
    @Environment(\.dismiss) private var dismiss
    var myName: String

    private var levels: [[Member]] {
        Rank.allCases.map { rank in Organization.members.filter { $0.rank == rank } }.filter { !$0.isEmpty }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("\(Cast.teamName) 조직도").font(UI.title).foregroundStyle(UI.ink)
                        Text("나를 뺀 모두가 AI입니다.\n아침 PT는 부장·팀장·과장·대리가 듣습니다.")
                            .font(UI.body).foregroundStyle(UI.inkSoft)
                    }
                    Spacer()
                    Button("닫기") { dismiss() }
                        .keyboardShortcut(.cancelAction)
                        .buttonStyle(SecondaryButtonStyle())
                }

                VStack(spacing: 6) {
                    ForEach(Array(levels.enumerated()), id: \.offset) { index, members in
                        if index > 0 {
                            Image(systemName: "arrow.down")
                                .font(UI.font(14, weight: .bold))
                                .foregroundStyle(UI.green.opacity(0.5))
                                .accessibilityHidden(true)
                        }
                        HStack(spacing: 10) {
                            ForEach(members) { member in
                                MemberCard(member: member, myName: myName)
                            }
                        }
                    }
                }
                .frame(maxWidth: .infinity)

                Card {
                    Text("책상 배치").font(UI.heading)
                    Text("팀원은 책상을 마주 붙인 섬에 앉고, 섬 머리에 팀장, 뒤쪽에서 부장이 사무실 전체를 봅니다.")
                        .font(UI.small).foregroundStyle(UI.inkSoft)
                    SeatMap(myName: myName)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 6)
                }
            }
            .padding(24)
        }
        .frame(width: 960, height: 820)
        .background(UI.paper)
    }
}

/// 사람 한 명 카드.
struct MemberCard: View {
    var member: Member
    var myName: String

    private var name: String { member.isHuman ? myName : member.name }

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Avatar(member: member, name: name, size: 40)
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 5) {
                    Text(name).font(UI.bodyBold).foregroundStyle(UI.ink)
                    Text(member.rank.title).font(UI.small).foregroundStyle(UI.inkSoft)
                    Text(member.isHuman ? "나" : "AI")
                        .font(UI.font(11, weight: .bold))
                        .foregroundStyle(member.isHuman ? .white : UI.green)
                        .padding(.horizontal, 6).padding(.vertical, 1)
                        .background(member.isHuman ? UI.green : UI.greenSoft, in: Capsule())
                }
                Text(member.role)
                    .font(UI.font(12))
                    .foregroundStyle(UI.inkSoft)
                    .lineLimit(3)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(10)
        .frame(width: 215, alignment: .leading)
        .background(Color.white, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(member.isHuman ? UI.green : UI.line, lineWidth: member.isHuman ? 2 : 1))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(name) \(member.rank.title), \(member.isHuman ? "나" : "AI"). \(member.role)")
    }
}

/// 옷 색 동그라미에 이름 첫 글자.
struct Avatar: View {
    var member: Member
    var name: String
    var size: CGFloat

    var body: some View {
        Text(String(name.prefix(1)))
            .font(UI.font(size * 0.42, weight: .bold))
            .foregroundStyle(.white)
            .frame(width: size, height: size)
            .background(Color(hex: member.outfit), in: Circle())
            .overlay(Circle().strokeBorder(Color(hex: member.hair), lineWidth: 3))
            .accessibilityHidden(true)
    }
}

/// 위에서 본 책상 배치. 3D 사무실의 배치와 같은 규칙(DeskSeat)으로 그린다.
struct SeatMap: View {
    var myName: String

    private func member(at seat: DeskSeat) -> Member? {
        Organization.members.first { $0.seat == seat }
    }

    var body: some View {
        VStack(spacing: 14) {
            Text("뒤쪽 벽").font(UI.small).foregroundStyle(UI.inkSoft)
            desk(member(at: .departmentHead), wide: true)
            HStack(alignment: .center, spacing: 10) {
                VStack(spacing: 4) {
                    HStack(spacing: 4) { ForEach((0..<3).reversed(), id: \.self) { desk(member(at: .inner(index: $0))) } }
                    Rectangle().fill(UI.green.opacity(0.35)).frame(height: 4).accessibilityHidden(true)
                    HStack(spacing: 4) { ForEach((0..<3).reversed(), id: \.self) { desk(member(at: .outer(index: $0))) } }
                }
                desk(member(at: .islandHead), tall: true)
            }
            Text("출입문 · 앞쪽").font(UI.small).foregroundStyle(UI.inkSoft)
        }
    }

    private func desk(_ member: Member?, wide: Bool = false, tall: Bool = false) -> some View {
        let name = member.map { $0.isHuman ? myName : $0.name } ?? "빈자리"
        return VStack(spacing: 2) {
            Text(name).font(UI.font(13, weight: .semibold))
            if let member { Text(member.rank.title).font(UI.font(11)).foregroundStyle(UI.inkSoft) }
        }
        .frame(width: wide ? 150 : 96, height: tall ? 96 : 50)
        .background(member?.isHuman == true ? UI.greenSoft : Color(red: 0.93, green: 0.87, blue: 0.77),
                    in: RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(member.map { Color(hex: $0.outfit) } ?? UI.line, lineWidth: 2))
        .accessibilityLabel(member.map { "\(name) \($0.rank.title) 자리" } ?? "빈자리")
    }
}

extension Color {
    /// 0xRRGGBB
    init(hex: UInt32) {
        self.init(red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255, blue: Double(hex & 0xFF) / 255)
    }
}
