"use client";

import type { CategoryMock } from "@/shared/mocks/erp-data";
import { Button } from "@/shared/components/Button";
import { Modal } from "@/shared/components/Modal";
import { cn } from "@/shared/utils/cn";

import type { ProductImportValidatedRow } from "../../types";
import { ProductImportValidationStatusBadge } from "../shared/ProductImportValidationStatusBadge";

type ProductImportRowReasonModalProps = {
  categories: CategoryMock[];
  onOpenChange: (open: boolean) => void;
  open: boolean;
  row: ProductImportValidatedRow | null;
};

const STATUS_HINTS: Record<ProductImportValidatedRow["status"], string> = {
  error: "Esta fila no se importará hasta corregir el problema en el archivo Excel.",
  warning:
    "La fila se puede importar, pero conviene revisar la advertencia antes de continuar.",
  valid: "La fila cumple las validaciones y está lista para importar.",
};

export function ProductImportRowReasonModal({
  categories,
  onOpenChange,
  open,
  row,
}: ProductImportRowReasonModalProps) {
  if (!row) {
    return null;
  }

  const categoryName = row.input?.categoryId
    ? categories.find((category) => category.id === row.input?.categoryId)?.name
    : undefined;

  return (
    <Modal
      description={`Fila ${row.rowIndex} del archivo · SKU ${row.sku}`}
      footer={({ close }) => (
        <Button onClick={close} type="button" variant="primary">
          Entendido
        </Button>
      )}
      onOpenChange={onOpenChange}
      open={open}
      title="Motivo de validación"
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <ProductImportValidationStatusBadge status={row.status} />
          <span className="text-sm text-on-surface-variant">{STATUS_HINTS[row.status]}</span>
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <div>
            <dt className="text-on-surface-variant">Producto</dt>
            <dd className="font-medium text-on-surface">{row.name || "—"}</dd>
          </div>
          <div>
            <dt className="text-on-surface-variant">Categoría</dt>
            <dd className="font-medium text-on-surface">{categoryName ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-on-surface-variant">Precio ref.</dt>
            <dd className="font-medium text-on-surface">
              {row.input?.salePriceRef !== undefined
                ? row.input.salePriceRef.toFixed(2)
                : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-on-surface-variant">Stock inicial</dt>
            <dd className="font-medium text-on-surface">
              {row.input?.currentStock ?? "—"}
            </dd>
          </div>
        </dl>

        {row.messages.length > 0 ? (
          <div
            className={cn(
              "rounded-lg border p-4",
              row.status === "error"
                ? "border-error-container bg-error-container/30"
                : "border-secondary-container bg-secondary-container/20",
            )}
          >
            <p className="mb-2 text-sm font-semibold text-on-surface">Detalle</p>
            <ul className="list-disc space-y-1.5 pl-5 text-sm text-on-surface-variant">
              {row.messages.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-sm text-on-surface-variant">
            No hay mensajes adicionales para esta fila.
          </p>
        )}

        {row.status === "error" &&
        row.messages.some((message) => message.toLowerCase().includes("categoria")) ? (
          <div className="rounded-lg border border-outline-variant bg-surface-container-low p-3 text-xs text-on-surface-variant">
            <p className="mb-1 font-medium text-on-surface">Categorías válidas en plantilla</p>
            <p>{categories.map((category) => category.name).join(", ") || "Ninguna cargada."}</p>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
