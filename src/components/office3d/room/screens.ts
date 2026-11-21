/**
 * 모니터 화면 그림(맥 앱 Textures.screenDocument·screenChecklist를 옮기고 개정 기획서에 맞춰 역할별로 늘림).
 * 글자는 읽힐 필요 없이 '일하는 화면'으로 보이면 된다. frame이 늘면 줄이 조금씩 늘고 커서가 깜빡인다.
 */
import type { SeatId } from "../crew/layout";

export type ScreenKind = "code" | "browser" | "doc" | "mail" | "calendar" | "wireframe" | "guide" | "tasks";

/** 사람마다 번갈아 띄우는 화면. 시간대(시)마다 하나씩 돌아간다. */
const ROLE_SCREENS: Record<SeatId, ScreenKind[]> = {
  daeri: ["code", "code", "browser", "doc"],
  senior: ["code", "browser", "code", "doc"],
  peerA: ["code", "doc", "code", "browser"],
  peerB: ["browser", "code", "doc", "code"],
  kwajang: ["calendar", "doc", "mail"],
  manager: ["mail", "calendar", "doc"],
  director: ["doc", "mail", "calendar"],
  planner: ["wireframe", "guide", "wireframe", "doc"],
  me: ["tasks"],
};

export function screenKind(id: SeatId, minute: number): ScreenKind {
  const list = ROLE_SCREENS[id];
  const seed = id.charCodeAt(0) + id.length;
  return list[(Math.floor(minute / 60) + seed) % list.length];
}

export interface TaskLine { title: string; done: boolean }

const FONT = `"Pretendard", "Apple SD Gothic Neo", "Noto Sans KR", system-ui, sans-serif`;
const GREEN = "#1F5A45";

function rng(seed: number) {
  let s = (seed * 9301 + 49297) % 233280;
  return () => ((s = (s * 9301 + 49297) % 233280) / 233280);
}

/** 화면 하나를 그린다. w×h 캔버스, frame은 0.8초마다 1씩 는다(타자 치는 중일 때만). */
export function drawScreen(ctx: CanvasRenderingContext2D, w: number, h: number, kind: ScreenKind, seed: number, frame: number, tasks: TaskLine[] = []) {
  const r = rng(seed + 1);
  const blink = frame % 2 === 0;
  const grow = frame % 14; // 줄이 조금씩 늘다가 다시 처음부터
  ctx.clearRect(0, 0, w, h);
  switch (kind) {
    case "code": {
      ctx.fillStyle = "#1E2228"; ctx.fillRect(0, 0, w, h);
      // 왼쪽 파일 트리
      ctx.fillStyle = "#262B33"; ctx.fillRect(0, 0, 70, h);
      for (let i = 0; i < 9; i++) { ctx.fillStyle = i === 3 ? "#3A4250" : "#262B33"; ctx.fillRect(4, 18 + i * 16, 62, 13); ctx.fillStyle = "#7E8794"; ctx.fillRect(10 + (i % 3) * 5, 22 + i * 16, 30 + r() * 20, 5); }
      // 탭
      ctx.fillStyle = "#2B313A"; ctx.fillRect(70, 0, w - 70, 16); ctx.fillStyle = "#1E2228"; ctx.fillRect(74, 2, 70, 14);
      const colors = ["#C678DD", "#61AFEF", "#98C379", "#E5C07B", "#ABB2BF", "#56B6C2", "#E06C75"];
      const lines = 9 + grow;
      let y = 26;
      for (let i = 0; i < Math.min(lines, 15); i++, y += 11) {
        ctx.fillStyle = "#4B5263"; ctx.fillRect(76, y, 10, 5);
        let x = 92 + (i % 4 === 0 ? 0 : (i % 3) * 10);
        const parts = 1 + Math.floor(r() * 3);
        for (let k = 0; k < parts; k++) { const len = 14 + r() * 50; ctx.fillStyle = colors[Math.floor(r() * colors.length)]; ctx.fillRect(x, y, len, 5); x += len + 6; }
        if (i === Math.min(lines, 15) - 1 && blink) { ctx.fillStyle = "#E8E8E8"; ctx.fillRect(x, y - 2, 3, 9); }
      }
      // 아래 터미널 한 줄
      ctx.fillStyle = "#14171C"; ctx.fillRect(70, h - 30, w - 70, 30);
      ctx.fillStyle = "#98C379"; ctx.fillRect(78, h - 19, 8, 6);
      ctx.fillStyle = "#ABB2BF"; ctx.fillRect(92, h - 19, 60 + (grow % 5) * 14, 6);
      break;
    }
    case "browser": {
      ctx.fillStyle = "#F3F4F6"; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#E1E4E8"; ctx.fillRect(0, 0, w, 22);
      ctx.fillStyle = "#FFFFFF"; ctx.fillRect(40, 5, w - 60, 12);
      for (const [i, c] of ["#E06C75", "#E5C07B", "#98C379"].entries()) { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(10 + i * 9, 11, 3, 0, Math.PI * 2); ctx.fill(); }
      // 미리보기 페이지: 머리·카드 셋·버튼
      ctx.fillStyle = "#2E7459"; ctx.fillRect(14, 32, w - 28, 34);
      ctx.fillStyle = "#FFFFFF"; ctx.fillRect(24, 42, 90, 8); ctx.fillRect(24, 54, 60, 5);
      for (let i = 0; i < 3; i++) { ctx.fillStyle = "#FFFFFF"; ctx.fillRect(14 + i * ((w - 28) / 3), 76, (w - 28) / 3 - 8, 70); ctx.fillStyle = ["#F6D9D2", "#D9EBDD", "#DDE6F4"][i]; ctx.fillRect(20 + i * ((w - 28) / 3), 82, (w - 28) / 3 - 20, 34); ctx.fillStyle = "#C9D0D6"; ctx.fillRect(20 + i * ((w - 28) / 3), 122, 50, 5); }
      ctx.fillStyle = GREEN; ctx.fillRect(14, 156, 70 + (grow % 3) * 8, 16);
      if (blink) { ctx.fillStyle = "#3B78CC"; ctx.fillRect(150 + (grow % 6) * 12, 162, 6, 8); }
      break;
    }
    case "doc": {
      ctx.fillStyle = "#F6FBF8"; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = GREEN; ctx.fillRect(0, 0, w, 26);
      ctx.fillStyle = "#FFFFFF"; ctx.font = `600 15px ${FONT}`; ctx.fillText("문서", 12, 18);
      ctx.fillStyle = "#2C3032"; ctx.fillRect(18, 40, 120, 9);
      const lines = 5 + grow;
      for (let i = 0; i < Math.min(lines, 11); i++) { ctx.fillStyle = i % 4 === 0 ? "#9DB5AA" : "#C9D6CF"; ctx.fillRect(18, 60 + i * 13, (w - 50) * (0.45 + r() * 0.5), 6); }
      if (blink) { ctx.fillStyle = "#2C3032"; ctx.fillRect(18 + (w - 60) * 0.6, 60 + (Math.min(lines, 11) - 1) * 13 - 2, 2, 10); }
      break;
    }
    case "mail": {
      ctx.fillStyle = "#FFFFFF"; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#EEF3F0"; ctx.fillRect(0, 0, 80, h);
      ctx.fillStyle = GREEN; ctx.fillRect(8, 10, 64, 16);
      for (let i = 0; i < 5; i++) { ctx.fillStyle = "#9DB5AA"; ctx.fillRect(10, 40 + i * 16, 40 + r() * 20, 6); }
      for (let i = 0; i < 8; i++) {
        const y = 10 + i * 25;
        ctx.fillStyle = i === grow % 8 ? "#E3F0E9" : "#FFFFFF"; ctx.fillRect(84, y, w - 88, 23);
        ctx.fillStyle = i < 2 ? GREEN : "#8A949B"; ctx.beginPath(); ctx.arc(94, y + 11, 4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#2C3032"; ctx.fillRect(104, y + 5, 60 + r() * 30, 5);
        ctx.fillStyle = "#B9C3C9"; ctx.fillRect(104, y + 14, 110 + r() * 60, 4);
      }
      break;
    }
    case "calendar": {
      ctx.fillStyle = "#FFFFFF"; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = GREEN; ctx.fillRect(0, 0, w, 22);
      const cols = 5, colW = (w - 30) / cols;
      ctx.strokeStyle = "#E3E7E5"; ctx.lineWidth = 1;
      for (let c = 0; c <= cols; c++) { ctx.beginPath(); ctx.moveTo(30 + c * colW, 22); ctx.lineTo(30 + c * colW, h); ctx.stroke(); }
      for (let row = 0; row < 9; row++) { ctx.beginPath(); ctx.moveTo(0, 30 + row * 21); ctx.lineTo(w, 30 + row * 21); ctx.stroke(); ctx.fillStyle = "#B9C3C9"; ctx.fillRect(4, 33 + row * 21, 18, 4); }
      const blocks = ["#CFE3D8", "#F6D9D2", "#DDE6F4", "#FFF1C8"];
      for (let k = 0; k < 7 + (grow % 3); k++) { const c = Math.floor(r() * cols), row = Math.floor(r() * 8); ctx.fillStyle = blocks[k % 4]; ctx.fillRect(32 + c * colW, 31 + row * 21, colW - 4, 19 + Math.floor(r() * 2) * 21); }
      break;
    }
    case "wireframe": {
      ctx.fillStyle = "#FAFAF7"; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#E9E5DA"; ctx.fillRect(0, 0, 54, h);
      for (let i = 0; i < 6; i++) { ctx.fillStyle = "#C9C2B4"; ctx.fillRect(8, 12 + i * 22, 38, 16); }
      // 휴대폰 화면 두 개와 화살표
      for (const [i, x] of [70, 200].entries()) {
        ctx.strokeStyle = "#5B6170"; ctx.lineWidth = 2; ctx.strokeRect(x, 20, 90, 170);
        ctx.fillStyle = "#E58B3A"; ctx.fillRect(x + 8, 30, 74, 14);
        for (let k = 0; k < 4; k++) { ctx.fillStyle = "#D6D2C8"; ctx.fillRect(x + 8, 52 + k * 26, 74, 18); }
        ctx.fillStyle = i === 0 ? GREEN : "#3B78CC"; ctx.fillRect(x + 20, 162, 50, 14);
      }
      ctx.strokeStyle = "#E58B3A"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(165, 100); ctx.lineTo(195, 100); ctx.stroke();
      if (blink) { ctx.strokeStyle = "#3B78CC"; ctx.setLineDash([4, 3]); ctx.strokeRect(205, 50 + (grow % 4) * 26, 80, 22); ctx.setLineDash([]); }
      break;
    }
    case "guide": {
      // 기획자의 UX 점검표: 사용자 안내 초안에 필요한, 놓치기 쉬운 상황(공식 가이드 기반 시나리오).
      ctx.fillStyle = "#FFFDF8"; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#E58B3A"; ctx.fillRect(0, 0, w, 26);
      ctx.fillStyle = "#FFFFFF"; ctx.font = `700 14px ${FONT}`; ctx.fillText("사용자 안내 · 상황 점검", 10, 18);
      const items = ["빈 화면", "오류가 났을 때", "기다리는 동안", "잘못 입력했을 때"];
      items.forEach((label, k) => {
        const y = 48 + k * 38;
        const checked = k < (grow % (items.length + 1));
        ctx.strokeStyle = "#5B6170"; ctx.lineWidth = 2; ctx.strokeRect(12, y - 12, 15, 15);
        if (checked) { ctx.strokeStyle = "#E58B3A"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(15, y - 5); ctx.lineTo(19, y); ctx.lineTo(26, y - 10); ctx.stroke(); }
        ctx.fillStyle = "#2C3032"; ctx.font = `600 14px ${FONT}`; ctx.fillText(label, 36, y + 1);
        ctx.fillStyle = "#D6D2C8"; ctx.fillRect(36, y + 8, 150 + ((seed + k * 37) % 90), 5);
      });
      ctx.fillStyle = "#8A949B"; ctx.font = `500 11px ${FONT}`; ctx.fillText("공식 가이드 기반 시나리오", 12, h - 10);
      if (blink) { ctx.fillStyle = "#3B78CC"; ctx.fillRect(190 + (grow % 3) * 10, 48 + (grow % 4) * 38 - 8, 2, 12); }
      break;
    }
    case "tasks": {
      ctx.fillStyle = "#F6FBF8"; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = GREEN; ctx.fillRect(0, 0, w, 30);
      ctx.fillStyle = "#FFFFFF"; ctx.font = `700 17px ${FONT}`; ctx.fillText("오늘의 과제", 12, 21);
      if (tasks.length === 0) {
        ctx.fillStyle = "#5B6170"; ctx.font = `600 15px ${FONT}`;
        ctx.fillText("아침보고에서", 16, 72); ctx.fillText("오늘 할 일을 정해요", 16, 96);
        if (blink) { ctx.fillStyle = GREEN; ctx.fillRect(16, 112, 10, 3); }
        break;
      }
      tasks.slice(0, 6).forEach((t, i) => {
        const y = 46 + i * 28;
        ctx.strokeStyle = "#4A4F52"; ctx.lineWidth = 2; ctx.strokeRect(14, y - 11, 15, 15);
        if (t.done) { ctx.strokeStyle = GREEN; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(17, y - 4); ctx.lineTo(21, y + 1); ctx.lineTo(28, y - 9); ctx.stroke(); }
        ctx.fillStyle = t.done ? "#8A949B" : "#2C3032";
        ctx.font = `600 14px ${FONT}`;
        const title = t.title.length > 16 ? `${t.title.slice(0, 15)}…` : t.title;
        ctx.fillText(title, 38, y + 1);
        if (t.done) { ctx.fillStyle = "#8A949B"; ctx.fillRect(38, y - 4, Math.min(w - 50, ctx.measureText(title).width), 1.5); }
      });
      break;
    }
  }
}
