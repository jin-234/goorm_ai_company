import type { NextRequest } from "next/server";
import { BadRequest } from "@/lib/server/actions";
import { errorResponse, json, officeIdOf } from "@/lib/server/http";
import { STT_MAX_BYTES, SttClient, SttError, sttConfigFromEnv } from "@/lib/stt/client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** 음성 인식이 켜져 있는지. 화면은 꺼져 있으면 녹음 버튼 대신 글 입력만 보여 줄 수 있다. */
export async function GET() {
  const config = sttConfigFromEnv();
  return json({ enabled: !!config.apiKey, model: config.model, maxBytes: STT_MAX_BYTES });
}

/**
 * 녹음 → 글. 본문: multipart/form-data, `audio` 파일 하나.
 * 응답: { text, model, seconds }. 녹음은 저장하지 않는다. 글을 전사문에 넣는 일은 화면이 한다.
 * 실패하면 { error: { type: "stt", kind, title, guidance, canRetry, typeOnly } } (502).
 */
export async function POST(req: NextRequest) {
  try {
    // 회사에 들어온 브라우저(쿠키가 있는)만 쓴다. 키가 아무에게나 쓰이지 않게.
    if (officeIdOf(req).isNew) throw new BadRequest("회사 화면을 연 뒤 녹음해 주세요.");
    const length = Number(req.headers.get("content-length"));
    if (Number.isFinite(length) && length > STT_MAX_BYTES + 64 * 1024) throw new SttError("tooLarge");

    let audio: FormDataEntryValue | null;
    try {
      audio = (await req.formData()).get("audio");
    } catch {
      throw new BadRequest("요청 본문은 audio 파일을 담은 form-data여야 합니다.");
    }
    if (!(audio instanceof Blob)) throw new SttError("noAudio");

    const started = Date.now();
    const result = await new SttClient(sttConfigFromEnv()).transcribe(audio);
    const seconds = Math.round((Date.now() - started) / 100) / 10;
    return json({ ...result, seconds });
  } catch (error) {
    return errorResponse(error);
  }
}
