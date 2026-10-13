"use client";

import { createContext, useContext, type ReactNode } from "react";

import { useReportReady } from "@/shared/hooks/useReportReady";

const ReportPanelReadyContext = createContext<(() => void) | undefined>(undefined);

type ReportPanelReadyProviderProps = {
  children: ReactNode;
  /** Estable e idempotente (un `useCallback` sobre un `setState`). */
  onReady: (() => void) | undefined;
};

/**
 * Reparte a los paneles de un reporte el aviso de «datos pintados» que la
 * pantalla usa como `ready` de `useScrollRestoration`. Sin proveedor (plataforma,
 * una prueba, un story) los paneles no avisan a nadie.
 */
export function ReportPanelReadyProvider({ children, onReady }: ReportPanelReadyProviderProps) {
  return <ReportPanelReadyContext.Provider value={onReady}>{children}</ReportPanelReadyContext.Provider>;
}

/**
 * Lo llama el panel del reporte activo con `true` cuando la consulta que decide
 * su alto terminó —con filas, vacía o con error— y su contenido ya está montado.
 * El aviso sale en un efecto de layout: la pantalla restaura el scroll en el
 * mismo fotograma en que aparece el contenido.
 */
export function useReportPanelReady(ready: boolean): void {
  useReportReady(ready, useContext(ReportPanelReadyContext));
}

/** Avisa al montarse: para los estados finales que no pasan por una consulta (el panel de error). */
export function ReportPanelReadySignal() {
  useReportPanelReady(true);

  return null;
}
