import type { ProductInput } from "../hooks/useProducts";

export type ProductImportStep =
  | "template"
  | "file"
  | "preview"
  | "importing"
  | "summary";

export type ProductImportStatus = "idle" | "parsing" | "validated" | "importing" | "done" | "cancelled" | "error";

export type ProductImportValidationStatus = "valid" | "error" | "warning";

export type ProductImportErrorPolicy = "continue" | "stop";

export type ProductImportRawRow = {
  categoria?: string;
  costo_ref?: number;
  nombre: string;
  precio_ref: number;
  rowIndex: number;
  sku: string;
  stock_inicial?: number;
  stock_minimo?: number;
};

export type ProductImportValidatedRow = {
  input?: ProductInput;
  messages: string[];
  name: string;
  rowIndex: number;
  sku: string;
  status: ProductImportValidationStatus;
};

export type ProductImportProgress = {
  currentRow?: ProductImportValidatedRow;
  failed: number;
  processed: number;
  succeeded: number;
  total: number;
};

export type ProductImportRowResult = {
  error?: string;
  rowIndex: number;
  sku: string;
  status: "success" | "failed" | "skipped";
};

export type ProductImportJobOptions = {
  onError: ProductImportErrorPolicy;
  onProgress?: (progress: ProductImportProgress) => void;
  rows: ProductImportValidatedRow[];
  signal?: AbortSignal;
};
