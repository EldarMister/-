import type { NextFunction, Request, Response } from "express";

export const adminRoles = ["OWNER", "ADMIN", "MANAGER"] as const;
export type AdminRole = typeof adminRoles[number];
const sections: Record<string, [string, string[]]> = {
  dashboard: ["Обзор", ["view"]], orders: ["Заказы", ["view", "status", "export"]],
  users: ["Пользователи", ["view", "edit"]], products: ["Товары", ["view", "create", "edit", "delete"]],
  categories: ["Категории", ["view", "create", "edit", "delete"]], locations: ["Точки самовывоза", ["view", "create", "edit", "delete"]],
  schedules: ["Время работы", ["view", "edit"]],
  promotions: ["Акции", ["view", "create", "edit", "delete"]], loyalty: ["Награды", ["view", "edit", "adjust"]],
  settings: ["Настройки", ["view", "edit"]], staff: ["Персонал", ["view", "create", "edit", "access"]],
  analytics: ["Аналитика", ["view", "export"]], audit: ["Журнал действий", ["view"]],
};
const actionLabels: Record<string,string> = {view:"Просмотр",create:"Создание",edit:"Редактирование",delete:"Архивирование",export:"Экспорт",status:"Смена статуса",adjust:"Корректировка наград",access:"Роли и права (только владелец)"};
export const permissionDefinitions = Object.entries(sections).flatMap(([section,[sectionLabel,actions]]) => actions.map(action => ({key:`${section}.${action}`,section,sectionLabel,action,label:actionLabels[action]})));
const all = permissionDefinitions.map(p=>p.key);
export const roleDefaults: Record<AdminRole,string[]> = {OWNER:all,ADMIN:all.filter(p=>!["staff.access","staff.create"].includes(p)),MANAGER:["orders.view","orders.status","users.view","users.edit"]};
export function validRole(value: unknown): value is AdminRole { return adminRoles.includes(value as AdminRole); }
export function effectivePermissions(role: AdminRole, overrides: Record<string,boolean|null> = {}): string[] {
  if (role === "OWNER") return [...all];
  const granted=all.filter(key => !["staff.access","staff.create"].includes(key) && (overrides[key] === true || (overrides[key] !== false && roleDefaults[role].includes(key))));
  return granted.filter(key=>(key.endsWith(".view")||granted.includes(`${key.split(".")[0]}.view`))&&(key!=="loyalty.adjust"||granted.includes("users.view")));
}
export function hasPermission(user: {role:AdminRole;permissions:string[]}, permission: string) { return user.role === "OWNER" || user.permissions.includes(permission); }
export function requiredPermission(method:string,path:string): string | string[] | null {
  const parts = path.replace(/^\/api\/admin\/?/,"").replace(/^\//,"").split("/");
  const [resource,,action] = parts;
  if (["session", "events", "notifications", "push"].includes(resource)) return null;
  if (resource === "upload") return ["products.create","products.edit","promotions.create","promotions.edit","loyalty.edit"];
  if (["geocode","yandex-map-link"].includes(resource)) return ["locations.create","locations.edit"];
  if (resource === "staff" && action === "access") return "staff.access";
  if (resource === "orders" && action === "status") return "orders.status";
  if (resource === "customers" && action === "orders") return "orders.view";
  if (resource === "customers" && parts.includes("rewards")) return "loyalty.adjust";
  if (resource === "settings" && parts[1] === "rewards") return "loyalty.edit";
  if (resource === "settings" && method === "GET") return ["settings.view","loyalty.view"];
  const section = resource === "customers" ? "users" : ["coin-withdrawals","nft-withdrawals"].includes(resource) ? "loyalty" : resource;
  if (!sections[section]) return "__denied__";
  const operation = parts.includes("export") ? "export" : method === "GET" ? "view" : method === "POST" ? "create" : method === "DELETE" ? "delete" : "edit";
  return `${section}.${operation}`;
}
export function requireAdminPermission(request:Request,response:Response,next:NextFunction) {
  const permission=requiredPermission(request.method,request.path);
  const user=response.locals.admin;
  const customerPath=request.path.replace(/^\/api\/admin\/?/,"").replace(/^\//,"").split("/")[0]==="customers";
  const allowed=(!customerPath||hasPermission(user,"users.view")) && (permission===null || (Array.isArray(permission) ? permission.some(p=>hasPermission(user,p)) : hasPermission(user,permission)));
  if (!allowed) return response.status(403).json({error:"Недостаточно прав для этого действия"});
  response.setHeader("Cache-Control","no-store");
  next();
}
