"use client";
import { useState } from "react";
import { pageSizes } from "./page-size";
export function PageSizeSelect({ value, disabled = false, onChange }: { value: number; disabled?: boolean; onChange?: (size: number) => void }) {
  const [navigating, setNavigating] = useState(false);
  return <label className="page-size">페이지당 <select aria-label="페이지당 조회 개수" value={value} disabled={disabled || navigating} onChange={event => {
    const size = Number(event.target.value);
    if (onChange) { onChange(size); return; }
    const url = new URL(window.location.href);
    url.searchParams.set("limit", String(size));
    for (const key of ["offset", "pickerOffset", "historyOffset", "chatOffset", "cursor"]) url.searchParams.delete(key);
    setNavigating(true);
    window.location.assign(url.pathname + url.search + url.hash);
  }}>{pageSizes.map(size => <option key={size} value={size}>{size}개</option>)}</select></label>;
}
