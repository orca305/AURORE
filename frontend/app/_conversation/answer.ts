"use server";

import { isAbsolute } from "node:path";
import { answerDemoConversation } from "../../../backend/tools/demo-conversation.mjs";
import { loadEvidence } from "../../../backend/tools/law-evidence.mjs";
import type { Reply } from "./conversation";

type Citation = NonNullable<Reply["source"]> & { hash: string; sourceKey: string } &
  ({ kind: "law"; date: string; article: string } | { kind: "case"; caseNumber: string });

async function list<T>(path: string, query: Record<string, string>): Promise<T[]> {
  const url = new URL(path, process.env.BACKEND_URL || "http://127.0.0.1:3001");
  url.search = new URLSearchParams(query).toString();
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error("Source lookup failed");
  const rows: unknown = await response.json();
  if (!Array.isArray(rows)) throw new Error("Invalid source lookup");
  return rows as T[];
}

async function linkedCitation(source: Citation): Promise<Reply["source"] | undefined> {
  let href: string;
  if (source.kind === "case") {
    const cases = await list<{ sourceKey: string; sourceHash: string }>("/legals/precedents", { q: source.caseNumber });
    if (!cases.some(row => row.sourceKey === source.sourceKey && row.sourceHash === source.hash)) return;
    href = `/precedents?${new URLSearchParams({ q: source.caseNumber })}#case-${source.sourceKey}`;
  } else {
    const laws = await list<{ id: string; srcCd: string; srcKey: string }>("/legals", { q: "주택임대차보호법" });
    const law = laws.find(row => row.srcCd === "MOLEG" && row.srcKey === source.sourceKey);
    if (!law || !/^\d+$/.test(law.id)) return;
    const versionsPath = `/legals/${law.id}/versions`;
    const editions = await list<{ id: string; enfcDt: string | null; sourceHash: string }>(versionsPath, { asOf: source.date });
    const edition = editions.find(row => row.enfcDt?.slice(0, 10) === source.date && row.sourceHash === source.hash);
    if (!edition || !/^\d+$/.test(edition.id)) return;
    href = `${versionsPath}/${edition.id}?${new URLSearchParams({ q: source.article, asOf: source.date })}`;
  }
  const { quote, label, url } = source;
  return { quote, label, url, href };
}

export async function askConversation(question: string, phase: string): Promise<Reply> {
  try {
    const result = await answerDemoConversation(question, phase === "lease-end" ? phase : "start", async () => {
      const directory = process.env.AURORE_LAW_SNAPSHOT_DIR;
      if (!directory || !isAbsolute(directory)) throw new Error("Snapshot directory is unavailable");
      return loadEvidence(directory);
    }) as Omit<Reply, "source"> & { source?: Citation };
    if (!result.source) return result;
    const source = await linkedCitation(result.source);
    if (source) return { ...result, source };
    return { phase: "start", text: "현재 저장된 판본과 원문을 대조하지 못해 답변을 보류했습니다." };
  } catch {
    return { phase: "start", text: "원문을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }
}
