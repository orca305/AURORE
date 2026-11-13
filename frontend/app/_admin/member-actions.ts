"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { currentToken, trustedOrigin } from "../_auth/session";
export type MemberActionState = { error: string; terminal: boolean } | null;
export async function changeMemberStatus(
  id: string,
  revision: string,
  previousStatus: string,
  status: string,
  limit: number,
  form: FormData,
): Promise<MemberActionState> {
  if (!(await trustedOrigin()))
    return { error: "요청을 확인할 수 없습니다.", terminal: true };
  const token = await currentToken();
  if (!token) redirect("/login");
  const requestId = form.get("requestId"),
    reason = form.get("reason");
  if (
    !/^[1-9]\d{0,18}$/.test(id) ||
    !/^(0|[1-9]\d{0,18})$/.test(revision) ||
    !["ACTIVE", "BLOCKED"].includes(previousStatus) ||
    !["ACTIVE", "BLOCKED"].includes(status) ||
    status === previousStatus ||
    typeof requestId !== "string" ||
    !/^[0-9a-f-]{36}$/i.test(requestId) ||
    typeof reason !== "string" ||
    !reason.trim() ||
    reason.length > 1000 ||
    form.get("confirmed") !== "yes" ||
    ![10, 20, 50].includes(limit)
  )
    return {
      error: "처리 사유와 상태 변경 확인을 입력해 주세요.",
      terminal: true,
    };
  let response: Response;
  try {
    response = await fetch(
      new URL(
        "/admin/members/" + id + "/status",
        process.env.BACKEND_URL || "http://127.0.0.1:3001",
      ),
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          requestId,
          revision,
          previousStatus,
          status,
          reason,
          confirmed: true,
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(20000),
      },
    );
  } catch {
    return {
      error:
        "처리 결과를 확인하지 못했습니다. 같은 사유로 다시 누르면 기존 요청의 결과를 확인합니다.",
      terminal: false,
    };
  }
  if (response.status === 401) redirect("/login?expired=1");
  if (!response.ok) {
    let message = "회원 상태를 처리하지 못했습니다. 다시 시도해 주세요.";
    if ([400, 403, 404, 409].includes(response.status)) {
      const body = (await response.json().catch(() => null)) as {
        message?: unknown;
      } | null;
      if (typeof body?.message === "string") message = body.message;
    }
    return {
      error: message,
      terminal: [400, 403, 404, 409].includes(response.status),
    };
  }
  revalidatePath('/admin/activity');revalidatePath("/admin/members");
  revalidatePath("/admin/members/" + id);
  revalidatePath("/admin");
  redirect("/admin/members/" + id + "?updated=1&limit=" + limit);
}
