import type { ReactNode } from "react";
import { SiteHeader } from "../_components/site-header";
import styles from "./account.module.css";

export function AccountPanel({ title, children, signedIn = false }: {
  title: string;
  children: ReactNode;
  signedIn?: boolean;
}) {
  return <div className={styles.page}>
    <SiteHeader signedIn={signedIn} active="account" />
    <main className={styles.main}>
      <section className={styles.panel} aria-labelledby="account-title">
        <h1 id="account-title">{title}</h1>
        {children}
      </section>
    </main>
  </div>;
}
