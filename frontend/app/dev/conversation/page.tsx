import { notFound } from "next/navigation";
import { isAbsolute } from "node:path";
import { answerDemoConversation } from "../../../../backend/tools/demo-conversation.mjs";
import { loadEvidence } from "../../../../backend/tools/law-evidence.mjs";
import { Conversation, type Reply } from "../../_conversation/conversation";

async function ask(question: string, phase: string): Promise<Reply> {
  "use server";

  if (process.env.NODE_ENV !== "development") notFound();
  try {
    const reply = await answerDemoConversation(question, phase, async () => {
      const directory = process.env.AURORE_LAW_SNAPSHOT_DIR;
      if (!directory || !isAbsolute(directory)) throw new Error("Snapshot directory is unavailable");
      return loadEvidence(directory);
    });
    return reply as Reply;
  } catch {
    return { phase: "start", text: "원문을 불러오지 못했습니다. 개발용 스냅샷 설정을 확인해 주세요." };
  }
}

export default function ConversationPage() {
  if (process.env.NODE_ENV !== "development") notFound();

  return <div>
    
    <main className="shell pb-10">
      <p className="dev-note">개발용 대화 · 임대차 보증금 예제만 검증 중입니다. 실제 개인정보는 입력하지 마세요.</p>
      <Conversation ask={ask} />
    </main>
  </div>;
}
