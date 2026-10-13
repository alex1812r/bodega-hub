"use client";

import type { ReactNode } from "react";

import { CollapsibleSection } from "@/shared/components/CollapsibleSection";

import { REPORTS_TABLE_OPEN_KEY, useSessionSectionOpen } from "../hooks/useSessionSectionOpen";

type ReportTableSectionProps = {
  children: ReactNode;
  /** Una línea visible con la tabla plegada («Mostrando 1-10 de 35 registros»). */
  summary?: ReactNode;
};

/**
 * Tabla de un reporte con gráfico, debajo de él y plegable. Abre plegada en
 * todos los anchos (plan §4.9 REP-04 y §6.10): el gráfico es la lectura
 * principal y el detalle queda a un clic. Lo que el usuario elija se recuerda
 * durante la sesión: al volver de un detalle la tabla está como la dejó.
 */
export function ReportTableSection({ children, summary }: ReportTableSectionProps) {
  const [isOpen, setIsOpen] = useSessionSectionOpen(REPORTS_TABLE_OPEN_KEY, false);

  return (
    <CollapsibleSection onOpenChange={setIsOpen} open={isOpen} summary={summary} title="Tabla de datos">
      {children}
    </CollapsibleSection>
  );
}
