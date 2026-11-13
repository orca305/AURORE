"use client";
import { useActionState, useRef, useState } from "react";
import {
  changeMemberStatus,
  type MemberActionState,
} from "../../../_admin/member-actions";
import styles from "../../page.module.css";
export function StatusForm({
  id,
  revision,
  status,
  limit,
}: {
  id: string;
  revision: string;
  status: string;
  limit: number;
}) {
  const target = status === "ACTIVE" ? "BLOCKED" : "ACTIVE";
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const request = useRef<{ id: string; payload: string } | null>(null);
  const [state, action, pending] = useActionState(
    async (_previous: MemberActionState, form: FormData) => {
      const payload = JSON.stringify([
        revision,
        status,
        target,
        String(form.get("reason")).normalize("NFC").trim(),
      ]);
      if (request.current?.payload !== payload)
        request.current = { id: crypto.randomUUID(), payload };
      form.set("requestId", request.current.id);
      const result = await changeMemberStatus(
        id,
        revision,
        status,
        target,
        limit,
        form,
      );
      if (result?.terminal) request.current = null;
      return result;
    },
    null,
  );
  return (
    <form className={styles.approval} action={action}>
      <h3>{target === "BLOCKED" ? "회원 차단" : "회원 차단 해제"}</h3>
      <p>
        {target === "BLOCKED"
          ? "차단하면 모든 기기의 로그인이 해제되고, 차단 해제 전까지 로그인할 수 없습니다."
          : "차단을 해제하면 다시 로그인할 수 있습니다. 이전 로그인은 복구되지 않습니다."}
      </p>
      <label>
        처리 사유
        <textarea
          name="reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          required
          maxLength={1000}
          rows={3}
          placeholder="처리 사유를 입력하세요. 개인정보는 적지 마세요."
          disabled={pending}
        />
      </label>
      <label>
        <input
          type="checkbox"
          name="confirmed"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
          value="yes"
          required
          disabled={pending}
        />
        변경할 상태와 처리 사유를 확인했습니다.
      </label>
      {state?.error && (
        <p role="alert" className={styles.approvalError}>
          {state.error}{" "}
          {state.terminal && (
            <a href={"/admin/members/" + id + "?limit=" + limit}>
              최신 상태 확인 ↗
            </a>
          )}
        </p>
      )}
      <button type="submit" disabled={pending}>
        {pending
          ? "처리 중…"
          : target === "BLOCKED"
            ? "회원 차단"
            : "차단 해제"}
      </button>
    </form>
  );
}
