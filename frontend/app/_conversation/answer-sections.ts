/**
 * AI 해설은 "질문에 대한 답", "쉽게 풀면" 같은 소제목 줄로 나뉜 글이다.
 * 화면에서는 첫 답을 "한 줄 결론", 나머지를 번호 단계로 보여 주고,
 * "확인해 보세요"와 "도움 받을 곳"은 오른쪽 열에서 따로 보여 주기 위해 떼어 둔다.
 */
export const SECTION_HEADINGS = [
  "질문에 대한 답", "쉽게 풀면", "예를 들어 (가상의 예)", "주의할 점", "확인해 보세요", "함께 본 조문", "도움 받을 곳", "결론",
  "이렇게 해 보세요", "알아 둘 내용", "근거 조문 (원문 확인됨)", "관련 판례", "근거 판례 (판결 요지 확인됨)",
] as const;

const HEADINGS = new Set<string>(SECTION_HEADINGS);
const CONCLUSION = new Set(["질문에 대한 답", "결론"]);
const SIDE = new Set(["확인해 보세요", "도움 받을 곳"]);

export type AnswerSection = { heading: string; body: string };
export type ParsedAnswer = {
  structured: boolean;
  conclusion: string;
  steps: AnswerSection[];
  checks: string[];
  help: string;
};

const bulletLine = (line: string) => line.replace(/^\s*(?:[-•·*]|\d+[.)])\s*/u, "").trim();

export function parseAnswer(text: string): ParsedAnswer {
  const sections: AnswerSection[] = [];
  const lead: string[] = [];
  let current: { heading: string; lines: string[] } | null = null;
  for (const line of text.split("\n")) {
    const heading = line.trim();
    if (HEADINGS.has(heading)) {
      if (current) sections.push({ heading: current.heading, body: current.lines.join("\n").trim() });
      current = { heading, lines: [] };
    } else if (current) current.lines.push(line);
    else lead.push(line);
  }
  if (current) sections.push({ heading: current.heading, body: current.lines.join("\n").trim() });
  if (!sections.length) return { structured: false, conclusion: text, steps: [], checks: [], help: "" };

  const conclusionSection = sections.find((section) => CONCLUSION.has(section.heading) && section.body);
  const leadText = lead.join("\n").trim();
  const conclusion = conclusionSection?.body ?? leadText;
  const steps = sections.filter((section) => section !== conclusionSection && !SIDE.has(section.heading) && section.body);
  const checks = sections
    .filter((section) => section.heading === "확인해 보세요")
    .flatMap((section) => section.body.split("\n").map(bulletLine).filter(Boolean));
  const help = sections.find((section) => section.heading === "도움 받을 곳")?.body ?? "";
  // 결론으로 쓸 글이 없으면 첫 단계가 결론이 된다.
  if (!conclusion && steps.length) {
    const first = steps.shift()!;
    return { structured: true, conclusion: first.body, steps, checks, help };
  }
  // 머리글이 따로 없고 결론 소제목만 있었다면 머리글은 단계로 보내지 않는다.
  return { structured: true, conclusion: leadText && conclusionSection ? leadText + "\n" + conclusion : conclusion, steps, checks, help };
}
