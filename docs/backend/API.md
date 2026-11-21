# 백엔드 API (프론트엔드용)

개정 기획서(VISION COMPANY, 2026-11-21) 기준. 코드 기준 정의는 `src/lib/server/actions.ts`(행동), `src/lib/server/view.ts`(화면용 상태), `src/lib/office/models.ts`(모델).

모든 요청은 같은 배포 주소의 `/api/...`로 보낸다. 참여자는 **httpOnly 쿠키 `office_id`** 로 구분하므로 브라우저에서 `fetch`할 때 별도 인증은 없다.
응답의 `office`는 아래 [화면용 상태](#화면용-상태-officeview) 모양이다. 화면은 이 값만 보고 그리고 규칙을 다시 계산하지 않는다.

## 하루 흐름과 단계

`beforeCheckIn → morningPT(아침보고) → working(수행·제출) → sharing(회의실 발표) → checkoutReview(하루 마감) → off`

단계는 사용자 행동으로만 넘어간다. 시각(사용자가 정한 활동 마감)은 안내(`pastActivityEnd`)에만 쓴다. 카메라 착석 판정·지각·자동 추가근무·주간보고는 없다.

## 오류 응답

| 상태 | 본문 | 언제 |
| --- | --- | --- |
| 409 | `{ error: { type: "rule", code, message, details } }` | 규칙상 지금 할 수 없음. `message`를 그대로 보여 주면 된다(줄바꿈 `\n` 포함). |
| 400 | `{ error: { type: "badRequest", message } }` | 값 형식이 틀림 |
| 502 | `{ error: { type: "solar" \| "stt", ... } }` | 외부 AI·음성 인식 실패(AI 동료 경로는 실패해도 수동 양식으로 200을 준다) |
| 500 | `{ error: { type: "server", message } }` | 서버 오류 |

규칙 오류 `code`: `notAllowedNow`, `noTasks`, `taskIncomplete`(details=과제별 빠진 칸), `taskNotFound`, `emptySubmission`, `noSubmission`, `shareQuestionLimit`, `choiceMissing`(details=과제명), `invalidProfile`.

## 엔드포인트

### `GET /api/office`
지금 상태. 처음이면 실제 지금 시각(한국 표준시, Asia/Seoul)에서 새로 시작한다. 회사 시계는 실제 시간과 같은 빠르기로 흐르고, 시연의 [다음 정각]·[다음 활동일]로 건너뛴 만큼만 앞서 간다. 옛 근태 형식으로 저장된 상태는 버리고 새로 시작한다.

### `DELETE /api/office`
처음부터 다시(기록 전부 삭제).

### `POST /api/office/actions`
본문 `{ "type": "...", ...값 }` → `{ result, office }`

| type | 값 | result |
| --- | --- | --- |
| `onboard` | `name`, `targetRole?`, `experience?`, `activityStart?`, `activityEnd?`(분 또는 `"HH:MM"`), `enforcement?`(`light` \| `standard` \| `strict`, 기본 `standard`) | — |
| `setEnforcement` | `level`(`light` \| `standard` \| `strict`) — 출근 뒤면 오늘부터 적용 | — |
| `lowerToday` | — (오늘만 한 단계 낮추기: 엄격→보통, 보통→가볍게) | — |
| `setDayOff` | `off`(bool, 기본 true), `date?`("YYYY-MM-DD", 없으면 오늘) — 쉬는 날 미리 알리기 | — |
| `checkIn` | `method?`: `"camera"` \| `"noCamera"`(기록만, 규칙에 쓰지 않음) | `{ checkInAt, method, late }` — `late`는 보통·엄격에서 시작 시각을 넘겼을 때 |
| `saveGoal` | `goal` | — |
| `confirmTasks` | `goal?`, `tasks: [{ title, completionCriteria, shareForm, level?(1·2·3, 보통·엄격은 필수), carryId? }]` — 이월 과제는 자동으로 앞에 붙고, `carryId`로 칸을 고친다 | `{ tasks }` |
| `setTaskStatus` | `taskId`, `status`: `in_progress` \| `submitted` \| `incomplete` (submitted는 제출물이 있어야 함) | — |
| `submitWork` | `taskId`, `kind`: `text` \| `code` \| `link`, `content` — 링크는 `readScope: "notRead"` | `{ submission }` |
| `observePresence` | `state`: `present` \| `absent` \| `cameraOff` \| `unknown` (보통·엄격 근무 중, 지금은 버튼이 보냄) | — |
| `requestLunch` | — (보통·엄격, 하루 한 번 1시간) | `{ allowance }` |
| `registerAway` | `reason` (보통·엄격, 건당 15분) | `{ allowance }` |
| `returnFromAllowance` | — | — |
| `submitCheckout` | — (보통·엄격, 마감 시각의 퇴근 점검) | `{ checkout: { kind: "noOvertime" } \| { kind: "overtime", count } }` |
| `endOvertime` | — (저녁시간·추가근무 중이면 일찍 끝냄, 점검 중이면 점검 제출) | `{ overtime: completed \| ranToEnd \| abandoned }` |
| `startSharing` | `earlyReason?` (엄격에서 마감 시각 전이면 필수) | — |
| `recordShareTurn` | `role: "user"`, `text` (기획자 턴은 `/api/office/share`가 남긴다) | — |
| `endSharing` | `reason?`: `done` \| `userStopped`, `earlyReason?` — 수행 중에 부르면 공유를 건너뜀(`endedBy: "skipped"`) | — |
| `saveReviewDraft` | `review`(아래 Review 8칸) — 사용자 수정으로 저장 | — |
| `confirmReview` | `review`, `choices: { [taskId]: "adjust" \| "carryOver" \| "endToday" }`(제출하지 않은 과제마다), `reasons?` | `{ close: { submitted, adjusted, carried, ended } }` |
| `skipHour` | — (시연: 다음 정각. 보통·엄격은 퇴근 점검·추가근무 시작·종료 시각에서 멈춤) | `{ skip: { from, to, stoppedFor } }` |
| `markMailRead` | `id` | — |
| `startNextWorkday` | — (마감 뒤, 또는 출근 전이면 넘김. 보통·엄격에서 쉬는 날로 알리지 않고 넘기면 결근 후보). 실제 날짜가 바뀌었으면 실제 오늘·지금 시각으로, 같은 날이면 다음 근무일 활동 시작 5분 전으로 | — |

2·3단계가 남았는데 마감 시각 전에 마감하려는 것처럼 규칙에 맞지 않는 요청은 `rule` 오류로 오고, 화면에 그대로 보여 줄 한국어 메시지가 함께 온다.

### AI 동료 (`src/lib/colleague`)

Solar 키가 없거나 `OFFICE_AI_MODE=sample`이면 `source: "sample"`(AI 연결 전 예시 응답, 화면에 '예시 응답(AI 연결 전)' 표시). 키가 있는데 실패하면 `source: "manual"`(정해진 양식, AI가 답한 것처럼 표시하지 않음).

| 경로 | 본문 | 응답 |
| --- | --- | --- |
| `POST /api/office/draft` | `{ goal, availableMinutes? }` | `{ source, proposal: { tasks, question }, solarError, result, office }` — 제안만, 확정은 `confirmTasks` |
| `POST /api/office/share` | `{ message }` (건너뛰기는 `"이 질문은 건너뛸게요."`) | `{ source, reply, solarError, office }` — 사용자·기획자 두 턴을 서버가 기록 |
| `POST /api/office/review-draft` | — | `{ source, review, solarError, office }` — `day.review` 초안으로 저장 |

기획자 `reply`: `acknowledgement`, `question`(물음표 하나), `question_reason`, `question_basis`(`role_need` \| `ux_guide`, 질문 없으면 `""`), `basis_ref`(근거 출처 이름), `known_facts[]`, `open_questions[]`, `evidence_refs[]`(`"턴 n"`·`"제출물 id"`), `can_finish`. 질문은 공유당 최대 3개(기본 1~2개).

Review 8칸: `reported_work`, `explained_learning`, `artifact_observations`, `shared_scope_and_limits`, `open_questions[]`, `job_connection`, `next_action`, `evidence_refs[]`.

## 화면용 상태 (`officeView`)

| 칸 | 내용 |
| --- | --- |
| `onboarded`, `profile` | `profile = { name, targetRole, experience, activityStart, activityEnd, enforcement }` |
| `clock` | `now`, `hm`, `date`, `dateShort`, `dateLong`, `weekLabel`, `isFriday` |
| `phase` | `{ value, label, headline }` |
| `pastActivityEnd` | 사용자가 정한 마감 시각이 지났는지 |
| `enforcement` | `chosen`(고른 강도), `level`(오늘 실제 강도), `lowered`, `rules`(켜진 장치), `options`(세 강도 설명) |
| `attendance` | `isLate`, `absentCandidate`, `dayOff`, `returning`, `presence`, `monitoring`, `activeAllowance`, `lunchUsed`, `unauthorizedAwayMinutes`, `cameraOffMinutes`, `month`(`late`·`absent`·`recovered`·`points`·`estimatedFee`), `lateFee`(규칙 값) |
| `overtime` | `dinnerHM`·`overtimeHM`, `targetIds`(지금 남은 2·3단계), `assignedIds`, `outcome`, `checkoutAt`, `earlyLeaveReason` |
| `day` | `date`, `checkInAt`, `checkInMethod`, `goal`, `tasks[]`, `submissions[]`, `share`, `review`, `unsubmittedTaskIds`, `events` |
| `pendingCarry` | 다음 활동일에 붙을 이월 과제(원본 ID `carriedFromTaskId` 보존) |
| `can` | `checkIn`, `confirmTasks`, `editTasks`, `startSharing`, `endSharing`, `confirmReview`, `startNextWorkday`, `skipHour`, `lowerToday`, `setDayOff`, `observePresence`, `requestLunch`, `registerAway`, `returnFromAllowance`, `submitCheckout`, `endOvertime`, `earlyLeave`, `earlyLeaveNeedsReason`, `earlyLeaveBlockedBy` |
| `mail` | `unreadCount`, `inbox[]`, `sent[]` |
| `history` | `[{ date, dateShort, tasks, review, counted, checkedIn, isLate, absentCandidate, dayOff }]` — `counted`: 제출물·설명이 있고 마감을 확정한 날 |
| `seat`, `state.now` | 3D 사무실 호환용. `seat`는 보통·엄격에서 점심·자리 비움·저녁시간·카메라 꺼짐도 반영(`isWarning`) |

`day.tasks[]`: `id`, `title`, `completionCriteria`, `shareForm`, `status`(`confirmed` → `in_progress` → `submitted` → `reviewed`, 또는 `incomplete`), `statusLabel`, `outcome`, `outcomeLabel`, `outcomeReason`, `carriedFrom`, `carriedFromTaskId`, `carryCount`, `submissionCount`.

`day.share`: `state`(`awaiting_explanation` → `clarifying` → `ready_to_summarize` → `user_confirmed`), `questionCount`, `maxQuestions`, `turns[]`, `knownFacts[]`, `openQuestions[]`, `endedBy`.

`day.review`: `draft`, `draftSource`(`solar` \| `sample` \| `manual`), `aiDraft`(AI 원본, 사용자 수정과 구분), `editedByUser`, `confirmed`, `confirmedAt`, `choices`.
