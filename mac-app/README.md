# AI 상사 가상회사 (맥 앱)

스스로 정한 취업 준비를 실제 업무처럼 수행하는, 성인용 구독형 관리 독서실.
매일 정해진 시간에 카메라로 출근하고, 아침 PT에서 오늘 할 일을 말하면 AI 팀장이 업무를 배정합니다.
근무 중에는 착석 여부를 확인하고, 퇴근 전에는 결과물을 검토합니다.
나를 뺀 팀장과 동기는 모두 AI이고, 사무실은 귀여운 3D 미니어처로 보입니다.

2026 서울AI디지털배움터 청년 AI 해커톤 출품작의 네이티브 macOS 판입니다.
브라우저 앱·앱 서버·Whisper 서버로 나눠 실행하던 구성을 앱 하나로 합쳤습니다.

## 필요한 것

- macOS 15 이상, Apple Silicon 권장 (M1 Pro에서 개발·확인)
- Xcode 16 이상 (Swift 6 도구 모음)
- 카메라와 마이크 (없어도 시연 가능, 아래 참고)
- Upstage Solar 키 (없어도 시연 가능하나 업무 정리·주간 답장이 정해진 규칙·문구로 바뀜)

## 처음 실행

```sh
cd mac-app
scripts/download-whisper-model.sh        # 음성 전사 모델 small(약 465MB)과 말소리 감지 모델
cp .env.example .env                     # 그리고 .env 에 UPSTAGE_API_KEY= 값을 넣는다
scripts/build-app.sh --open              # 빌드하고 실행
```

- 처음 빌드할 때 whisper.cpp 배포판(약 66MB)을 내려받습니다.
- 앱은 `~/Library/Caches/AIBossOffice/build/AI 상사 가상회사.app` 에 만들어집니다.
  (프로젝트가 iCloud 동기화 폴더에 있어도 빌드 산출물이 올라가지 않게 캐시 폴더에 둡니다.)
- 처음 실행하면 카메라·마이크 권한을 묻습니다.

## Solar 키 넣기

Solar 전용 설정은 `UPSTAGE_API_KEY` 하나면 됩니다. 주소(`https://api.upstage.ai/v1`)와 모델(`solar-pro4`)은 소스에 기본값으로 들어 있습니다.

키를 읽는 순서:

1. 환경변수 `UPSTAGE_API_KEY`
2. `~/Library/Application Support/AIBossOffice/.env` (앱 설정 화면에서 저장하면 여기에 들어감, 권한 600)
3. 앱이 들어 있는 폴더에서 위로 네 단계까지의 `.env`, 그리고 실행한 폴더의 `.env`

실제 응답 확인(앱 없이 터미널에서):

```sh
scripts/solar-check.sh                  # 기획서 예시 PT → 체크리스트, 주간보고 → 답장
scripts/solar-check.sh "3단계 필수 업무는 …"
```

앱에서는 설정(⌘,) → Upstage Solar → '연결 확인'.
키 없음, 인증 실패, 막힌 키, 지역 불일치, 응답 시간 초과, 인터넷 끊김, 요청 한도를 구분해 안내하고, 다시 시도할 수 있으면 버튼을 보여 줍니다.
연결에 실패해도 전사문과 주간보고 초안은 그대로 남습니다.

`solar-pro4`는 사용량에 따라 요금이 나오는 클라우드 API입니다. ([요금 안내](https://www.upstage.ai/pricing/api))
Solar로는 전사문과 주간보고서 글만 보내고, 영상과 녹음은 보내지 않습니다.

### Solar가 없을 때 (기획서에 없는 추가 동작)

시연이 끊기지 않도록 다음을 넣었습니다. 화면에 Solar가 아니라고 표시합니다.

- 아침 PT 초안: 기기 안 규칙(`PTParser`)으로 단계·마감·완료 기준을 읽습니다. 화면에 "기기 안 규칙으로 정리한 초안 (Solar 미연결)"으로 표시.
- 주간보고 답장: 보고서의 첫 성취와 다음 주 목표 한 줄을 넣은 정해진 문구. 메일에 "Solar 미연결 · 정해진 문구의 기본 답장"으로 표시.

## 시연 순서 (기획서 '첫 시연 범위')

1. 입사 안내 확인 → 출입문 출근 화면에서 카메라에 앉아 출근 → 문이 열리고 걸어 들어가 자리에 앉음, 팀장이 손을 흔듦
2. 회의실을 눌러 아침 PT: '말하기 시작'(⌘R)으로 3단계부터 말함 → 전사 → 업무 초안
3. 업무명·중요도·마감·완료 기준을 고치고 '확정하고 근무 시작'
4. 팀장 자리(메일함) 또는 내 책상에서 점심 요청(1시간), 사유를 적어 15분 자리 비움. 위 막대 '시연' 묶음의 '다음 정각'(⌘])으로 시각과 창밖 빛을 바꿈
5. 18:00 퇴근 점검: 1단계는 이월 보고 후 정시 퇴근, 2·3단계가 남으면 저녁시간 뒤 19:00~22:00 추가근무. 22:00에 남은 업무 이월
6. '금요일 장면' → 출근 → 메일함에서 주간보고서 작성·제출 → 팀장 답장

'다음 정각'은 다음 정각으로 가고(30분 미만이면 그다음 정각, 08:55 → 10:00), 퇴근 점검(18:00), 추가근무 시작(19:00), 종료(22:00)에서 멈춥니다.
건너뛴 시간에는 카메라로 본 것이 없으므로 자리 비움을 세지 않고, 점심과 등록한 자리 비움은 등록된 종료 시각에 끝납니다.
가상 시계는 그 밖에는 실제 시간처럼 1초씩 흐릅니다.

### 키보드와 글자 크기

- ⌘1 내 책상, ⌘2 팀장 자리(메일함), ⌘3 회의실(아침 PT), Esc 패널 닫기, ⌘] 다음 정각, ⌘R 아침 PT 녹음 시작·정지
- 설정(⌘,) → 글자 → '글자 크게 (125%)'

### 카메라 없이 시연

설정 → 카메라 → '카메라로 출근과 착석 확인'을 끄면, 출근 화면의 '카메라 없이 출근(시연)'과 내 책상의 '자리에 있음 / 자리 비움 / 카메라 꺼짐' 버튼으로 진행합니다.

### 처음부터 다시

설정 → 시연 → '처음부터 다시'. 상태는 `~/Library/Application Support/AIBossOffice/office.json` 한 파일에 저장됩니다.

## 근태 규칙 (단일 엄격 관리 기준)

| 항목 | 규칙 |
|---|---|
| 출근 | 09:00 기준. 09:01부터 지각, 당일 기록이 없으면 결근 후보 |
| 점심 | 사내 메일로 요청하면 1시간 |
| 자리 비움 | 사유 등록 시 건당 15분. 허용 시간이 끝난 뒤에도 비면 '근무 중 자리 비움' |
| 카메라 꺼짐 | 자리 비움과 다른 상태. 확인한 뒤 근태 확정 |
| 18:00 | 1단계만 남으면 이월 보고 후 정시 퇴근, 2·3단계가 남으면 저녁시간과 추가근무 |
| 19:00~22:00 | 추가근무 한 구간, 3단계부터. 먼저 끝내면 보충근무 미이행, 22:00에 남은 일 이월 |
| 지각비 | 예상액만 표시. 지각 1점, 무단결근 3점, 월 2점까지 0원, 초과 1점당 1,000원, 월 최대 5,000원 |

## 개인정보

- 카메라 영상은 저장·전송하지 않고 이 맥 안에서만 사람이 보이는지 판단합니다. 장면을 보고 바로 버리며 사람 수만 남깁니다.
- 녹음은 이 맥 안에서 전사(whisper.cpp)한 뒤 지웁니다.
- 근태·업무 기록은 이 맥의 `office.json`에만 있습니다.

## 구조

```
mac-app/
├── App/                      앱 실행 타깃(SwiftUI). 화면, 상태 모델, 3D 화면 연결
├── Packages/
│   ├── OfficeKit/
│   │   ├── OfficeCore        근태·업무 규칙, 가상 시계, 사내 메일, Solar 연동, PT 규칙 읽기 (시험 82개)
│   │   ├── OfficeScene       3D 사무실(SceneKit): 방, 가구, 시간대 빛, 캐릭터 4명, 입장 장면
│   │   ├── render-shots      3D 장면을 창 없이 PNG로 뽑는 도구
│   │   └── solar-check       Solar 실제 응답 확인 도구
│   ├── OfficeScreens/        아침 PT·출근 화면, Whisper 모델 설정 칸
│   ├── WhisperBridge/        마이크 녹음, 한국어 전사(whisper.cpp), 모델 보관, whisper-check
│   └── SeatKit/              웹캠 착석 판정(Vision), 카메라 미리보기, seat-check
└── scripts/
    ├── build-app.sh          .app 빌드
    ├── download-whisper-model.sh
    └── solar-check.sh
```

## 개발자용 확인 도구

모든 `swift` 명령에는 `--scratch-path ~/Library/Caches/AIBossOffice/<꾸러미>`를 붙입니다(iCloud 폴더에 `.build`가 생기지 않게).

```sh
# 규칙 시험
swift test --package-path Packages/OfficeKit --scratch-path ~/Library/Caches/AIBossOffice/officekit

# 3D 장면 그림(09:00, 20:00 시안 등)
swift run --package-path Packages/OfficeKit --scratch-path ~/Library/Caches/AIBossOffice/officekit render-shots <출력 폴더> 1600x1000

# 전사 확인: 인자 없으면 기획서 예시 PT를 합성 음성으로 만들어 전사, --mic 초 로 마이크 녹음
swift run --package-path Packages/WhisperBridge --scratch-path ~/Library/Caches/AIBossOffice/WhisperBridge whisper-check
swift run --package-path Packages/WhisperBridge --scratch-path ~/Library/Caches/AIBossOffice/WhisperBridge whisper-check --mic 20

# 착석 판정 확인: 카메라로 20초, --seconds 초, --frames 로 장면별 상반신·얼굴 수
swift run --package-path Packages/SeatKit --scratch-path ~/Library/Caches/AIBossOffice/SeatKit seat-check --frames

# 화면(아침 PT·출근) PNG
swift run --package-path Packages/OfficeScreens --scratch-path ~/Library/Caches/AIBossOffice/OfficeScreens screen-shots <출력 폴더>
```

터미널에서 whisper-check·seat-check를 돌릴 때는 그 터미널 앱에 마이크·카메라 권한이 필요합니다
(시스템 설정 → 개인정보 보호 및 보안 → 카메라 / 마이크).

### 시연 영상 녹화

```sh
scripts/demo/record-demo.sh            # ../공유/AI 상사 가상회사 시연.mp4 (약 3분, 1920폭, 자막 포함)
```

시험용 앱을 뒤에서 띄워 자동 대본으로 하루(입사 → 출근 → 아침 PT 회의 → 자리 비움 → 점심 → 퇴근 점검 → 추가근무 → 금요일 주간보고)를 진행하며 그 창만 녹화합니다(ScreenCaptureKit, 다른 창에 가려져도 됨). 터미널에 화면 기록 권한과 ffmpeg가 필요합니다.

### 자동 시연 대본

앱을 손으로 누르지 않고 하루 흐름을 진행시키며 확인할 수 있습니다.

```sh
AIBOSS_SCRIPT="reset;onboard;checkin;wait 6;transcript;draft;confirm;skip;lunch" \
  "$HOME/Library/Caches/AIBossOffice/build/AI 상사 가상회사.app/Contents/MacOS/AIBossOffice"
```

단계 목록은 `App/Sources/AIBossOffice/DemoScript.swift`에 있습니다.

시험할 때 쓰는 앱의 기록·설정을 건드리지 않으려면 아래 환경변수를 함께 줍니다.

- `AIBOSS_SUPPORT_DIR=<폴더>`: office.json·.env를 그 폴더에서 읽고 씀
- `AIBOSS_NO_CAMERA=1`: 카메라를 쓰지 않음(설정은 바꾸지 않음)
- `AIBOSS_TEXT_SCALE=1.25`: 글자 배율

## 참고

- 디자인 레퍼런스(기획서): 입장 장면은 동물의 숲 해피 홈 파라다이스, 구도는 Two Point Museum, 창밖 빛은 Spirit City: Lofi Sessions를 참고했습니다.
  캐릭터는 기본 도형으로 직접 만들었고, 각 작품을 바로 떠올리게 하는 조합(세로 타원 눈과 삼각 코, 떠 있는 손, 콩 모양 몸 등)은 피했습니다.
- 외부 3D 모델·그림 파일은 쓰지 않습니다. 모두 코드로 그립니다.
