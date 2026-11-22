"use client";
import { useState } from "react";

const presets = [
  ["all", "전체 기간"],
  ["today", "오늘"],
  ["7d", "7일"],
  ["1m", "1개월"],
  ["1y", "1년"],
  ["custom", "직접 입력"],
] as const;

const seoulDay = (offsetDays = 0) => {
  const time = new Date(Date.now() - offsetDays * 86400000);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(time);
  return parts; // YYYY-MM-DD
};

/**
 * 기간 검색(검색 영역 안의 둘째 줄). 빠른 선택을 고르면 시작일·종료일이 채워지고,
 * "직접 입력"이나 날짜 칸을 만지면 그 날짜가 그대로 쓰인다. 값은 from/to 로 전달된다.
 */
export function PeriodFields({ from = "", to = "" }: { from?: string; to?: string }) {
  const [start, setStart] = useState(from);
  const [end, setEnd] = useState(to);
  const [preset, setPreset] = useState<string>(from || to ? "custom" : "all");
  function choose(value: string) {
    setPreset(value);
    if (value === "all") { setStart(""); setEnd(""); }
    else if (value === "today") { setStart(seoulDay(0)); setEnd(seoulDay(0)); }
    else if (value === "7d") { setStart(seoulDay(6)); setEnd(seoulDay(0)); }
    else if (value === "1m") { setStart(seoulDay(30)); setEnd(seoulDay(0)); }
    else if (value === "1y") { setStart(seoulDay(365)); setEnd(seoulDay(0)); }
  }
  const reversed = Boolean(start && end && start > end);
  return <div className="period-row">
    <select aria-label="기간" value={preset} onChange={event => choose(event.target.value)}>
      {presets.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select>
    <input type="date" name="from" aria-label="시작일" value={start} max={end || undefined} onChange={event => { setStart(event.target.value); setPreset("custom"); }} />
    <span aria-hidden="true">~</span>
    <input type="date" name="to" aria-label="종료일" value={end} min={start || undefined} onChange={event => { setEnd(event.target.value); setPreset("custom"); }} />
    {reversed && <span role="alert">시작일이 종료일보다 늦어요.</span>}
  </div>;
}
