import type { Metadata } from "next";
import AdminPanel from "./AdminPanel";
import "./admin.css";
import { createPageMetadata } from "../seo";

export const metadata: Metadata = createPageMetadata({ title: "Админка", description: "Управление сайтом ДААНА СУШИ.", path: "/admin", index: false });

export default function AdminPage() { return <AdminPanel />; }
