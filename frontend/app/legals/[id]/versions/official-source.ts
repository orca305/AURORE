export function officialUrl(value: string | null) {
  const url = value && URL.parse(value);
  return url && url.protocol === "https:" && url.hostname === "www.law.go.kr" &&
    !url.port && !url.username && !url.password ? url.href : null;
}
