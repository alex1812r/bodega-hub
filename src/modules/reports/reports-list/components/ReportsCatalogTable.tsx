"use client";

import { type ReportDefinition } from "../config/reportCatalog";
import { ReportsStatusBadge } from "./ReportsStatusBadge";
import { cn } from "@/shared/utils/cn";

type ReportsCatalogTableProps = {
  activeReportId: string;
  onSelect: (id: ReportDefinition["id"]) => void;
  reports: ReportDefinition[];
};

export function ReportsCatalogTable({
  activeReportId,
  onSelect,
  reports,
}: ReportsCatalogTableProps) {
  return (
    <section className="hidden overflow-hidden rounded-lg border border-outline-variant bg-surface-container-lowest shadow-sm lg:block">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-outline-variant bg-surface-container-low text-xs font-medium text-on-surface-variant">
              <th className="px-4 py-3 font-medium">Nombre del reporte</th>
              <th className="px-4 py-3 font-medium">Periodo sugerido</th>
              <th className="px-4 py-3 font-medium">Descripcion</th>
              <th className="px-4 py-3 font-medium">Estado</th>
            </tr>
          </thead>
          <tbody className="text-sm text-on-surface">
            {reports.map((report) => {
              const isActive = report.id === activeReportId;
              const Icon = report.icon;

              return (
                <tr
                  className={cn(
                    "cursor-pointer border-b border-outline-variant/50 transition-colors last:border-b-0 hover:bg-surface-container-low",
                    isActive && "bg-primary/5 hover:bg-primary/10",
                  )}
                  key={report.id}
                  onClick={() => onSelect(report.id)}
                >
                  <td
                    className={cn(
                      "px-4 py-3 font-medium",
                      isActive ? "text-primary" : "text-foreground",
                    )}
                  >
                    <span className="inline-flex items-center gap-2">
                      <Icon
                        aria-hidden
                        className={cn(
                          "size-[1.125rem] shrink-0",
                          isActive ? "text-primary" : "text-outline",
                        )}
                      />
                      {report.name}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-on-surface-variant">{report.period}</td>
                  <td className="px-4 py-3 text-on-surface-variant">{report.description}</td>
                  <td className="px-4 py-3">
                    <ReportsStatusBadge />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
