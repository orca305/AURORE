import { notFound } from "next/navigation";
import { isAbsolute } from "node:path";
import { buildDemoAnswer } from "../../../../backend/tools/law-answer-demo.mjs";
import { loadEvidence } from "../../../../backend/tools/law-evidence.mjs";
import { TestQuestionForm, type Result } from "./test-question-form";

export default function LocalAiTestPage() {
  if (process.env.NODE_ENV !== "development") notFound();

  return <div>
    
    <main className="shell">
    <section className="intro">
      <h1>법령 답변 검증</h1>
      <p>저장된 원문으로 답변과 출처 표시를 시험합니다. 개인정보 없이 테스트 질문을 입력하세요.</p>
    </section>
    <TestQuestionForm ask={askTestQuestion} />
    </main>
  </div>;
}

async function askTestQuestion(_previous: Result, form: FormData): Promise<Result> {
  "use server";

  if (process.env.NODE_ENV !== "development") notFound();

  const input = form.get("question");
  const question = typeof input === "string" ? input.trim() : "";
  if (!question || question.length > 1000) {
    return { error: "질문을 1~1,000자로 입력하세요." };
  }

  const testMode = form.get("testMode");
  if (testMode === "law" || testMode === "bad-citation") {
    const directory = process.env.AURORE_LAW_SNAPSHOT_DIR;
    if (!directory || !isAbsolute(directory)) {
      return { error: "법령 원문 폴더의 절대 경로를 설정하세요." };
    }
    try {
      const corpus = await loadEvidence(directory);
      const result = buildDemoAnswer(corpus, question, { corruptCitation: testMode === "bad-citation" });
      if (result.status === "insufficient") {
        return { mode: "근거 부족", error: "검증된 예제 범위에서 이 질문의 근거를 확인할 수 없어 답변을 보류했습니다." };
      }
      if (result.status === "invalid-citation") {
        return { mode: "인용 오류", error: "인용문이 저장된 원문과 일치하지 않아 답변을 보류했습니다." };
      }
      if (result.status === "verified") {
        return { mode: "검증된 모의 답변", answer: result.answer, source: result.source };
      }
      return { error: "법령 검증 결과를 읽을 수 없습니다." };
    } catch {
      return { error: "법령 원문을 읽거나 검증하지 못했습니다. 스냅샷 폴더를 확인하세요." };
    }
  }
  if (testMode !== "local-ai") return { error: "테스트 유형을 선택하세요." };

  try {
    const url = new URL("/dev/ask", process.env.AURORE_AI_URL || "http://127.0.0.1:8000");
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(65_000),
    });
    if (response.status === 503) return { error: "AI 서버에 모델 또는 모의 응답 모드를 설정하세요." };
    if (response.status === 504) return { error: "모델 응답 시간이 초과되었습니다. 다시 시도해 주세요." };
    if (!response.ok) return { error: "AI 서버가 답변을 받지 못했습니다. 모델 실행 상태를 확인하세요." };

    const data: { answer?: unknown; mode?: unknown } | null = await response.json();
    if (typeof data?.answer !== "string" || !data.answer.trim() || (data.mode !== "mock" && data.mode !== "local")) {
      return { error: "AI 서버의 응답 형식을 확인하세요." };
    }
    return { answer: data.answer, mode: data.mode === "mock" ? "모의 응답" : "로컬 모델 응답" };
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      return { error: "AI 서버 응답 시간이 초과되었습니다. 다시 시도해 주세요." };
    }
    return { error: "AI 서버와 통신하지 못했습니다. 서버 실행 상태를 확인하세요." };
  }
}
