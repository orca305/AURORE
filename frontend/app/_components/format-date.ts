const parts = new Intl.DateTimeFormat("ko-KR", { year: "2-digit", month: "2-digit", day: "2-digit", timeZone: "Asia/Seoul" });

/** 26.11.13 처럼 연도를 포함한 짧은 날짜. 목록과 카드에서 쓴다. */
export function shortDate(value: string | Date | null | undefined): string {
  if (!value) return "-";
  const time = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(time.getTime())) return "-";
  const map = Object.fromEntries(parts.formatToParts(time).map((part) => [part.type, part.value]));
  return `${map.year}.${map.month}.${map.day}`;
}

/** 2025-06-12 같은 날짜 문자열을 25.06.12 로 줄인다. 형식이 다르면 그대로 돌려준다. */
export function shortDay(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? `${match[1].slice(2)}.${match[2]}.${match[3]}` : value;
}
