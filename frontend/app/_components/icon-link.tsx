import Link from "next/link";

const paths = {
  plus: "M12 5v14M5 12h14",
  chat: "M20 11a8 8 0 0 1-8 8H5l-3 3V11a9 9 0 0 1 18 0ZM7 10h8M7 14h5",
  timeline: "M7 4v16M7 7h.01M7 12h.01M7 17h.01M11 7h9M11 12h7M11 17h9",
  download: "M12 4v11m-5-4 5 5 5-5M5 20h14",
  edit: "M4 20h4L19 9l-4-4L4 16v4ZM13.5 6.5l4 4",
} as const;

export type IconKind = keyof typeof paths;

/** 목록 위쪽 도구 버튼: 글자 대신 아이콘만 보이고, 설명은 툴팁과 스크린리더용 이름으로 둔다. */
export function IconLink({ href, kind, label, download = false, plain = false }: { href: string; kind: IconKind; label: string; download?: boolean; plain?: boolean }) {
  const icon = <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[kind]} /></svg>;
  if (download || plain) return <a href={href} className="ui-button icon-button" aria-label={label} title={label} {...(download ? { download: true } : {})}>{icon}</a>;
  return <Link href={href} prefetch={false} className="ui-button icon-button" aria-label={label} title={label}>{icon}</Link>;
}
