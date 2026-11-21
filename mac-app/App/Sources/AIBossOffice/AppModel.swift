import AppKit
import Foundation
import Observation
import OfficeCore
import OfficeScene
import SeatKit

/// 오른쪽 패널에 무엇을 띄우는지.
enum Panel: Equatable {
    case checkIn
    case meeting
    case desk
    case mail
    case checkout
    case overtime
    case overtimeReview
    case off
    case weekly
}

/// 앱 전체 상태. 규칙은 모두 `Office`(OfficeCore)가 판단하고, 여기서는 화면·3D·카메라·저장을 잇는다.
@MainActor
@Observable
final class AppModel {
    var office: Office {
        didSet { officeDidChange(from: oldValue) }
    }
    var panel: Panel? {
        didSet { panelDidChange() }
    }
    /// 화면 아래에 잠깐 뜨는 한 줄 알림.
    var toast: String?
    var showSettings = false
    var showOrgChart = false
    var selectedMailID: UUID?
    /// 카메라로 착석을 확인할지. 끄면 화면의 버튼으로 자리 상태를 바꾼다(카메라 없는 시연용).
    var useCamera: Bool {
        didSet {
            UserDefaults.standard.set(useCamera, forKey: "useCamera")
            Task { @MainActor [weak self] in
                self?.updateCamera()
                self?.refeedPresence()
            }
        }
    }
    /// 글자 배율(1 또는 1.25). 화면 글꼴은 UI.scale로 읽는다.
    var textScale: Double {
        didSet {
            UserDefaults.standard.set(textScale, forKey: "textScale")
        }
    }
    private(set) var solar: ResolvedSolar
    private(set) var cameraPresence: SeatPresence = .unknown
    private(set) var cameraOffReason: String?
    var weeklySending = false
    var weeklyError: SolarError?

    @ObservationIgnored let stage: OfficeStage
    @ObservationIgnored let seat = SeatMonitor()
    @ObservationIgnored private var ticker: Timer?
    @ObservationIgnored private var ticks = 0
    @ObservationIgnored private var checklistSignature = ""
    @ObservationIgnored private var toastTask: Task<Void, Never>?
    /// 오른쪽 패널 폭(점). 3D 장면을 이만큼 왼쪽으로 민다.
    static let panelWidth: CGFloat = 460
    @ObservationIgnored var windowWidth: CGFloat = 1400 {
        didSet { panelDidChange() }
    }

    init() {
        let quality: StageQuality = ProcessInfo.processInfo.physicalMemory < 12_000_000_000 ? .light : .full
        stage = OfficeStage(quality: quality)
        useCamera = UserDefaults.standard.object(forKey: "useCamera") as? Bool ?? true
        if ProcessInfo.processInfo.environment["AIBOSS_NO_CAMERA"] == "1" { useCamera = false }
        textScale = max(1, UserDefaults.standard.double(forKey: "textScale"))
        solar = SolarSettings.resolve(envFiles: AppPaths.envFiles)
        office = Storage.load() ?? Office(startingAt: Office.demoStart())
        seat.onChange = { [weak self] in self?.seatDidChange() }
        prepareStageForDay(animated: false)
        syncStage(animated: false)
        updateCamera()
        if office.onboarded, office.day.phase == .beforeCheckIn { panel = .checkIn }
        startTicking()
        DemoScript.runIfRequested(self)
    }

    // MARK: - 가상 시계

    /// 시연 시각도 실제 시간처럼 1초씩 흐른다. 15분 자리 비움이 실제로 줄어드는 것이 보인다.
    private func startTicking() {
        ticker = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.tick() }
        }
    }

    /// 아직 office에 넣지 않은 초. office는 분이 바뀔 때만 바꾼다.
    /// 매초 바꾸면 화면 전체가 다시 그려지고 한글 조합 입력이 끊길 수 있다.
    @ObservationIgnored private var pendingSeconds: TimeInterval = 0

    private func tick() {
        guard office.onboarded else { return }
        ticks += 1
        pendingSeconds += 1
        let next = office.now.addingTimeInterval(pendingSeconds)
        if next.minuteOfDay != office.now.minuteOfDay {
            pendingSeconds = 0
            office.advance(to: next)
        } else {
            // 3D 장면의 빛과 시계만 초 단위로 따라간다.
            stage.setTime(minutes: minuteOfDay + pendingSeconds / 60, animated: true)
        }
        if ticks % 30 == 0 { save() }
    }

    func skipHour() {
        guard let result = office.skipHour() else { return }
        pendingSeconds = 0
        // 건너뛰면 자리 상태를 모르는 것으로 돌아간다. 카메라는 바뀐 것이 없으면 다시 알려 주지 않으므로 지금 값을 다시 넣는다.
        refeedPresence()
        if let why = result.stoppedFor {
            show("\(why)(\(result.to.hm))에서 멈췄습니다.")
        }
        save()
    }

    func jumpToFriday() {
        office.jumpToFriday()
        prepareStageForDay(animated: true)
        panel = .checkIn
        show("금요일 아침으로 이동했습니다.\n오늘은 주간보고서를 제출하는 날입니다.")
        save()
    }

    func startNextWorkday() {
        office.startNextWorkday()
        prepareStageForDay(animated: true)
        panel = .checkIn
        save()
    }

    // MARK: - 입사와 출근

    func completeOnboarding(name: String) {
        office.completeOnboarding(name: name)
        panel = .checkIn
        save()
    }

    /// 출근 기록이 끝나면 문이 열리고 내 캐릭터가 걸어 들어간다.
    func didCheckIn(_ attendance: Attendance) {
        panel = nil
        refeedPresence()
        stage.setHighlight(nil)
        stage.playEntrance { [weak self] in
            guard let self else { return }
            self.syncStage()
            // 연출 도중 패널을 열었으면 그 패널 구도로 옮긴다(연출 중에는 구도를 바꾸지 않아 문 앞에 남는다).
            self.panelDidChange()
            // 연출 도중 이미 업무를 확정했으면 회의실 안내를 띄우지 않는다.
            guard self.office.day.phase == .morningPT else { return }
            self.stage.setHighlight(.meeting)
            self.show(attendance == .late ? "지각으로 기록했습니다.\n회의실을 눌러 아침 PT를 시작하세요." : "출근했습니다.\n회의실을 눌러 아침 PT를 시작하세요.")
        }
        save()
    }

    /// 아침 PT에서 업무를 확정하면 내 책상으로 간다.
    func didConfirmTasks() {
        refeedPresence()
        panel = .desk
        show("업무를 확정했습니다.\n근무를 시작합니다.")
        save()
    }

    /// 카메라 없이 출근(시연용). 사람 확인 없이 기록한다.
    func checkInWithoutCamera() {
        do {
            let attendance = try office.checkIn()
            didCheckIn(attendance)
        } catch {
            show(error.localizedDescription)
        }
    }

    // MARK: - 장소 누르기

    func open(_ spot: OfficeSpot) {
        guard office.onboarded else { return }
        if office.day.phase == .beforeCheckIn {
            panel = .checkIn
            return
        }
        stage.setHighlight(nil)
        switch spot {
        case .myDesk: panel = office.day.phase == .overtime || office.day.phase == .dinner ? .overtime : .desk
        case .manager: panel = .mail
        case .meeting: panel = .meeting
        }
    }

    func closePanel() {
        panel = nil
    }

    private func panelDidChange() {
        let view: OfficeView
        switch panel {
        case .desk, .overtime, .checkout, .overtimeReview, .off: view = .spot(.myDesk)
        case .mail: view = .spot(.manager)
        case .weekly: view = weeklyMeetingOn ? .spot(.meeting) : .spot(.manager)
        case .meeting: view = .spot(.meeting)
        case .checkIn: view = office.day.phase == .beforeCheckIn ? .door : .overview
        case nil: view = office.day.phase == .beforeCheckIn ? .door : .overview
        }
        syncStage()
        guard !stage.isPlayingEntrance else { return }
        let shift = panel == nil || view == .door ? 0 : Self.panelWidth / max(windowWidth, 800)
        stage.setPanelShift(shift, animated: true)
        if stage.view != view { stage.setView(view, animated: true) }
    }

    // MARK: - Office가 바뀔 때

    private func officeDidChange(from old: Office) {
        if old.day.date != office.day.date { prepareStageForDay(animated: true) }
        syncStage()
        if old.day.phase != office.day.phase { phaseDidChange(from: old.day.phase) }
        if old.mails.count < office.mails.count, let newest = office.inbox.first, !newest.isRead,
           old.mails.contains(where: { $0.id == newest.id }) == false {
            show("새 메일: \(newest.subject)")
        }
    }

    private func phaseDidChange(from old: Phase) {
        switch office.day.phase {
        case .checkoutReview: panel = .checkout
        case .dinner, .overtime: if panel == .checkout || panel == nil { panel = .overtime }
        case .overtimeReview: panel = .overtimeReview
        case .off: panel = .off
        case .working: if panel == .meeting { panel = .desk }
        case .beforeCheckIn, .morningPT: break
        }
        // office를 바꾸는 도중에 카메라를 켜고 끄면 그 알림이 다시 office를 바꾼다. 다음 차례로 미룬다.
        Task { @MainActor [weak self] in self?.updateCamera() }
        save()
    }

    /// 새 근무일이 시작되면 문을 닫고 앞벽을 올린다.
    private func prepareStageForDay(animated: Bool) {
        let date = office.day.date
        stage.setDay(seed: date.year * 10_000 + date.month * 100 + date.day)
        let before = office.day.phase == .beforeCheckIn
        stage.setFrontWallRaised(before, animated: animated)
        stage.setDoorOpen(!before, animated: animated)
        stage.setTime(minutes: minuteOfDay, animated: false)
        if before { stage.setView(.door, animated: animated) }
    }

    private var minuteOfDay: Double {
        let parts = KST.calendar.dateComponents([.hour, .minute, .second], from: office.now)
        return Double((parts.hour ?? 0) * 60 + (parts.minute ?? 0)) + Double(parts.second ?? 0) / 60
    }

    private func syncStage(animated: Bool = true) {
        stage.setTime(minutes: minuteOfDay, animated: true)
        stage.setTerminal(checkedInAt: office.day.checkInAt?.hm)
        let checkedIn = office.day.checkInAt != nil && office.day.phase != .off
        stage.setMyDeskActive(checkedIn)
        let items = office.day.tasks.filter { $0.status != .carried }.map { (level: $0.level.rawValue, done: $0.isDone) }
        let signature = items.map { "\($0.level)\($0.done)" }.joined()
        if signature != checklistSignature {
            checklistSignature = signature
            stage.setChecklist(items)
        }
        // 아침 PT는 팀 전체, 금요일 주간보고를 쓰는 동안은 부장·팀장만 회의실에 모인다(같은 회의실이라 둘 중 하나만).
        if office.day.phase == .morningPT {
            stage.setMeeting(true, animated: animated)
        } else if weeklyMeetingOn {
            stage.setWeeklyMeeting(true, animated: animated)
        } else {
            stage.setWeeklyMeeting(false, animated: animated)
        }
        var avatar = Self.avatar(for: office.seatStatus, phase: office.day.phase)
        if weeklyMeetingOn, avatar == .seated { avatar = .presenting }
        stage.setMyAvatar(avatar)
    }

    /// 금요일 근무 중에 아직 내지 않은 주간보고서를 쓰는 동안: 회의실에서 부장·팀장에게 이번 주를 보고한다.
    /// 제출하거나 패널을 닫으면 끝난다. 퇴근 뒤에 쓸 때는 다들 퇴근했으니 열지 않는다.
    private var weeklyMeetingOn: Bool {
        panel == .weekly && office.canSubmitWeekly && office.day.phase == .working
    }

    static func avatar(for status: SeatStatus, phase: Phase) -> MyAvatar {
        // 아침 PT 동안은 회의실 화면 옆에서 발표한다.
        if phase == .morningPT {
            switch status {
            case .seated, .checking, .emptyBeforeWork: return .presenting
            default: break
            }
        }
        switch status {
        case .beforeCheckIn: return .outside
        case .absentCandidate, .off: return .off
        case .seated, .checking, .review: return .seated
        case .emptyBeforeWork, .unauthorizedAway: return .empty
        case .dinner: return .dinner
        case .lunch: return .lunch
        case .away(_, let reason): return .away(reason: reason)
        case .cameraOff: return .cameraOff
        }
    }

    // MARK: - 카메라

    private var cameraWanted: Bool {
        guard useCamera, office.onboarded else { return false }
        switch office.day.phase {
        case .off: return false
        case .beforeCheckIn: return !office.day.absentCandidate
        default: return true
        }
    }

    func updateCamera() {
        if cameraWanted {
            guard !seat.isRunning else { return }
            Task { await seat.start() }
        } else if seat.isRunning {
            seat.stop()
        }
    }

    private func seatDidChange() {
        cameraPresence = seat.presence
        cameraOffReason = seat.offReason
        guard useCamera, office.day.phase != .beforeCheckIn else { return }
        office.observe(PresenceState(rawValue: seat.presence.rawValue) ?? .unknown)
    }

    /// 카메라 없이 시연할 때 자리 상태를 직접 바꾼다.
    func setManualPresence(_ state: PresenceState) {
        manualPresence = state
        office.observe(state)
    }

    @ObservationIgnored private var manualPresence: PresenceState = .present

    private func refeedPresence() {
        if useCamera {
            if seat.isRunning { office.observe(PresenceState(rawValue: seat.presence.rawValue) ?? .unknown) }
        } else {
            office.observe(manualPresence)
        }
    }

    // MARK: - 업무와 근태 요청

    func run(_ action: (inout Office) throws -> Void) {
        do {
            try action(&office)
            save()
        } catch {
            show(error.localizedDescription)
        }
    }

    // MARK: - 주간보고

    func submitWeekly() {
        let draft = office.weeklyDraft
        do {
            let submitted = try office.submitWeeklyReport(draft)
            save()
            Task { await requestWeeklyReply(for: submitted) }
        } catch {
            show(error.localizedDescription)
        }
    }

    /// 상사 답장을 받는다. Solar에 연결하지 못하면 정해진 문구의 기본 답장을 넣고 그렇게 표시한다.
    func requestWeeklyReply(for report: WeeklyReport, allowFallback: Bool = false) async {
        weeklySending = true
        weeklyError = nil
        defer { weeklySending = false }
        if let client = solarClient() {
            do {
                let reply = try await client.weeklyReply(report: report, name: office.profile.name)
                office.receiveWeeklyFeedback(reportID: report.id, subject: reply.subject, body: reply.body, source: .solar)
                show("팀장의 주간 피드백이 도착했습니다.")
                save()
                return
            } catch {
                weeklyError = error
                guard allowFallback else { return }
            }
        } else if !allowFallback {
            return
        }
        let reply = LocalWeeklyReply.make(report: report, name: office.profile.name)
        office.receiveWeeklyFeedback(reportID: report.id, subject: reply.subject, body: reply.body, source: .localTemplate)
        show("주간 피드백이 도착했습니다.\n(Solar 미연결 기본 답장)")
        save()
    }

    // MARK: - Solar

    func solarClient() -> SolarClient? {
        solar.config.hasKey ? SolarClient(config: solar.config) : nil
    }

    func saveSolarKey(_ key: String) throws {
        try EnvFile.write(key: SolarSettings.keyName, value: key.trimmingCharacters(in: .whitespacesAndNewlines),
                          to: AppPaths.supportEnv)
        solar = SolarSettings.resolve(envFiles: AppPaths.envFiles)
    }

    func reloadSolar() {
        solar = SolarSettings.resolve(envFiles: AppPaths.envFiles)
    }

    // MARK: - 초기화와 저장

    func resetDemo() {
        office = Office(startingAt: Office.demoStart())
        prepareStageForDay(animated: false)
        panel = nil
        save()
    }

    func save() {
        Storage.save(office)
    }

    func show(_ message: String) {
        toast = message
        toastTask?.cancel()
        toastTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(4.5))
            guard !Task.isCancelled else { return }
            self?.toast = nil
        }
    }
}

/// 파일 위치.
enum AppPaths {
    static var support: URL {
        // 시험 실행은 사용자 기록을 덮어쓰지 않게 다른 폴더를 쓴다.
        if let override = ProcessInfo.processInfo.environment["AIBOSS_SUPPORT_DIR"], !override.isEmpty {
            return URL(fileURLWithPath: override, isDirectory: true)
        }
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Library/Application Support")
        return base.appendingPathComponent("AIBossOffice", isDirectory: true)
    }

    static var supportEnv: URL { support.appendingPathComponent(".env") }
    static var officeFile: URL { support.appendingPathComponent("office.json") }

    /// `.env`를 찾는 곳: 앱 설정 폴더, 그리고 앱이 들어 있는 저장소 폴더들(빌드한 자리에서 실행할 때).
    static var envFiles: [URL] {
        var files = [supportEnv]
        var folder = Bundle.main.bundleURL.deletingLastPathComponent()
        for _ in 0..<4 {
            files.append(folder.appendingPathComponent(".env"))
            folder = folder.deletingLastPathComponent()
        }
        files.append(URL(fileURLWithPath: FileManager.default.currentDirectoryPath).appendingPathComponent(".env"))
        return files
    }
}

/// 회사 상태를 이 맥에만 저장한다.
enum Storage {
    static func load() -> Office? {
        guard let data = try? Data(contentsOf: AppPaths.officeFile) else { return nil }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try? decoder.decode(Office.self, from: data)
    }

    static func save(_ office: Office) {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        guard let data = try? encoder.encode(office) else { return }
        try? FileManager.default.createDirectory(at: AppPaths.support, withIntermediateDirectories: true)
        try? data.write(to: AppPaths.officeFile, options: .atomic)
    }
}
