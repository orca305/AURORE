"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { trustedOrigin } from "../_auth/session";
import { requestTerms, validTermId } from "./requests";
export type TermSaveState = { error: string; uncertain: boolean } | null;
export async function saveTerm(
  mode: "create" | "update" | "publish" | "delete",
  id: string | null,
  revision: number | null,
  _previous: TermSaveState,
  form: FormData,
): Promise<TermSaveState> {
  if (!(await trustedOrigin()))
    return {
      error: "요청을 확인할 수 없습니다. 페이지를 다시 열어 주세요.",
      uncertain: false,
    };
  const requestId = form.get("requestId");
  if (
    !["create", "update", "publish", "delete"].includes(mode) ||
    typeof requestId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      requestId,
    ) ||
    (mode !== "create" &&
      (!id ||
        !validTermId(id) ||
        !Number.isSafeInteger(revision) ||
        revision! < 1))
  )
    return { error: "처리 정보를 확인해 주세요.", uncertain: false };
  const body: Record<string, unknown> = {
    requestId,
    ...(mode !== "create" ? { revision } : {}),
  };
  if (mode === "create" || mode === "update") {
    for (const name of [
      "termName",
      "definition",
      "explanation",
      "sourceName",
      "sourceUrl",
      "sourceReference",
    ]) {
      const value = form.get(name);
      if (typeof value !== "string")
        return { error: "입력란을 확인해 주세요.", uncertain: false };
      body[name] = value;
    }
    const aliases = form.get("aliases");
    if (typeof aliases !== "string")
      return { error: "동의어를 확인해 주세요.", uncertain: false };
    body.aliases = aliases
      .split(/\r?\n/)
      .map((v) => v.trim())
      .filter(Boolean);
  } else {
    if (form.get("confirmed") !== "yes")
      return { error: "처리할 내용을 확인해 주세요.", uncertain: false };
    body.confirmed = true;
  }
  const path =
      mode === "create" ? "" : "/" + id + (mode === "update" ? "" : "/" + mode),
    response = await requestTerms(path, true, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  if (!response?.ok) {
    let error =
      "처리 결과를 확인하지 못했습니다. 내용을 바꾸지 않고 다시 시도해 주세요.";
    if (response && [400, 401, 403, 404, 409].includes(response.status)) {
      const data = (await response.json().catch(() => null)) as {
        message?: unknown;
      } | null;
      if (typeof data?.message === "string") error = data.message;
      return { error, uncertain: false };
    }
    return { error, uncertain: true };
  }
  const result = (await response.json().catch(() => null)) as {
    id?: unknown;
  } | null;
  if (!result || typeof result.id !== "string" || !validTermId(result.id))
    return {
      error: "결과를 확인하지 못했습니다. 같은 내용으로 다시 시도해 주세요.",
      uncertain: true,
    };
  revalidatePath("/terms");
  revalidatePath("/admin/terms");
  if (id) revalidatePath("/terms/" + id);
  redirect(
    mode === "delete"
      ? "/admin/terms?state=DELETED&saved=1"
      : "/admin/terms/" + result.id + "?saved=1",
  );
}
