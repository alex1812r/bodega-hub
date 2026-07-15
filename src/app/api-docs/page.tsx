import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { isDevToolkitEnabled } from "@/lib/api/dataSource";

import { ApiDocsClient } from "./ApiDocsClient";

export const metadata: Metadata = {
  title: "API Docs | Control Ventas ERP",
  description: "Documentacion visual de la API REST interna.",
};

export default function ApiDocsPage() {
  if (!isDevToolkitEnabled()) {
    redirect("/login");
  }

  return (
    <main className="min-h-screen bg-white dark:bg-slate-950">
      <ApiDocsClient />
    </main>
  );
}
