"use client";

import { getPaginatedItems } from "@/lib/api/pagination";
import { ErrorState } from "@/shared/components/ErrorState";
import { LoadingState } from "@/shared/components/LoadingState";
import { ProcessGuard } from "@/shared/components/ProcessGuard";
import type { CategoryMock } from "@/shared/mocks/erp-data";

import { useAllCategories } from "../../hooks/useProducts";
import { useProductBulkImport } from "../hooks/useProductBulkImport";
import type { ProductImportStatus, ProductImportStep } from "../types";
import { ProductImportStepper } from "./shared/ProductImportStepper";
import { getProductImportStepIndex, PRODUCT_IMPORT_STEPS } from "./shared/productImportSteps";
import { ProductImportWizardHeader } from "./shared/ProductImportWizardHeader";
import { ProductImportStep1Template } from "./step1-template/ProductImportStep1Template";
import { ProductImportStep2File } from "./step2-file/ProductImportStep2File";
import { ProductImportStep3Preview } from "./step3-preview/ProductImportStep3Preview";
import { ProductImportStep4Importing } from "./step4-importing/ProductImportStep4Importing";
import {
  downloadProductImportResultsCsv,
  ProductImportStep5Summary,
} from "./step5-summary/ProductImportStep5Summary";

type ProductImportGuardInput = {
  rowCount: number;
  status: ProductImportStatus;
  step: ProductImportStep;
};

/**
 * Hay un archivo cargado (o leyéndose) que se perdería al salir: desde el paso
 * del archivo hasta que la importación termina. La plantilla (paso 1), el paso
 * del archivo sin archivo y el resumen final salen sin preguntar.
 */
export function isProductImportGuarded({ rowCount, status, step }: ProductImportGuardInput) {
  if (step === "preview" || step === "importing") {
    return true;
  }

  return step === "file" && (status === "parsing" || rowCount > 0);
}

/** Nombre del proceso en la pregunta del guardia: paso y filas del archivo. */
export function getProductImportGuardLabel({ rowCount, step }: ProductImportGuardInput) {
  const position = `paso ${getProductImportStepIndex(step) + 1} de ${PRODUCT_IMPORT_STEPS.length}`;
  const rows = rowCount > 0 ? ` · ${rowCount} ${rowCount === 1 ? "fila" : "filas"}` : "";

  return `Importación de productos · ${position}${rows}`;
}

export function ProductImportWizard() {
  const categories = useAllCategories();
  const bulk = useProductBulkImport({
    categories: getPaginatedItems(categories.data),
  });

  if (categories.isLoading) {
    return (
      <LoadingState
        description="Cargando categorías para validar el archivo."
        title="Preparando importación..."
      />
    );
  }

  if (categories.isError) {
    return (
      <ErrorState
        description={categories.error.message}
        onRetry={() => void categories.refetch()}
        title="No se pudieron cargar las categorías"
      />
    );
  }

  const categoryList = getPaginatedItems(categories.data) as CategoryMock[];
  const guardInput: ProductImportGuardInput = {
    rowCount: bulk.validatedRows.length,
    status: bulk.status,
    step: bulk.step,
  };

  return (
    <div className="product-import-root flex flex-col gap-6 py-2">
      {/* El archivo no se puede guardar como borrador: salir lo descarta, y se pregunta antes. */}
      <ProcessGuard
        active={isProductImportGuarded(guardInput)}
        label={getProductImportGuardLabel(guardInput)}
        onLeave="discard"
      />
      <ProductImportWizardHeader step={bulk.step} />
      <ProductImportStepper currentStep={bulk.step} />

      {bulk.step === "template" ? (
        <ProductImportStep1Template
          categoryNames={categoryList.map((category) => category.name)}
          isDownloading={bulk.isDownloadingTemplate}
          onContinue={() => bulk.setStep("file")}
          onDownload={() => void bulk.downloadTemplate()}
          templateMessage={bulk.templateDownloadMessage}
        />
      ) : null}

      {bulk.step === "file" ? (
        <ProductImportStep2File
          errorMessage={bulk.errorMessage}
          fileName={bulk.fileName}
          isParsing={bulk.status === "parsing"}
          onBack={() => bulk.setStep("template")}
          onFileSelected={(file) => void bulk.parseFile(file)}
        />
      ) : null}

      {bulk.step === "preview" ? (
        <ProductImportStep3Preview
          categories={categoryList}
          errorCount={bulk.errorCount}
          errorPolicy={bulk.errorPolicy}
          importableCount={bulk.importableCount}
          onBack={() => bulk.setStep("file")}
          onErrorPolicyChange={bulk.setErrorPolicy}
          onImport={() => void bulk.startImport()}
          onUpdateRow={bulk.updatePreviewRow}
          rows={bulk.validatedRows}
          warningCount={bulk.warningCount}
        />
      ) : null}

      {bulk.step === "importing" ? (
        <ProductImportStep4Importing
          onCancel={bulk.cancelImport}
          progress={bulk.progress}
        />
      ) : null}

      {bulk.step === "summary" ? (
        <ProductImportStep5Summary
          cancelled={bulk.status === "cancelled"}
          onDownloadLog={() => downloadProductImportResultsCsv(bulk.results)}
          onReset={bulk.reset}
          results={bulk.results}
        />
      ) : null}
    </div>
  );
}
