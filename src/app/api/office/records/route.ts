import type { NextRequest } from "next/server";
import { recordsPayloadOf } from "@/lib/records/records";
import { errorResponse, json, officeIdOf } from "@/lib/server/http";
import { withOffice } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/**
 * 기록 내보내기에 쓸 활동일 목록(출근한 날 + 오늘). 결과물·회의실 질문까지 담아 화면 상태(officeView)보다 크므로 따로 부른다.
 * 어느 날짜·항목을 PDF·엑셀에 넣을지는 화면에서 사용자가 고른다.
 */
export async function GET(req: NextRequest) {
  const officeId = officeIdOf(req);
  try {
    const { office } = await withOffice(officeId.id, () => null);
    return json(recordsPayloadOf(office), { officeId });
  } catch (error) {
    return errorResponse(error);
  }
}
