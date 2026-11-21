// 출근 카메라 얼굴 검출(MediaPipe)의 wasm 실행 파일을 node_modules에서 public/으로 복사한다.
// 외부 CDN에 의존하지 않으려고 같은 사이트에서 내려보낸다. 15MB라 git에는 넣지 않고 dev·build 직전에 복사한다.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const from = join(root, "node_modules/@mediapipe/tasks-vision/wasm");
const to = join(root, "public/mediapipe/wasm");
const files = ["vision_wasm_internal.js", "vision_wasm_internal.wasm"];

if (!existsSync(from)) {
  console.warn("[mediapipe] node_modules에 @mediapipe/tasks-vision이 없어 wasm을 복사하지 않았습니다. npm install 뒤 다시 실행하세요.");
  process.exit(0);
}
mkdirSync(to, { recursive: true });
for (const f of files) copyFileSync(join(from, f), join(to, f));
console.log(`[mediapipe] wasm ${files.length}개를 public/mediapipe/wasm에 복사했습니다.`);
