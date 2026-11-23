import Link from "next/link";
import type { ReactNode } from "react";

type Props = {
  /** 접근성 이름(예: "용어 검색 페이지") */
  label: string;
  /** 현재 시작 위치(0부터) */
  offset: number;
  /** 한 페이지 개수 */
  limit: number;
  /** 전체 개수를 알면 넘긴다. 끝 페이지(»)와 뒤쪽 번호까지 보여 준다. */
  total?: number | null;
  /** 전체 개수를 모를 때 다음 페이지가 있는지 */
  hasNext?: boolean;
  /** 페이지 주소를 만드는 함수(시작 위치를 받는다). 서버 화면에서 쓴다. */
  href?: (offset: number) => string;
  /** 눌렀을 때 실행하는 함수(시작 위치를 받는다). 화면 안의 패널처럼 주소를 바꾸지 않을 때 쓴다. */
  onGo?: (offset: number) => void;
  disabled?: boolean;
  /** 번호 왼쪽에 붙일 요약(예: "총 200개") */
  summary?: ReactNode;
  /** 페이지가 하나뿐이어도 보여 줄지(기본은 숨김) */
  alwaysShow?: boolean;
  /** 좁은 패널용: 번호 3개, 처음·끝 이동 없음 */
  compact?: boolean;
};

const icons = {
  first: "m11 17-5-5 5-5M18 17l-5-5 5-5",
  prev: "m15 6-6 6 6 6",
  next: "m9 6 6 6-6 6",
  last: "m6 17 5-5-5-5M13 17l5-5-5-5",
} as const;

function Icon({ kind }: { kind: keyof typeof icons }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={icons[kind]} /></svg>;
}

/**
 * 목록 아래 페이지 이동: « ‹ 1 2 3 4 5 › »
 * 전체 개수를 알면 끝 페이지까지, 모르면 알려진 범위(현재 페이지와 다음 페이지 하나)까지만 번호를 보여 준다.
 */
export function Pagination({ label, offset, limit, total = null, hasNext = false, href, onGo, disabled = false, summary, alwaysShow = false, compact = false }: Props) {
  const size = Math.max(1, limit);
  const page = Math.floor(Math.max(0, offset) / size) + 1;
  const knownLast = total !== null && total >= 0 ? Math.max(1, Math.ceil(total / size)) : hasNext ? page + 1 : page;
  const last = Math.max(knownLast, page);
  const exactLast = total !== null && total >= 0;
  if (!alwaysShow && last === 1 && page === 1) return null;
  const span = compact ? 2 : 4;
  const start = Math.max(1, Math.min(page - Math.floor(span / 2), last - span));
  const end = Math.min(last, start + span);
  const numbers = Array.from({ length: end - start + 1 }, (_, index) => start + index);
  const target = (n: number) => (n - 1) * size;

  function item(n: number, content: ReactNode, name: string, enabled: boolean, current = false, className = "") {
    const classes = ["pg", current ? "pg-current" : "", enabled ? "" : "pg-off", className].filter(Boolean).join(" ");
    if (!enabled || current || disabled) return <span key={name} className={classes} aria-current={current ? "page" : undefined} aria-disabled={enabled && !current ? undefined : true} aria-label={name} title={name}>{content}</span>;
    if (onGo) return <button key={name} type="button" className={classes} aria-label={name} title={name} onClick={() => onGo(target(n))}>{content}</button>;
    return <Link key={name} href={href ? href(target(n)) : "#"} prefetch={false} className={classes} aria-label={name} title={name}>{content}</Link>;
  }

  return <nav className={"pagination pager" + (compact ? " pager-compact" : "")} aria-label={label}>
    {summary && <span className="pager-summary">{summary}</span>}
    <span className="pager-items">
      {!compact && item(1, <Icon kind="first" />, "첫 페이지", page > 1)}
      {item(page - 1, <Icon kind="prev" />, "이전 페이지", page > 1)}
      {numbers.map((n) => item(n, String(n), n + "페이지", true, n === page, !compact && Math.abs(n - page) === 2 ? "pg-far" : ""))}
      {item(page + 1, <Icon kind="next" />, "다음 페이지", page < last)}
      {!compact && exactLast && item(last, <Icon kind="last" />, "마지막 페이지", page < last)}
    </span>
  </nav>;
}
