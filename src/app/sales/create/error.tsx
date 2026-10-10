"use client";

import { RouteError } from "@/shared/components/RouteError";

/**
 * Red de seguridad del POS (POS-H4). Se pinta dentro del `AppShell` que monta
 * `layout.tsx`, así el vendedor no pierde el menú. El carrito sigue en su
 * borrador: «Reintentar» lo recupera.
 */
export default function SalesCreateError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <RouteError
        error={error}
        homeHref={null}
        retry={unstable_retry}
        title="No pudimos mostrar el punto de venta"
      />
    </div>
  );
}
