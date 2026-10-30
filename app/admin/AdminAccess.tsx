"use client";

import { createContext, useContext, type ReactNode } from "react";

export type AdminUser = { id: number; name: string; email: string; role: "OWNER" | "ADMIN" | "MANAGER"; active: boolean; permissions: string[]; overrides?: Record<string, boolean> };
const AdminAccess = createContext<{ user: AdminUser | null; can: (permission: string) => boolean }>({ user: null, can: () => false });
export function AdminAccessProvider({ user, children }: { user: AdminUser; children: ReactNode }) {
  return <AdminAccess.Provider value={{ user, can: (permission) => user.role === "OWNER" || user.permissions.includes(permission) }}>{children}</AdminAccess.Provider>;
}
export const useAdminAccess = () => useContext(AdminAccess);
