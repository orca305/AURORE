"use client";
import { useState } from "react";

/**
 * 기간 검색: 시작일 ~ 종료일 두 칸. 검색 줄 안에 함께 놓이고, 값은 from/to 로 전달된다.
 */
export function PeriodFields({ from = "", to = "" }: { from?: string; to?: string }) {
  const [start, setStart] = useState(from);
  const [end, setEnd] = useState(to);
  const reversed = Boolean(start && end && start > end);
  return <div className="period-row">
    <input type="date" name="from" aria-label="시작일" value={start} max={end || undefined} onChange={event => { setStart(event.target.value);  }} />
    <span aria-hidden="true">~</span>
    <input type="date" name="to" aria-label="종료일" value={end} min={start || undefined} onChange={event => { setEnd(event.target.value);  }} />
    {reversed && <span role="alert">시작일이 종료일보다 늦어요.</span>}
  </div>;
}
