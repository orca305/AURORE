"use client";
import { useState } from "react";
import { PasswordForm } from "./account-form";
import styles from "./account.module.css";

/** 비밀번호 변경: 처음엔 버튼만 보이고, 누르면 변경 양식이 펼쳐진다. 취소하면 다시 접는다. */
export function PasswordDisclosure() {
  const [open, setOpen] = useState(false);
  return <div className={styles.pwBlock}>
    {!open
      ? <button type="button" className="ui-button" onClick={() => setOpen(true)} aria-expanded="false">비밀번호 변경</button>
      : <div className={styles.pwOpen}>
        <p className={styles.help}>현재 비밀번호를 확인한 뒤 새 비밀번호를 설정합니다.</p>
        <PasswordForm />
        <button type="button" className="ui-button" onClick={() => setOpen(false)}>취소</button>
      </div>}
  </div>;
}
