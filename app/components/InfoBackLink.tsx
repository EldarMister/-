"use client";

import type { MouseEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import styles from "./InfoPage.module.css";

const MENU_HREF = "/catalog/1";

export function InfoBackLink() {
  const router = useRouter();

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (window.history.length <= 1) return;
    event.preventDefault();
    router.back();
  }

  return (
    <Link
      aria-label="Вернуться назад"
      className={styles.back}
      href={MENU_HREF}
      onClick={handleClick}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M19 12H5m6 6-6-6 6-6" />
      </svg>
    </Link>
  );
}
