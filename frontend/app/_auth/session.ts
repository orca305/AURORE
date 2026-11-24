import { cookies, headers } from "next/headers";

export async function trustedOrigin() {
  const request = await headers();
  const origin = request.get("origin");
  if (!origin) return null;
  try {
    const url = new URL(origin);
    if (url.host !== request.get("host")) return null;
    if (url.protocol === "https:") return url;
    if (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return url;
  } catch {
    return null;
  }
  return null;
}

export const sessionCookie = "aurore_session";
export const tokenPattern = /^[A-Za-z0-9_-]{43}$/;

export async function authRequest(path: string, init?: RequestInit) {
  const url = new URL("/auth/" + path, process.env.BACKEND_URL || "http://127.0.0.1:3001");
  try {
    return await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(8000) });
  } catch {
    return null;
  }
}

export async function currentToken() {
  const value = (await cookies()).get(sessionCookie)?.value;
  return value && tokenPattern.test(value) ? value : undefined;
}

export async function currentMember(activity = false) {
  const token = await currentToken();
  if (!token) return null;
  const response = await authRequest(activity ? "session/activity" : "session", {
    method: activity ? "POST" : "GET",
    headers: { Authorization: "Bearer " + token },
  });
  if (!response?.ok) return null;
  return await response.json() as { loginId: string; nickname: string };
}

/**
 * 방문자 식별값(접속 주소를 해시한 값). 백엔드가 비회원 대화 시작·질문 횟수를 방문자별로 제한하는 데 쓴다.
 * 터널(Cloudflare)을 거친 요청에만 접속 주소가 있고, 이 PC에서 직접 연 경우는 null 이라 제한하지 않는다.
 */
export async function clientId() {
  const request = await headers();
  const address = request.get("cf-connecting-ip") ?? request.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (!address) return null;
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update("aurore-client:v1:" + address).digest("hex").slice(0, 32);
}
