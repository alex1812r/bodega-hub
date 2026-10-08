import type { ReactNode } from "react";

import { PageBackButton } from "@/shared/components/PageBackButton";

type InventoryMovementsPageHeaderProps = {
  actions?: ReactNode;
  /**
   * `returnTo` válido de la URL (se llegó desde `/inventory` o desde el detalle
   * de un producto): "Volver" regresa a esa pantalla tal como estaba, con el
   * `returnTo` propio que traiga (`readChainedReturnTo`). `null` = no hay.
   */
  returnTo?: string | null;
};

export function InventoryMovementsPageHeader({
  actions,
  returnTo = null,
}: InventoryMovementsPageHeaderProps) {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0 space-y-1">
        <p className="text-sm font-medium text-primary">Inventario</p>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          Movimientos de Inventario
        </h1>
        <p className="text-sm text-on-surface-variant">
          Historial auditable de entradas, salidas, ventas, compras y ajustes de stock.
        </p>
      </div>
      <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap lg:justify-end">
        {returnTo ? (
          <PageBackButton href={returnTo} shortcuts />
        ) : (
          <PageBackButton href="/inventory" label="Volver a Inventario" />
        )}
        {actions}
      </div>
    </div>
  );
}
