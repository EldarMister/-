import type { ReactNode } from "react";
import Link from "next/link";
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
          <Link aria-label="Вернуться в меню" className={styles.back} href="/catalog/1">
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M19 12H5m6 6-6-6 6-6" />
            </svg>
          </Link>
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
