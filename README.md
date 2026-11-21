# AI 상사 가상회사

구직 공백기 청년이 스스로 정한 취업 준비를 실제 업무처럼 수행하도록 돕는 가상회사 서비스.
출근 → 아침 PT(업무 확정) → 근무 → 18:00 퇴근 점검 → 추가근무·이월 → 금요일 주간보고.

- 배포: Vercel (Next.js, API 라우트 = Vercel 함수)
- 저장: Supabase Postgres (`DATABASE_URL` 또는 `POSTGRES_URL`, 없으면 메모리)
- AI: Upstage Solar (`UPSTAGE_API_KEY`, 없으면 서버 안 규칙과 기본 답장)

## 실행

```bash
npm install
cp .env.example .env.local   # 키는 비워 둬도 동작
npm run dev                  # http://localhost:3000
npm test                     # 시험 94개
```

## 문서

- [백엔드 개발 계획 (Vercel 배포판)](docs/backend/개발계획_Vercel.md)
- [API (프론트엔드용)](docs/backend/API.md)
- [데이터 모델](docs/backend/데이터모델.md)
- [현직자 피드백](docs/feedback/현직자_피드백.md)
- [Git 협업 규칙](CONTRIBUTING.md)
