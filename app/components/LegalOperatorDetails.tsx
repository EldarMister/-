"use client";

import Localized from "../i18n/Localized";
import { LEGAL_DETAILS } from "../legalDetails";
import styles from "./LegalOperatorDetails.module.css";

const rows = [
  ["Оператор сервиса", LEGAL_DETAILS.operator],
  ["ИНН", LEGAL_DETAILS.inn],
  ["Регистрационный номер", LEGAL_DETAILS.registrationNumber],
  ["Адрес", LEGAL_DETAILS.address],
] as const;

export function LegalOperatorDetails({ className = "" }: { className?: string }) {
  return <Localized>{(
    <dl className={`${styles.details} ${className}`.trim()}>
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}:</dt>
          <dd translate="no">{value}</dd>
        </div>
      ))}
    </dl>
  )}</Localized>;
}
