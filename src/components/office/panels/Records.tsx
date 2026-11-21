"use client";
/**
 * 기록 내보내기(개발기획서 3.3): 날짜와 항목을 골라 미리보기로 확인한 뒤 PDF·엑셀로 내보낸다.
 * PDF는 미리보기와 같은 HTML을 브라우저 인쇄 창으로 열어 'PDF로 저장'한다(한글·링크·여러 쪽을 브라우저가 처리).
 * 엑셀은 이 기기에서 바로 만든다. 기록은 서버로 다시 보내지 않는다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildReport, defaultExportOptions, type ExportOptions, exportFileName, type RecordsPayload } from "@/lib/records/records";
import { reportHtml } from "@/lib/records/report-html";
import { reportXlsx } from "@/lib/records/report-xlsx";
import { api, type OfficeView } from "../api";
import { Card, Notice, PanelHeader } from "../ui";

type Toggle = Exclude<keyof ExportOptions, "dates">;

const TOGGLES: { key: Toggle; label: string; detail: string }[] = [
  { key: "submissions", label: "결과물", detail: "제출한 글·링크·코드" },
  { key: "questions", label: "타 부서 질문과 내 답", detail: "회의실에서 받은 질문과 내가 한 설명" },
  { key: "revisions", label: "수정·재보고 이력", detail: "다시 제출, 범위 조정, 이월한 과제" },
  { key: "review", label: "하루 마감 요약", detail: "내가 확정한 마감 요약" },
  { key: "incompleteReasons", label: "미완료 사유", detail: "개인적인 내용일 수 있어 기본으로 넣지 않습니다" },
];

export function Records({ view }: { view: OfficeView }) {
  const [payload, setPayload] = useState<RecordsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [options, setOptions] = useState<ExportOptions | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);

  // 오늘 기록이 바뀌면(제출·마감 등) 목록을 다시 받는다. 고른 날짜·항목은 그대로 둔다.
  const reloadKey = `${view.clock.date}:${view.phase.value}:${view.day.submissions.length}:${view.history.length}`;
  useEffect(() => {
    let alive = true;
    api
      .records()
      .then((p) => {
        if (!alive) return;
        setPayload(p);
        setError(null);
        setOptions((prev) => {
          if (!prev) return defaultExportOptions(p.days);
          const exists = new Set(p.days.map((d) => d.date));
          return { ...prev, dates: prev.dates.filter((d) => exists.has(d)) };
        });
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : "기록을 불러오지 못했습니다."));
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  const report = useMemo(() => (payload && options ? buildReport(payload, options) : null), [payload, options]);
  const html = useMemo(() => (report ? reportHtml(report) : ""), [report]);

  const toggleDate = (date: string) =>
    setOptions((o) => (o ? { ...o, dates: o.dates.includes(date) ? o.dates.filter((d) => d !== date) : [...o.dates, date] } : o));
  const pickDates = (dates: string[]) => setOptions((o) => (o ? { ...o, dates } : o));

  const printPdf = useCallback(() => {
    const win = frame.current?.contentWindow;
    if (!win) return;
    win.focus();
    win.print();
  }, []);

  const downloadXlsx = useCallback(() => {
    if (!report) return;
    const blob = new Blob([reportXlsx(report) as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${exportFileName(report)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [report]);

  if (error) {
    return (
      <div className="panel">
        <PanelHeader place="기록" title="기록 내보내기" />
        <Notice kind="error" title="기록을 불러오지 못했습니다">
          {error}
        </Notice>
      </div>
    );
  }
  if (!payload || !options || !report) {
    return (
      <div className="panel">
        <PanelHeader place="기록" title="기록 내보내기" />
        <p className="muted">기록을 불러오는 중입니다.</p>
      </div>
    );
  }

  const days = payload.days;
  const empty = report.days.length === 0;
  return (
    <div className="panel">
      <PanelHeader
        place="기록"
        title="기록 내보내기"
        detail={"넣을 날짜와 항목을 고르고 미리보기로 확인한 뒤 내보냅니다.\nPDF는 대표 활동을 보여 주고, 엑셀은 같은 범위의 원문을 모두 담습니다."}
      />

      {days.length === 0 ? (
        <Notice kind="info" title="아직 내보낼 기록이 없습니다">
          출근해 과제를 정하고 결과물을 제출하면 여기에 쌓입니다.
        </Notice>
      ) : (
        <>
          <Card
            title={`날짜 ${options.dates.length} / ${days.length}일`}
            aside={
              <div className="row" style={{ gap: 6 }}>
                <button className="btn plain small" onClick={() => pickDates(days.map((d) => d.date))}>
                  모두
                </button>
                <button className="btn plain small" onClick={() => pickDates(days.filter((d) => d.counted).map((d) => d.date))}>
                  활동 인정한 날만
                </button>
                <button className="btn plain small" onClick={() => pickDates([])}>
                  비우기
                </button>
              </div>
            }
          >
            <div style={{ display: "grid", gap: 4, maxHeight: 220, overflowY: "auto" }}>
              {[...days].reverse().map((d) => {
                const done = d.tasks.filter((t) => t.done).length;
                return (
                  <label key={d.date} className="row" style={{ cursor: "pointer", gap: 8, flexWrap: "nowrap" }}>
                    <input type="checkbox" checked={options.dates.includes(d.date)} onChange={() => toggleDate(d.date)} style={{ width: 18, height: 18, accentColor: "var(--green)" }} />
                    <span style={{ minWidth: 92 }}>{d.label}</span>
                    <span className="small muted" style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      과제 {done}/{d.tasks.length} · 결과물 {d.submissions.length} · 설명 {d.explanationCount}회{d.goal ? ` · ${d.goal}` : ""}
                    </span>
                    {d.isToday ? <span className="badge tag">오늘</span> : null}
                    {d.counted ? <span className="badge l3">활동 인정</span> : !d.closed ? <span className="badge tag">마감 전</span> : null}
                  </label>
                );
              })}
            </div>
          </Card>

          <Card title="넣을 항목">
            <div style={{ display: "grid", gap: 6 }}>
              {TOGGLES.map((t) => (
                <label key={t.key} className="row" style={{ cursor: "pointer", gap: 8, flexWrap: "nowrap", alignItems: "flex-start" }}>
                  <input
                    type="checkbox"
                    checked={options[t.key]}
                    onChange={(e) => setOptions((o) => (o ? { ...o, [t.key]: e.target.checked } : o))}
                    style={{ width: 18, height: 18, marginTop: 2, accentColor: "var(--green)" }}
                  />
                  <span>
                    {t.label}
                    <span className="small muted"> · {t.detail}</span>
                  </span>
                </label>
              ))}
            </div>
            <p className="small muted pre" style={{ margin: 0 }}>
              {"과제·완료 기준·날짜별 요약은 늘 들어갑니다. 출근·지각 같은 근태 기록은 넣지 않습니다.\n문서 끝에 'AI 동료와 연습한 자기 기록이며 역량 인증서가 아님'을 함께 적습니다."}
            </p>
          </Card>

          <Card title="미리보기">
            <iframe
              ref={frame}
              title="내보낼 기록 미리보기"
              srcDoc={html}
              sandbox="allow-modals allow-same-origin"
              style={{ width: "100%", height: 460, border: "1px solid var(--line, #d5dae1)", borderRadius: 8, background: "#fff" }}
            />
          </Card>

          <div className="row" style={{ gap: 8 }}>
            <button className="btn" onClick={printPdf} disabled={empty}>
              PDF로 저장
            </button>
            <button className="btn secondary" onClick={downloadXlsx} disabled={empty}>
              엑셀(.xlsx) 내려받기
            </button>
          </div>
          <p className="small muted pre" style={{ margin: 0 }}>
            {"PDF로 저장을 누르면 인쇄 창이 열립니다. 대상(프린터)에서 'PDF로 저장'을 고르세요.\n파일은 이 기기에서 만들고 다른 곳으로 보내지 않습니다."}
          </p>
        </>
      )}
    </div>
  );
}
