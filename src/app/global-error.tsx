"use client";

import "./globals.css";

import { useEffect } from "react";

import { RouteError } from "@/shared/components/RouteError";
import { applyTheme, getStoredTheme } from "@/shared/theme/theme";

/**
 * Red de seguridad del layout raíz (POS-H4). Sustituye al layout entero: trae su
 * `<html>`, su `<body>` y los estilos globales, y no cuenta con proveedores ni
 * con el script de tema del layout (por eso lo aplica al montar).
 */
export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    applyTheme(getStoredTheme());
  }, []);

  return (
    <html lang="es" className="h-full antialiased" suppressHydrationWarning>
      <body className="flex min-h-full flex-col">
        <title>Algo salió mal · BodegaHub ERP</title>
        <main className="flex min-h-dvh flex-1 items-center justify-center bg-background px-4 py-10">
          <RouteError error={error} retry={unstable_retry} title="Algo salió mal" />
        </main>
      </body>
    </html>
  );
}
