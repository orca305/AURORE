import { NextResponse, type NextRequest } from "next/server";
import { gateCookie, gateCode, gateToken, sameText } from "./app/_gate/gate";

/**
 * 외부 공개 시 접속 코드를 입력한 브라우저만 들어오게 한다. AURORE_ACCESS_CODE 가 없거나, 이 컴퓨터에서 localhost 로 직접 열면 막지 않는다.
 * 개발용 화면(/dev)은 공개 중에는 열지 않고, 검색 엔진에는 노출하지 않도록 헤더를 붙인다.
 */
export async function proxy(request: NextRequest) {
  const code = gateCode();
  if (!code) return NextResponse.next();
  // 이 컴퓨터에서 직접(localhost) 여는 경우는 터널을 거치지 않았으므로 코드 없이 열어 둔다.
  // 터널(Cloudflare)을 거친 요청은 공개 주소 Host 와 cf-* 헤더가 붙어 여기에 해당하지 않는다.
  const host = (request.headers.get("host") ?? "").split(":")[0];
  const viaTunnel = request.headers.has("cf-connecting-ip") || request.headers.has("cf-ray") || request.headers.has("cdn-loop");
  if (!viaTunnel && ["localhost", "127.0.0.1", "[::1]"].includes(host)) return NextResponse.next();
  const { pathname, search } = request.nextUrl;
  if (pathname === "/dev" || pathname.startsWith("/dev/")) return new NextResponse("Not Found", { status: 404, headers: { "X-Robots-Tag": "noindex, nofollow" } });
  const token = request.cookies.get(gateCookie)?.value ?? "";
  if (token && sameText(token, await gateToken(code))) {
    const response = NextResponse.next();
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
    return response;
  }
  const target = new URL("/gate", request.url);
  if (pathname !== "/") target.searchParams.set("next", pathname + search);
  const response = NextResponse.redirect(target);
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|brand/|favicon.ico|icon.svg|apple-icon.png|gate).*)"],
};
