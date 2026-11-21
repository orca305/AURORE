import { currentToken } from "../_auth/session";

export type AiStatus = {
  reachable: boolean; provider?: "external" | "local"; mode?: "external" | "fallback" | "local";
  externalModel?: string | null; selectedModel?: string | null; localModel?: string; keyConfigured?: boolean; blockedKind?: string | null; blockedSecondsLeft?: number;
  calls?: { external: number; local: number; fallback: number; lastFallbackKind: string | null }; sinceSeconds?: number;
};

export type AdminOverview = {
  asOf: string; personalDataAccess: false;
  counts: { members: number; conversations: number; legals: number; versions: number; provisions: number; precedents: number; snapshots: number };
  jobs: { status: string; count: number }[];
  recentJobs: { id: string; status: string; provider: string; attempts: number; errorCode: string | null;resultCode:string|null; createdAt: string; updatedAt: string }[];
  recentSources: { id: string; source: string; contentType: string; collectedAt: string }[];
};

export async function requestAdmin(path: "privacy-retention" | "collection-schedule" | "precedent-collections" | `precedent-collections/${string}` | "ai-jobs" | `ai-jobs/${string}` | "activity" | "members" | `members/${string}` | "session" | "overview" | "ai-status" | "ai-model" | "ai-monitor" | "legal-refresh" | "legal-refresh/processing-history" | `legal-refresh/reviews/${string}` | "precedent-reviews" | "precedent-reviews/history" | `precedent-reviews/${string}`, query?: URLSearchParams) {
  const token = await currentToken();
  if (!token) return null;
  try {
    return await fetch(new URL("/admin/" + path + (query ? "?" + query.toString() : ""), process.env.BACKEND_URL || "http://127.0.0.1:3001"), {
      headers: { Authorization: "Bearer " + token }, cache: "no-store", signal: AbortSignal.timeout(8000),
    });
  } catch { return null; }
}

export type RefreshOverview = {
  execution:{status:string;startedAt:string|null};
  asOf: string; initialized: boolean; fromDate: string | null; lastCompletedDate: string | null; nextDate: string | null;
  summary: {runs: number; failures: number; pending: number; corrections: number}; historyLimit: number;
  history: {id: string; date: string; status: "STAGED" | "FAILED";errorCode:string|null; recordedAt: string; candidates: number; editions: number; corrections: number}[];
  pending: {id: string; kind: "new-edition" | "correction"; date: string; lawId: string; lawName: string | null; versionKey: string; effectiveDate: string; status: string; canCompare: boolean}[];
};
export type CorrectionReview = {
  id: string; status: string; lawId: string; lawName: string | null; versionKey: string; effectiveDate: string; beforeHash: string; afterHash: string;
  totalChanges: number; offset: number; nextOffset: number | null;
  changes: {key: string; change: string; before: {number: string; title: string | null; text: string} | null; after: {number: string; title: string | null; text: string} | null}[];
};

export type CorrectionAction = {id:string;status:string;resultCode:string;revision:number|null;affectedCount:number;beforeHash:string;afterHash:string;requestedAt:string;finishedAt:string;operator:string;lawName:string|null;versionKey:string|null;href:string|null};

export type MemberList = {
  total: number; counts: { members: number; active: number; blocked: number }; offset: number; limit: number; nextOffset: number | null;
  items: { id: string; loginIdMasked: string; nicknameMasked: string; status: 'ACTIVE' | 'BLOCKED' | 'UNAVAILABLE'; joinedAt: string }[];
};

export type MemberDetail = {
  member: MemberList['items'][number] & { revision: string; canChange: boolean; self: boolean };
  history: { total: number; offset: number; nextOffset: number | null; items: {
    id: string; reason: string; previousStatus: string; status: string; operatorMasked: string; changedAt: string;
  }[] };
};

export type AdminActivity = {
  total:number; counts:{succeeded:number;failed:number};offset:number;limit:number;nextOffset:number|null;
  items:{id:string;kind:string;result:string;action:string;occurredAt:string;subject:string;reason:string|null;operatorMasked:string;href:string|null}[];
};

export type AdminJob = {id:string;status:string;provider:string;errorCode:string|null;resultCode:string|null;attempts:number;createdAt:string;updatedAt:string};
export type AdminJobList = {total:number;counts:{failed:number;retrying:number;needsEvidence:number;aiNotReady:number;evidenceInvalid:number};offset:number;limit:number;nextOffset:number|null;items:AdminJob[]};
export type AdminJobDetail = AdminJob & {deadlineAt:string;nextAttemptAt:string|null;leaseExpiresAt:string|null;deadlineExceeded:boolean;leaseExpired:boolean};

export type CollectionList = {total:number;offset:number;limit:number;nextOffset:number|null;items:{id:string;label:string;total:number;collected:number;remaining:number;available:boolean}[]};
export type CollectionDetail = {id:string;label:string;total:number;collected:number;offset:number;limit:number;nextOffset:number|null;items:{sourceId:string;caseNumber:string;ready:boolean;collectedAt:string|null}[]};
export type CollectedPrecedent = {batchId:string;label:string;sourceId:string;officialUrl:string;status:string;beforeHash:string|null;afterHash:string;candidate:PrecedentOriginal;current:PrecedentOriginal|null};
export type PrecedentOriginal = {title:string;caseNumber:string;court:string;date:string;issue:string|null;summary:string|null;decision:string};

export type CollectionHistory = {total:number;offset:number;limit:number;nextOffset:number|null;items:{id:string;batchId:string;sourceId:string;status:string;resultCode:string;revision:number|null;finishedAt:string;operator:string}[]};

export type CollectionSchedule = {enabled:boolean;timezone:string;heartbeatAt:string|null;worker:string;jobs:{kind:string;enabled:boolean;dailyAt:string;targets:number;status:string;code:string|null;failures:number;attempts:number;processed:number;retentionRemoved?:number;startedAt:string|null;finishedAt:string|null;lastSuccessAt:string|null;nextAttemptAt:string|null}[]};

export type PrivacyRetention = {asOf:string;readOnly:true;contentAccess:false;purgeImplemented:false;purgeReview?:{executionEnabled:false;scopes:{code:string;count:number;dependency:string}[];blockers:string[]};counts:Record<string,number>;temporaryBackups:{status:string;files:number|null;olderThan7Days:number|null;scope:string};backup:{enabled:boolean;status:string;lastSuccessAt:string|null;worker:string}|null;unassessed:string[]};
