"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./site-header.module.css";

const MIN = 224;
const MAX = 480;
const DEFAULT = 272; // 17rem
const clamp = (value: number) => Math.min(MAX, Math.max(MIN, Math.round(value)));

function remember(width: number | null) {
  document.cookie = "aurore_sidebar_width=" + (width ?? "") + "; Path=/; Max-Age=" + (width === null ? 0 : 31536000) + "; SameSite=Lax" + (location.protocol === "https:" ? "; Secure" : "");
}

/** 사이드바 오른쪽 가장자리를 잡아 끌어 폭을 바꾼다(더블 클릭하면 기본 폭, 방향키로도 조절). 정한 폭은 쿠키로 기억한다. */
export function SidebarResizer({ initial }: { initial: number | null }) {
  const [width, setWidth] = useState(initial ?? DEFAULT);
  const [dragging, setDragging] = useState(false);
  const live = useRef(width);

  function apply(next: number, save: boolean) {
    const value = clamp(next);
    live.current = value;
    setWidth(value);
    document.documentElement.style.setProperty("--sidebar-custom", value + "px");
    if (save) remember(value);
  }

  useEffect(() => {
    if (!dragging) return;
    const move = (event: PointerEvent) => apply(event.clientX, false);
    const stop = () => { setDragging(false); remember(live.current); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, [dragging]);

  return <button
    type="button"
    role="separator"
    aria-orientation="vertical"
    aria-label="사이드바 너비 조절"
    aria-valuemin={MIN}
    aria-valuemax={MAX}
    aria-valuenow={width}
    title="끌어서 너비 조절 · 더블 클릭하면 기본 너비"
    className={styles.resizer}
    data-dragging={dragging}
    onPointerDown={(event) => { event.preventDefault(); setDragging(true); }}
    onDoubleClick={() => { live.current = DEFAULT; setWidth(DEFAULT); document.documentElement.style.removeProperty("--sidebar-custom"); remember(null); }}
    onKeyDown={(event) => {
      if (event.key === "ArrowLeft") { event.preventDefault(); apply(width - 16, true); }
      if (event.key === "ArrowRight") { event.preventDefault(); apply(width + 16, true); }
    }}
  />;
}
