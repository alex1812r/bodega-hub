"use client";

import type { QueryKey } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { PanelErrorBoundary } from "@/modules/reports/reports-list/components/PanelErrorBoundary";

const DASHBOARD_QUERY_KEY: QueryKey = ["dashboard"];

type DashboardCardBoundaryProps = {
  children: ReactNode;
  /** Prefijo de las consultas de la tarjeta; por defecto, las del dashboard. */
  queryKey?: QueryKey;
  /** Para tarjetas que reciben sus datos por props: al cambiar, se reintenta el render. */
  resetKey?: string;
};

/**
 * Límite de error de una tarjeta del dashboard (REP-F8 R-05): si su render lanza
 * por una respuesta malformada, solo ella muestra el error con «Reintentar»; el
 * resto del dashboard sigue vivo.
 */
export function DashboardCardBoundary({
  children,
  queryKey = DASHBOARD_QUERY_KEY,
  resetKey,
}: DashboardCardBoundaryProps) {
  return (
    <PanelErrorBoundary queryKey={queryKey} resetKey={resetKey} title="No pudimos mostrar esta tarjeta">
      {children}
    </PanelErrorBoundary>
  );
}
