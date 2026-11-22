export const pageSizes = [10, 20, 50] as const;
export function parsePageSize(value: unknown): number {
  return typeof value === "string" && /^(10|20|50)$/.test(value) ? Number(value) : 10;
}
