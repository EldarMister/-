"use client";

import { useAdminLanguage } from "./i18n";

import { useCallback, useEffect, useRef, useState } from "react";

export type AdminPage<T> = { items: T[]; total: number; limit: number; offset: number };
export type AdminListRequest = <T = unknown>(path: string, options?: RequestInit) => Promise<T>;

export function usePagedAdminList<T>(request: AdminListRequest, endpoint: string, query: string, refreshSignal: unknown, pageSize = 24, refreshKey = 0) {
  const [page, setPage] = useState(0);
  const [data, setData] = useState<AdminPage<T>>({ items: [], total: 0, limit: pageSize, offset: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const reload = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    try {
      const parameters = new URLSearchParams(query);
      parameters.set("limit", String(pageSize));
      parameters.set("offset", String(page * pageSize));
      const result = await request<AdminPage<T>>(`${endpoint}?${parameters}`);
      if (current !== generation.current) return;
      if (!Array.isArray(result.items)) throw new Error("Не удалось прочитать список. Обновите страницу.");
      if (page > 0 && !result.items.length && result.total > 0) { setPage(Math.max(0, Math.ceil(result.total / pageSize) - 1)); return; }
      setData(result); setError("");
    } catch (reason) {
      if (current === generation.current) setError(reason instanceof Error ? reason.message : "Не удалось загрузить список.");
    } finally { if (current === generation.current) setLoading(false); }
  }, [request, endpoint, query, page, pageSize]);
  useEffect(() => {
    const timer = window.setTimeout(() => void reload(), 200);
    return () => { window.clearTimeout(timer); generation.current += 1; };
  }, [reload, refreshSignal, refreshKey]);
  return { ...data, page, setPage, loading, error, reload };
}

export function Pagination({ page, total, limit, loading, onPage }: { page: number; total: number; limit: number; loading?: boolean; onPage: (page: number) => void }) {
  const { t } = useAdminLanguage();

  const pages = Math.max(1, Math.ceil(total / limit));
  return <footer className="admin-pagination"><span>{total ? t("{v0}–{v1} из {v2}", { v0: page * limit + 1, v1: Math.min((page + 1) * limit, total), v2: total }) : t("Нет записей")}</span><div><button type="button" disabled={loading || page === 0} onClick={() => onPage(page - 1)} aria-label={t("Предыдущая страница")}>←</button><span>{t("Страница {page} из {pages}", { page: page + 1, pages })}</span><button type="button" disabled={loading || page + 1 >= pages} onClick={() => onPage(page + 1)} aria-label={t("Следующая страница")}>→</button></div></footer>;
}
