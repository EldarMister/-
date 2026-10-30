"use client";

import { useAdminLanguage } from "./i18n";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

type Props = {
  title: string;
  description?: string;
  onClose: () => void;
  busy?: boolean;
  unsaved?: boolean;
  className?: string;
  children: ReactNode;
};

export default function AdminDialog({ title, description, onClose, busy = false, unsaved = false, className = "", children }: Props) {
  const { t } = useAdminLanguage();

  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  const titleId = useId();
  const descriptionId = useId();
  const [dirty, setDirty] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const dirtyRef = useRef(false);
  const unsavedRef = useRef(unsaved);
  const requestClose = () => {
    if (busyRef.current) return;
    if (dirtyRef.current || unsavedRef.current) setConfirmClose(true);
    else closeRef.current();
  };
  const requestCloseRef = useRef(requestClose);

  useEffect(() => { closeRef.current = onClose; busyRef.current = busy; }, [onClose, busy]);
  useEffect(() => { unsavedRef.current = unsaved; }, [unsaved]);
  useEffect(() => { requestCloseRef.current = requestClose; });
  useEffect(() => {
    if (!dirty && !unsaved) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, unsaved]);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    const dismissBackdrop = (event: MouseEvent) => { if (event.target === dialog && !busyRef.current) requestCloseRef.current(); };
    const containFocus = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const controls = [...dialog.querySelectorAll<HTMLElement>("button, a[href], input:not([type=hidden]), select, textarea, [tabindex]")]
        .filter((element) => !element.matches(":disabled") && element.tabIndex >= 0 && !element.closest("[inert]") && element.getClientRects().length > 0);
      const first = controls[0];
      const last = controls.at(-1);
      if (!first || !last) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    };
    dialog.addEventListener("click", dismissBackdrop);
    dialog.addEventListener("keydown", containFocus);
    dialog.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      dialog.removeEventListener("click", dismissBackdrop);
      dialog.removeEventListener("keydown", containFocus);
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className={`admin-dialog ${className}`}
      data-slot="dialog-content"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      aria-busy={busy}
      onCancel={(event) => { event.preventDefault(); requestClose(); }}
    >
      <header className="admin-dialog-header">
        <div><h2 id={titleId}>{title}</h2>{description && <p id={descriptionId}>{description}</p>}</div>
        <button type="button" className="admin-dialog-close" aria-label={t("Закрыть окно")} disabled={busy} onClick={requestClose}>×</button>
      </header>
      <div className="admin-dialog-body" onInput={() => { dirtyRef.current = true; setDirty(true); }} onChange={() => { dirtyRef.current = true; setDirty(true); }} onClickCapture={(event) => {
        if ((event.target as HTMLElement).closest("[data-dialog-dismiss]")) { event.preventDefault(); event.stopPropagation(); requestClose(); }
      }}>{children}</div>
      {confirmClose && <aside className="admin-discard-confirm" role="alert"><strong>{t("Есть несохранённые изменения")}</strong><p>{t("При закрытии окна изменения будут потеряны.")}</p><div><button type="button" onClick={() => setConfirmClose(false)}>{t("Продолжить редактирование")}</button><button type="button" className="danger" onClick={() => closeRef.current()}>{t("Не сохранять и закрыть")}</button></div></aside>}
    </dialog>
  );
}
