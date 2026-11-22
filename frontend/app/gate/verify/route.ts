import { NextResponse, type NextRequest } from "next/server";
import { gateCode, gateCookie, gateToken, safeNext, sameText } from "../../_gate/gate";

// 접속 코드 입력 시도를 접속 주소(IP)별로 제한한다. 이 프로세스 안에서만 세는 간단한 방식이다.
const attempts = new Map<string, { count: number; since: number }>();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILS = 8;

function clientKey(request: NextRequest) {
  return request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
}

/** 이동 주소는 상대 경로로 돌려준다(터널 뒤에서는 request.url 이 내부 주소 localhost 로 보이기 때문). */
function goTo(path: string) {
  return new NextResponse(null, { status: 303, headers: { Location: path, "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const code = gateCode();
  const form = await request.formData().catch(() => null);
  const next = safeNext(typeof form?.get("next") === "string" ? (form!.get("next") as string) : null);
  const back = (error: string) => {
    const query = new URLSearchParams({ error });
    if (next !== "/") query.set("next", next);
    return goTo("/gate?" + query);
  };
  if (!code) return goTo(next);

  const key = clientKey(request);
  const now = Date.now();
  const entry = attempts.get(key);
  if (entry && now - entry.since > WINDOW_MS) attempts.delete(key);
  const current = attempts.get(key);
  if (current && current.count >= MAX_FAILS) return back("locked");

  const given = typeof form?.get("code") === "string" ? (form!.get("code") as string).trim() : "";
  if (!given || !sameText(await gateToken(given), await gateToken(code))) {
    attempts.set(key, { count: (current?.count ?? 0) + 1, since: current?.since ?? now });
    return back("wrong");
  }
  attempts.delete(key);
  const response = goTo(next);
  response.cookies.set(gateCookie, await gateToken(code), {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:" || request.headers.get("x-forwarded-proto") === "https" || request.headers.has("cf-visitor"),
    path: "/",
    maxAge: 60 * 60 * 24 * 14,
  });
  return response;
}
