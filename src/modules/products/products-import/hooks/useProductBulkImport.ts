"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";

import type { CategoryMock } from "@/shared/mocks/erp-data";

import { productsQueryKeys } from "../../hooks/useProducts";
import { downloadProductImportTemplateFromApi } from "../services/buildProductImportTemplate";
import { fetchExistingSkus } from "../services/fetchExistingSkus";
import { logProductImportParseSummary } from "../services/logProductImportValidation";
import { parseProductImportWorkbook } from "../services/parseProductImportWorkbook";
import {
  updateImportRowDraft,
  type ProductImportRowDraft,
} from "../services/validateProductImportRows";
import { runProductImportJob } from "../services/runProductImportJob";
import type {
  ProductImportErrorPolicy,
  ProductImportProgress,
  ProductImportRowResult,
  ProductImportStatus,
  ProductImportStep,
  ProductImportValidatedRow,
} from "../types";

type UseProductBulkImportOptions = {
  categories?: CategoryMock[];
};

export function useProductBulkImport({ categories = [] }: UseProductBulkImportOptions = {}) {
  const queryClient = useQueryClient();
  const abortRef = useRef<AbortController | null>(null);
  const existingSkusRef = useRef<Set<string>>(new Set());

  const [status, setStatus] = useState<ProductImportStatus>("idle");
  const [step, setStep] = useState<ProductImportStep>("template");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [validatedRows, setValidatedRows] = useState<ProductImportValidatedRow[]>([]);
  const [results, setResults] = useState<ProductImportRowResult[]>([]);
  const [progress, setProgress] = useState<ProductImportProgress>({
    total: 0,
    processed: 0,
    succeeded: 0,
    failed: 0,
  });
  const [errorPolicy, setErrorPolicy] = useState<ProductImportErrorPolicy>("continue");
  const [fileName, setFileName] = useState<string | null>(null);
  const [isDownloadingTemplate, setIsDownloadingTemplate] = useState(false);
  const [templateDownloadMessage, setTemplateDownloadMessage] = useState<string | null>(null);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus("idle");
    setStep("template");
    setErrorMessage(null);
    setValidatedRows([]);
    setResults([]);
    setProgress({ total: 0, processed: 0, succeeded: 0, failed: 0 });
    setFileName(null);
    setTemplateDownloadMessage(null);
  }, []);

  const downloadTemplate = useCallback(async () => {
    setErrorMessage(null);
    setTemplateDownloadMessage(null);
    setIsDownloadingTemplate(true);

    try {
      const result = await downloadProductImportTemplateFromApi(categories);

      if (result.error) {
        setTemplateDownloadMessage(result.error);
      } else if (result.source === "api") {
        setTemplateDownloadMessage("Plantilla descargada desde el servidor.");
      }
    } finally {
      setIsDownloadingTemplate(false);
    }
  }, [categories]);

  const parseFile = useCallback(
    async (file: File) => {
      setStatus("parsing");
      setErrorMessage(null);
      setFileName(file.name);

      try {
        if (!file.name.toLowerCase().endsWith(".xlsx")) {
          throw new Error("Solo se aceptan archivos .xlsx");
        }

        const buffer = await file.arrayBuffer();
        const existingSkus = await fetchExistingSkus();
        existingSkusRef.current = existingSkus;
        const rows = parseProductImportWorkbook(buffer, categories, existingSkus);

        logProductImportParseSummary({
          categoriesLoaded: categories.length,
          fileName: file.name,
          rows,
        });

        setValidatedRows(rows);
        setStatus("validated");
        setStep("preview");
      } catch (error) {
        setStatus("error");
        setErrorMessage(error instanceof Error ? error.message : "No se pudo leer el archivo.");
        setStep("file");
      }
    },
    [categories],
  );

  const startImport = useCallback(
    async (options?: { onError?: ProductImportErrorPolicy }) => {
      const policy = options?.onError ?? errorPolicy;
      const importable = validatedRows.filter((row) => row.status !== "error" && row.input);

      if (importable.length === 0) {
        setErrorMessage("No hay filas validas para importar.");
        return;
      }

      abortRef.current = new AbortController();
      setStatus("importing");
      setStep("importing");
      setErrorMessage(null);
      setResults([]);
      setProgress({
        total: importable.length,
        processed: 0,
        succeeded: 0,
        failed: 0,
      });

      try {
        const jobResults = await runProductImportJob({
          rows: validatedRows,
          onError: policy,
          signal: abortRef.current.signal,
          onProgress: setProgress,
        });

        setResults(jobResults);
        await queryClient.invalidateQueries({ queryKey: productsQueryKeys.all });

        if (abortRef.current.signal.aborted) {
          setStatus("cancelled");
        } else {
          setStatus("done");
        }

        setStep("summary");
      } catch (error) {
        setStatus("error");
        setErrorMessage(
          error instanceof Error ? error.message : "La importacion fallo inesperadamente.",
        );
        setStep("preview");
      } finally {
        abortRef.current = null;
      }
    },
    [errorPolicy, queryClient, validatedRows],
  );

  const cancelImport = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const updatePreviewRow = useCallback(
    (draft: ProductImportRowDraft) => {
      setValidatedRows((previous) =>
        updateImportRowDraft(previous, draft, {
          categories,
          existingSkus: existingSkusRef.current,
        }),
      );
    },
    [categories],
  );

  const validCount = validatedRows.filter((row) => row.status === "valid").length;
  const warningCount = validatedRows.filter((row) => row.status === "warning").length;
  const errorCount = validatedRows.filter((row) => row.status === "error").length;
  const importableCount = validatedRows.filter(
    (row) => row.status !== "error" && row.input,
  ).length;

  return {
    cancelImport,
    downloadTemplate,
    errorCount,
    errorMessage,
    errorPolicy,
    fileName,
    importableCount,
    isDownloadingTemplate,
    parseFile,
    progress,
    reset,
    results,
    setErrorPolicy,
    setStep,
    startImport,
    status,
    step,
    templateDownloadMessage,
    updatePreviewRow,
    validCount,
    validatedRows,
    warningCount,
  };
}
