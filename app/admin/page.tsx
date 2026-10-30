import type { Metadata } from "next";
import AdminPanel from "./AdminPanel";
import "./admin.css";
import { createPageMetadata } from "../seo";

export const metadata: Metadata = { ...createPageMetadata({ title: "Админка", description: "Управление сайтом ДААНА СУШИ.", path: "/admin", index: false }), manifest: "/admin/manifest.webmanifest", applicationName: "ДААНА · Управление", icons: { icon: "/admin/icon-192.png", apple: "/admin/icon-192.png" } };

export default function AdminPage() { return <AdminPanel />; }
