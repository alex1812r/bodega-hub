"use client";

import { RouteError } from "@/shared/components/RouteError";

/**
 * Red de seguridad de toda la app (POS-H4): recoge lo que escapa a una página sin
 * `error.tsx` propio. Va dentro del layout raíz (tema y proveedores) pero fuera
 * del `AppShell`, que monta cada página: por eso ofrece «Volver al inicio».
 */
export default function RootError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <main className="flex min-h-dvh flex-1 items-center justify-center bg-background px-4 py-10">
      <RouteError error={error} retry={unstable_retry} title="Algo salió mal" />
    </main>
  );
}
