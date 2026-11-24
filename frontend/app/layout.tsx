import { NavigationProgress } from "./_components/navigation-progress";
import { ScrollControls } from "./_components/scroll-controls";
import { cookies } from "next/headers";
import { UiPreferences } from "./_components/ui-preferences";
import { SiteHeader } from "./_components/site-header";
import { ChromeGate } from "./_components/site-active";
import type { Metadata } from "next";
import { IBM_Plex_Sans_KR } from "next/font/google";
import "./globals.css";

// 사이드바 메뉴 이름에만 쓰는 글꼴(본문과 다른 느낌).
const menuFont = IBM_Plex_Sans_KR({ weight: ["400", "500", "600"], subsets: ["latin"], display: "swap", variable: "--font-menu" });

export const metadata: Metadata = {
  title: "AURORE | 법을 이해하는 시작",
  description: "법규 원문을 바탕으로 법을 이해하는 첫걸음. AURORE 법규 검색.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const preferences = await cookies();
  const theme = preferences.get("aurore_theme")?.value === "dark" ? "dark" : "light";
  const savedSidebar = preferences.get("aurore_sidebar")?.value;
  const sidebar = savedSidebar === "collapsed" || savedSidebar === "expanded" ? savedSidebar : "auto";
  const widthText = preferences.get("aurore_sidebar_width")?.value ?? "";
  const width = /^\d{3}$/.test(widthText) && Number(widthText) >= 224 && Number(widthText) <= 480 ? Number(widthText) : null;
  return <html lang="ko" className={menuFont.variable} data-theme={theme} data-sidebar={sidebar} style={width ? ({ "--sidebar-custom": width + "px" } as React.CSSProperties) : undefined}><body><UiPreferences initialTheme={theme} initialSidebar={sidebar}><ChromeGate><SiteHeader /></ChromeGate>{children}<div role="contentinfo" className="site-copyright">© 2026 우정범. All rights reserved.</div><ScrollControls/><NavigationProgress/></UiPreferences></body></html>;
}
