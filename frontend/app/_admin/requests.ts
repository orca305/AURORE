import { currentToken } from "../_auth/session";

export type AdminOverview = {
  asOf: string; personalDataAccess: false;
  counts: { members: number; conversations: number; legals: number; versions: number; provisions: number; precedents: number; snapshots: number };
  jobs: { status: string; count: number }[];
  recentJobs: { id: string; status: string; provider: string; attempts: number; errorCode: string | null; createdAt: string; updatedAt: string }[];
  recentSources: { id: string; source: string; contentType: string; collectedAt: string }[];
};

export async function requestAdmin(path: "ai-jobs" | `ai-jobs/${string}` | "activity" | "members" | `members/${string}` | "session" | "overview" | "legal-refresh" | "legal-refresh/processing-history" | `legal-refresh/reviews/${string}` | "precedent-reviews" | "precedent-reviews/history" | `precedent-reviews/${string}`, query?: URLSearchParams) {
  const token = await currentToken();
  if (!token) return null;
  try {
    return await fetch(new URL("/admin/" + path + (query ? "?" + query.toString() : ""), process.env.BACKEND_URL || "http://127.0.0.1:3001"), {
      headers: { Authorization: "Bearer " + token }, cache: "no-store", signal: AbortSignal.timeout(8000),
    });
  } catch { return null; }
}

export type RefreshOverview = {
  asOf: string; initialized: boolean; fromDate: string | null; lastCompletedDate: string | null; nextDate: string | null;
  summary: {runs: number; failures: number; pending: number; corrections: number}; historyLimit: number;
  history: {id: string; date: string; status: "STAGED" | "FAILED"; recordedAt: string; candidates: number; editions: number; corrections: number}[];
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

export type AdminJob = {id:string;status:string;provider:string;errorCode:string|null;attempts:number;createdAt:string;updatedAt:string};
export type AdminJobList = {total:number;counts:{failed:number;retrying:number};offset:number;limit:number;nextOffset:number|null;items:AdminJob[]};
export type AdminJobDetail = AdminJob & {deadlineAt:string;nextAttemptAt:string|null;leaseExpiresAt:string|null;deadlineExceeded:boolean;leaseExpired:boolean};
