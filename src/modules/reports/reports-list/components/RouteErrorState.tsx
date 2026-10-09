"use client";

import { QueryClientContext, type QueryKey } from "@tanstack/react-query";
import { useContext, useEffect } from "react";

import { ErrorState } from "@/shared/components/ErrorState";

type RouteErrorStateProps = {
  error: Error & { digest?: string };
  /** Consultas de la ruta (prefijo de su clave): se descartan antes de reintentar. */
  queryKey: QueryKey;
  /** `unstable_retry` de `error.tsx`: vuelve a pedir y a pintar el segmento. */
  retry: () => void;
  title: string;
};

/**
 * Contenido de un `error.tsx` de ruta: red de seguridad cuando un error escapa a
 * los límites de cada panel. En español y con el tema; nunca enseña el mensaje
 * del error (puede traer detalles internos), que queda en la consola.
 */
export function RouteErrorState({ error, queryKey, retry, title }: RouteErrorStateProps) {
  const queryClient = useContext(QueryClientContext);

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto w-full max-w-3xl rounded-lg border border-outline-variant bg-surface-container-lowest shadow-sm">
      <ErrorState
        description="Ocurrió un error inesperado al mostrar esta página. Vuelve a intentarlo; si se repite, recarga la página."
        onRetry={() => {
          // Sin esto se repintaría la misma respuesta que provocó el error.
          queryClient?.removeQueries({ queryKey });
          retry();
        }}
        title={title}
      />
    </div>
  );
}
