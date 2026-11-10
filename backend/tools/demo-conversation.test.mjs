import assert from "node:assert/strict";
import { test } from "node:test";
import { answerDemoConversation } from "./demo-conversation.mjs";

test("carries the lease question through a follow-up and only cites the exact reviewed source", async () => {
  const never = () => assert.fail("Unexpected source query");
  const first = await answerDemoConversation("보증금을 돌려받지 못했어요", "start", never);
  assert.equal(first.phase, "lease-end");
  const unrelated = await answerDemoConversation("오늘 뭐 먹지?", first.phase, never);
  assert.equal(unrelated.phase, first.phase);
  assert(!unrelated.source);
  assert(!(await answerDemoConversation("아직 안 끝났어요", first.phase, never)).source);

  const text = "① 검증용 원문";
  const hash = "543bb70dc8c4ce4d0d46b765b0e4815ff2a4d3742310401631780bb8e294a389";
  const chunk = { id: "clause", hash, path: ["body"], text,
    date: "20260102", group: "law:001248:3의3", section: "paragraph", displayNumber: "①" };
  const corpus = { chunks: [chunk], snapshots: new Map([[hash, { body: text }]]) };
  const answer = await answerDemoConversation("네, 끝났어요.", first.phase, () => corpus);
  assert.equal(answer.phase, "start");
  assert.equal(answer.source.quote, text);
  assert(!(await answerDemoConversation("네", "start", never)).source);
  assert.match((await answerDemoConversation("네", first.phase, () => ({
    ...corpus, chunks: [chunk, chunk],
  }))).text, /보류/);
  assert.match((await answerDemoConversation("네", first.phase, () => ({
    ...corpus, chunks: [{ ...chunk, text: "변조" }],
  }))).text, /보류/);
  assert.match((await answerDemoConversation("네", first.phase, () => ({
    ...corpus, chunks: [{ ...chunk, hash: "unreviewed" }],
  }))).text, /보류/);
});
