import AppKit

/// 사무실 색.
/// 밝은 오크 바닥과 크림색 벽에 짙은 초록을 포인트로 쓴다.
/// 초록은 회의실 프레임, 의자, 스탠드에 집중한다.
enum Palette {
    // 벽과 바닥
    static var cream: NSColor { NSColor(hex: 0xF4ECDB) }
    static var creamLower: NSColor { NSColor(hex: 0xEADFC8) }
    static var wallCap: NSColor { NSColor(hex: 0xDCCDB2) }
    static var skirting: NSColor { NSColor(hex: 0xD3C09D) }
    static var oak: NSColor { NSColor(hex: 0xDCBE92) }
    static var oakDeep: NSColor { NSColor(hex: 0xC6A473) }
    static var base: NSColor { NSColor(hex: 0xB99A6E) }

    // 포인트: 짙은 초록
    static var green: NSColor { NSColor(hex: 0x1F5A45) }
    static var greenLight: NSColor { NSColor(hex: 0x2E7459) }
    static var greenDark: NSColor { NSColor(hex: 0x173F31) }

    // 가구
    static var deskTop: NSColor { NSColor(hex: 0xEEDFC4) }
    static var white: NSColor { NSColor(hex: 0xF7F3EA) }
    static var paper: NSColor { NSColor(hex: 0xFBF8F0) }
    static var charcoal: NSColor { NSColor(hex: 0x2C3032) }
    static var graphite: NSColor { NSColor(hex: 0x4A4F52) }
    static var steel: NSColor { NSColor(hex: 0xBDB9B0) }
    static var brass: NSColor { NSColor(hex: 0xC9A55E) }
    static var walnut: NSColor { NSColor(hex: 0x8A6544) }

    // 소품
    static var terracotta: NSColor { NSColor(hex: 0xC87650) }
    static var leaf: NSColor { NSColor(hex: 0x6AA86A) }
    static var leafDeep: NSColor { NSColor(hex: 0x4A8A56) }
    static var rug: NSColor { NSColor(hex: 0xDCE1CF) }
    static var rugLine: NSColor { NSColor(hex: 0xB9C7AE) }
    static var mug: NSColor { NSColor(hex: 0xF2EEE4) }

    // 빛
    static var screenOn: NSColor { NSColor(hex: 0xDFF2EA) }
    static var lampWarm: NSColor { NSColor(hex: 0xFFD9A0) }
    static var terminalIdle: NSColor { NSColor(hex: 0xBFE3D4) }
}
