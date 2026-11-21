import type { NextRequest } from "next/server";
import { errorResponse, json, officeIdOf } from "@/lib/server/http";
import { withOffice } from "@/lib/server/session";
import { getStore } from "@/lib/server/store";
import { officeView } from "@/lib/server/view";

export const dynamic = "force-dynamic";

/** 지금 회사 상태. 처음이면 이번 주 월요일 08:55에서 새로 시작한다. 화면은 이 주소를 몇 초마다 불러 시계를 맞춘다. */
export async function GET(req: NextRequest) {
  const officeId = officeIdOf(req);
  try {
    const { office } = await withOffice(officeId.id, () => null);
    return json(officeView(office), { officeId });
  } catch (error) {
    return errorResponse(error);
  }
}

/** 처음부터 다시(모든 기록을 지움). */
export async function DELETE(req: NextRequest) {
  const officeId = officeIdOf(req);
  try {
    await getStore().remove(officeId.id);
    const { office } = await withOffice(officeId.id, () => null);
    return json(officeView(office), { officeId });
  } catch (error) {
    return errorResponse(error);
  }
}
