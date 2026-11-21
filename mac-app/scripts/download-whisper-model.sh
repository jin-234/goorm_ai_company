#!/bin/bash
# Whisper 모델과 말소리 구간 감지 모델을 내려받는다.
#
#   scripts/download-whisper-model.sh            small + 말소리 구간 감지 모델
#   scripts/download-whisper-model.sh base       base + 말소리 구간 감지 모델
#   scripts/download-whisper-model.sh all        small, base + 말소리 구간 감지 모델
#
# 놓는 곳: ~/Library/Application Support/AIBossOffice/models/
# 프로젝트 폴더는 iCloud로 올라갈 수 있어 그 안에는 모델을 두지 않는다.
# 앱도 같은 폴더를 읽으므로, 시연 전에 이 스크립트로 받아 두면 앱에서 다시 받지 않는다.
set -euo pipefail

DIR="$HOME/Library/Application Support/AIBossOffice/models"
WHISPER_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main"
VAD_URL="https://huggingface.co/ggml-org/whisper-vad/resolve/main"

# 이름 → 파일 크기(바이트). 덜 받은 파일을 가려내는 데 쓴다.
size_of() {
  case "$1" in
    ggml-small.bin) echo 487601967 ;;
    ggml-base.bin) echo 147951465 ;;
    ggml-silero-v6.2.0.bin) echo 885098 ;;
    *) echo 0 ;;
  esac
}

usage() {
  sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'
}

case "${1:-small}" in
  small) WANT=(ggml-small.bin) ;;
  base) WANT=(ggml-base.bin) ;;
  all) WANT=(ggml-small.bin ggml-base.bin) ;;
  -h|--help) usage; exit 0 ;;
  *) echo "모델 이름은 small, base, all 가운데 하나입니다: $1" >&2; usage >&2; exit 2 ;;
esac
WANT+=(ggml-silero-v6.2.0.bin)

mkdir -p "$DIR"

# 온전한 모델 파일인지: 크기가 같고 앞 4바이트가 ggml 표시("lmgg")인지 본다.
is_complete() {
  local file="$1" expected="$2"
  [ -f "$file" ] || return 1
  [ "$(stat -f %z "$file")" = "$expected" ] || return 1
  [ "$(head -c 4 "$file")" = "lmgg" ] || return 1
}

for name in "${WANT[@]}"; do
  target="$DIR/$name"
  expected="$(size_of "$name")"
  if is_complete "$target" "$expected"; then
    echo "[$name] 이미 있습니다."
    continue
  fi
  case "$name" in
    ggml-silero-*) url="$VAD_URL/$name" ;;
    *) url="$WHISPER_URL/$name" ;;
  esac
  if [ "$expected" -ge 1000000 ]; then shown="$((expected / 1000000))MB"; else shown="$((expected / 1000))KB"; fi
  echo "[$name] 내려받는 중 ($shown)"
  # 끊기면 이어 받는다(-C -). 다 받아 확인하기 전까지는 .part 이름으로 둔다.
  if ! curl -L --fail --retry 3 --retry-delay 2 -C - --progress-bar -o "$target.part" "$url"; then
    echo "[$name] 내려받지 못했습니다. 네트워크를 확인한 뒤 다시 실행해 주세요. 받은 데까지는 남겨 두고 다음에 이어 받습니다." >&2
    exit 1
  fi
  if ! is_complete "$target.part" "$expected"; then
    rm -f "$target.part"
    echo "[$name] 받은 파일이 온전하지 않아 지웠습니다. 다시 실행해 주세요." >&2
    exit 1
  fi
  mv -f "$target.part" "$target"
  echo "[$name] 완료"
done

echo "모델 폴더: $DIR"
ls -lh "$DIR" | sed 1d
