import { routeConversation } from "./demo-conversation-intent.mjs";
import { verifyCitation } from "./law-evidence.mjs";
const reviewedLaw = "543bb70dc8c4ce4d0d46b765b0e4815ff2a4d3742310401631780bb8e294a389";
const reviewedPrecedent = "ce489386e54ae963231f9be3e299911c4e49fcb22e020a4b5d42a03a97a5e284";

function verifiedQuote(corpus, chunk, quote) {
  if (!quote) return false;
  const start = chunk.text.indexOf(quote);
  return verifyCitation(corpus, new Map([[chunk.id, chunk]]), {
    id: chunk.id, hash: chunk.hash, start, end: start + quote.length, quote,
  });
}
export async function answerDemoConversation(question, phase, loadCorpus) {
  const route = routeConversation(question, phase);
  if (!route.intent) return route;
  if (route.intent === "renewal") {
    const corpus = await loadCorpus();
    const matches = corpus.chunks.filter(chunk => chunk.hash === reviewedPrecedent &&
      chunk.group === "case:239217" && chunk.section === "판결요지");
    if (matches.length === 1) {
      const [chunk] = matches;
      const quote = chunk.text.match(/임차인이 주택임대차보호법 제6조의3 제1항에 따라 임대차계약의 갱신을 요구하면 임대인에게 갱신거절 사유가 존재하지 않는 한 임대인에게 갱신요구가 도달한 때 갱신의 효력이 발생한다\./u)?.[0];
      if (verifiedQuote(corpus, chunk, quote)) {
        return {
          phase: "start",
          text: "이 판결에서는 임대인에게 갱신거절 사유가 없다면, 갱신 요구가 임대인에게 도달한 때 갱신의 효력이 생긴다고 판단했습니다.",
          source: {
            kind: "case", sourceKey: "239217", caseNumber: "2023다258672", hash: chunk.hash,
            quote, label: "대법원 2023다258672 판결요지",
            url: "https://www.law.go.kr/LSW/precInfoP.do?precSeq=239217",
          },
        };
      }
    }
    return { phase: "start", text: "저장된 원문에서 해당 판례를 확인하지 못해 답변을 보류했습니다." };
  }
  if (route.intent === "deposit") {
    const corpus = await loadCorpus();
    const matches = corpus.chunks.filter(chunk => chunk.hash === reviewedLaw && chunk.date === "20260102" &&
      chunk.group === "law:001248:3의3" && chunk.section === "paragraph" && chunk.displayNumber === "①");
    if (matches.length === 1) {
      const [chunk] = matches;
      if (verifiedQuote(corpus, chunk, chunk.text)) {
        return {
          phase: "start",
          text: "계약이 끝났는데도 보증금을 받지 못했다면 임차권등기명령을 신청할 수 있습니다. 그 조건을 규정한 조문을 아래에서 확인할 수 있어요.",
          source: {
            kind: "law", sourceKey: "001248", date: "2026-01-02", article: "제3조의3", hash: chunk.hash,
            quote: chunk.text, label: "주택임대차보호법 제3조의3 제1항 · 2026-01-02 시행본",
            url: "https://www.law.go.kr/LSW/lsInfoP.do?efYd=20260102&lsiSeq=276291",
          },
        };
      }
    }
    return { phase: "start", text: "저장된 원문에서 해당 조문을 확인하지 못해 답변을 보류했습니다." };
  }
  return { phase: "start", text: "현재 검증한 예제 범위에서는 이 질문에 답할 근거를 확인하지 못했습니다." };
}
