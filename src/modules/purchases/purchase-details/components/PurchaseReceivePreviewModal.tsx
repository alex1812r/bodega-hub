"use client";

import { ArrowRight, TriangleAlert } from "lucide-react";

import { ConfirmActionModal } from "@/shared/components/ConfirmActionModal";
import { formatRefUsd } from "@/shared/utils/currency";

import type { ReceivePreviewLine } from "../utils/buildReceivePreview";

type PurchaseReceivePreviewModalProps = {
  /** Mensaje del servidor al fallar la recepción; se muestra tal cual. */
  error?: string | null;
  isPending?: boolean;
  lines: ReceivePreviewLine[];
  onConfirm: () => void | Promise<void>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  purchaseNumber: string;
};

function quantityInLabel(line: ReceivePreviewLine) {
  if (line.packCount && line.unitsPerPack) {
    return `${line.packCount} × ${line.unitsPerPack} = ${line.quantityIn} un`;
  }

  return `${line.quantityIn} un`;
}

function PreviewLine({ line }: { line: ReceivePreviewLine }) {
  return (
    <li className="space-y-2 py-3 text-sm">
      <p className="break-words font-medium text-foreground">{line.name}</p>

      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
        <dt className="text-on-surface-variant">Entra</dt>
        <dd className="text-right font-medium tabular-nums text-foreground">
          {quantityInLabel(line)}
          {line.packLabel ? (
            <span className="block text-xs font-normal text-on-surface-variant">
              Por {line.packLabel}
            </span>
          ) : null}
        </dd>

        <dt className="text-on-surface-variant">Stock</dt>
        <dd className="flex flex-wrap items-center justify-end gap-1.5 tabular-nums text-foreground">
          {line.stockBefore === null || line.stockAfter === null ? (
            <span className="text-on-surface-variant">Sin dato de stock</span>
          ) : (
            <>
              <span className="text-on-surface-variant">{line.stockBefore} un</span>
              <ArrowRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
              <span className="sr-only">pasa a</span>
              <span className="font-semibold">{line.stockAfter} un</span>
            </>
          )}
        </dd>

        <dt className="text-on-surface-variant">Costo unitario (sin impuesto)</dt>
        <dd className="text-right font-mono tabular-nums text-foreground">
          {formatRefUsd(line.unitCostRef)}
        </dd>
      </dl>

      {line.productInactive ? (
        <p className="flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">
          <TriangleAlert aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>Producto inactivo: se recibirá igualmente</span>
        </p>
      ) : null}
    </li>
  );
}

/**
 * Previsualización de cantidades al recibir un pedido (COM-07): por línea, lo que
 * entra, el stock antes → después y el costo unitario. La lista apila los datos de
 * cada línea y hace scroll dentro del modal, sin desbordar en pantallas estrechas.
 */
export function PurchaseReceivePreviewModal({
  error,
  isPending = false,
  lines,
  onConfirm,
  onOpenChange,
  open,
  purchaseNumber,
}: PurchaseReceivePreviewModalProps) {
  return (
    <ConfirmActionModal
      confirmLabel="Recibir mercancía"
      description="La mercancía entrará al inventario y la compra pasará a recibida."
      error={error}
      isPending={isPending}
      onConfirm={onConfirm}
      onOpenChange={onOpenChange}
      open={open}
      renderEffects={() =>
        lines.length === 0 ? (
          <p className="py-3 text-sm text-on-surface-variant">
            Esta compra no tiene productos registrados.
          </p>
        ) : (
          <ul aria-label="Mercancía que entra" className="divide-y divide-border">
            {lines.map((line, index) => (
              <PreviewLine key={`${line.productId}-${index}`} line={line} />
            ))}
          </ul>
        )
      }
      title="Recibir mercancía"
    >
      Compra {purchaseNumber}
    </ConfirmActionModal>
  );
}
