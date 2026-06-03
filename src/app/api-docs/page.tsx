import type { Metadata } from "next";

import { ApiDocsClient } from "./ApiDocsClient";

export const metadata: Metadata = {
  title: "API Docs | Control Ventas ERP",
  description: "Documentacion visual de la API REST interna.",
};

export default function ApiDocsPage() {
  return (
    <main className="min-h-screen bg-white dark:bg-slate-950">
      <ApiDocsClient />
    </main>
  );
}
