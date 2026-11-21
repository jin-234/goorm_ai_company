"use client";
/**
 * 동료와 대화(팀장·PM·기획자·디자이너·마케터).
 * 왼쪽: 동료 고르기·대화 기록 목록 / 가운데: 대화(말 고치기·지우기·손으로 덧붙이기) / 오른쪽: 동료별 기억 MD(읽기·고치기·내려받기).
 * 대화를 마치면 요약이 기억 MD에 합쳐지고, 다음 대화는 그 MD를 읽고 시작한다.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Notice, SampleMark } from "../office/ui";
import { VoiceInput } from "../office/voice/VoiceInput";
import { type ChatTurn, type Colleague, colleagueApi, type Conversation, type ConversationItem, type Memory, type PersonaId } from "./api";

const fmt = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul" });
};

function SourceTag({ turn }: { turn: ChatTurn }) {
  if (turn.source === "sample") return <SampleMark />;
  if (turn.source === "manual") return <span className="badge tag" title="AI를 부르지 못해 정해진 질문을 보여 줍니다.">AI 연결 실패 · 정해진 질문</span>;
  if (turn.source === "user" && turn.speaker !== "me") return <span className="badge tag">직접 옮겨 적음</span>;
  return null;
}

/** 아주 작은 MD 미리보기(제목·목록·인용만). */
function MarkdownPreview({ text }: { text: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 14 }}>
      {text.split("\n").map((raw, i) => {
        const line = raw.replace(/<!--.*?-->/g, "").trimEnd();
        if (line.startsWith("### ")) return <strong key={i} style={{ display: "block", marginTop: 8 }}>{line.slice(4)}</strong>;
        if (line.startsWith("## ")) return <h3 key={i} style={{ margin: "12px 0 2px", fontSize: 15, color: "var(--green)" }}>{line.slice(3)}</h3>;
        if (line.startsWith("# ")) return <h2 key={i} style={{ margin: 0, fontSize: 17 }}>{line.slice(2)}</h2>;
        if (line.startsWith("> ")) return <div key={i} className="small muted">{line.slice(2)}</div>;
        if (/^\s*[-*]\s/.test(line)) return <div key={i} style={{ paddingLeft: 12 }}>• {line.replace(/^\s*[-*]\s/, "").replace(/\*\*/g, "")}</div>;
        if (!line.trim()) return null;
        return <div key={i}>{line.replace(/\*\*/g, "")}</div>;
      })}
    </div>
  );
}

export function ColleaguesApp() {
  const [colleagues, setColleagues] = useState<Colleague[]>([]);
  const [aiMode, setAiMode] = useState<"solar" | "sample">("sample");
  const [records, setRecords] = useState<ConversationItem[]>([]);
  const [picked, setPicked] = useState<PersonaId[]>(["leader"]);
  const [title, setTitle] = useState("");
  const [current, setCurrent] = useState<Conversation | null>(null);
  const [message, setMessage] = useState("");
  const [appendAs, setAppendAs] = useState<ChatTurn["speaker"]>("me");
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [memoryOf, setMemoryOf] = useState<PersonaId>("leader");
  const [memory, setMemory] = useState<Memory | null>(null);
  const [memoryDraft, setMemoryDraft] = useState("");
  const [memoryMode, setMemoryMode] = useState<"view" | "edit">("view");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const byId = useMemo(() => new Map(colleagues.map((c) => [c.id, c])), [colleagues]);
  const nameOf = (speaker: ChatTurn["speaker"]) => (speaker === "me" ? "나" : `${byId.get(speaker)?.name ?? speaker} ${byId.get(speaker)?.title ?? ""}`);

  const run = useCallback(async <T,>(work: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    const [c, l] = await Promise.all([colleagueApi.colleagues(), colleagueApi.list()]);
    setColleagues(c.colleagues);
    setAiMode(c.aiMode);
    setRecords(l.conversations);
  }, []);

  const loadMemory = useCallback(async (id: PersonaId) => {
    const { memory } = await colleagueApi.memory(id);
    setMemory(memory);
    setMemoryDraft(memory.markdown);
  }, []);

  useEffect(() => {
    run(refresh);
  }, [run, refresh]);

  useEffect(() => {
    run(() => loadMemory(memoryOf));
  }, [run, loadMemory, memoryOf]);

  const solarNotice = (r: { solarError: { title: string; guidance: string } | null }) => {
    if (r.solarError) setNotice(`${r.solarError.title} — 정해진 질문으로 이어 갑니다.`);
  };

  const toggle = (id: PersonaId) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const start = (opening: boolean) =>
    run(async () => {
      const r = await colleagueApi.start({ participants: picked, title: title.trim() || undefined, opening });
      setCurrent(r.conversation);
      setAppendAs("me");
      setTitle("");
      setNotice(r.conversation.memoryUsed.length ? `지난 대화 기억을 읽고 시작했습니다: ${r.conversation.memoryUsed.map((id) => byId.get(id)?.name).join(", ")}` : null);
      solarNotice(r);
      setMemoryOf(picked[0]);
      await refresh();
    });

  const open = (id: string) =>
    run(async () => {
      const r = await colleagueApi.get(id);
      setCurrent(r.conversation);
      setEditing(null);
      setNotice(null);
      setMemoryOf(r.conversation.participants[0]);
    });

  const say = () =>
    run(async () => {
      if (!current || !message.trim()) return;
      const r = await colleagueApi.say(current.id, message.trim());
      setCurrent(r.conversation);
      setMessage("");
      solarNotice(r);
      await refresh();
    });

  const append = () =>
    run(async () => {
      if (!current || !message.trim()) return;
      const r = await colleagueApi.edit(current.id, { append: [{ speaker: appendAs, text: message.trim() }] });
      setCurrent(r.conversation);
      setMessage("");
      await refresh();
    });

  const saveEdit = () =>
    run(async () => {
      if (!current || !editing) return;
      const r = await colleagueApi.edit(current.id, { edits: [{ id: editing.id, text: editing.text }] });
      setCurrent(r.conversation);
      setEditing(null);
      if (r.conversation.status === "closed") setNotice("고친 내용을 기억에 반영하려면 [다시 요약해 기억에 저장]을 눌러 주세요.");
    });

  const removeTurn = (turnId: string) =>
    run(async () => {
      if (!current) return;
      const r = await colleagueApi.edit(current.id, { remove: [turnId] });
      setCurrent(r.conversation);
    });

  const rename = (value: string) =>
    run(async () => {
      if (!current) return;
      const r = await colleagueApi.edit(current.id, { title: value });
      setCurrent(r.conversation);
      await refresh();
    });

  const finish = () =>
    run(async () => {
      if (!current) return;
      const r = await colleagueApi.finish(current.id);
      setCurrent(r.conversation);
      setNotice(`요약을 ${r.memories.map((m) => byId.get(m.personaId)?.name).join(", ")}의 기억 MD에 저장했습니다. 다음 대화는 이 기억을 읽고 시작합니다.`);
      solarNotice(r);
      await loadMemory(memoryOf);
      await refresh();
    });

  const removeConversation = (id: string) =>
    run(async () => {
      if (!window.confirm("이 대화 기록을 지울까요? 기억 MD의 이 대화 항목도 함께 빠집니다.")) return;
      await colleagueApi.remove(id);
      if (current?.id === id) setCurrent(null);
      await loadMemory(memoryOf);
      await refresh();
    });

  const saveMemory = () =>
    run(async () => {
      const r = await colleagueApi.saveMemory(memoryOf, memoryDraft);
      setMemory(r.memory);
      setMemoryMode("view");
      setNotice("기억 MD를 저장했습니다. 다음 대화부터 고친 내용을 읽습니다.");
      await refresh();
    });

  const handwritten = current != null && current.turns.every((t) => t.source === "user");

  return (
    <main style={{ maxWidth: 1360, margin: "0 auto", padding: "16px 16px 40px", display: "flex", flexDirection: "column", gap: 16 }}>
      <header className="row" style={{ justifyContent: "space-between" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <a href="/" className="small muted">← 사무실로</a>
          <h1 style={{ margin: 0, fontSize: 22 }}>동료와 대화</h1>
          <span className="small muted">대화를 마치면 요약이 동료별 기억 MD에 저장되고, 다음 대화는 그 기억을 읽고 이어 갑니다. 모든 동료는 AI이고 가상 역할입니다.</span>
        </div>
        {aiMode === "sample" ? <SampleMark /> : <span className="chip">Solar 연결됨</span>}
      </header>

      {error ? <Notice kind="error" title="처리하지 못했습니다">{error}</Notice> : null}
      {notice ? <Notice kind="info" title="안내">{notice}</Notice> : null}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(240px, 280px) minmax(0, 1fr) minmax(280px, 380px)", gap: 16, alignItems: "start" }}>
        {/* 왼쪽: 동료·기록 */}
        <section style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="card">
            <h2>누구와 이야기할까요</h2>
            <span className="small muted">두 명 이상 고르면 회의가 됩니다.</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {colleagues.map((c) => (
                <label key={c.id} className="row" style={{ gap: 8, cursor: "pointer" }}>
                  <input type="checkbox" checked={picked.includes(c.id)} onChange={() => toggle(c.id)} />
                  <span>
                    <strong>{c.name}</strong> {c.title} <span className="small muted">· {c.department}</span>
                    <br />
                    <span className="small muted">{c.memoryUpdatedAt ? `기억 있음 · ${fmt(c.memoryUpdatedAt)}` : "기억 없음(처음)"}</span>
                  </span>
                </label>
              ))}
            </div>
            <input className="field" placeholder="주제(선택) 예: 로그인 화면 회의" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} />
            <button className="btn" disabled={busy || picked.length === 0} onClick={() => start(true)}>
              {picked.length > 1 ? "회의 시작" : "대화 시작"}
            </button>
            <button className="btn plain small" disabled={busy || picked.length === 0} onClick={() => start(false)} title="AI 없이 실제 회의 내용을 옮겨 적습니다.">
              회의록 직접 적기
            </button>
          </div>

          <div className="card">
            <h2>대화 기록</h2>
            {records.length === 0 ? <span className="small muted">아직 없습니다.</span> : null}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {records.map((r) => (
                <div key={r.id} className="row" style={{ justifyContent: "space-between", gap: 4, padding: 8, borderRadius: 8, background: current?.id === r.id ? "var(--green-soft)" : "var(--paper-deep)" }}>
                  <button className="btn plain small" style={{ border: "none", textAlign: "left", flex: 1, height: "auto", padding: 0 }} onClick={() => open(r.id)}>
                    <strong>{r.title || "제목 없음"}</strong>
                    <br />
                    <span className="small muted">
                      {r.participants.map((p) => byId.get(p)?.name ?? p).join(", ")} · {fmt(r.updatedAt)} · {r.status === "closed" ? "요약됨" : "진행 중"}
                    </span>
                  </button>
                  <button className="btn plain small" aria-label="대화 기록 지우기" onClick={() => removeConversation(r.id)}>
                    지우기
                  </button>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 가운데: 대화 */}
        <section className="card" style={{ minHeight: 480 }}>
          {!current ? (
            <span className="muted">왼쪽에서 동료를 골라 대화를 시작하거나, 지난 대화 기록을 열어 주세요.</span>
          ) : (
            <>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <input
                  key={current.id + current.title}
                  className="field"
                  style={{ flex: 1, fontWeight: 600 }}
                  defaultValue={current.title}
                  placeholder="제목(마치면 요약에서 채웁니다)"
                  onBlur={(e) => e.target.value.trim() !== current.title && rename(e.target.value)}
                  aria-label="대화 제목"
                />
                <span className="chip">{current.kind === "meeting" ? "회의" : "1:1"} · {current.status === "closed" ? "요약됨" : "진행 중"}</span>
              </div>
              <span className="small muted">
                참여: {current.participants.map((p) => nameOf(p)).join(", ")} · 시작 {fmt(current.startedAt)}
                {current.memoryUsed.length ? ` · 기억을 읽고 시작함(${current.memoryUsed.map((p) => byId.get(p)?.name).join(", ")})` : ""}
              </span>

              <div style={{ display: "flex", flexDirection: "column", gap: 10 }} aria-live="polite">
                {current.turns.map((t) => (
                  <div
                    key={t.id}
                    style={{
                      alignSelf: t.speaker === "me" ? "flex-end" : "flex-start",
                      maxWidth: "85%",
                      background: t.speaker === "me" ? "var(--green-soft)" : "var(--paper-deep)",
                      borderRadius: 12,
                      padding: "8px 12px",
                    }}
                  >
                    <div className="row small muted" style={{ gap: 6 }}>
                      <strong style={{ color: "var(--ink)" }}>{nameOf(t.speaker)}</strong>
                      <SourceTag turn={t} />
                      {t.edited ? <span className="badge tag">고침</span> : null}
                    </div>
                    {editing?.id === t.id ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        <textarea className="field" value={editing.text} onChange={(e) => setEditing({ id: t.id, text: e.target.value })} />
                        <div className="row">
                          <button className="btn small" disabled={busy || !editing.text.trim()} onClick={saveEdit}>저장</button>
                          <button className="btn plain small" onClick={() => setEditing(null)}>취소</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div style={{ whiteSpace: "pre-wrap" }}>{t.text}</div>
                        <div className="row" style={{ gap: 4 }}>
                          <button className="btn plain small" style={{ minHeight: 24, border: "none" }} onClick={() => setEditing({ id: t.id, text: t.text })}>고치기</button>
                          <button className="btn plain small" style={{ minHeight: 24, border: "none" }} onClick={() => removeTurn(t.id)}>지우기</button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 8, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
                <VoiceInput onText={(t) => setMessage((m) => (m.trim() ? `${m.trimEnd()}\n${t}` : t))} disabled={busy} />
                {handwritten ? (
                  <label className="row small">
                    말한 사람
                    <select className="field" style={{ width: "auto" }} value={appendAs} onChange={(e) => setAppendAs(e.target.value as ChatTurn["speaker"])}>
                      <option value="me">나</option>
                      {current.participants.map((p) => <option key={p} value={p}>{nameOf(p)}</option>)}
                    </select>
                  </label>
                ) : null}
                <textarea
                  className="field"
                  aria-label="보낼 말"
                  placeholder={handwritten ? "회의에서 나온 말을 옮겨 적어 주세요." : "하고 싶은 말을 적거나 [말로 하기]를 눌러 주세요."}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) (handwritten ? append : say)();
                  }}
                />
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <div className="row">
                    <button className="btn" disabled={busy || !message.trim()} onClick={handwritten ? append : say}>
                      {busy ? "처리 중" : handwritten ? "기록에 추가" : "보내기"}
                    </button>
                    {!handwritten ? (
                      <button className="btn plain small" disabled={busy || !message.trim()} onClick={append} title="동료의 답 없이 내 말만 기록합니다.">
                        답 없이 기록만
                      </button>
                    ) : null}
                  </div>
                  <button className="btn secondary" disabled={busy || !current.turns.some((t) => t.speaker === "me")} onClick={finish}>
                    {current.status === "closed" ? "다시 요약해 기억에 저장" : "대화 마치고 기억에 저장"}
                  </button>
                </div>
              </div>

              {current.summaryMd ? (
                <div className="card" style={{ background: "var(--paper)" }}>
                  <h2 style={{ fontSize: 15 }}>이 대화의 요약</h2>
                  <MarkdownPreview text={current.summaryMd} />
                </div>
              ) : null}
            </>
          )}
        </section>

        {/* 오른쪽: 기억 MD */}
        <section className="card">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2>기억 MD</h2>
            <select className="field" style={{ width: "auto" }} value={memoryOf} onChange={(e) => { setMemoryOf(e.target.value as PersonaId); setMemoryMode("view"); }} aria-label="기억을 볼 동료">
              {colleagues.map((c) => <option key={c.id} value={c.id}>{c.name} {c.title}</option>)}
            </select>
          </div>
          <span className="small muted">
            {memory?.exists ? `마지막 저장 ${fmt(memory.updatedAt)}` : "아직 저장된 기억이 없습니다. 대화를 마치면 만들어집니다."}
          </span>
          <div className="row">
            <button className={`btn small ${memoryMode === "view" ? "" : "plain"}`} onClick={() => setMemoryMode("view")}>보기</button>
            <button className={`btn small ${memoryMode === "edit" ? "" : "plain"}`} onClick={() => setMemoryMode("edit")}>고치기</button>
            <a className="btn plain small" style={{ display: "inline-flex", alignItems: "center", textDecoration: "none" }} href={colleagueApi.memoryFileUrl(memoryOf)} download>
              .md 내려받기
            </a>
          </div>
          {memoryMode === "view" ? (
            <MarkdownPreview text={memory?.markdown ?? ""} />
          ) : (
            <>
              <textarea className="field" style={{ minHeight: 420, fontFamily: "ui-monospace, Menlo, monospace", fontSize: 13 }} value={memoryDraft} onChange={(e) => setMemoryDraft(e.target.value)} aria-label="기억 MD 원문" />
              <span className="small muted">## 제목(알고 있는 맥락·합의·결정·다음에 이어갈 것·대화 기록)은 그대로 두고 목록(- )을 고쳐 주세요. 다른 ## 절을 추가해도 보존됩니다.</span>
              <div className="row">
                <button className="btn" disabled={busy || memoryDraft === memory?.markdown} onClick={saveMemory}>저장</button>
                <button className="btn plain small" onClick={() => { setMemoryDraft(memory?.markdown ?? ""); setMemoryMode("view"); }}>되돌리기</button>
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
