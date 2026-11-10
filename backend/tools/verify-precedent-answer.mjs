import assert from "node:assert/strict";
import pg from "pg";
import { verifiedEvidenceForPrecedent } from "./precedent-citation-evidence.mjs";

// ponytail: relevance is evaluated on reviewed questions with known supporting paragraphs.
const questions = new Map([
  ["2005다4529에서 임차권등기 뒤 대항요건을 잃으면 기존 대항력이 어떻게 되나요",
    { caseKey: "193797", article: "제3조의3", marker: "⑤" }],
  ["2023다258672에서 해지 통지가 도달한 뒤 언제 효력이 생기나요",
    { caseKey: "239217", article: "제6조의2", marker: "②" }],
  ["2023다258672에서 갱신된 임대차 해지에는 어떤 규정이 준용되나요",
    { caseKey: "239217", article: "제6조의3", marker: "④" }],
  ["2022다255126에서 보증금반환채권 양수에 적용된 시행본은 무엇인가요",
    { caseKey: "233877" }],
]);

async function checkAnswer(db, question, proposeCitation) {
  const scenario = questions.get(question.normalize("NFKC").trim().replace(/[?.!]+$/u, ""));
  if (!scenario) return { status: "insufficient" };

  const evidence = await verifiedEvidenceForPrecedent(db, scenario.caseKey);
  if (!evidence.length) return { status: "insufficient" };
  const proposal = await proposeCitation(evidence.map(({ id, hash, quote }) => ({ id, hash, quote })));
  const source = evidence.find(item => item.id === proposal?.id);
  if (!source || proposal.hash !== source.hash || !Number.isInteger(proposal.start) ||
      !Number.isInteger(proposal.end) || proposal.start < 0 || proposal.end > source.quote.length ||
      proposal.end <= proposal.start || typeof proposal.quote !== "string" ||
      !proposal.quote.trim() || source.quote.slice(proposal.start, proposal.end) !== proposal.quote) {
    return { status: "invalid-citation" };
  }

  if (source.reference.split(" ")[0] !== scenario.article ||
      !source.quote.trimStart().startsWith(scenario.marker)) {
    return { status: "irrelevant" };
  }
  // Keep the reviewed paragraph intact so a matching substring cannot drop conditions.
  return { status: "verified", source };
}

async function main() {
  const url = URL.parse(process.env.DATABASE_URL ?? "");
  if (url?.protocol !== "postgresql:" || url.host !== "127.0.0.1:5433" ||
      url.pathname !== "/aurore_dev_check") {
    throw new Error("Run this verification against the local development DB on port 5433.");
  }
  const db = new pg.Client({ connectionString: url.href, connectionTimeoutMillis: 5000 });
  await db.connect();
  try {
    await db.query("BEGIN READ ONLY");
    const [registration, notice, renewal, unresolved] = questions.keys();
    const full = (item) => ({ ...item, start: 0, end: item.quote.length });
    const choose = (phrase) => (items) => full(items.find(item => item.quote.includes(phrase)));
    const positives = [
      [registration, "상실하지 아니한다", "1999-03-01"],
      [notice, "3개월이 지나면", "2020-12-10"],
      [renewal, "제6조의2를 준용", "2020-12-10"],
    ];
    for (const [question, phrase, date] of positives) {
      const result = await checkAnswer(db, question, choose(phrase));
      assert.equal(result.status, "verified");
      assert.equal(result.source.effectiveDate, date);
      assert.ok(result.source.quote.includes(phrase));
    }
    const selectNotice = choose("3개월이 지나면");
    const cases = [
      [notice, (items) => ({ ...selectNotice(items), quote: "3개월" }), "invalid-citation"],
      [notice, (items) => ({ ...selectNotice(items), hash: "0".repeat(64) }), "invalid-citation"],
      [notice, (items) => ({ ...selectNotice(items), end: items[0].quote.length + 1000 }), "invalid-citation"],
      [notice, choose("제6조의2를 준용"), "irrelevant"],
      [notice, choose("언제든지"), "irrelevant"],
      [notice, () => null, "invalid-citation"],
    ];
    for (const [question, proposer, status] of cases) {
      assert.deepEqual(await checkAnswer(db, question, proposer), { status });
    }
    const neverCalled = () => assert.fail("Insufficient evidence must skip citation generation.");
    for (const question of [unresolved, "오늘 저녁 뭐 먹을까요", "퇴직금은 어떻게 계산하나요"]) {
      assert.deepEqual(await checkAnswer(db, question, neverCalled), { status: "insufficient" });
    }
    const registrationEvidence = await verifiedEvidenceForPrecedent(db, "193797");
    assert.deepEqual(await checkAnswer(db, notice, () => full(registrationEvidence[0])), { status: "invalid-citation" });
    const excerpt = await checkAnswer(db, notice, (items) => {
      const item = selectNotice(items);
      const start = item.quote.indexOf("3개월");
      return { ...item, start, end: start + 3, quote: "3개월" };
    });
    assert.equal(excerpt.status, "verified");
    assert.notEqual(excerpt.source.quote, "3개월");

    console.log(JSON.stringify({ scenariosPassed: 14, mode: "mock citation proposal with real database evidence" }));
  } finally {
    await db.end();
  }
}

if (import.meta.main) await main();
