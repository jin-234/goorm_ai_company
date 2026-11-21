#!/bin/zsh
# 맥 앱(AI 상사 가상회사.app)을 빌드한다.
#
# 사용법 (mac-app 폴더에서):
#   scripts/build-app.sh            릴리스로 빌드해 build/AI 상사 가상회사.app 을 만든다
#   scripts/build-app.sh --open     빌드 후 바로 실행한다
#   scripts/build-app.sh --debug    디버그로 빌드한다(빠름)
#   scripts/build-app.sh --universal  인텔·애플 실리콘 겸용(친구에게 보낼 때)
#   scripts/build-app.sh --share    겸용으로 빌드하고 공유용 zip(안내문 포함)을 만든다
#
# 바탕화면 같은 iCloud 동기화 폴더에 빌드 산출물이 쌓이지 않도록
# 중간 산출물은 ~/Library/Caches/AIBossOffice/App 에 둔다.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG=release
OPEN=0
ARCHS=()
SHARE=0
for arg in "$@"; do
  case "$arg" in
    --debug) CONFIG=debug ;;
    --open) OPEN=1 ;;
    --universal) ARCHS=(--arch arm64 --arch x86_64) ;;
    --share) ARCHS=(--arch arm64 --arch x86_64); SHARE=1 ;;
  esac
done

SCRATCH="$HOME/Library/Caches/AIBossOffice/App"
[ ${#ARCHS[@]} -gt 0 ] && SCRATCH="$HOME/Library/Caches/AIBossOffice/App-universal"
APP_NAME="AI 상사 가상회사"
OUT="${AIBOSS_APP_DIR:-$HOME/Library/Caches/AIBossOffice/build}"
APP="$OUT/$APP_NAME.app"

echo "· 빌드 ($CONFIG)"
swift build --package-path "$ROOT/App" --scratch-path "$SCRATCH" -c "$CONFIG" "${ARCHS[@]}" 2>&1 | grep -E "error|Compiling|Build complete" || true
BIN_DIR="$(swift build --package-path "$ROOT/App" --scratch-path "$SCRATCH" -c "$CONFIG" "${ARCHS[@]}" --show-bin-path)"
[ -x "$BIN_DIR/AIBossOffice" ] || { echo "빌드에 실패했습니다."; exit 1; }

echo "· 앱 꾸러미 만들기"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Frameworks" "$APP/Contents/Resources"
cp "$ROOT/App/Resources/Info.plist" "$APP/Contents/Info.plist"
cp "$BIN_DIR/AIBossOffice" "$APP/Contents/MacOS/AIBossOffice"

# whisper.cpp 프레임워크를 앱 안에 넣는다.
# xcframework 안의 맥용 조각(macos-…)을 고른다. 다른 플랫폼 조각을 넣으면 실행하자마자 꺼진다.
FRAMEWORK="$(find "$SCRATCH/artifacts" -path "*whisper.xcframework/macos-*/whisper.framework" -type d -prune 2>/dev/null | head -1)"
[ -n "$FRAMEWORK" ] || { echo "맥용 whisper.framework 를 찾지 못했습니다."; exit 1; }
ditto "$FRAMEWORK" "$APP/Contents/Frameworks/whisper.framework"
install_name_tool -add_rpath "@executable_path/../Frameworks" "$APP/Contents/MacOS/AIBossOffice" 2>/dev/null || true

# 꾸러미 리소스(있으면)
for bundle in "$BIN_DIR"/*.bundle(N); do
  cp -R "$bundle" "$APP/Contents/Resources/"
done

echo "· 서명(이 맥에서 실행용 임시 서명)"
codesign --force --deep --sign - "$APP" >/dev/null

echo "완료: $APP ($(lipo -archs "$APP/Contents/MacOS/AIBossOffice"))"

if [ "$SHARE" = 1 ]; then
  SHARE_DIR="$ROOT/../공유"
  STAGE="$(mktemp -d)"
  mkdir -p "$SHARE_DIR"
  ditto "$APP" "$STAGE/AI 상사 가상회사/$APP_NAME.app"
  cp "$ROOT/scripts/처음 여는 법.txt" "$STAGE/AI 상사 가상회사/"
  rm -f "$SHARE_DIR/AI 상사 가상회사.zip"
  (cd "$STAGE" && ditto -c -k --sequesterRsrc --keepParent "AI 상사 가상회사" "$SHARE_DIR/AI 상사 가상회사.zip")
  rm -rf "$STAGE"
  echo "공유용: $SHARE_DIR/AI 상사 가상회사.zip"
fi
if [ "$OPEN" = 1 ]; then open "$APP"; fi
