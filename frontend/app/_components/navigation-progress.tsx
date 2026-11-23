"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 링크를 누르면 화면 맨 위에 진행 표시줄을 바로 보여 준다.
 * 다음 화면이 서버에서 오기 전까지 아무 변화가 없어 "눌렀는데 반응이 없다"고 느껴지는 것을 막는다.
 * 주소가 실제로 바뀌면(또는 15초가 지나면) 사라진다.
 */
export function NavigationProgress() {
  const [active, setActive] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    const stop = () => {
      window.clearInterval(timer.current);
      setActive(false);
    };
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a");
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      let url: URL;
      try { url = new URL(anchor.href, window.location.href); } catch { return; }
      const here = window.location.pathname + window.location.search;
      if (url.origin !== window.location.origin || url.pathname + url.search === here) return;
      const started = Date.now();
      setActive(true);
      window.clearInterval(timer.current);
      timer.current = window.setInterval(() => {
        if (window.location.pathname + window.location.search !== here || Date.now() - started > 15000) stop();
      }, 80);
    };
    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", stop);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", stop);
      window.clearInterval(timer.current);
    };
  }, []);
  return active ? <div className="nav-progress" role="progressbar" aria-label="이동 중" /> : null;
}
