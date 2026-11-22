// 외부 공개용 접속 코드 보호. AURORE_ACCESS_CODE 가 비어 있으면(로컬 개발) 꺼져 있다.
export const gateCookie = "aurore_gate";

export function gateCode(): string {
  return (process.env.AURORE_ACCESS_CODE ?? "").trim();
}

export const gateEnabled = () => gateCode().length > 0;

/** 쿠키에 넣는 값: 접속 코드로 만든 해시. 코드를 바꾸면 이전 쿠키는 모두 무효가 된다. */
export async function gateToken(code: string): Promise<string> {
  const bytes = new TextEncoder().encode("aurore-gate:v1:" + code);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** 되돌아갈 주소는 같은 사이트 안의 경로만 허용한다(열린 리다이렉트 방지). */
export function safeNext(value: string | null | undefined): string {
  return typeof value === "string" && /^\/(?!\/)[^\\\r\n]*$/.test(value) && !value.startsWith("/gate") ? value : "/";
}

/** 문자열 비교 시간이 내용에 따라 달라지지 않도록 비교한다. */
export function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index++) diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return diff === 0;
}
