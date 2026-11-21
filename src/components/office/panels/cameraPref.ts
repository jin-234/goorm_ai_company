/** '출근 때 카메라 사용' 설정. 기본은 켜짐이고, 이 브라우저에만 기억한다. */
const KEY = "vision.checkInCamera";

export function loadCameraPref(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function saveCameraPref(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    // 저장하지 못하면 이번 화면에서만 적용된다.
  }
}
