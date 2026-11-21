#!/bin/zsh
# Upstage Solar 실제 응답을 터미널에서 확인한다(앱을 띄우지 않고).
#
#   scripts/solar-check.sh                기획서 예시 PT로 체크리스트와 주간보고 답장 확인
#   scripts/solar-check.sh "전사문 …"     직접 넣은 전사문으로 확인
#
# 키는 환경변수 UPSTAGE_API_KEY, 또는 mac-app/.env, 또는
# ~/Library/Application Support/AIBossOffice/.env 에서 읽는다.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
swift run --package-path "$ROOT/Packages/OfficeKit" --scratch-path "$HOME/Library/Caches/AIBossOffice/officekit" solar-check "$@"
