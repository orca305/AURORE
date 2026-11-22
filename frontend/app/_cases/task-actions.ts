"use server";
import { revalidatePath } from "next/cache";
import { currentToken, trustedOrigin } from "../_auth/session";
import { requestCase } from "./requests";
import { caseIdPattern } from "./types";

export type TaskActionResult = { error: string | null };

async function post(caseId: string, path: string, body?: object): Promise<TaskActionResult> {
  if (!caseIdPattern.test(caseId)) return { error: "사건을 확인할 수 없습니다." };
  if (!(await trustedOrigin())) return { error: "요청을 확인할 수 없습니다." };
  if (!(await currentToken())) return { error: "다시 로그인해 주세요." };
  const response = await requestCase("/" + caseId + path, { method: "POST", headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (!response) return { error: "처리 결과를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  if (!response.ok) {
    const messages: Record<number, string> = { 400: "할 일은 1~200자로 적어 주세요.", 404: "사건이나 할 일을 찾을 수 없습니다.", 409: "할 일은 최대 20개까지 적을 수 있어요." };
    return { error: messages[response.status] ?? "저장하지 못했습니다. 다시 시도해 주세요." };
  }
  revalidatePath("/cases/" + caseId);
  return { error: null };
}

export async function addCaseTask(caseId: string, text: string) {
  if (typeof text !== "string" || !text.trim() || Array.from(text).length > 200) return { error: "할 일은 1~200자로 적어 주세요." };
  return post(caseId, "/tasks", { text });
}
export async function toggleCaseTask(caseId: string, taskId: string, done: boolean) {
  if (!/^[1-9]\d{0,17}$/.test(taskId) || typeof done !== "boolean") return { error: "할 일을 확인할 수 없습니다." };
  return post(caseId, "/tasks/" + taskId + "/update", { done });
}
export async function deleteCaseTask(caseId: string, taskId: string) {
  if (!/^[1-9]\d{0,17}$/.test(taskId)) return { error: "할 일을 확인할 수 없습니다." };
  return post(caseId, "/tasks/" + taskId + "/delete");
}
