"use client";

import { createContext, useContext, useState, useSyncExternalStore } from "react";
import styles from "./site-header.module.css";

type Sidebar = "auto" | "expanded" | "collapsed";
const Preferences = createContext<{dark: boolean; collapsed: boolean; toggleTheme: () => void; toggleSidebar: () => void} | null>(null);
const subscribe = (notify: () => void) => { const media = matchMedia("(max-width: 800px)"); media.addEventListener("change", notify); return () => media.removeEventListener("change", notify); };
const smallScreen = () => matchMedia("(max-width: 800px)").matches;
function save(name: string, value: string) {
  document.cookie = name + "=" + value + "; Path=/; Max-Age=31536000; SameSite=Lax" + (location.protocol === "https:" ? "; Secure" : "");
}

export function UiPreferences({children, initialTheme, initialSidebar}: {children: React.ReactNode; initialTheme: "light" | "dark"; initialSidebar: Sidebar}) {
  const [theme, setTheme] = useState(initialTheme);
  const [sidebar, setSidebar] = useState(initialSidebar);
  const mobile = useSyncExternalStore(subscribe, smallScreen, () => false);
  const collapsed = sidebar === "collapsed" || (sidebar === "auto" && mobile);
  return <Preferences.Provider value={{dark: theme === "dark", collapsed,
    toggleTheme() { const next = theme === "dark" ? "light" : "dark"; setTheme(next); document.documentElement.dataset.theme = next; save("aurore_theme", next); },
    toggleSidebar() { const next = collapsed ? "expanded" : "collapsed"; setSidebar(next); document.documentElement.dataset.sidebar = next; save("aurore_sidebar", next); },
  }}>{children}</Preferences.Provider>;
}

export const useUiPreferences = () => useContext(Preferences)!;

export function PreferenceToggle({kind}: {kind: "theme" | "sidebar"}) {
  const preferences = useUiPreferences();
  const sidebar = kind === "sidebar";
  const label = sidebar ? (preferences.collapsed ? "사이드바 펼치기" : "사이드바 접기") : (preferences.dark ? "라이트 모드" : "다크 모드");
  return <button type="button" className={sidebar ? styles.sidebarToggle : styles.themeToggle} aria-label={label} title={label}
    aria-expanded={sidebar ? !preferences.collapsed : undefined} aria-controls={sidebar ? "site-menu" : undefined}
    aria-pressed={sidebar ? undefined : preferences.dark} onClick={sidebar ? preferences.toggleSidebar : preferences.toggleTheme}>
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {sidebar ? <path d={preferences.collapsed ? "m6 17 5-5-5-5M13 17l5-5-5-5" : "m18 17-5-5 5-5M11 17l-5-5 5-5"}/> : preferences.dark ? <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></> : <path d="M20.5 13.2A8.5 8.5 0 0 1 10.8 3.5 8.5 8.5 0 1 0 20.5 13.2Z"/>}
    </svg>{!sidebar && <span>{label}</span>}
  </button>;
}
