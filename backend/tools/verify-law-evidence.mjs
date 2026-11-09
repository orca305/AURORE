import assert from "node:assert/strict";
import { buildDemoAnswer } from "./law-answer-demo.mjs";
import { loadEvidence, searchEvidence, verifyCitation } from "./law-evidence.mjs";
import { packProvisions } from "./pack-provisions.mjs";

const directory = process.argv[2];
if (!directory) {
  console.error("Usage: node backend/tools/verify-law-evidence.mjs <snapshot-directory>");
  process.exit(1);
}

const corpus = await loadEvidence(directory);
const current = "20260102";
const previous = "20230719";
const lawChunks = (date) => corpus.chunks.filter((chunk) => chunk.kind === "law" && chunk.date === date);
const editions = [previous, current].map((date) => {
  const chunks = lawChunks(date);
  const counts = {};
  for (const chunk of chunks) counts[chunk.section] = (counts[chunk.section] ?? 0) + 1;
  assert.equal(counts.article, 42);
  for (const section of ["paragraph", "clause", "item", "addendum"]) assert.ok(counts[section] > 0, section);
  const versionKeys = [...new Set(chunks.map((chunk) => chunk.sourceVersionKey))];
  assert.equal(versionKeys.length, 1);
  return { date, versionKey: versionKeys[0], counts };
});
assert.notEqual(editions[0].versionKey, editions[1].versionKey);
assert.ok(lawChunks(current).some((chunk) => chunk.article === "7의2" && chunk.section === "clause"));
assert.equal(corpus.chunks.filter((chunk) => chunk.kind === "case").length, 3);

const samples = [
  ["묵시적 갱신 이후 계약을 해지하고 싶어요", "law:001248:6의2"],
  ["보증금을 반환받지 못해 임차권등기명령을 신청하려고 합니다", "law:001248:3의3"],
  ["집주인이 실제 거주한다며 계약갱신을 거절했어요", "law:001248:6의3"],
  ["경매에서 보증금 우선변제를 받는 조건", "law:001248:3의2"],
  ["제6조의3", "law:001248:6의3"],
  ["2023다258672", "case:239217"],
  ["전입신고와 주택 인도 후 대항력", "law:001248:3"],
  ["계약을 갱신해 달라는 통지가 도달하면 언제 갱신되나요", "case:239217"],
  ["소액임차인 보증금 중 일정액 보호", "law:001248:8"],
];
const ranks = samples.map(([query, expected]) => {
  const hits = searchEvidence(corpus, { query, date: current });
  assert.ok(hits.every((chunk) => chunk.kind !== "law" || chunk.date === current));
  const rank = hits.findIndex((chunk) => chunk.group === expected) + 1;
  assert.ok(rank, `Expected evidence missing from top five: ${query}`);
  return { query, expected, rank };
});

const query = "제6조의3 계약갱신 요구";
const oldHits = searchEvidence(corpus, { query, date: previous });
assert.ok(oldHits.some((chunk) => chunk.article === "6의3"));
assert.ok(oldHits.every((chunk) => chunk.kind === "law" && chunk.date === previous));
assert.throws(() => searchEvidence(corpus, { query, date: "20240101" }), /outside the verified/);
assert.deepEqual(searchEvidence(corpus, { query: "2023다258672", date: previous }), []);

const article = lawChunks(current).find((chunk) => chunk.article === "6의3" && chunk.section === "article");
assert.throws(() => searchEvidence({
  ...corpus, chunks: [...corpus.chunks, { ...article, hash: "ambiguous-revision" }],
}, { query, date: current }), /multiple captured revisions/);
const hiddenHits = searchEvidence(corpus, { query, date: current, hidden: new Set([article.id]) });
assert.ok(hiddenHits.every((chunk) => chunk.article !== "6의3"));
const caseHit = searchEvidence(corpus, { query: "2023다258672", date: current })[0];
assert.deepEqual(searchEvidence(corpus, {
  query: "2023다258672", date: current, hidden: new Set([caseHit.hash]),
}), []);

// Test offsets against the hash-checked original fields, including nested addenda.
const allEvidence = new Map(corpus.chunks.map((chunk) => [chunk.id, chunk]));
assert.equal(allEvidence.size, corpus.chunks.length);
for (const chunk of corpus.chunks) {
  assert.ok(verifyCitation(corpus, allEvidence, {
    id: chunk.id, hash: chunk.hash, start: 0, end: chunk.text.length, quote: chunk.text,
  }));
}
const allowed = new Map([[article.id, article]]);
const start = article.text.indexOf("(") + 1;
const end = article.text.indexOf(")", start);
const citation = { id: article.id, hash: article.hash, start, end, quote: article.text.slice(start, end) };
assert.ok(verifyCitation(corpus, allowed, citation));
for (const invalid of [
  null,
  { ...citation, quote: citation.quote + "변조" },
  { ...citation, hash: oldHits[0].hash },
  { ...citation, end: article.text.length + 1 },
  { ...citation, id: caseHit.id, hash: caseHit.hash },
]) assert.equal(verifyCitation(corpus, allowed, invalid), false);

const outOfScope = [
  "부당해고를 당했는데 노동위원회에 구제 신청하려면 어떻게 해야 하나요?",
  "종합소득세 신고 기한을 놓치면 어떻게 하나요?",
].map((query) => ({
  query,
  candidateCount: searchEvidence(corpus, { query, date: current }).length,
}));

const groupedUnits = [previous, current].map((date) => {
  const units = packProvisions(lawChunks(date));
  for (const unit of units) {
    assert.equal(unit.parts.length, unit.members.length);
    for (const [index, part] of unit.parts.entries()) {
      assert.equal(unit.text.slice(part.start, part.end), unit.members[index].chunk.text);
      assert.deepEqual(part.path, unit.members[index].chunk.path);
    }
  }
  return units.length;
});
assert.deepEqual(groupedUnits, [66, 67]);
const [exactClause] = searchEvidence(corpus, { query: "제6조의3 제1항 제8호", date: current });
assert.equal(exactClause.section, "clause");
assert.equal(exactClause.displayNumber, "8.");
assert.ok(exactClause.contextText.length > exactClause.text.length);
assert.ok(verifyCitation(corpus, new Map([[exactClause.id, exactClause]]), {
  id: exactClause.id, hash: exactClause.hash, start: 0, end: exactClause.text.length, quote: exactClause.text,
}));
assert.deepEqual(searchEvidence(corpus, { query: "제6조의3 제1항 제999호", date: current }), []);

const demoQuestion = samples[1][0];
const verifiedDemo = buildDemoAnswer(corpus, demoQuestion);
assert.equal(verifiedDemo.status, "verified");
assert.match(verifiedDemo.source.label, /제3조의3/);
assert.ok(verifiedDemo.source.quote);
assert.deepEqual(buildDemoAnswer(corpus, demoQuestion, { corruptCitation: true }), {
  status: "invalid-citation",
});
assert.deepEqual(buildDemoAnswer(corpus, outOfScope[0].query), { status: "insufficient" });

console.log(JSON.stringify({
  snapshots: corpus.snapshots.size,
  editions,
  exactSourceFieldsVerified: corpus.chunks.length,
  top1: ranks.filter(({ rank }) => rank === 1).length,
  top5: ranks.length,
  ranks,
  outOfScope,
  groupedUnits,
  demoAnswerChecks: "passed",
  visibilityAndCitationChecks: "passed",
}, null, 2));
