#!/bin/zsh
# 시연 영상 녹화: 시험용 앱을 뒤에서 띄워 자동 대본대로 하루를 진행하며 그 창만 녹화한다.
# 사용법 (mac-app 폴더에서): scripts/demo/record-demo.sh <출력.mp4>
# 필요: ffmpeg, 화면 기록 권한(터미널). 사용 중인 앱과 기록은 건드리지 않는다.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${1:-$ROOT/../공유/AI 상사 가상회사 시연.mp4}"
WORK="$HOME/Library/Caches/AIBossOffice/demo"
mkdir -p "$WORK"
AIBOSS_APP_DIR="$WORK/app" "$ROOT/scripts/build-app.sh" > /dev/null
swiftc -O -parse-as-library "$ROOT/scripts/demo/winrec.swift" -o "$WORK/winrec"
SCRIPT="wait 2;say AI 상사 가상회사/나를 뺀 팀장과 동기는 모두 AI입니다;wait 4;onboard;say 출근: 카메라 앞에 앉아 출근하기;wait 4;checkin;say 문이 열리고 내 캐릭터가 걸어 들어갑니다;wait 6;say 아침 PT: 부장·팀장·과장·대리가 회의실에 모입니다;wait 9;panel meeting;say 3단계부터 1단계 순서로 오늘 할 일을 말합니다;wait 4;transcript;wait 3;draft;say 말한 내용으로 업무 초안을 만들고 고친 뒤 확정합니다;wait 5;confirm;wait 2;close;say 회의가 끝나면 모두 자리로 돌아갑니다;wait 8;panel desk;say 내 책상: 체크리스트와 결과물·착석 상태;wait 4;done 1;wait 3;close;away 물 마시러 자리 비웁니다;say 자리 비움 15분: 사유에 맞는 곳으로 갑니다;wait 10;back;wait 6;org;say 조직도: 부장부터 사원까지 8명;wait 5;orgclose;skip;skip;skip;say 시연: 다음 정각으로 시각을 앞으로 보냅니다;wait 3;lunch;say 점심은 사내 메일로 요청하면 1시간;wait 7;skip;skip;skip;skip;skip;skip;skip;wait 2;say 18:00 퇴근 점검: 1단계는 이월 보고, 2·3단계는 추가근무;wait 6;checkout;close;say 동료들은 그날 일정대로 퇴근하거나 야근합니다;wait 6;skip;wait 3;skip;skip;skip;wait 2;say 22:00 추가근무 종료: 남은 업무는 다음 근무일로;wait 4;overtimereview;wait 3;friday;say 금요일: 주간보고서를 직접 써서 올립니다;checkin;wait 8;transcript;draft;confirm;close;wait 3;panel weekly;say 금요일 주간 회의: 부장·팀장에게 이번 주를 보고합니다;wait 13;weeklyfill;wait 4;weeklysubmit;wait 1;weeklyfallback;mailfeedback;say 팀장이 이번 주에 해낸 일을 짚어 답장합니다;wait 7"
rm -rf "$WORK/support"
AIBOSS_BACKGROUND=1 AIBOSS_SUPPORT_DIR="$WORK/support" AIBOSS_NO_CAMERA=1 AIBOSS_SCRIPT="$SCRIPT" AIBOSS_QUIT=1 \
  "$WORK/app/AI 상사 가상회사.app/Contents/MacOS/AIBossOffice" > "$WORK/app.log" 2>&1 &
PID=$!
"$WORK/winrec" $PID 400 "$WORK/raw.mov"
kill $PID 2>/dev/null || true
ffmpeg -v error -y -i "$WORK/raw.mov" -vf "scale=1920:-2,fps=30" -c:v libx264 -preset slow -crf 22 -pix_fmt yuv420p -movflags +faststart -an "$OUT"
rm -f "$WORK/raw.mov"
echo "완료: $OUT"
