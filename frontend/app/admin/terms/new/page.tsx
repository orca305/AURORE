import { randomUUID } from "node:crypto";
import Link from "next/link";
import { TermForm } from "../../../_terms/term-form";
export const metadata = { title: "법률용어 등록 | AURORE" };
export default function NewTerm() {
  return (
    <>
      <Link href="/admin/terms" className="ui-button">
        목록으로
      </Link>
      <section className="results">
        <h2>법률용어 등록</h2>
        <TermForm requestId={randomUUID()} />
      </section>
    </>
  );
}
