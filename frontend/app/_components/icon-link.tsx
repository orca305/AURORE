import Link from "next/link";

const paths = {
  plus: "M12 5v14M5 12h14",
  chat: "M20 11a8 8 0 0 1-8 8H5l-3 3V11a9 9 0 0 1 18 0ZM7 10h8M7 14h5",
  timeline: "M7 4v16M7 7h.01M7 12h.01M7 17h.01M11 7h9M11 12h7M11 17h9",
  download: "M12 4v11m-5-4 5 5 5-5M5 20h14",
  edit: "M4 20h4L19 9l-4-4L4 16v4ZM13.5 6.5l4 4",
  book: "M12 5v15M12 5C9 3 5 3 2 4v15c3-1 7-1 10 1 3-2 7-2 10-1V4c-3-1-7-1-10 1Z",
  chatPlus: "M21 11.5a8.4 8.4 0 0 1-9 8.4 8.6 8.6 0 0 1-3.8-.9L3 20l1.3-4.7A8.4 8.4 0 1 1 21 11.5ZM12 8.5v6M9 11.5h6",
  eye: "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12ZM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z",
  compare: "M6 3v12a3 3 0 0 0 3 3h3M18 21V9a3 3 0 0 0-3-3h-3M3 6h6M15 18h6",
  squarePen: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z",
  folderPlus: "M3 6h7l2 2h9v12H3zM12 11v6M9 14h6",
  external: "M14 4h6v6M20 4l-9 9M18 14v6H4V6h6",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
} as const;

export type IconKind = keyof typeof paths;

/** 목록 위쪽 도구 버튼: 글자 대신 아이콘만 보이고, 설명은 툴팁과 스크린리더용 이름으로 둔다. */
export function IconLink({ href, kind, label, download = false, plain = false }: { href: string; kind: IconKind; label: string; download?: boolean; plain?: boolean }) {
  const icon = <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[kind]} /></svg>;
  if (download || plain) return <a href={href} className="ui-button icon-button" aria-label={label} title={label} {...(download ? { download: true } : {})}>{icon}</a>;
  return <Link href={href} prefetch={false} className="ui-button icon-button" aria-label={label} title={label}>{icon}</Link>;
}
