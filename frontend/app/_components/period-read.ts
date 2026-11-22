/** 쿼리 문자열의 from/to 를 달력 형식(YYYY-MM-DD)일 때만 받는다. 서버 화면에서 쓴다. */
export function readPeriod(value: string | string[] | undefined): string {
  const text = typeof value === "string" ? value : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}
