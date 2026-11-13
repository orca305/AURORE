import { ScrollControls } from "./_components/scroll-controls";
import { cookies } from "next/headers";
import { UiPreferences } from "./_components/ui-preferences";
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AURORE | 법을 이해하는 시작",
  description: "법규 원문을 바탕으로 법을 이해하는 첫걸음. AURORE 법규 검색.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const preferences = await cookies();
  const theme = preferences.get("aurore_theme")?.value === "dark" ? "dark" : "light";
  const savedSidebar = preferences.get("aurore_sidebar")?.value;
  const sidebar = savedSidebar === "collapsed" || savedSidebar === "expanded" ? savedSidebar : "auto";
  return <html lang="ko" data-theme={theme} data-sidebar={sidebar}><body><UiPreferences initialTheme={theme} initialSidebar={sidebar}>{children}<ScrollControls/></UiPreferences></body></html>;
}
