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
