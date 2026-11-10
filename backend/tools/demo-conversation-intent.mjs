const leaseQuestion = "임대차 계약은 이미 끝났나요? 계약 종료 여부부터 확인할게요.";
const deliveryQuestion = "갱신 요구가 집주인에게 도달했는지 확인할 수 있나요? 보낸 시점과 도달한 시점은 다를 수 있어요.";
const yes = /^(?:네|예|응|맞아요|맞습니다)$/u;
const no = /^(?:아니요|아뇨|아니|아직이에요)$/u;

function leaseEnd(text, shortReply) {
  if (/끝났는지|끝났나요|끝났을까|끝난줄|끝난것같|끝난거같|끝났다면|끝났다고들|끝나면|종료됐는지|만료됐는지|확실하지|모르겠/u.test(text)) return "unknown";
  const ended = /(?<!안)(?:끝났|종료됐|종료되었|만료됐|만료되었|만료입니다)/u.test(text);
  const ongoing = /안끝났|끝나지않|아직계약중|계약이남|기간이남|종료되지않|만료되지않|만료전|계약중이에요/u.test(text);
  if (ended && ongoing) return "unknown";
  if (ongoing || (shortReply && no.test(text))) return "no";
  if (ended || (shortReply && yes.test(text))) return "yes";
  return "unknown";
}

function noticeDelivery(text, shortReply) {
  if (/도달했는지|도달했나요|받았는지|읽었는지|받았을까|확실하지|모르겠|확인못|확인할수없|(?:제가|내가)(?:답장|문자)?받았/u.test(text)) return "unknown";
  const notDelivered = /안갔|도달하지않|전달되지않|못받았다고|도달안됐|도달안했/u.test(text);
  const delivered = /(?<!못)(?:받았다고(?:했|답)|받았대)|(?:도달|전달|도착|수신확인)(?:은|이)?(?:이미)?(?:했|됐|되었)|(?:집주인|임대인|상대방)(?:이|은|도)?받았/u.test(text);
  if (notDelivered && delivered) return "unknown";
  if (notDelivered || (shortReply && no.test(text))) return "no";
  if (delivered || (shortReply && yes.test(text))) return "yes";
  return "unknown";
}

export function routeConversation(question, phase) {
  if (phase !== "lease-end" && phase !== "renewal-delivery") phase = "start";
  if (typeof question !== "string" || !question.trim() || question.length > 1000) {
    return { phase, text: "질문을 1~1,000자로 입력해 주세요." };
  }
  const normalized = question.normalize("NFKC").trim();
  const text = normalized.replace(/[\s.!?,，。！？]/gu, "");
  if (/^(?:안녕(?:하세요)?|오늘뭐먹(?:지|을까요)|밥뭐먹지|고마워(?:요)?|감사합니다)$/u.test(text)) {
    return { phase, text: "법률 문제가 생기면 상황을 편하게 이야기해 주세요." };
  }

  const housing = /임대차|임차인|세입자|집주인|임대인|전세|월세|집계약/u.test(text);
  if (/꿈에서|꿈을꿨|농담|역할극/u.test(text)) {
    return { phase, text: "법률 문제로 확인하고 싶은 실제 상황이 있다면 이야기해 주세요." };
  }
  const outside = /보험|근로계약|고용|구독|요금제|계약직|반려동물|렌터카|숙박|대출|예약금/u.test(text);
  const deposit = (!outside || housing) && /보증금|전세금/u.test(text) &&
    /못받|못돌려받|돌려받지못|반환받지못|받지못|돌려주지않|안돌려|안주|안줘|안해줘|미반환|반환을?안해|반환을거부|반환하지않|돌려받을수없/u.test(text);
  const renewal = (!outside || housing) && (housing || deposit || /계약(?:을)?갱신/u.test(text)) &&
    /갱신|재계약|연장/u.test(text) && /언제|시점|효력|도달|갱신됐|연장된|보냈|통지|요구했/u.test(text);
  if (deposit && renewal) {
    return { phase: "start", text: "보증금 반환과 계약 갱신을 함께 말씀하셨어요. 어느 쪽부터 확인할까요?" };
  }
  if (outside && !housing) {
    return { phase, text: "지금은 임대차 보증금 반환과 계약 갱신 예제에서만 근거를 확인할 수 있어요." };
  }

  // In a question ending in a fact, such as “끝났어요?”, the fact is still unconfirmed.
  const uncertainQuestion = /[?？]$/u.test(normalized) && /(?:끝났어요|끝났습니다|종료됐어요|만료됐어요|도달했어요|받았어요)$/u.test(text);
  if (deposit || (!renewal && phase === "lease-end")) {
    if (/제가(?:임대인|집주인)|임대인인데|집주인인데/u.test(text)) {
      return { phase: "start", text: "이 예제는 보증금을 돌려받지 못한 임차인의 경우를 다뤄요. 말씀하신 임대인 쪽 상황은 근거를 확인하지 못했습니다." };
    }
    const fact = uncertainQuestion ? "unknown" : leaseEnd(text, !deposit);
    if (fact === "yes") return { intent: "deposit" };
    if (fact === "no") return {
      phase: "start",
      text: "계약이 아직 끝나지 않았다면 임차권등기명령 조항의 계약 종료 요건이 충족되지 않은 상태예요. 계약 중 대응은 이 예제에서 확인한 근거가 부족해요.",
    };
    return { phase: "lease-end", text: leaseQuestion };
  }
  if (renewal || phase === "renewal-delivery") {
    if (/거절했|거절당했|거부했|거절한다고|거절통지/u.test(text)) {
      return { phase: "start", text: "갱신 요구가 거절된 경우라면 거절 사유부터 확인해야 해요. 이 예제만으로는 갱신 효력이 생겼는지 판단할 근거가 부족합니다." };
    }
    const fact = uncertainQuestion ? "unknown" : noticeDelivery(text, !renewal);
    if (fact === "yes") return { intent: "renewal" };
    if (fact === "no") return {
      phase: "start",
      text: "아직 도달하지 않았다면, 보낸 날만으로 갱신이 효력을 얻었다고 판단할 수 없어요. 집주인에게 도달한 시점부터 확인해야 해요.",
    };
    const describesSending = /보냈|보낸|전송했|전했|요구했|요청했|문자했|갱신됐나요|연장된건가/u.test(text);
    if (renewal && !describesSending && /언제|시점|효력이생기/u.test(text)) return { intent: "renewal" };
    return { phase: "renewal-delivery", text: deliveryQuestion };
  }
  return { phase: "start", text: "현재 검증한 예제 범위에서는 이 질문에 답할 근거를 확인하지 못했습니다." };
}
