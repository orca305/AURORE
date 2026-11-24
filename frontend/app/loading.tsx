// 메뉴를 눌렀을 때 서버에서 다음 화면이 오기 전에도 바로 화면이 바뀌도록 하는 로딩 화면(헤더·사이드바는 그대로 유지된다).
export default function Loading() {
  return (
    <main aria-busy="true" aria-label="화면을 불러오는 중" style={{ display: "grid", gap: "0.75rem", maxWidth: "60rem", margin: "0 auto", padding: "2rem 1rem" }}>
      {[40, 100, 100, 70].map((width, index) => (
        <div key={index} style={{ height: index ? "3.5rem" : "2rem", width: width + "%", borderRadius: "0.75rem", background: "var(--surface)", opacity: 0.7 }} />
      ))}
    </main>
  );
}
