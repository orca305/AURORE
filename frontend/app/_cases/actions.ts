"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { trustedOrigin, currentToken } from "../_auth/session";
import { requestCase } from "./requests";
import { caseIdPattern, factIdPattern, type CaseCommand } from "./types";
export type CaseActionState = { error: string; terminal: boolean } | null;
export async function saveCase(
  command: CaseCommand,
  form: FormData,
): Promise<CaseActionState> {
  if (!(await trustedOrigin()))
    return { error: "요청을 확인할 수 없습니다.", terminal: true };
  if (!(await currentToken())) redirect("/login");
  const requestId = form.get("requestId");
  const creating = command.operation === "create";
  if (
    typeof requestId !== "string" ||
    !caseIdPattern.test(requestId) ||
    ![
      "create",
      "update",
      "delete",
      "createFact",
      "updateFact",
      "deleteFact",
    ].includes(command.operation) ||
    (!creating &&
      (!caseIdPattern.test(command.caseId ?? "") ||
        !Number.isInteger(command.revision) ||
        command.revision! < 1 ||
        command.revision! > 2147483646)) ||
    (["updateFact", "deleteFact"].includes(command.operation) &&
      !factIdPattern.test(command.factId ?? "")) ||
    (command.srcMsgId !== undefined && (command.operation !== "createFact" || !caseIdPattern.test(command.srcMsgId))) ||
    form.get("confirmed") !== "yes"
  )
    return {
      error: "입력 내용과 저장·삭제 확인을 다시 확인해 주세요.",
      terminal: true,
    };
  const body: Record<string, unknown> = {
    requestId,
    confirmed: true,
    ...(!creating ? { revision: command.revision } : {}),
  };
  if (
    ["create", "update", "createFact", "updateFact"].includes(command.operation)
  ) {
    const title = form.get("title");
    if (typeof title !== "string" || !title.trim() || title.length > 80)
      return { error: "제목을 1~80자로 입력해 주세요.", terminal: true };
    body.title = title;
  }
  if (["create", "update"].includes(command.operation)) {
    const typeCode = form.get("typeCode");
    if (
      typeof typeCode !== "string" ||
      !/^[A-Z][A-Z0-9_]{0,59}$/.test(typeCode)
    )
      return { error: "사건 분류를 선택해 주세요.", terminal: true };
    body.typeCode = typeCode;
  }
  if (["createFact", "updateFact"].includes(command.operation)) {
    const content = form.get("content"),
      date = form.get("occurredOn");
    if (
      typeof content !== "string" ||
      !content.trim() ||
      content.length > 4000 ||
      typeof date !== "string" ||
      (date && !/^\d{4}-\d{2}-\d{2}$/.test(date))
    )
      return { error: "사실관계 내용과 날짜를 확인해 주세요.", terminal: true };
    body.content = content;
    if(command.srcMsgId)body.srcMsgId=command.srcMsgId;
    if (date) body.occurredOn = date;
  }
  const base = "/" + command.caseId,
    paths = {
      create: "",
      update: base + "/update",
      delete: base + "/delete",
      createFact: base + "/facts",
      updateFact: base + "/facts/" + command.factId + "/update",
      deleteFact: base + "/facts/" + command.factId + "/delete",
    };
  const response = await requestCase(paths[command.operation], {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response)
    return {
      error:
        "처리 결과를 확인하지 못했습니다. 같은 내용으로 다시 누르면 기존 요청의 결과를 확인합니다.",
      terminal: false,
    };
  if (response.status === 401) redirect("/login?expired=1");
  if (!response.ok) {
    let error = "사건을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.";
    if ([400, 403, 404, 409].includes(response.status)) {
      const data = (await response.json().catch(() => null)) as {
        message?: unknown;
      } | null;
      if (typeof data?.message === "string") error = data.message;
    }
    return { error, terminal: [400, 403, 404, 409].includes(response.status) };
  }
  const result = (await response.json()) as { id: string; deleted: boolean };
  revalidatePath("/cases");
  revalidatePath("/cases/" + result.id);
  revalidatePath("/cases/" + result.id + "/timeline");
  redirect(
    result.deleted ? "/cases?removed=1" : "/cases/" + result.id + (command.returnTo === "timeline" ? "/timeline" : "") + "?saved=1",
  );
}
