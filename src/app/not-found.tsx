import { SearchX } from "lucide-react";
import Link from "next/link";

import { Button } from "@/shared/components/Button";
import { EmptyState } from "@/shared/components/EmptyState";

/**
 * 404 de toda la app (POS-H4): direcciones que no existen y `notFound()` sin
 * `not-found.tsx` más cercano. No consulta la sesión: `/` ya reparte al inicio
 * del rol o al login, así que el enlace sirve con y sin sesión.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-1 items-center justify-center bg-background px-4 py-10">
      <div className="mx-auto w-full max-w-3xl rounded-lg border border-outline-variant bg-surface-container-lowest shadow-sm">
        <EmptyState
          action={
            <Button asChild size="sm">
              <Link href="/">Volver al inicio</Link>
            </Button>
          }
          description="La dirección no existe o cambió de lugar. Revisa el enlace o vuelve al inicio."
          icon={<SearchX aria-hidden="true" className="h-5 w-5" />}
          title="No encontramos esta página"
        />
      </div>
    </main>
  );
}
