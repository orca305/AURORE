import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { currentToken, authRequest } from "../_auth/session";

export default async function CasesLayout({ children }: { children: ReactNode }) {
  const token = await currentToken();
  if (!token) redirect("/login");
  const response = await authRequest("session", {
    headers: { Authorization: "Bearer " + token },
  });
  if (response?.status === 401) redirect("/login?expired=1");
  return (
    <>
      
      <main className="shell">
        {response?.ok ? children : (
          <section className="intro">
            <h1>나의 사건에 연결하지 못했습니다</h1>
            <p>잠시 후 다시 시도해 주세요.</p>
          </section>
        )}
      </main>
    </>
  );
}
