import { searchEvidence, verifyCitation } from "./law-evidence.mjs";

const editionDate = "20260102";
const demoQuestions = new Map([
  ["보증금을 반환받지 못해 임차권등기명령을 신청하려고 합니다", "law:001248:3의3"],
  ["집주인이 실제 거주한다며 계약갱신을 거절했어요", "law:001248:6의3"],
  ["계약을 갱신해 달라는 통지가 도달하면 언제 갱신되나요", "case:239217"],
]);

function describeSource(chunk) {
  const date = `${chunk.date.slice(0, 4)}-${chunk.date.slice(4, 6)}-${chunk.date.slice(6)}`;
  if (chunk.kind === "case") {
    return {
      label: `${chunk.court} ${chunk.caseNumber} · ${chunk.section}`,
      dateLabel: `선고 ${date}`,
      url: `https://www.law.go.kr/LSW/precInfoP.do?precSeq=${encodeURIComponent(chunk.sourceKey)}`,
    };
  }
  const [number, branch] = chunk.article.split("의");
  const article = `제${number}조${branch ? `의${branch}` : ""}`;
  const paragraph = chunk.section === "paragraph" && chunk.displayNumber ? ` ${chunk.displayNumber}` : "";
  return {
    label: `${chunk.title} ${article}${paragraph}`,
    dateLabel: `시행 ${date}`,
    url: "https://www.law.go.kr/LSW/lsInfoP.do?efYd=20260102&lsiSeq=276291",
  };
}

export function buildDemoAnswer(corpus, question, { corruptCitation = false } = {}) {
  const normalized = question.normalize("NFKC").trim().replace(/[.?!]+$/u, "").replace(/\s+/gu, " ");
  // ponytail: a reviewed sample set gates this demo. General relevance needs its own evaluation.
  const expectedGroup = demoQuestions.get(normalized);
  if (!expectedGroup) return { status: "insufficient" };

  const hits = searchEvidence(corpus, { query: normalized, date: editionDate });
  const allowedEvidence = new Map(hits.map((chunk) => [chunk.id, chunk]));
  const evidence = hits.find((chunk) => chunk.group === expectedGroup);
  if (!evidence) return { status: "insufficient" };

  const snippet = evidence.text.split(/<br\s*\/?\s*>/iu).find((line) => line.trim())?.trim();
  if (!snippet) return { status: "insufficient" };
  const start = evidence.text.indexOf(snippet);
  const candidate = {
    id: evidence.id,
    hash: evidence.hash,
    start,
    end: start + snippet.length,
    quote: corruptCitation ? snippet + " (변조)" : snippet,
  };
  if (!verifyCitation(corpus, allowedEvidence, candidate)) return { status: "invalid-citation" };

  return {
    status: "verified",
    answer: "테스트 질문에 연결된 공식 자료를 찾았습니다. 검증을 통과한 원문 구절을 아래에서 확인할 수 있습니다.",
    source: { ...describeSource(evidence), quote: candidate.quote },
  };
}
