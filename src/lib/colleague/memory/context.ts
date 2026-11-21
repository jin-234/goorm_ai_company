/** API 요청 하나에 쓸 대화 맥락(참여자·저장소·Solar·사용자 이름). */
import type { NextRequest } from "next/server";
import { SolarClient, solarConfigFromEnv } from "@/lib/solar/client";
import { officeIdOf } from "@/lib/server/http";
import { getStore } from "@/lib/server/store";
import type { Ctx } from "./service";
import { getConversationStore } from "./store";

export async function contextOf(req: NextRequest): Promise<{ ctx: Ctx; officeId: { id: string; isNew: boolean } }> {
  const officeId = officeIdOf(req);
  // 이름·희망 직무는 회사 상태에서 읽기만 한다(시계를 움직이지 않는다).
  const office = officeId.isNew ? null : await getStore().load(officeId.id).catch(() => null);
  const profile = office?.state?.profile;
  return {
    officeId,
    ctx: {
      store: getConversationStore(),
      client: new SolarClient(solarConfigFromEnv()),
      officeId: officeId.id,
      myName: profile?.name,
      targetRole: profile?.targetRole,
    },
  };
}
