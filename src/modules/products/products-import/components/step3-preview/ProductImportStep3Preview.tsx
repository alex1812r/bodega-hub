"use client";

import { Upload } from "lucide-react";
import { useState } from "react";

import type { CategoryMock } from "@/shared/mocks/erp-data";
import { Button } from "@/shared/components/Button";

import type { ProductImportRowDraft } from "../../services/validateProductImportRows";
import type { ProductImportErrorPolicy, ProductImportValidatedRow } from "../../types";
import { ProductImportContinueOnErrorsToggle } from "./ProductImportContinueOnErrorsToggle";
import {
  ProductImportPreviewTable,
  type ProductImportPreviewFilter,
} from "./ProductImportPreviewTable";
import { ProductImportPreviewStats } from "./ProductImportPreviewStats";

type ProductImportStep3PreviewProps = {
  categories: CategoryMock[];
  errorCount: number;
  errorPolicy: ProductImportErrorPolicy;
  importableCount: number;
  onBack: () => void;
  onErrorPolicyChange: (policy: ProductImportErrorPolicy) => void;
  onImport: () => void;
  onUpdateRow: (draft: ProductImportRowDraft) => void;
  rows: ProductImportValidatedRow[];
  warningCount: number;
};

export function ProductImportStep3Preview({
  categories,
  errorCount,
  errorPolicy,
  importableCount,
  onBack,
  onErrorPolicyChange,
  onImport,
  onUpdateRow,
  rows,
  warningCount,
}: ProductImportStep3PreviewProps) {
  const [filter, setFilter] = useState<ProductImportPreviewFilter>("all");

  return (
    <div className="flex flex-col gap-6">
      <ProductImportPreviewStats
        errorCount={errorCount}
        importableCount={importableCount}
        onViewErrors={() => setFilter("errors")}
        warningCount={warningCount}
      />
      <ProductImportPreviewTable
        categories={categories}
        filter={filter}
        onFilterChange={setFilter}
        onUpdateRow={onUpdateRow}
        rows={rows}
      />
      <div className="flex flex-col items-stretch justify-between gap-4 rounded-xl border border-outline-variant bg-surface p-4 shadow-sm sm:flex-row sm:items-center">
        <Button onClick={onBack} type="button" variant="outline">
          Atrás
        </Button>
        <div className="flex flex-col items-stretch gap-4 sm:flex-row sm:items-center">
          <ProductImportContinueOnErrorsToggle
            onChange={onErrorPolicyChange}
            value={errorPolicy}
          />
          <Button
            className="gap-2 shadow-sm"
            disabled={importableCount === 0}
            onClick={() => void onImport()}
            type="button"
          >
            <Upload aria-hidden className="size-4" />
            Importar {importableCount} productos
          </Button>
        </div>
      </div>
    </div>
  );
}
