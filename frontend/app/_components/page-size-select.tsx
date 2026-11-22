"use client";
import { useState } from "react";
import { pageSizes } from "./page-size";

const pageKeys = ["offset", "pickerOffset", "historyOffset", "chatOffset", "cursor", "page"];

/**
 * 목록 위쪽의 "정렬 + 페이지당 개수" 선택. 바꾸면 주소의 sort/limit 만 바꿔 다시 열고 나머지 검색 조건은 그대로 둔다.
 * sort 를 넘기면 정렬 선택(최신순·과거순)이 함께 나온다.
 */
export function PageSizeSelect({ value, disabled = false, onChange, sort, sortBasis }: { value: number; disabled?: boolean; onChange?: (size: number) => void; sort?: string; sortBasis?: string }) {
  const [navigating, setNavigating] = useState(false);
  function go(change: (url: URL) => void) {
    const url = new URL(window.location.href);
    change(url);
    for (const key of pageKeys) url.searchParams.delete(key);
    setNavigating(true);
    window.location.assign(url.pathname + url.search + url.hash);
  }
  return <span className="list-controls">
    {sort !== undefined && <select className="sort-select" aria-label={sortBasis ? sortBasis + " 정렬" : "정렬"} title={sortBasis ? sortBasis + " 기준 정렬" : undefined} value={sort === "oldest" ? "oldest" : "newest"} disabled={disabled || navigating} onChange={event => go(url => url.searchParams.set("sort", event.target.value))}>
      <option value="newest">최신순</option><option value="oldest">과거순</option>
    </select>}
    <label className="page-size"><select aria-label="페이지당 조회 개수" value={value} disabled={disabled || navigating} onChange={event => {
      const size = Number(event.target.value);
      if (onChange) { onChange(size); return; }
      go(url => url.searchParams.set("limit", String(size)));
    }}>{pageSizes.map(size => <option key={size} value={size}>{size}개</option>)}</select></label>
  </span>;
}
