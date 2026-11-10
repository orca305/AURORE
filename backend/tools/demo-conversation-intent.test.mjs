import assert from "node:assert/strict";
import { test } from "node:test";
import { routeConversation } from "./demo-conversation-intent.mjs";

test("recognizes variations and separates legal questions from unsupported topics", () => {
  for (const question of [
    "집주인이 전세금을 안 줘요",
    "월세 보증금을 못 돌려받고 있어요",
    "임대인이 보증금 반환을 거부했습니다.",
    "전세금 반환을 안 해줘요!",
  ]) assert.equal(routeConversation(question, "start").phase, "lease-end", question);

  for (const question of [
    "임대차 계약 갱신 효력은 언제부터 생기나요?",
    "계약을 갱신해 달라는 통지가 도달하면 언제 갱신되나요?",
    "세입자가 재계약 요청을 하면 효력이 발생하는 시점은 언제인가요?",
  ]) assert.equal(routeConversation(question, "start").intent, "renewal", question);

  for (const question of [
    "보험 계약 갱신의 효력은 언제인가요?",
    "퇴직금을 안 줘요",
    "전세 보증금 못 받는 꿈을 꿨어요",
    "그냥 농담인데 보증금을 못 받았어요",
    "오늘 뭐 먹을까요?",
  ]) assert.equal(routeConversation(question, "start").intent, undefined, question);
});

test("does not treat negation, guessing or an outgoing message as a confirmed fact", () => {
  assert.equal(routeConversation("계약은 이미 만료됐고 보증금은 못 받았어요.", "start").intent, "deposit");
  assert.equal(routeConversation("임대차 기간은 아직 안 끝났어요.", "lease-end").phase, "start");
  assert.equal(routeConversation("네, 종료됐습니다.", "lease-end").intent, "deposit");
  for (const answer of [
    "끝났는지 모르겠어요", "끝난 것 같아요", "만료됐어요?", "끝났는데 아직 계약 기간이 남았어요",
  ]) assert.equal(routeConversation(answer, "lease-end").phase, "lease-end", answer);
  assert.equal(routeConversation("네", "start").intent, undefined);
  assert.equal(routeConversation("제가 집주인인데 보증금을 안 줬어요", "start").intent, undefined);

  const pending = routeConversation("집주인한테 갱신 문자를 보냈는데 계약이 연장된 건가요?", "start");
  assert.equal(pending.phase, "renewal-delivery");
  assert.equal(routeConversation("도달했는지 아직 몰라요", pending.phase).phase, pending.phase);
  assert.equal(routeConversation("제가 답장 받았다고 했어요", pending.phase).phase, pending.phase);
  assert.equal(routeConversation("네, 도달했어요", pending.phase).intent, "renewal");
  assert.equal(routeConversation("임대인이 받았다고 답했어요", pending.phase).intent, "renewal");
  assert.equal(routeConversation("아직 도달하지 않았어요", pending.phase).phase, "start");
  assert.equal(routeConversation("갱신을 거절당했어요", pending.phase).intent, undefined);
  assert.equal(routeConversation("보증금을 못 받았고 갱신 통지도 보냈어요", "lease-end").phase, "start");
});
