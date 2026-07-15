import { ChevronRight, Package } from "lucide-react";
import Link from "next/link";

import { cn } from "@/shared/utils/cn";

import type { ProductImportStep } from "../../types";

type ProductImportWizardHeaderProps = {
  step: ProductImportStep;
};

export function ProductImportWizardHeader({ step }: ProductImportWizardHeaderProps) {
  const isSummary = step === "summary";

  return (
    <div className={cn("flex flex-col gap-2", isSummary ? "mb-0" : "mb-4")}>
      {isSummary ? (
        <nav
          aria-label="Ruta"
          className="mb-2 flex items-center gap-2 text-sm text-outline"
        >
          <Package aria-hidden className="size-4" />
          <Link className="hover:text-primary" href="/products">
            Productos
          </Link>
          <ChevronRight aria-hidden className="size-4" />
          <span className="font-medium text-primary">Importación Masiva</span>
        </nav>
      ) : null}
      <h1
        className={cn(
          "text-on-surface",
          isSummary
            ? "text-2xl font-semibold tracking-tight md:text-3xl"
            : "text-2xl font-semibold md:text-[1.75rem]",
        )}
      >
        {isSummary ? "Resumen de Importación" : "Importación Masiva de Productos"}
      </h1>
      <p className="text-sm text-on-surface-variant md:text-base">
        {isSummary
          ? "El proceso de carga masiva ha concluido. Revisa los resultados a continuación."
          : "Añade o actualiza el catálogo de tu tienda mediante un archivo Excel (.xlsx). Sigue los pasos cuidadosamente para asegurar la integridad de los datos."}
      </p>
    </div>
  );
}
