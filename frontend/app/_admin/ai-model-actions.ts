"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { currentToken, trustedOrigin } from "../_auth/session";

export type AiModelActionState = { error: string } | null;

/** AI 답변 모델 교체/롤백. 허용 목록 검사와 AI 서버 반영은 백엔드가 한다. 사유와 확인 체크를 요구한다. */
async function post(path: "ai-model" | "ai-model/rollback", body: Record<string, unknown>): Promise<AiModelActionState> {
  if (!(await trustedOrigin())) return { error: "요청을 확인할 수 없습니다." };
  const token = await currentToken();
  if (!token) redirect("/login");
  let response: Response;
  try {
    response = await fetch(new URL("/admin/" + path, process.env.BACKEND_URL || "http://127.0.0.1:3001"), {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, confirmed: true }),
      cache: "no-store",
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    return { error: "처리 결과를 확인하지 못했습니다. 현재 모델을 확인한 뒤 다시 시도해 주세요." };
  }
  if (response.status === 401) redirect("/login?expired=1");
  if (!response.ok) {
    let message = "모델을 바꾸지 못했습니다. 다시 시도해 주세요.";
    if ([400, 403, 409].includes(response.status)) {
      const data = (await response.json().catch(() => null)) as { message?: unknown } | null;
      if (typeof data?.message === "string") message = data.message;
    }
    return { error: message };
  }
  revalidatePath("/admin/ai-model");
  revalidatePath("/admin");
  redirect("/admin/ai-model?updated=1");
}

function readForm(form: FormData) {
  const reason = form.get("reason");
  if (typeof reason !== "string" || !reason.trim() || reason.length > 500 || form.get("confirmed") !== "yes") return null;
  return reason;
}

export async function changeAiModel(_previous: AiModelActionState, form: FormData): Promise<AiModelActionState> {
  const reason = readForm(form);
  const model = form.get("model");
  if (reason === null || typeof model !== "string" || !/^[A-Za-z0-9._-]{1,60}$/.test(model)) return { error: "모델, 교체 사유, 확인 체크를 입력해 주세요." };
  return post("ai-model", { model, reason });
}

export async function rollbackAiModel(_previous: AiModelActionState, form: FormData): Promise<AiModelActionState> {
  const reason = readForm(form);
  if (reason === null) return { error: "되돌리는 사유와 확인 체크를 입력해 주세요." };
  return post("ai-model/rollback", { reason });
}
