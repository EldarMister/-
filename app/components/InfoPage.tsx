import type { ReactNode } from "react";
import { InfoBackLink } from "./InfoBackLink";
import styles from "./InfoPage.module.css";

export function InfoPage({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: { label: string; href: string };
}) {
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <InfoBackLink />
          <h1>{title}</h1>
        </header>
        <article className={styles.card}>
          {children}
          {action ? <a className={styles.action} href={action.href}>{action.label}</a> : null}
        </article>
      </div>
    </main>
  );
}
