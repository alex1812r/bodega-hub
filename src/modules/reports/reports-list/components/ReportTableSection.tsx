"use client";

import type { ReactNode } from "react";

import { CollapsibleSection } from "@/shared/components/CollapsibleSection";

import { useIsNarrowViewport } from "../hooks/useIsNarrowViewport";
import { REPORTS_TABLE_OPEN_KEY, useSessionSectionOpen } from "../hooks/useSessionSectionOpen";

type ReportTableSectionProps = {
  children: ReactNode;
  /** Una línea visible con la tabla plegada («Mostrando 1-10 de 35 registros»). */
  summary?: ReactNode;
};

/**
 * Tabla de un reporte con gráfico, debajo de él y plegable. En escritorio abre
 * desplegada (gráfico y detalle caben a la vez); en móvil abre plegada para que
 * el gráfico no quede a varias pantallas de los filtros. Lo que el usuario elija
 * se recuerda durante la sesión: al volver de un detalle la tabla está como la dejó.
 */
export function ReportTableSection({ children, summary }: ReportTableSectionProps) {
  const isNarrow = useIsNarrowViewport();
  const [isOpen, setIsOpen] = useSessionSectionOpen(REPORTS_TABLE_OPEN_KEY, !isNarrow);

  return (
    <CollapsibleSection onOpenChange={setIsOpen} open={isOpen} summary={summary} title="Tabla de datos">
      {children}
    </CollapsibleSection>
  );
}
