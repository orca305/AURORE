// 판례의 "참조조문" 글(예: "민법 제750조, 제756조 / [2] 구 주택법(2009. 1. 30. 법률 제9366호로 개정되기 전의 것) 제40조")을
// 법령 이름과 조문 번호 목록으로 바꾼다. 항·호는 버리고 조(의 가지번호 포함) 단위까지만 쓴다.

const OLD_MARK = /개정되기\s*전의\s*것|폐지되기\s*전의\s*것|전부\s*개정되기\s*전/;

/** 괄호 밖의 쉼표로만 나눈다 (법령 이름 뒤 괄호 안에 쉼표가 있을 수 있다). */
function splitTopLevel(text) {
  const out = [];
  let depth = 0;
  let cur = "";
  for (const ch of text) {
    if (ch === "(" || ch === "（") depth += 1;
    if (ch === ")" || ch === "）") depth = Math.max(0, depth - 1);
    if ((ch === "," || ch === "，") && depth === 0) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) out.push(cur);
  return out;
}

export function parseReferences(text) {
  if (typeof text !== "string") return [];
  const clean = text.replace(/<br\s*\/?>/gi, " ").replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const parts = clean.split(/\s\/\s|\[\d+\]/).map((p) => p.trim()).filter(Boolean);
  const seen = new Set();
  const refs = [];
  for (const part of parts) {
    let law = null;
    for (const piece of splitTopLevel(part)) {
      const p = piece.trim();
      const stripped = p.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
      const article = stripped.match(/제\s*(\d+)\s*조(?:\s*의\s*(\d+))?/);
      if (!article) continue; // "제3항" 같은 항·호만 있는 조각
      const key = article[2] ? `${article[1]}의${article[2]}` : article[1];
      if (article.index === 0) {
        // 앞에서 나온 법령의 다른 조문
        if (!law) continue;
      } else {
        const name = stripped.slice(0, article.index).replace(/^구\s+/, "").trim();
        if (!name || /부칙$/.test(name)) {
          law = null; // 부칙 조문은 본문 조문과 구분해 건너뛴다
          continue;
        }
        law = { name, old: p.startsWith("구 ") || OLD_MARK.test(p) };
      }
      const id = `${law.name}|${law.old ? 1 : 0}|${key}`;
      if (seen.has(id)) continue;
      seen.add(id);
      refs.push({ lawName: law.name, old: law.old, articleKey: key });
    }
  }
  return refs;
}

/** 법령 이름 비교용: 공백을 없애고 가운뎃점 변형(· ㆍ ・ ∙ •)을 하나로 맞춘다. 판례 글과 법령 DB가 서로 다른 점을 쓴다. */
export function compactName(name) {
  return name.replace(/\s+/g, "").replace(/[·ㆍ・∙•‧]/g, "ㆍ");
}
