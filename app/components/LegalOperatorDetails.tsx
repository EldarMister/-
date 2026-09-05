import { LEGAL_DETAILS } from "../legalDetails";
import styles from "./LegalOperatorDetails.module.css";

const rows = [
  ["Оператор сервиса", LEGAL_DETAILS.operator],
  ["ИНН", LEGAL_DETAILS.inn],
  ["Регистрационный номер", LEGAL_DETAILS.registrationNumber],
  ["Адрес", LEGAL_DETAILS.address],
] as const;

export function LegalOperatorDetails({ className = "" }: { className?: string }) {
  return (
    <dl className={`${styles.details} ${className}`.trim()}>
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}:</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
