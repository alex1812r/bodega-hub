import type { ProductImportStep } from "../../types";

export const PRODUCT_IMPORT_STEPS: ReadonlyArray<{
  id: ProductImportStep;
  label: string;
}> = [
  { id: "template", label: "Plantilla" },
  { id: "file", label: "Archivo" },
  { id: "preview", label: "Preview" },
  { id: "importing", label: "Importación" },
  { id: "summary", label: "Resumen" },
] as const;

export function getProductImportStepIndex(step: ProductImportStep): number {
  return PRODUCT_IMPORT_STEPS.findIndex((item) => item.id === step);
}
