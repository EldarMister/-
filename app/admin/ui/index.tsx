"use client";

// Adapted from shadcnstore/shadcn-dashboard-landing-template (MIT).
// Source: nextjs-version/src/components/ui/{card,table,button,badge}.tsx.
// The template's slots and composition are kept; styles are scoped to the admin.
import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from "react";

const cx = (...values: Array<string | undefined | false>) => values.filter(Boolean).join(" ");

export function Card({ className, size = "default", ...props }: ComponentProps<"div"> & { size?: "default" | "sm" }) {
  return <div data-slot="card" data-size={size} className={cx("ui-card", className)} {...props} />;
}
export function CardHeader({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="card-header" className={cx("ui-card-header", className)} {...props} />;
}
export function CardTitle({ className, children, ...props }: ComponentProps<"h2">) {
  return <h2 data-slot="card-title" className={cx("ui-card-title", className)} {...props}>{children}</h2>;
}
export function CardDescription({ className, ...props }: ComponentProps<"p">) {
  return <p data-slot="card-description" className={cx("ui-card-description", className)} {...props} />;
}
export function CardContent({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="card-content" className={cx("ui-card-content", className)} {...props} />;
}
export function CardAction({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="card-action" className={cx("ui-card-action", className)} {...props} />;
}
export function CardFooter({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="card-footer" className={cx("ui-card-footer", className)} {...props} />;
}
export function Button({ variant = "outline", size = "default", className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "outline" | "secondary" | "ghost" | "destructive" | "link"; size?: "default" | "sm" | "lg" | "icon" | "icon-sm" }) {
  return <button data-slot="button" data-variant={variant} data-size={size} className={cx("ui-button", variant === "default" && "admin-primary", variant === "destructive" && "danger", className)} {...props} />;
}
export function Badge({ variant = "secondary", className, ...props }: ComponentProps<"span"> & { variant?: "secondary" | "success" | "warning" | "destructive" | "outline" }) {
  return <span data-slot="badge" data-variant={variant} className={cx("ui-badge", className)} {...props} />;
}
export function Table({ className, ...props }: ComponentProps<"table">) {
  return <div data-slot="table-container" className="ui-table-container"><table data-slot="table" className={cx("ui-table", className)} {...props} /></div>;
}
export const DataTable = Table;
export function TableHeader(props: ComponentProps<"thead">) { return <thead data-slot="table-header" {...props} />; }
export function TableBody(props: ComponentProps<"tbody">) { return <tbody data-slot="table-body" {...props} />; }
export function TableRow(props: ComponentProps<"tr">) { return <tr data-slot="table-row" {...props} />; }
export function TableHead(props: ComponentProps<"th">) { return <th data-slot="table-head" {...props} />; }
export function TableCell(props: ComponentProps<"td">) { return <td data-slot="table-cell" {...props} />; }
export function PageHeading({ title, description, children }: { title: string; description?: string; children?: ReactNode }) {
  return <header className="section-title"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{children}</header>;
}
export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="admin-empty-state"><span className="admin-empty-icon" aria-hidden="true">◫</span><h3>{title}</h3>{children}</div>;
}
export function SidebarHeader({ className, ...props }: ComponentProps<"div">) { return <div data-slot="sidebar-header" className={cx("ui-sidebar-header", className)} {...props} />; }
export function SidebarContent({ className, ...props }: ComponentProps<"div">) { return <div data-slot="sidebar-content" className={cx("ui-sidebar-content", className)} {...props} />; }
export function SidebarFooter({ className, ...props }: ComponentProps<"div">) { return <div data-slot="sidebar-footer" className={cx("ui-sidebar-footer", className)} {...props} />; }
export function Separator({ orientation = "horizontal", className }: { orientation?: "horizontal" | "vertical"; className?: string }) { return <div role="separator" aria-orientation={orientation} data-slot="separator" className={cx("ui-separator", `is-${orientation}`, className)} />; }
