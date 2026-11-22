import { cookies } from "next/headers";
import { currentToken, tokenPattern } from "../_auth/session";
import type { ChatDetail, ChatList, ChatResult } from "./types";

export const guestCookie = "aurore_guest";
export const chatIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function chatCredential() {
  const member = await currentToken();
  if (member) return "Bearer " + member;
  const guest = (await cookies()).get(guestCookie)?.value;
  return guest && tokenPattern.test(guest) ? "Guest " + guest : null;
}

export async function requestChat<T>(path: string, credential: string, init?: RequestInit): Promise<ChatResult<T>> {
  try {
    const response = await fetch(new URL(path, process.env.BACKEND_URL || "http://127.0.0.1:3001"), {
      ...init, headers: { ...init?.headers, Authorization: credential },
      cache: "no-store", signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      const messages: Record<number, string> = {
        400: "입력한 내용을 확인해 주세요.",
        401: "인증이 만료되었습니다. 회원은 다시 로그인하고, 비회원은 새 대화를 시작해 주세요.",
        404: "대화를 찾을 수 없습니다. 삭제되었거나 보관 기간이 지났을 수 있습니다.",
        409: "다른 화면에서 대화가 변경됐거나 답변이 진행 중입니다. 최신 내용을 다시 확인해 주세요.",
        429: "요청이 많습니다. 잠시 후 다시 시도해 주세요.",
      };
      return { data: null, error: messages[response.status] ?? "대화를 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.", status: response.status };
    }
    return { data: response.status === 204 ? null : await response.json() as T, error: null, status: response.status };
  } catch {
    return { data: null, error: "대화 서버에 연결할 수 없습니다. 다시 시도해 주세요.", status: 503 };
  }
}

export async function loadChat(id: string, beforeSeq?: number) {
  if (!chatIdPattern.test(id)) return { data: null, error: "대화를 찾을 수 없습니다.", status: 404 };
  const credential = await chatCredential();
  if (!credential) return { data: null, error: "이 대화를 열 수 있는 인증이 없습니다.", status: 401 };
  return requestChat<ChatDetail>("/chat-sessions/" + id + (beforeSeq ? "?beforeSeq=" + beforeSeq : ""), credential);
}

export type ChatFilter = { q?: string; from?: string; to?: string };

export async function loadChatList(cursor?: string, limit = 20, filter: ChatFilter = {}): Promise<ChatResult<ChatList>> {
  const credential = await chatCredential();
  if (!credential) return { data: { items: [], nextCursor: null }, error: null, status: 200 };
  return requestChat<ChatList>("/chat-sessions?" + new URLSearchParams({ limit: String(limit), ...(cursor ? { cursor } : {}), ...(filter.q ? { q: filter.q } : {}), ...(filter.from ? { from: filter.from } : {}), ...(filter.to ? { to: filter.to } : {}) }), credential);
}
