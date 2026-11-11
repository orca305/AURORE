"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { authRequest, currentToken, sessionCookie, tokenPattern, trustedOrigin } from "./session";

export async function submitAccount(
  mode: "signup" | "login", _previous: string | null, form: FormData,
) {
  const origin = await trustedOrigin();
  if (!origin) return "요청을 확인할 수 없습니다. 페이지를 다시 열어 주세요.";
  if (mode !== "signup" && mode !== "login") return "지원하지 않는 요청입니다.";

  const loginId = form.get("loginId");
  const password = form.get("password");
  const nickname = form.get("nickname");
  if (typeof loginId !== "string" || typeof password !== "string" ||
      (mode === "signup" && typeof nickname !== "string")) {
    return "필수 입력란을 확인해 주세요.";
  }

  const response = await authRequest(mode, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ loginId, password, ...(mode === "signup" ? { nickname } : {}) }),
  });
  if (!response?.ok) {
    if (response?.status === 400) {
      const { message } = await response.json() as { message?: unknown };
      return typeof message === "string" ? message : "입력 형식과 글자 수를 확인해 주세요.";
    }
    if (response?.status === 401) return "아이디 또는 비밀번호를 확인해 주세요.";
    if (response?.status === 409) return "이미 사용 중인 아이디입니다.";
    if (response?.status === 429) return "요청이 많습니다. 잠시 후 다시 시도해 주세요.";
    return "계정 서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.";
  }

  if (mode === "signup") redirect("/login?registered=1");

  const { token } = await response.json() as { token?: unknown };
  if (typeof token !== "string" || !tokenPattern.test(token)) return "로그인에 실패했습니다. 다시 시도해 주세요.";
  (await cookies()).set(sessionCookie, token, {
    httpOnly: true, sameSite: "lax", secure: origin.protocol === "https:",
    path: "/", maxAge: 7 * 24 * 60 * 60,
  });
  redirect("/account");
}

export async function signOut() {
  const origin = await trustedOrigin();
  if (!origin) return "요청을 확인할 수 없습니다. 페이지를 다시 열어 주세요.";
  const token = await currentToken();
  if (token) {
    const response = await authRequest("logout", {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
    });
    if (!response?.ok) return "로그아웃할 수 없습니다. 잠시 후 다시 시도해 주세요.";
  }
  (await cookies()).set(sessionCookie, "", {
    httpOnly: true, sameSite: "lax", secure: origin.protocol === "https:",
    path: "/", maxAge: 0,
  });
  redirect("/");
}

export async function secureAccount(mode: "password" | "logout-all", _previous: string | null, form: FormData) {
  const origin = await trustedOrigin();
  if (!origin) return "요청을 확인할 수 없습니다. 페이지를 다시 열어 주세요.";
  if (mode !== "password" && mode !== "logout-all") return "지원하지 않는 요청입니다.";
  const token = await currentToken();
  if (!token) redirect("/login");
  const currentPassword = form.get("currentPassword");
  const newPassword = form.get("newPassword");
  if (mode === "password") {
    if (typeof currentPassword !== "string" || typeof newPassword !== "string") return "비밀번호를 입력해 주세요.";
    const confirmation = form.get("confirmPassword");
    if (typeof confirmation !== "string" || newPassword.normalize("NFC") !== confirmation.normalize("NFC"))
      return "새 비밀번호 확인이 일치하지 않습니다.";
  }
  const response = await authRequest(mode, {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    ...(mode === "password" ? { body: JSON.stringify({ currentPassword, newPassword }) } : {}),
  });
  if (response?.status === 400) {
    const { message } = await response.json() as { message?: unknown };
    return typeof message === "string" ? message : "비밀번호 입력을 확인해 주세요.";
  }
  if (response?.status === 429) return "요청이 많습니다. 잠시 후 다시 시도해 주세요.";
  if (!response?.ok && response?.status !== 401) return "요청을 처리할 수 없습니다. 잠시 후 다시 시도해 주세요.";
  (await cookies()).set(sessionCookie, "", {
    httpOnly: true, sameSite: "lax", secure: origin.protocol === "https:", path: "/", maxAge: 0,
  });
  redirect(response?.status === 401 ? "/login?expired=1" : mode === "password" ? "/login?passwordChanged=1" : "/login?signedOut=1");
}
