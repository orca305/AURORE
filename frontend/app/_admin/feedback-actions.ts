"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { currentToken, trustedOrigin } from "../_auth/session";

export type FeedbackActionState = { error: string } | null;

/** 피드백 처리 상태와 메모를 바꾼다. 처리자와 시각은 백엔드가 기록한다. */
export async function setFeedbackStatus(id: string, _previous: FeedbackActionState, form: FormData): Promise<FeedbackActionState> {
  if (!/^[1-9]\d{0,17}$/.test(id)) return { error: "대상을 확인할 수 없습니다." };
  if (!(await trustedOrigin())) return { error: "요청을 확인할 수 없습니다." };
  const status = form.get("status");
  const note = form.get("note");
  if (typeof status !== "string" || !["NEW", "REVIEWING", "DONE"].includes(status)) return { error: "처리 상태를 골라 주세요." };
  if (typeof note !== "string" || Array.from(note).length > 500) return { error: "처리 메모는 500자 이내로 적어 주세요." };
  const token = await currentToken();
  if (!token) redirect("/login");
  let response: Response;
  try {
    response = await fetch(new URL("/admin/feedback/" + id + "/status", process.env.BACKEND_URL || "http://127.0.0.1:3001"), {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ status, ...(note.trim() ? { note } : {}) }),
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    return { error: "처리 결과를 확인하지 못했습니다. 화면을 새로 열어 상태를 확인해 주세요." };
  }
  if (response.status === 401) redirect("/login?expired=1");
  if (!response.ok) return { error: response.status === 404 ? "의견을 찾을 수 없습니다. 사용자가 지웠을 수 있어요." : "상태를 바꾸지 못했습니다. 다시 시도해 주세요." };
  revalidatePath("/admin/feedback");
  redirect("/admin/feedback/" + id + "?updated=1");
}
