import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AURORE | 법을 이해하는 시작",
  description: "법규 원문을 바탕으로 법을 이해하는 첫걸음. AURORE 법규 검색.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="ko"><body>{children}</body></html>;
}
