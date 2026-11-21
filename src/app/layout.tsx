import "./globals.css";

export const metadata = {
  title: "VISION COMPANY",
  description: "스스로 정한 취업 준비를 실제 업무처럼 수행하는 가상회사",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
