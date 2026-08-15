import type { Metadata } from "next";
import AdminPanel from "./AdminPanel";
import "./admin.css";

export const metadata: Metadata = { title: "Админка", robots: { index: false, follow: false } };

export default function AdminPage() { return <AdminPanel />; }

