"use client";

import { QueryClientContext, type QueryKey } from "@tanstack/react-query";
import { useContext, useEffect } from "react";

import { ErrorState } from "@/shared/components/ErrorState";

type RouteErrorProps = {
  /** Texto bajo el título. Nunca el `message` del error. */
  description?: string;
  error: Error & { digest?: string };
  /**
   * Destino de «Volver al inicio»; `null` lo oculta. `/` reparte según la sesión:
   * al inicio del rol o al login.
   */
  homeHref?: string | null;
  /** Consultas de la ruta (prefijo de su clave): se descartan antes de reintentar. */
  queryKey?: QueryKey;
  /** `unstable_retry` de `error.tsx`: vuelve a pedir y a pintar el segmento. */
  retry: () => void;
  title: string;
};

const DEFAULT_DESCRIPTION =
  "Ocurrió un error inesperado al mostrar esta página. Vuelve a intentarlo; si se repite, recarga la página.";

/**
 * Contenido de un `error.tsx` de ruta: red de seguridad cuando un error escapa a
 * los límites de cada pantalla. En español y con el tema; nunca enseña el mensaje
 * ni la traza del error (pueden traer detalles internos), que quedan en la
 * consola. El `digest`, si existe, se muestra como referencia para soporte.
 *
 * No necesita proveedores: funciona también en `global-error.tsx`, que sustituye
 * al layout raíz.
 */
export function RouteError({
  description = DEFAULT_DESCRIPTION,
  error,
  homeHref = "/",
  queryKey,
  retry,
  title,
}: RouteErrorProps) {
  const queryClient = useContext(QueryClientContext);

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto w-full max-w-3xl rounded-lg border border-outline-variant bg-surface-container-lowest shadow-sm">
      <ErrorState
        description={description}
        onRetry={() => {
          if (queryKey) {
            // Sin esto se repintaría la misma respuesta que provocó el error.
            queryClient?.removeQueries({ queryKey });
          }

          retry();
        }}
        title={title}
      />
      {homeHref || error.digest ? (
        <div className="-mt-4 flex flex-col items-center gap-3 px-6 pb-8 text-center">
          {homeHref ? (
            // Enlace de documento, no de cliente: tras un error conviene cargar la app de cero.
            <a
              className="rounded-md text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              href={homeHref}
            >
              Volver al inicio
            </a>
          ) : null}
          {error.digest ? (
            <p className="break-all text-xs text-on-surface-variant">
              Referencia para soporte: <code className="font-mono">{error.digest}</code>
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
