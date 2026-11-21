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
| `onboard` | `name`, `targetRole?`, `experience?`, `activityStart?`·`activityEnd?`("HH:MM"·분), `enforcement?`(`light` \| `standard` \| `strict`, 기본 `standard`) | — |
| `setEnforcement` | `level`(`light` \| `standard` \| `strict`) — 출근 뒤면 오늘부터 적용 | — |
| `lowerToday` | — (오늘만 한 단계 낮추기: 엄격→보통, 보통→가볍게) | — |
| `setDayOff` | `off`(bool, 기본 true), `date?`("YYYY-MM-DD", 없으면 오늘) — 쉬는 날 미리 알리기 | — |
| `checkIn` | — | `{ checkInAt, late }` |
| `saveGoal` | `goal` | — |
| `confirmTasks` | `goal?`, `tasks: [{ title, completionCriteria, shareForm, level?(1·2·3, 보통·엄격은 필수), carryId? }]` | `{ tasks }` |
| `setTaskStatus` | `taskId`, `status`: `in_progress` \| `submitted` \| `incomplete` | — |
| `submitWork` | `taskId`, `kind`: `text` \| `code` \| `link`, `content` | `{ submission }` |
| `observePresence` | `state`: `present` \| `absent` \| `cameraOff` \| `unknown` (보통·엄격, 지금은 버튼이 보냄) | — |
| `requestLunch` | — (보통·엄격, 하루 한 번 1시간) | `{ allowance }` |
| `registerAway` | `reason` (보통·엄격, 건당 15분) | `{ allowance }` |
| `returnFromAllowance` | — | — |
| `submitCheckout` | — (보통·엄격, 마감 시각의 퇴근 점검) | `{ checkout: { kind: "noOvertime" } \| { kind: "overtime", count } }` |
| `endOvertime` | — (저녁시간·추가근무 중이면 일찍 끝냄, 점검 중이면 점검 제출) | `{ overtime: completed \| ranToEnd \| abandoned }` |
| `startSharing` | `earlyReason?` (엄격에서 마감 시각 전이면 필수) | — |
| `recordShareTurn` | `role: "user"`, `text` | — |
| `endSharing` | `reason?`(`done` \| `userStopped`), `earlyReason?` — 수행 중에 부르면 공유 건너뛰기 | — |
| `saveReviewDraft` | `review` | — |
| `confirmReview` | `review`, `choices: { [taskId]: adjust \| carryOver \| endToday }`, `reasons?` | `{ close }` |
| `skipHour` | — ('다음 정각') | `{ skip: { from, to, stoppedFor } }` — 보통·엄격은 퇴근 점검·추가근무 시작·종료 시각에서 멈춤 |
| `saveWeeklyDraft` | `completed?`, `incomplete?`, `nextGoals?` | — |
| `submitWeeklyReport` | 세 칸(없으면 저장된 초안 사용) | `{ report }` |
| `markMailRead` | `id` | — |
| `startNextWorkday` | — (보통·엄격에서 출근 없이 넘기면 결근 후보, 쉬는 날로 알렸으면 세지 않음) | — |
| `jumpToFriday` | — ('금요일 장면') | — |

규칙 위반(예: 2·3단계가 남았는데 마감 시각 전 마감)은 `rule` 오류와 화면에 그대로 보여 줄 한국어 메시지로 온다.

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
| `profile` | 이름·희망 직무·경험·활동 시작/마감 시각·`enforcement` |
| `clock` | `now`(ms), `hm`("09:05"), `dateShort`("11월 16일(월)"), `dateLong`, `weekLabel`, `isFriday` |
| `phase` | `value`, `label`, `headline`("수행 중 · 18:00 퇴근 점검") |
| `enforcement` | `chosen`(고른 강도), `level`(오늘 실제 강도), `lowered`, `rules`(켜진 장치), `options`(세 강도 설명) |
| `attendance` | `isLate`, `absentCandidate`, `dayOff`, `returning`, `presence`, `monitoring`, `activeAllowance`, `lunchUsed`, `unauthorizedAwayMinutes`, `cameraOffMinutes`, `month`(`late`·`absent`·`recovered`·`points`·`estimatedFee`), `lateFee`(규칙 값) |
| `overtime` | `dinnerHM`·`overtimeHM`, `targetIds`(지금 남은 2·3단계), `assignedIds`, `outcome`, `checkoutAt`, `earlyLeaveReason` |
| `seat` | `kind`, `title`, `detail`, `isWarning`, `showsWorkingAvatar`, (`until`/`since`/`reason`) — 3D 내 캐릭터 |
| `day` | 목표·과제(각 `level`·`levelLabel`)·제출물·공유·마감 초안·기록 |
| `can` | 버튼 켜고 끄기: `checkIn`, `confirmTasks`, `editTasks`, `startSharing`, `endSharing`, `confirmReview`, `lowerToday`, `setDayOff`, `observePresence`, `requestLunch`, `registerAway`, `returnFromAllowance`, `submitCheckout`, `endOvertime`, `earlyLeave`, `earlyLeaveNeedsReason`, `earlyLeaveBlockedBy`, `skipHour`, `submitWeekly`, `startNextWorkday`, `jumpToFriday` |
| `mail` | `unreadCount`, `inbox`, `sent`(최신순, 각 `tag`·`fromName`·`toName`) |
| `weekly` | `draft`, `awaitingReplyId`, `lastSubmitted` |
| `history` | 지난 날(각 `checkedIn`·`isLate`·`absentCandidate`·`dayOff`·`counted`) |

## 예시

```ts
const act = (body: object) =>
  fetch("/api/office/actions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
    .then((r) => r.json());

await act({ type: "checkIn" });
await fetch("/api/office/draft", { method: "POST", body: JSON.stringify({ transcript }) });
await act({ type: "confirmTasks" });
```
