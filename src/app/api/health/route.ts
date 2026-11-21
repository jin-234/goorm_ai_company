import { storeKind } from "@/lib/server/store";
import { json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** 배포 확인용. 저장소 종류와 Solar 키 유무만 알려 준다. */
export async function GET() {
  return json({ ok: true, store: storeKind(), solar: !!process.env.UPSTAGE_API_KEY?.trim() });
}
