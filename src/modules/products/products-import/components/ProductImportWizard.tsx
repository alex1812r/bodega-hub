"use client";

import { getPaginatedItems } from "@/lib/api/pagination";
import { ErrorState } from "@/shared/components/ErrorState";
import { LoadingState } from "@/shared/components/LoadingState";
import type { CategoryMock } from "@/shared/mocks/erp-data";

import { useCategories } from "../../hooks/useProducts";
import { useProductBulkImport } from "../hooks/useProductBulkImport";
import { ProductImportStepper } from "./shared/ProductImportStepper";
import { ProductImportWizardHeader } from "./shared/ProductImportWizardHeader";
import { ProductImportStep1Template } from "./step1-template/ProductImportStep1Template";
import { ProductImportStep2File } from "./step2-file/ProductImportStep2File";
import { ProductImportStep3Preview } from "./step3-preview/ProductImportStep3Preview";
import { ProductImportStep4Importing } from "./step4-importing/ProductImportStep4Importing";
import {
  downloadProductImportResultsCsv,
  ProductImportStep5Summary,
} from "./step5-summary/ProductImportStep5Summary";

export function ProductImportWizard() {
  const categories = useCategories();
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

  return (
    <div className="product-import-root flex flex-col gap-6 py-2">
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
