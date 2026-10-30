"use client";

import Localized from "../i18n/Localized";
import LanguageSelector from "../i18n/LanguageSelector";
import LocalizedPageTitle from "../i18n/LocalizedPageTitle";
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
  return <Localized>{(
    <main className={styles.page}>
      <LocalizedPageTitle title={title} />
      <div className={styles.shell}>
        <header className={styles.header}>
          <InfoBackLink />
          <h1>{title}</h1>
        </header>
        <div className={styles.language}><LanguageSelector /></div>
        <article className={styles.card}>
          {children}
          {action ? <a className={styles.action} href={action.href}>{action.label}</a> : null}
        </article>
      </div>
    </main>
  )}</Localized>;
}
