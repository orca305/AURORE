"use server";

import { cookies } from "next/headers";
import { authRequest, currentToken, tokenPattern, trustedOrigin } from "../_auth/session";
import { chatCredential, chatIdPattern, guestCookie, loadChat, loadChatList, requestChat } from "./requests";
import type { ChatDetail, ChatResult } from "./types";

type ExtendedChat = ChatDetail & { authExpiresAt?: string | null };
const invalid = (): ChatResult<ChatDetail> => ({ data: null, error: "요청을 확인할 수 없습니다. 페이지를 다시 열어 주세요.", status: 400 });

async function rememberGuest(token: string, expiresAt: string, secure: boolean) {
  (await cookies()).set(guestCookie, token, {
    httpOnly: true, sameSite: "lax", secure, path: "/", expires: new Date(expiresAt),
  });
}

async function createGuest(secure: boolean) {
  const response = await authRequest("guest", { method: "POST" });
  if (!response?.ok) return null;
  const data = await response.json() as { token: string; expiresAt: string };
  if (!tokenPattern.test(data.token) || !Number.isFinite(Date.parse(data.expiresAt))) return null;
  await rememberGuest(data.token, data.expiresAt, secure);
  return "Guest " + data.token;
}

async function mutation(path: string, body?: object, create = false): Promise<ChatResult<ChatDetail>> {
  const origin = await trustedOrigin();
  if (!origin) return invalid();
  const member = await currentToken();
  let credential = await chatCredential();
  if (!credential && create) credential = await createGuest(origin.protocol === "https:");
  if (!credential) return { data: null, error: "대화 인증을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.", status: 401 };
  const init = { method: "POST", headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) };
  let result = await requestChat<ExtendedChat>(path, credential, init);
  if (result.status === 401 && !member && create) {
    credential = await createGuest(origin.protocol === "https:");
    if (credential) result = await requestChat<ExtendedChat>(path, credential, init);
  }
  if (result.data?.authExpiresAt && credential?.startsWith("Guest ")) {
    await rememberGuest(credential.slice(6), result.data.authExpiresAt, origin.protocol === "https:");
  }
  return result;
}

export async function sendChatMessage(id: string, requestId: string, question: string, revision: number) {
  if (!chatIdPattern.test(id) || !chatIdPattern.test(requestId) ||
    typeof question !== "string" || Array.from(question).length > 1000 || !Number.isInteger(revision) || revision < 0) return invalid();
  return mutation("/chat-sessions/" + id + "/messages", { question, requestId, revision }, true);
}

export async function refreshChat(id: string, beforeSeq?: number) {
  return loadChat(id, beforeSeq);
}

export async function markChatRead(id: string) {
  if (!chatIdPattern.test(id)) return invalid();
  return mutation("/chat-sessions/" + id + "/read");
}

export async function retryChatJob(id: string) {
  if (!chatIdPattern.test(id)) return invalid();
  return mutation("/jobs/" + id + "/retry");
}

export async function cancelChatJob(id: string) {
  if (!chatIdPattern.test(id)) return invalid();
  return mutation("/jobs/" + id + "/cancel");
}

export async function deleteChat(id: string, revision: number) {
  if (!chatIdPattern.test(id) || !Number.isInteger(revision) || revision < 0) return invalid();
  return mutation("/chat-sessions/" + id + "/delete", { revision });
}

export async function moreChats(cursor: string) {
  if (typeof cursor !== "string" || cursor.length > 200) return { data: null, error: "목록 위치를 확인해 주세요.", status: 400 };
  return loadChatList(cursor);
}
