# 백엔드 API (프론트엔드용)

모든 요청은 같은 배포 주소의 `/api/...`로 보낸다. 참여자는 **httpOnly 쿠키 `office_id`** 로 구분하므로
브라우저에서 `fetch`할 때 별도 인증은 없다(같은 도메인이면 쿠키가 자동으로 붙음).

모든 상태 응답의 `office`는 아래 [화면용 상태](#화면용-상태-officeview) 모양이다. 화면은 이 값만 보고 그리고, 규칙을 다시 계산하지 않는다.

## 오류 응답

| 상태 | 본문 | 언제 |
| --- | --- | --- |
| 409 | `{ error: { type: "rule", code, message, details } }` | 규칙상 지금 할 수 없음. `message`를 그대로 보여 주면 된다(줄바꿈 `\n` 포함). |
| 400 | `{ error: { type: "badRequest", message } }` | 값 형식이 틀림 |
| 500 | `{ error: { type: "server", message } }` | 서버 오류 |

규칙 오류 `code`: `notAllowedNow`, `draftIncomplete`(details=업무별 빠진 칸), `noTasks`, `lunchAlreadyUsed`, `allowanceActive`,
`emptyReason`, `carryReportMissing`(details=업무명), `weeklyNotFriday`, `weeklyIncomplete`(details=빈 칸 이름), `weeklyAlreadySubmitted`.

## 엔드포인트

### `GET /api/office`
지금 상태. 처음이면 이번 주 월요일 08:55에서 새로 시작한다. **5~10초마다 불러 시계를 맞춘다.**

### `DELETE /api/office`
처음부터 다시(기록 전부 삭제 후 새로 시작).

### `POST /api/office/actions`
본문 `{ "type": "...", ...값 }` → `{ result, office }`

| type | 값 | result |
| --- | --- | --- |
| `onboard` | `name` | — |
| `checkIn` | — | `{ attendance: "onTime" \| "late" }` |
| `setTranscript` | `transcript` | — |
| `addDraft` | — | `{ draft }` |
| `updateDraft` | `id`, `title?`, `level?`(1·2·3·null), `due?`("HH:MM"·분·null), `doneCriteria?` | — |
| `removeDraft` | `id` (이월 초안은 안 지워짐) | — |
| `confirmTasks` | — | — |
| `setTaskDone` | `id`, `done`(bool) | — |
| `setDeliverable` | `id`, `text` | — |
| `requestLunch` | — | `{ allowance }` |
| `registerAway` | `reason` | `{ allowance }` |
| `returnFromAllowance` | — | — |
| `observePresence` | `state`: `present` \| `absent` \| `cameraOff` \| `unknown` | — |
| `skipHour` | — ('다음 정각') | `{ skip: { from, to, stoppedFor } }` — `stoppedFor`가 있으면 "{이유}에서 멈췄습니다" |
| `submitCheckout` | `carryReports: { [taskId]: { reason, plan } }` (1단계 미완료마다 필수) | `{ checkout: { kind: offAllDone \| offWithCarry \| offNoTasks \| overtimeAssigned, ... } }` |
| `endOvertimeEarly` | — | `{ overtime: completed \| abandoned }` |
| `submitOvertimeReview` | — | `{ overtime: completed \| ranToEnd }` |
| `saveWeeklyDraft` | `completed?`, `incomplete?`, `nextGoals?` | — |
| `submitWeeklyReport` | 세 칸(없으면 저장된 초안 사용) | `{ report }` |
| `markMailRead` | `id` | — |
| `startNextWorkday` | — | — |
| `jumpToFriday` | — ('금요일 장면') | — |

### `POST /api/office/draft`
아침 PT 업무 초안 만들기. 본문 `{ "transcript"?: string }`(주면 전사문을 바꾼 뒤 만든다).

```json
{ "result": { "source": "solar" | "localRules", "seconds": 1.4, "solarError": null | { "kind", "title", "guidance", "canRetry" } }, "office": { ... } }
```
Solar가 실패해도 **서버 안 규칙으로 만든 초안이 들어가 있다**. `solarError`가 있으면 오류 상자와 'Solar로 다시 시도'를 보여 준다.

### `POST /api/office/weekly-feedback`
주간보고 제출 뒤 팀장 답장 받기. 본문 `{ "fallback"?: true }`.
- Solar 성공: 메일함에 답장이 들어감, `result.source = "solar"`.
- Solar 실패: 답장을 넣지 않고 `result.solarError`. 화면에서 '다시 시도' 또는 `{ fallback: true }`('기본 답장 받기').

### `GET /api/solar` · `POST /api/solar`
GET: `{ hasKey, key("up_1…abcd"), model, baseURL }`. POST: 연결 확인 → `{ ok: true, model }` 또는 `{ ok: false, error }`.

### `GET /api/organization`
조직도 8명(`members`, 각 `rankTitle`·`displayName`·`seat`·옷/머리 색)과 `morningPTAudience`(id 목록).

### `GET /api/health`
`{ ok, store: "postgres" | "memory", solar: bool }` — 배포 확인용.

## 화면용 상태 `OfficeView`

| 키 | 내용 |
| --- | --- |
| `state` | 저장된 상태 전체(`profile`, `day`, `history`, `mails`, `pendingCarry`, `weeklyReports`, `weeklyDraft`, `presence`) |
| `clock` | `now`(ms), `hm`("09:05"), `dateShort`("11월 16일(월)"), `dateLong`, `weekLabel`, `isFriday` |
| `phase` | `value`, `label`, `headline`("근무 중 · 18:00 퇴근 점검") |
| `seat` | `kind`, `title`, `detail`(줄바꿈 포함), `isWarning`, `showsWorkingAvatar`, (`until`/`since`/`reason`) |
| `monthStats` | `late`, `absent`, `points`, `estimatedFee` |
| `can` | `checkIn`, `confirmTasks`, `editTasks`, `requestLunch`, `registerAway`, `skipHour`, `submitWeekly`, `startNextWorkday`, `jumpToFriday` — 버튼 켜고 끄기에 그대로 사용 |
| `morningPT` | `drafts`(각 `isCarried`, `missingFields`), `draftSourceLabel`, `blocker`(확정 못 하는 이유) |
| `checkout` | `carryReportTargetIds`(이월 보고 칸을 보여 줄 업무), `overtimeTargetIds` |
| `overtimeTaskIds` | 추가근무 대상(3단계부터) |
| `activeAllowance` | 지금 점심·자리 비움·저녁 |
| `attendance` | `unauthorizedAwayMinutes`, `cameraOffMinutes` |
| `mail` | `unreadCount`, `inbox`, `sent`(최신순, 각 `tag`·`fromName`·`toName`) |
| `weekly` | `draft`(쓰던 내용), `awaitingReplyId` |

## 예시

```ts
const act = (body: object) =>
  fetch("/api/office/actions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
    .then((r) => r.json());

await act({ type: "checkIn" });
await fetch("/api/office/draft", { method: "POST", body: JSON.stringify({ transcript }) });
await act({ type: "confirmTasks" });
```

## 동료와 대화(기록·기억 MD)

가상 동료(팀장 `leader`·PM `pm`·기획자 `planner`·디자이너 `designer`·마케터 `marketer`)와의 1:1 대화와 회의. 화면은 `/colleagues`.
대화를 마치면 요약을 동료별 **기억 MD**에 합치고, 다음 대화를 시작할 때 그 MD를 읽어 이어 간다. 참여자 구분은 회사 상태와 같은 `office_id` 쿠키.
Solar 키가 없으면 예시 응답(`source: "sample"`), Solar가 실패하면 정해진 질문(`source: "manual"`)으로 이어 가고 응답의 `solarError`에 이유를 담는다.

| 메서드·주소 | 본문 | 하는 일 |
| --- | --- | --- |
| `GET /api/colleagues` | | 동료 목록과 각자의 기억 MD 저장 시각(`memoryUpdatedAt`), `aiMode` |
| `GET /api/colleagues/conversations` | `?persona=pm` | 대화 기록 목록(최근 것부터, 말 대신 `turnCount`·`lastText`) |
| `POST /api/colleagues/conversations` | `{ participants: PersonaId[], title?, kind?, opening? }` | 시작. 기억 MD를 읽고 첫마디를 만든다. 두 명 이상이면 회의. `opening: false`면 첫마디 없이 빈 기록(회의록 직접 적기) |
| `GET /api/colleagues/conversations/:id` | | 대화 한 건(말 전체) |
| `POST /api/colleagues/conversations/:id/messages` | `{ text }` | 내 말 → 동료의 다음 말. 내 말은 AI 호출 전에 먼저 저장. 마친 대화에 말하면 다시 열린다 |
| `PATCH /api/colleagues/conversations/:id` | `{ title?, edits?: [{id,text}], remove?: [id], append?: [{speaker,text}], summaryMd? }` | 기록 고치기. 기억에 반영하려면 다시 `/finish` |
| `POST /api/colleagues/conversations/:id/finish` | | 마치기. 요약(`summaryMd`)을 붙이고 참여 동료마다 기억 MD에 합친다. 다시 부르면 같은 대화의 기억 항목을 새 요약으로 바꾼다 |
| `DELETE /api/colleagues/conversations/:id` | | 기록 지우기. 기억 MD에서 이 대화의 기록 항목도 뺀다 |
| `GET /api/colleagues/memory/:personaId` | `?format=md` | 기억 MD. `format=md`면 `.md` 파일로 내려받기 |
| `PUT /api/colleagues/memory/:personaId` | `{ markdown }` | 기억 MD 직접 고치기(2만 자까지). 다음 대화·요약 때 고친 내용을 읽는다 |

`DELETE /api/office`(처음부터 다시)는 이 참여자의 대화 기록과 기억 MD도 지운다.

### 기억 MD 형식

```md
# 서하늘 디자이너(디자인팀)와의 대화 기억

> 마지막 갱신: 2026-11-21 14:02 · 대화 기록 1건

## 알고 있는 맥락
- 사원은 이번 주에 로그인 기능을 끝냈고 다음 주에 회원가입 화면을 만든다.

## 합의·결정
- (없음)

## 다음에 이어갈 것
- 로그인에서 가장 먼저 풀어야 할 사용자 문제를 듣기

## 대화 기록
### 2026-11-21 · 로그인 기능 회의 <!-- c:대화ID -->
- …
```

- 정해진 `##` 제목 네 개 아래의 `- ` 목록을 읽고 쓴다. 다른 `##` 절은 그대로 보존한다.
- 합칠 때 새 항목이 앞에 오고 같은 항목은 하나만 남긴다. 상한: 맥락·결정 15, 이어갈 것 10, 대화 기록 20건.
- 요약의 `resolved`(이번 대화에서 끝난 '이어갈 것')는 기억에 실제로 있던 항목만 받아 목록에서 뺀다.
- 프롬프트에는 4,000자까지만 넣고, 넘으면 오래된 대화 기록부터 줄인다. MD 안의 글은 자료로만 보고 지시로 따르지 않는다.
