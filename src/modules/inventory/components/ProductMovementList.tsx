import Link from "next/link";

import type { StockMovementType } from "@/shared/mocks/erp-data";
import { formatCaracasDateTime } from "@/shared/utils/caracasBusinessDay";

import { InventoryMovementQuantityCell } from "../inventory-movements/components/InventoryMovementQuantityCell";
import { InventoryMovementTypeBadge } from "../inventory-movements/components/InventoryMovementTypeBadge";
import { withChainedReturnTo } from "../utils/chainedReturnTo";
import type { MovementDocumentKind } from "../utils/inventoryMovementFilters";

/** Lo que la lista necesita de un movimiento (kardex del producto o `/api/inventory/movements`). */
export type ProductMovementListItem = {
  createdAt: string;
  /** `null` o ausente = sin documento: se muestra "Ajuste manual". */
  documentKind?: MovementDocumentKind | null;
  documentNumber?: string | null;
  id: string;
  purchaseId?: string | null;
  quantityDelta: number;
  reason?: string | null;
  saleId?: string | null;
  stockAfter: number;
  type: StockMovementType;
};

type ProductMovementListProps = {
  movements: ProductMovementListItem[];
  /**
   * URL de la pantalla que monta la lista: a ella vuelven los documentos
   * enlazados, con el `returnTo` que esa pantalla traiga.
   */
  returnTo?: string;
};

const documentKindLabels = {
  compra: "Compra",
  conversion: "Conversión de empaque",
  venta: "Venta",
} as const;

/**
 * Movimientos de un producto, del más reciente al más antiguo: tipo, documento,
 * motivo, fecha, cantidad con signo y saldo tras el movimiento.
 */
export function ProductMovementList({ movements, returnTo }: ProductMovementListProps) {
  return (
    <ul className="divide-y divide-border/50 dark:divide-slate-800">
      {movements.map((movement) => (
        <li
          className="flex flex-col gap-2 px-5 py-3 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-4"
          key={movement.id}
        >
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <InventoryMovementTypeBadge type={movement.type} />
              <ProductMovementDocument movement={movement} returnTo={returnTo} />
            </div>
            {movement.reason ? (
              <p className="break-words text-xs text-on-surface-variant">{movement.reason}</p>
            ) : null}
            <p className="text-xs text-on-surface-variant">
              {formatCaracasDateTime(movement.createdAt)}
            </p>
          </div>
          <div className="flex shrink-0 items-baseline gap-3 sm:flex-col sm:items-end sm:gap-0">
            <InventoryMovementQuantityCell quantity={movement.quantityDelta} />
            <span className="text-xs tabular-nums text-on-surface-variant">
              Saldo: {movement.stockAfter}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Documento del movimiento: enlace a la venta o compra; sin documento, "Ajuste manual". */
function ProductMovementDocument({
  movement,
  returnTo,
}: {
  movement: ProductMovementListItem;
  returnTo?: string;
}) {
  const documentKind = movement.documentKind ?? null;

  if (documentKind === null) {
    return <span className="text-on-surface-variant">Ajuste manual</span>;
  }

  const label = movement.documentNumber
    ? `${documentKindLabels[documentKind]} ${movement.documentNumber}`
    : documentKindLabels[documentKind];
  const href =
    documentKind === "venta" && movement.saleId
      ? `/sales/${movement.saleId}`
      : documentKind === "compra" && movement.purchaseId
        ? `/purchases/${movement.purchaseId}`
        : null;

  if (!href) {
    return <span className="text-foreground">{label}</span>;
  }

  return (
    <Link className="font-medium text-primary hover:underline" href={withChainedReturnTo(href, returnTo)}>
      {label}
    </Link>
  );
}
