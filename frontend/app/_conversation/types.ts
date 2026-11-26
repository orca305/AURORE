export type Phase = "start" | "lease-end" | "renewal-delivery";
export type Source = { verification?:string; quote: string; label: string; url: string; href?: string; warning?: string; correction?: {key:string;readAt:string|null;kind:string;recordedAt:string;currentHref:string;compareHref:string|null} };
export type Reply = { phase: Phase; text: string; source?: Source };
export type Feedback = { rating: "HELPFUL" | "IMPROVE"; reason: string | null; text: string | null };
export type Message = { feedback?: Feedback; clarification?:string;clarifyReplyTo?:string; caseContext?:{asOf:string;factCount:number;revision:number;current?:boolean}; documentAnswer?:boolean;explained?:boolean;documentQuotes?:{id:string;documentId:string;name:string;quote:string}[]; id?: string; sequence?: number; role: "user" | "assistant"; text: string; source?: Source };
export type ChatDetail = {
  linkedCase: {id:string;title:string}|null; canLinkCase:boolean;
  id: string; title: string; updatedAt?:string; phase: Phase; revision: number; expiresAt: string | null;
  messages: Message[]; nextBeforeSeq: number | null;
  job: { id: string; status: string;reason?:string;stage?:"analyze"|"search"|"write";preview?:string } | null;
};
export type ChatList = {
  items: { id: string; title: string; pinned?: boolean; unreadCorrectionCount: number; revision: number; updatedAt: string; expiresAt: string | null }[];
  nextCursor: string | null;
};
export type ChatResult<T> = { data: T | null; error: string | null; status: number };
export const isPendingJob = (job: ChatDetail["job"]) => Boolean(job && ["QUEUED", "RUNNING", "RETRY_WAIT"].includes(job.status));

export type CorrectionHistoryPage={items:{id:string;kind:string;label:string;messageId:string;readAt:string;compareHref:string|null;currentHref:string}[];offset:number;nextOffset:number|null};

export type CaseSelection={revision:number;factIds:string[];asOf:string;confirmed:true};
export type CaseContextPage={caseId:string;revision:number;items:{id:string;title:string;content:string;occurredOn:string|null}[];total:number;offset:number;nextOffset:number|null};
