import type { StockMovementType } from "@/shared/mocks/erp-data";
import { DATE_FORMATS, formatDate } from "@/shared/utils/date";

import { getMovementTypeLabel } from "../../inventory-movements/utils/movementTypeLabels";

type InventoryLastMovementCellProps = {
  at: string | null;
  type: StockMovementType | null;
};

/** Fecha corta y tipo del último movimiento del producto; "Sin movimientos" si nunca tuvo uno. */
export function InventoryLastMovementCell({ at, type }: InventoryLastMovementCellProps) {
  if (!at) {
    return <span className="text-on-surface-variant">Sin movimientos</span>;
  }

  return (
    <span className="inline-flex flex-col leading-snug">
      <time
        className="tabular-nums text-foreground"
        dateTime={at}
        title={formatDate(at, DATE_FORMATS.dateTime)}
      >
        {formatDate(at)}
      </time>
      {type ? (
        <span className="text-xs text-on-surface-variant">{getMovementTypeLabel(type)}</span>
      ) : null}
    </span>
  );
}
