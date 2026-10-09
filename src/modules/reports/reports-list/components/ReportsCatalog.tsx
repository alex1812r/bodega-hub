"use client";

import { useId, useState } from "react";

import { CollapsibleSection } from "@/shared/components/CollapsibleSection";
import { EmptyState } from "@/shared/components/EmptyState";
import { Input } from "@/shared/components/Input";
import { cn } from "@/shared/utils/cn";

import {
  getReportById,
  groupReports,
  searchReports,
  type ReportDefinition,
  type ReportId,
} from "../config/reportCatalog";

/** Por debajo de `lg` el catálogo se cierra al elegir, para dejar el resultado a la vista. */
const COMPACT_CATALOG_QUERY = "(max-width: 1023px)";

type ReportsCatalogProps = {
  activeReportId: ReportId;
  /** Catálogo abierto al montar. Por defecto cerrado: la cabecera ya dice qué reporte se ve. */
  defaultOpen?: boolean;
  onSelect: (id: ReportId) => void;
  reports: readonly ReportDefinition[];
};

function isCompactViewport() {
  return typeof window.matchMedia === "function" && window.matchMedia(COMPACT_CATALOG_QUERY).matches;
}

/**
 * Catálogo de reportes agrupado (Ventas · Compras · Inventario · Dinero) con
 * búsqueda por nombre o descripción. Un solo componente para todos los anchos:
 * plegado muestra el reporte activo en la cabecera y no desplaza el resultado.
 */
export function ReportsCatalog({
  activeReportId,
  defaultOpen = false,
  onSelect,
  reports,
}: ReportsCatalogProps) {
  const headingId = useId();
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [search, setSearch] = useState("");
  const activeReport = reports.find((report) => report.id === activeReportId) ?? getReportById(activeReportId);
  const groups = groupReports(searchReports(reports, search));

  function handleSelect(id: ReportId) {
    onSelect(id);

    if (isCompactViewport()) {
      setIsOpen(false);
    }
  }

  return (
    <CollapsibleSection
      onOpenChange={setIsOpen}
      open={isOpen}
      summary={`${activeReport.description} Abre el catálogo para cambiar de reporte.`}
      title={
        <>
          <span className="font-normal text-on-surface-variant">Reporte: </span>
          {activeReport.name}
        </>
      }
    >
      <div className="space-y-4">
        <Input
          aria-label="Buscar reporte"
          autoComplete="off"
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar reporte por nombre o descripción"
          type="search"
          value={search}
        />

        {groups.length === 0 ? (
          <EmptyState
            description="Prueba con otra palabra, por ejemplo «ventas» o «stock»."
            title={`Ningún reporte coincide con «${search.trim()}»`}
          />
        ) : (
          <nav aria-label="Catálogo de reportes" className="grid gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-4">
            {groups.map((group) => {
              const groupHeadingId = `${headingId}-${group.id}`;

              return (
                <section aria-labelledby={groupHeadingId} className="min-w-0" key={group.id}>
                  <h4
                    className="mb-1.5 text-xs font-semibold tracking-wide text-on-surface-variant uppercase"
                    id={groupHeadingId}
                  >
                    {group.label}
                  </h4>
                  <ul className="space-y-1">
                    {group.reports.map((report) => {
                      const isActive = report.id === activeReportId;
                      const Icon = report.icon;

                      return (
                        <li key={report.id}>
                          <button
                            aria-current={isActive ? "true" : undefined}
                            className={cn(
                              "flex w-full cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                              isActive
                                ? "border-primary bg-primary/10"
                                : "border-transparent hover:bg-surface-container-low",
                            )}
                            onClick={() => handleSelect(report.id)}
                            type="button"
                          >
                            <Icon
                              aria-hidden
                              className={cn(
                                "mt-0.5 size-[1.125rem] shrink-0",
                                isActive ? "text-primary" : "text-on-surface-variant",
                              )}
                            />
                            <span className="min-w-0">
                              <span className="block text-sm font-medium text-on-surface">
                                {report.name}
                              </span>
                              <span className="block text-xs text-on-surface-variant">
                                {report.description}
                              </span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </nav>
        )}
      </div>
    </CollapsibleSection>
  );
}
