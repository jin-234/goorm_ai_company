/**
 * 리포트 → 인쇄용 HTML 한 장. 미리보기 창과 PDF 저장(브라우저 인쇄 → PDF로 저장)이 같은 HTML을 쓴다.
 * 브라우저 인쇄를 쓰면 한글 글꼴·링크·여러 쪽 나눔을 브라우저가 처리한다.
 * 사용자 입력은 모두 글자로 바꿔 넣고(HTML로 해석하지 않음), 링크는 http(s) 주소만 누를 수 있게 한다.
 */
import { exportFileName, type Report, REVIEW_LABELS, reviewValue, SUBMISSION_KIND_LABEL } from "./records";

export const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** http(s) 주소만 링크로 만든다(javascript: 같은 주소는 글자로만 둔다). */
export function safeUrl(text: string): string | null {
  const t = text.trim();
  if (!/^https?:\/\/\S+$/i.test(t)) return null;
  try {
    const u = new URL(t);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

const e = escapeHtml;
const MAX_CONTENT = 1200;
const clip = (s: string) => (s.length > MAX_CONTENT ? `${s.slice(0, MAX_CONTENT)}…(이하 생략, 원본은 엑셀에 전체 수록)` : s);

function submissionHtml(s: Report["days"][number]["submissions"][number]): string {
  const url = s.kind === "link" ? safeUrl(s.content) : null;
  const body = url
    ? `<a href="${e(url)}">${e(s.content.trim())}</a> <span class="muted">(링크 · 본문은 읽지 않음)</span>`
    : s.kind === "code"
      ? `<pre class="code">${e(clip(s.content))}</pre>`
      : `<div class="pre">${e(clip(s.content))}</div>`;
  return `<li><span class="tag">${SUBMISSION_KIND_LABEL[s.kind]}</span> <strong>${e(s.taskTitle || "과제 미지정")}</strong><div class="sub">${body}</div></li>`;
}

function dayHtml(d: Report["days"][number]): string {
  const parts: string[] = [];
  const badges = [d.counted ? `<span class="tag ok">활동 인정</span>` : "", !d.closed ? `<span class="tag">마감 전</span>` : ""].join(" ");
  parts.push(`<h2>${e(d.label)} <span class="date">${e(d.date)}</span> ${badges}</h2>`);
  if (d.goal.trim()) parts.push(`<p><span class="label">오늘 목표</span> ${e(d.goal)}</p>`);

  if (d.tasks.length > 0) {
    const rows = d.tasks
      .map((t) => {
        const status = t.outcomeLabel && !t.done ? `${t.statusLabel} · ${t.outcomeLabel}` : t.done ? (t.outcomeLabel ? t.outcomeLabel : "제출함") : t.statusLabel;
        const reason = t.outcomeReason.trim() ? `<div class="muted small">사유: ${e(t.outcomeReason)}</div>` : "";
        return `<tr><td><strong>${e(t.title)}</strong>${reason}</td><td>${e(t.completionCriteria)}</td><td class="nowrap">${e(status)}</td></tr>`;
      })
      .join("");
    parts.push(`<h3>과제와 완료 기준</h3><table><thead><tr><th>과제</th><th>완료 기준</th><th>결과</th></tr></thead><tbody>${rows}</tbody></table>`);
  }

  if (d.submissions.length > 0) parts.push(`<h3>결과물</h3><ul class="list">${d.submissions.map(submissionHtml).join("")}</ul>`);

  if (d.questions.length > 0) {
    const qs = d.questions
      .map(
        (q) =>
          `<li><div><span class="tag">${e(q.department)}</span>${q.source === "sample" ? ` <span class="tag">예시 응답</span>` : ""} <strong>Q.</strong> ${e(q.question)}</div>` +
          (q.reason ? `<div class="muted small">물은 이유: ${e(q.reason)}</div>` : "") +
          `<div class="answer"><strong>내 답.</strong> ${q.answer ? e(clip(q.answer)) : `<span class="muted">(답하지 않음)</span>`}</div></li>`,
      )
      .join("");
    parts.push(`<h3>타 부서 질문과 내 답 <span class="muted small">(회의실 설명 ${d.explanationCount}회)</span></h3><ul class="list">${qs}</ul>`);
  }

  if (d.revisions.length > 0) {
    parts.push(`<h3>수정·재보고 이력</h3><ul class="list">${d.revisions.map((r) => `<li><strong>${e(r.taskTitle)}</strong> — ${e(r.text)}</li>`).join("")}</ul>`);
  }

  if (d.review) {
    const review = d.review;
    const rows = REVIEW_LABELS.map(([k, label]) => [label, reviewValue(review, k)] as const)
      .filter(([, v]) => v)
      .map(([label, v]) => `<dt>${e(label)}</dt><dd class="pre">${e(v)}</dd>`)
      .join("");
    if (rows) parts.push(`<h3>하루 마감 요약 <span class="muted small">(사용자 확정)</span></h3><dl>${rows}</dl>`);
  }
  return `<section class="day">${parts.join("\n")}</section>`;
}

const CSS = `
@page { size: A4; margin: 16mm 14mm; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; padding: 24px; font-family: "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif; color: #1d232b; background: #fff; font-size: 12.5px; line-height: 1.6; word-break: keep-all; overflow-wrap: anywhere; }
@media print { body { padding: 0; } }
h1 { font-size: 22px; margin: 0 0 4px; }
h2 { font-size: 16px; margin: 0 0 8px; padding-bottom: 6px; border-bottom: 2px solid #1d232b; }
h3 { font-size: 13px; margin: 14px 0 6px; }
.date { font-weight: 400; color: #5b6573; font-size: 12px; }
.muted { color: #5b6573; } .small { font-size: 11px; font-weight: 400; }
.label { font-weight: 700; margin-right: 6px; }
.tag { display: inline-block; border: 1px solid #b8c0cc; border-radius: 4px; padding: 0 5px; font-size: 10.5px; font-weight: 600; color: #374151; vertical-align: 1px; }
.tag.ok { border-color: #2f7d4f; color: #1f5f39; }
.meta { color: #5b6573; margin: 0 0 16px; }
.summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 12px 0 20px; }
.summary div { border: 1px solid #d5dae1; border-radius: 6px; padding: 8px 10px; }
.summary b { display: block; font-size: 18px; }
.day { margin: 0 0 22px; break-inside: auto; }
h2, h3 { break-after: avoid; }
table { width: 100%; border-collapse: collapse; }
th, td { border: 1px solid #d5dae1; padding: 5px 7px; text-align: left; vertical-align: top; }
th { background: #f2f4f7; font-size: 11.5px; }
tr, li { break-inside: avoid; }
.nowrap { white-space: nowrap; }
.list { margin: 0; padding-left: 18px; } .list li { margin-bottom: 6px; }
.sub, .answer { margin-top: 2px; }
.pre { white-space: pre-wrap; }
pre.code { white-space: pre-wrap; background: #f6f7f9; border: 1px solid #e1e5ea; border-radius: 4px; padding: 6px 8px; margin: 2px 0 0; font-size: 11px; font-family: ui-monospace, Menlo, Consolas, monospace; }
a { color: #1d4ed8; word-break: break-all; }
dl { margin: 0; display: grid; grid-template-columns: 9.5em 1fr; gap: 4px 10px; }
dt { font-weight: 700; } dd { margin: 0; }
.limits { border-top: 1px solid #b8c0cc; padding-top: 10px; margin-top: 24px; font-size: 11px; color: #374151; break-inside: avoid; }
.limits ul { margin: 4px 0 0; padding-left: 18px; }
.empty { padding: 40px 0; text-align: center; color: #5b6573; }
`;

export function reportHtml(report: Report): string {
  const s = report.summary;
  const period = report.period ? (report.period.from === report.period.to ? report.period.from : `${report.period.from} ~ ${report.period.to}`) : "선택한 날 없음";
  const role = report.targetRole.trim() ? ` · 희망 직무 ${e(report.targetRole)}` : "";
  const body =
    report.days.length === 0
      ? `<p class="empty">내보낼 날짜를 하나 이상 골라 주세요.</p>`
      : `<div class="summary">
<div><b>${s.days}일</b>선택한 활동일</div>
<div><b>${s.countedDays}일</b>활동 인정</div>
<div><b>${s.doneTasks} / ${s.tasks}</b>마친 과제</div>
<div><b>${s.explanations}회</b>타 부서 설명${s.questions > 0 ? ` · 질문 ${s.questions}개` : ""}</div>
</div>
${report.days.map(dayHtml).join("\n")}`;
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(exportFileName(report))}</title><style>${CSS}</style></head>
<body>
<h1>활동 기록 리포트</h1>
<p class="meta">${e(report.name)}${role} · 기간 ${e(period)} · 만든 날 ${e(report.generatedOn)}</p>
${body}
<div class="limits"><strong>이 기록을 읽을 때</strong><ul>${report.limits.map((l) => `<li>${e(l)}</li>`).join("")}</ul></div>
</body></html>`;
}
