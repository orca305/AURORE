import { currentToken } from "../_auth/session";

export type AdminOverview = {
  asOf: string; personalDataAccess: false;
  counts: { members: number; conversations: number; legals: number; versions: number; provisions: number; precedents: number; snapshots: number };
  jobs: { status: string; count: number }[];
  recentJobs: { id: string; status: string; provider: string; attempts: number; errorCode: string | null; createdAt: string; updatedAt: string }[];
  recentSources: { id: string; source: string; contentType: string; collectedAt: string }[];
};

export async function requestAdmin(path: "session" | "overview") {
  const token = await currentToken();
  if (!token) return null;
  try {
    return await fetch(new URL("/admin/" + path, process.env.BACKEND_URL || "http://127.0.0.1:3001"), {
      headers: { Authorization: "Bearer " + token }, cache: "no-store", signal: AbortSignal.timeout(8000),
    });
  } catch { return null; }
}
