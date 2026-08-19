"use client";

import { Eye, Loader2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/shared/components/Button";

import {
  fetchReportsForExport,
  type ReportsExportDataset,
  type ReportsExportFilters,
} from "../../services/fetchReportsForExport";
import { ReportsExportPreviewModal } from "./ReportsExportPreviewModal";

type ReportsExportActionsProps = {
  exportFilters: ReportsExportFilters;
};

export function ReportsExportActions({ exportFilters }: ReportsExportActionsProps) {
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewData, setPreviewData] = useState<ReportsExportDataset | null>(null);
  const [exportedAt, setExportedAt] = useState<string | null>(null);

  const exportDisabled =
    isLoadingPreview ||
    (exportFilters.scope?.pathPrefix === "/api/platform/reports" &&
      exportFilters.scope.enabled === false);

  async function openPreview() {
    setIsLoadingPreview(true);
    setPreviewError(null);

    try {
      const nextExportedAt = new Date().toISOString();
      const data = await fetchReportsForExport(exportFilters);
      setExportedAt(nextExportedAt);
      setPreviewData(data);
      setPreviewOpen(true);
    } catch (error) {
      setPreviewError(
        error instanceof Error
          ? error.message
          : "No se pudo generar la vista previa de reportes.",
      );
    } finally {
      setIsLoadingPreview(false);
    }
  }

  function handlePreviewOpenChange(open: boolean) {
    setPreviewOpen(open);
    if (!open) {
      setPreviewData(null);
      setExportedAt(null);
    }
  }

  return (
    <div className="flex w-full flex-col gap-2 sm:w-auto">
      <Button
        className="gap-2 border-outline-variant bg-surface-container-lowest hover:bg-surface-container-low"
        disabled={exportDisabled}
        onClick={() => void openPreview()}
        variant="outline"
      >
        {isLoadingPreview ? (
          <Loader2 aria-hidden className="size-[1.125rem] shrink-0 animate-spin" />
        ) : (
          <Eye aria-hidden className="size-[1.125rem] shrink-0" />
        )}
        {isLoadingPreview ? "Generando vista previa..." : "Vista previa / exportar"}
      </Button>
      {previewError ? (
        <p className="text-xs text-error" role="alert">
          {previewError}
        </p>
      ) : null}

      <ReportsExportPreviewModal
        data={previewData}
        exportedAt={exportedAt}
        filters={exportFilters}
        onOpenChange={handlePreviewOpenChange}
        open={previewOpen}
      />
    </div>
  );
}
