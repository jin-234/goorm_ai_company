import AppKit
import SceneKit

/// 코드로 그리는 표면 그림. 외부 이미지 파일을 쓰지 않는다.
enum Textures {

    /// 밝은 오크 마루. 가로로 긴 판자를 엇갈려 깐다.
    static func oakFloor() -> NSImage {
        drawImage(width: 1024, height: 1024) { context, size in
            var random = SeededRandom(7)
            let rows = 8
            let rowHeight = size.height / CGFloat(rows)
            for row in 0..<rows {
                var x = -CGFloat(random.range(0, 320))
                while x < size.width {
                    let length = CGFloat(random.range(300, 560))
                    let tone = random.range(0, 1)
                    let color = Palette.oak.mixed(Palette.oakDeep, CGFloat(tone) * 0.55)
                        .lighter(CGFloat(random.range(0, 0.07)))
                    let plank = CGRect(x: x, y: CGFloat(row) * rowHeight, width: length, height: rowHeight)
                    context.setFillColor(color.cgColor)
                    context.fill(plank)

                    // 나뭇결
                    context.saveGState()
                    context.clip(to: plank)
                    for _ in 0..<7 {
                        let y = plank.minY + CGFloat(random.range(0.08, 0.92)) * rowHeight
                        let grain = CGMutablePath()
                        grain.move(to: CGPoint(x: plank.minX, y: y))
                        let wobble = CGFloat(random.range(-5, 5))
                        grain.addCurve(to: CGPoint(x: plank.maxX, y: y + wobble),
                                       control1: CGPoint(x: plank.minX + length * 0.3, y: y + wobble * 1.6),
                                       control2: CGPoint(x: plank.minX + length * 0.7, y: y - wobble))
                        context.addPath(grain)
                        context.setStrokeColor(Palette.oakDeep.darker(0.18).withAlphaComponent(0.10).cgColor)
                        context.setLineWidth(CGFloat(random.range(1, 2.4)))
                        context.strokePath()
                    }
                    context.restoreGState()

                    // 판자 끝 이음
                    context.setFillColor(Palette.oakDeep.darker(0.35).withAlphaComponent(0.30).cgColor)
                    context.fill(CGRect(x: plank.maxX - 1.5, y: plank.minY, width: 3, height: rowHeight))
                    x += length
                }
                // 판자 줄 사이
                context.setFillColor(Palette.oakDeep.darker(0.35).withAlphaComponent(0.32).cgColor)
                context.fill(CGRect(x: 0, y: CGFloat(row) * rowHeight - 1.5, width: size.width, height: 3))
            }
        }
    }

    /// 책상 구역 러그. 테두리에 줄 두 개.
    static func rug() -> NSImage {
        drawImage(width: 768, height: 512) { context, size in
            context.setFillColor(Palette.rug.cgColor)
            context.fill(CGRect(origin: .zero, size: size))
            context.setStrokeColor(Palette.rugLine.cgColor)
            context.setLineWidth(10)
            context.stroke(CGRect(x: 26, y: 26, width: size.width - 52, height: size.height - 52))
            context.setLineWidth(4)
            context.stroke(CGRect(x: 48, y: 48, width: size.width - 96, height: size.height - 96))
        }
    }

    /// 동기와 팀장 모니터 화면. 문서처럼 보이는 줄.
    static func screenDocument(seed: UInt64) -> NSImage {
        drawImage(width: 512, height: 320) { context, size in
            var random = SeededRandom(seed)
            context.setFillColor(NSColor(hex: 0xF3FAF6).cgColor)
            context.fill(CGRect(origin: .zero, size: size))
            // 위쪽 띠
            context.setFillColor(Palette.green.withAlphaComponent(0.85).cgColor)
            context.fill(CGRect(x: 0, y: size.height - 44, width: size.width, height: 44))
            // 옆 목록
            context.setFillColor(NSColor(hex: 0xDDEBE4).cgColor)
            context.fill(CGRect(x: 0, y: 0, width: 110, height: size.height - 44))
            for index in 0..<6 {
                context.setFillColor(NSColor(hex: 0x9DB8AC).cgColor)
                context.fill(CGRect(x: 16, y: size.height - 84 - CGFloat(index) * 34, width: 78, height: 12))
            }
            // 본문 줄
            var y = size.height - 86
            while y > 30 {
                let width = CGFloat(random.range(140, 340))
                context.setFillColor(NSColor(hex: 0x6F8179).withAlphaComponent(0.55).cgColor)
                context.fill(CGRect(x: 136, y: y, width: width, height: 11))
                y -= CGFloat(random.range(22, 30))
            }
        }
    }

    /// 내 모니터 화면. 오늘의 체크리스트.
    /// - Parameter items: 업무별 (중요도 단계, 완료 여부)
    static func screenChecklist(items: [(level: Int, done: Bool)]) -> NSImage {
        drawImage(width: 512, height: 320) { context, size in
            context.setFillColor(NSColor(hex: 0xFBF8F0).cgColor)
            context.fill(CGRect(origin: .zero, size: size))
            context.setFillColor(Palette.green.cgColor)
            context.fill(CGRect(x: 0, y: size.height - 52, width: size.width, height: 52))
            drawText("오늘의 체크리스트", in: CGRect(x: 24, y: size.height - 52, width: size.width - 48, height: 52),
                     context: context, size: 26, weight: .bold, color: .white, alignment: .left)

            if items.isEmpty {
                drawText("아침 PT에서 업무를 확정하세요", in: CGRect(x: 24, y: 80, width: size.width - 48, height: 120),
                         context: context, size: 24, weight: .medium, color: NSColor(hex: 0x6B766F))
                return
            }
            let rowHeight: CGFloat = min(58, (size.height - 76) / CGFloat(max(items.count, 1)))
            for (index, item) in items.prefix(5).enumerated() {
                let y = size.height - 70 - CGFloat(index + 1) * rowHeight + 10
                let box = CGRect(x: 28, y: y + 4, width: 32, height: 32)
                context.setStrokeColor(Palette.green.cgColor)
                context.setLineWidth(4)
                let path = CGPath(roundedRect: box, cornerWidth: 7, cornerHeight: 7, transform: nil)
                if item.done {
                    context.addPath(path)
                    context.setFillColor(Palette.green.cgColor)
                    context.fillPath()
                    context.setStrokeColor(NSColor.white.cgColor)
                    context.setLineWidth(5)
                    context.setLineCap(.round)
                    context.move(to: CGPoint(x: box.minX + 7, y: box.midY))
                    context.addLine(to: CGPoint(x: box.minX + 14, y: box.minY + 8))
                    context.addLine(to: CGPoint(x: box.maxX - 6, y: box.maxY - 8))
                    context.strokePath()
                } else {
                    context.addPath(path)
                    context.strokePath()
                }
                // 단계 표시
                let badge = CGRect(x: 76, y: y + 6, width: 62, height: 28)
                context.addPath(CGPath(roundedRect: badge, cornerWidth: 14, cornerHeight: 14, transform: nil))
                context.setFillColor(Palette.green.withAlphaComponent(item.level == 3 ? 1 : item.level == 2 ? 0.62 : 0.32).cgColor)
                context.fillPath()
                drawText("\(item.level)단계", in: badge, context: context, size: 17, weight: .bold,
                         color: item.level == 1 ? Palette.greenDark : .white)
                // 업무 줄
                context.setFillColor(NSColor(hex: 0x39443E).withAlphaComponent(item.done ? 0.28 : 0.72).cgColor)
                context.fill(CGRect(x: 154, y: y + 14, width: CGFloat(300 - index * 34), height: 12))
            }
        }
    }

    /// 꺼진 화면.
    static func screenOff() -> NSImage {
        drawImage(width: 64, height: 40) { context, size in
            context.setFillColor(NSColor(hex: 0x15181A).cgColor)
            context.fill(CGRect(origin: .zero, size: size))
        }
    }

    /// 문 위 간판.
    static func sign(_ text: String) -> NSImage {
        drawImage(width: 768, height: 192) { context, size in
            let rect = CGRect(origin: .zero, size: size)
            context.setFillColor(Palette.green.cgColor)
            context.fill(rect)
            context.setStrokeColor(Palette.brass.cgColor)
            context.setLineWidth(8)
            context.stroke(rect.insetBy(dx: 14, dy: 14))
            drawText(text, in: rect, context: context, size: 92, weight: .heavy, color: Palette.paper)
        }
    }

    /// 출근 단말기 화면.
    static func terminal(title: String, detail: String, checked: Bool) -> NSImage {
        drawImage(width: 384, height: 512) { context, size in
            let background = checked ? NSColor(hex: 0x2E9A68) : NSColor(hex: 0x1D3A30)
            context.setFillColor(background.cgColor)
            context.fill(CGRect(origin: .zero, size: size))
            // 동그라미 표시
            let circle = CGRect(x: size.width / 2 - 84, y: 250, width: 168, height: 168)
            context.setStrokeColor(NSColor.white.withAlphaComponent(checked ? 1 : 0.75).cgColor)
            context.setLineWidth(14)
            context.strokeEllipse(in: circle)
            context.setLineCap(.round)
            context.setLineJoin(.round)
            if checked {
                context.move(to: CGPoint(x: circle.minX + 44, y: circle.midY))
                context.addLine(to: CGPoint(x: circle.midX - 8, y: circle.minY + 50))
                context.addLine(to: CGPoint(x: circle.maxX - 40, y: circle.maxY - 50))
                context.strokePath()
            } else {
                // 사람 모양
                context.setFillColor(NSColor.white.withAlphaComponent(0.8).cgColor)
                context.fillEllipse(in: CGRect(x: circle.midX - 26, y: circle.midY + 2, width: 52, height: 52))
                context.fillEllipse(in: CGRect(x: circle.midX - 48, y: circle.minY + 30, width: 96, height: 66))
            }
            drawText(title, in: CGRect(x: 10, y: 130, width: size.width - 20, height: 96), context: context,
                     size: 70, weight: .heavy, color: .white)
            drawText(detail, in: CGRect(x: 10, y: 44, width: size.width - 20, height: 80), context: context,
                     size: 40, weight: .semibold, color: NSColor.white.withAlphaComponent(0.92))
        }
    }

    /// 회의실 벽 화면. 아침 PT 양식.
    static func meetingBoard() -> NSImage {
        drawImage(width: 1024, height: 576) { context, size in
            context.setFillColor(NSColor(hex: 0xF6FBF8).cgColor)
            context.fill(CGRect(origin: .zero, size: size))
            context.setFillColor(Palette.green.cgColor)
            context.fill(CGRect(x: 0, y: size.height - 120, width: size.width, height: 120))
            drawText("아침 PT", in: CGRect(x: 48, y: size.height - 120, width: size.width - 96, height: 120),
                     context: context, size: 78, weight: .heavy, color: .white, alignment: .left)
            let rows = [("3단계", "필수 마감", 1.0), ("2단계", "당일 완료", 0.62), ("1단계", "이월 가능", 0.34)]
            for (index, row) in rows.enumerated() {
                let y = size.height - 240 - CGFloat(index) * 136
                let badge = CGRect(x: 48, y: y, width: 190, height: 92)
                context.addPath(CGPath(roundedRect: badge, cornerWidth: 46, cornerHeight: 46, transform: nil))
                context.setFillColor(Palette.green.withAlphaComponent(row.2).cgColor)
                context.fillPath()
                drawText(row.0, in: badge, context: context, size: 52, weight: .heavy,
                         color: index == 2 ? Palette.greenDark : .white)
                drawText(row.1, in: CGRect(x: 270, y: y, width: 330, height: 92), context: context, size: 50,
                         weight: .bold, color: NSColor(hex: 0x2B3A33), alignment: .left)
                context.setFillColor(NSColor(hex: 0x9AAFA5).cgColor)
                context.fill(CGRect(x: 620, y: y + 54, width: 340, height: 14))
                context.fill(CGRect(x: 620, y: y + 24, width: 240, height: 14))
            }
        }
    }

    /// 팀장 자리 뒤 게시판. 메모지가 붙어 있다.
    static func corkboard() -> NSImage {
        drawImage(width: 768, height: 512) { context, size in
            var random = SeededRandom(21)
            context.setFillColor(NSColor(hex: 0xCFA873).cgColor)
            context.fill(CGRect(origin: .zero, size: size))
            let notes: [NSColor] = [Palette.paper, NSColor(hex: 0xF7E3A1), NSColor(hex: 0xCFE6D6),
                                    Palette.paper, NSColor(hex: 0xF4CDBB), Palette.paper]
            for (index, color) in notes.enumerated() {
                let column = CGFloat(index % 3)
                let row = CGFloat(index / 3)
                let rect = CGRect(x: 46 + column * 236 + CGFloat(random.range(-10, 10)),
                                  y: 44 + row * 236 + CGFloat(random.range(-10, 10)), width: 196, height: 190)
                context.saveGState()
                context.translateBy(x: rect.midX, y: rect.midY)
                context.rotate(by: CGFloat(random.range(-0.06, 0.06)))
                let local = CGRect(x: -rect.width / 2, y: -rect.height / 2, width: rect.width, height: rect.height)
                context.setFillColor(NSColor.black.withAlphaComponent(0.14).cgColor)
                context.fill(local.offsetBy(dx: 5, dy: -6))
                context.setFillColor(color.cgColor)
                context.fill(local)
                for line in 0..<4 {
                    context.setFillColor(NSColor(hex: 0x6C6558).withAlphaComponent(0.5).cgColor)
                    context.fill(CGRect(x: local.minX + 22, y: local.maxY - 54 - CGFloat(line) * 32,
                                        width: CGFloat(random.range(90, 150)), height: 10))
                }
                context.setFillColor(Palette.green.cgColor)
                context.fillEllipse(in: CGRect(x: -9, y: local.maxY - 24, width: 18, height: 18))
                context.restoreGState()
            }
        }
    }

    /// 벽시계 문자판.
    static func clockFace() -> NSImage {
        drawImage(width: 512, height: 512) { context, size in
            let center = CGPoint(x: size.width / 2, y: size.height / 2)
            context.setFillColor(Palette.paper.cgColor)
            context.fillEllipse(in: CGRect(origin: .zero, size: size))
            for tick in 0..<12 {
                let angle = CGFloat(tick) / 12 * 2 * .pi
                let major = tick % 3 == 0
                let outer = size.width / 2 - 26
                let inner = outer - (major ? 54 : 30)
                context.setStrokeColor(Palette.greenDark.cgColor)
                context.setLineWidth(major ? 16 : 9)
                context.setLineCap(.round)
                context.move(to: CGPoint(x: center.x + sin(angle) * inner, y: center.y + cos(angle) * inner))
                context.addLine(to: CGPoint(x: center.x + sin(angle) * outer, y: center.y + cos(angle) * outer))
                context.strokePath()
            }
        }
    }

    /// 종이 한 장. 서류 더미와 서류철에 쓴다.
    static func paperSheet() -> NSImage {
        drawImage(width: 256, height: 352) { context, size in
            context.setFillColor(Palette.paper.cgColor)
            context.fill(CGRect(origin: .zero, size: size))
            for line in 0..<9 {
                context.setFillColor(NSColor(hex: 0x7B7468).withAlphaComponent(0.45).cgColor)
                context.fill(CGRect(x: 28, y: size.height - 56 - CGFloat(line) * 30, width: line % 3 == 2 ? 120 : 196, height: 9))
            }
        }
    }

    /// 내 책상 팻말. 예: 점심 중
    static func deskSign(_ text: String) -> NSImage {
        drawImage(width: 500, height: 200) { context, size in
            let rect = CGRect(origin: .zero, size: size)
            context.addPath(CGPath(roundedRect: rect, cornerWidth: 30, cornerHeight: 30, transform: nil))
            context.setFillColor(Palette.paper.cgColor)
            context.fillPath()
            context.setStrokeColor(Palette.green.cgColor)
            context.setLineWidth(10)
            context.addPath(CGPath(roundedRect: rect.insetBy(dx: 12, dy: 12), cornerWidth: 22, cornerHeight: 22, transform: nil))
            context.strokePath()
            drawText(text, in: rect, context: context, size: text.count > 5 ? 62 : 80, weight: .heavy, color: Palette.greenDark)
        }
    }

    /// 사원증.
    static func badge() -> NSImage {
        drawImage(width: 192, height: 256) { context, size in
            context.setFillColor(Palette.paper.cgColor)
            context.fill(CGRect(origin: .zero, size: size))
            context.setFillColor(Palette.green.cgColor)
            context.fill(CGRect(x: 0, y: size.height - 64, width: size.width, height: 64))
            context.setFillColor(NSColor(hex: 0xE9C9A8).cgColor)
            context.fillEllipse(in: CGRect(x: 66, y: 110, width: 60, height: 60))
            context.setFillColor(NSColor(hex: 0x7B7468).withAlphaComponent(0.6).cgColor)
            context.fill(CGRect(x: 40, y: 62, width: 112, height: 14))
            context.fill(CGRect(x: 58, y: 34, width: 76, height: 10))
        }
    }

    /// 하늘과 실내 빛이 은은하게 비치는 환경 그림. 광택 있는 표면에 쓴다.
    static func environment(top: NSColor, bottom: NSColor) -> NSImage {
        drawImage(width: 256, height: 128) { context, size in
            let colors = [bottom.cgColor, top.cgColor] as CFArray
            let space = CGColorSpace(name: CGColorSpace.sRGB) ?? CGColorSpaceCreateDeviceRGB()
            if let gradient = CGGradient(colorsSpace: space, colors: colors, locations: [0, 1]) {
                context.drawLinearGradient(gradient, start: .zero, end: CGPoint(x: 0, y: size.height), options: [])
            }
        }
    }
}
