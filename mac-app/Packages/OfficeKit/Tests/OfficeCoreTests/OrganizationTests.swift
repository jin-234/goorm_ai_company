import Testing
@testable import OfficeCore

@Suite("조직도")
struct OrganizationTests {
    @Test func 맨_위는_부장_한_명이다() {
        let heads = Organization.members.filter { $0.reportsTo == nil }
        #expect(heads.count == 1)
        #expect(heads.first?.rank == .departmentHead)
    }

    @Test func 모두_부장까지_이어진다() {
        for member in Organization.members {
            var current: Member? = member
            var steps = 0
            while let reportsTo = current?.reportsTo, steps < 10 {
                current = Organization.member(reportsTo)
                steps += 1
            }
            #expect(current?.id == "director", "\(member.name)")
        }
    }

    @Test func 자리가_겹치지_않는다() {
        let seats = Organization.members.map { "\($0.seat)" }
        #expect(Set(seats).count == seats.count)
    }

    @Test func 상사가_부하보다_직급이_높거나_같다() {
        for member in Organization.members {
            guard let boss = member.reportsTo.flatMap(Organization.member) else { continue }
            #expect(boss.rank <= member.rank, "\(member.name)")
        }
    }

    @Test func 아침_PT는_상사_넷이_듣는다() {
        let audience = Organization.morningPTAudience.map(\.rank)
        #expect(audience == [.departmentHead, .teamLeader, .manager, .assistantManager])
    }

    @Test func 사람은_김서울_한_명이고_기존_인물은_그대로다() {
        #expect(Organization.members.filter(\.isHuman).map(\.name) == ["김서울"])
        #expect(Organization.member("manager")?.name == Cast.managerName)
        #expect(Organization.member("peerA")?.name == Cast.peerNames[0])
        #expect(Organization.member("peerB")?.name == Cast.peerNames[1])
    }
}
