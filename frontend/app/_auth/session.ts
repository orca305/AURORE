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
