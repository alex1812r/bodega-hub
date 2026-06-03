"use client";

import { EntityListPage } from "@/shared/components/EntityListPage";

import { ProductImportWizard } from "./components/ProductImportWizard";

export function ProductsImportPage() {
  return (
    <EntityListPage
      description="Carga decenas de productos desde Excel con validacion por fila y progreso en tiempo real."
      title="Importar productos"
    >
      <ProductImportWizard />
    </EntityListPage>
  );
}
