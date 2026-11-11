export type Phase = "start" | "lease-end" | "renewal-delivery";
export type Source = { quote: string; label: string; url: string; href?: string; warning?: string };
export type Reply = { phase: Phase; text: string; source?: Source };
export type Message = { id?: string; sequence?: number; role: "user" | "assistant"; text: string; source?: Source };
export type ChatDetail = {
  id: string; title: string; phase: Phase; revision: number; expiresAt: string | null;
  messages: Message[]; nextBeforeSeq: number | null;
  job: { id: string; status: string } | null;
};
export type ChatList = {
  items: { id: string; title: string; revision: number; updatedAt: string; expiresAt: string | null }[];
  nextCursor: string | null;
};
export type ChatResult<T> = { data: T | null; error: string | null; status: number };
export const isPendingJob = (job: ChatDetail["job"]) => Boolean(job && ["QUEUED", "RUNNING", "RETRY_WAIT"].includes(job.status));
