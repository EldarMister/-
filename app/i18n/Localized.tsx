"use client";

import { cloneElement, Fragment, isValidElement, type ReactElement, type ReactNode } from "react";
import { useLanguage } from "./LanguageProvider";

const displayAttributes = ["aria-label", "aria-description", "title", "placeholder", "alt"] as const;
type ContentProps = Record<string, unknown> & { children?: ReactNode; translate?: string; dangerouslySetInnerHTML?: unknown };

/** Localize a component's own markup, leaving child component boundaries and form data alone. */
export function localizeContent(content: ReactNode, t: (source: string) => string): ReactNode {
  if (Array.isArray(content)) return content.map((node, index) => {
    const localized = localizeContent(node, t);
    return isValidElement(localized) && localized.key === null ? cloneElement(localized, { key: index }) : localized;
  });
  const node = content;
  if (typeof node === "string") return t(node);
  if (!isValidElement<ContentProps>(node)) return node;
  if (node.props.translate === "no" || node.props.dangerouslySetInnerHTML || ["script", "style"].includes(String(node.type))) return node;
  const props: ContentProps = {};
  for (const attribute of displayAttributes) {
    if (typeof node.props[attribute] === "string") props[attribute] = t(node.props[attribute]);
  }
  if ((typeof node.type === "string" || node.type === Fragment) && !["textarea", "code", "pre"].includes(String(node.type)) && node.props.children !== undefined) props.children = localizeContent(node.props.children, t);
  return Object.keys(props).length ? cloneElement(node as ReactElement<ContentProps>, props) : node;
}

export default function Localized({ children }: { children: ReactNode }) {
  const { t } = useLanguage();
  return <>{localizeContent(children, t)}</>;
}
