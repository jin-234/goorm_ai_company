/** 아침보고 목표 글에서 쓸 수 있는 시간을 읽는다(서버·화면 모두 쓴다). */

/** 쓸 수 있는 시간만 말하는 문장(과제로 나누지 않는다). */
export const TIME_ONLY = /^(오늘은?\s*)?(약\s*)?\d+(\.\d+)?\s*(시간|분)(\s*정도|\s*쯤)?\s*(쓸|할애할|낼|투자할)\s*수\s*있/;

/** 목표 글에서 쓸 수 있는 시간(분)을 읽는다. "3시간", "1시간 30분", "90분". 없으면 null. */
export function minutesFromGoal(goal: string): number | null {
  const h = goal.match(/(\d+(?:\.\d+)?)\s*시간(?:\s*(\d+)\s*분)?/);
  if (h) return Math.round(Number(h[1]) * 60 + (h[2] ? Number(h[2]) : 0));
  const m = goal.match(/(\d+)\s*분\s*(?:정도|쯤)?\s*(?:쓸|할애|낼|투자)/);
  return m ? Number(m[1]) : null;
}
