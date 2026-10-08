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
    // El título conserva al menos 20rem; si las acciones no caben a su lado bajan a su propia línea.
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0 grow basis-80 space-y-1">
        <p className="text-sm font-medium text-primary">Inventario</p>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          Movimientos de Inventario
        </h1>
        <p className="text-sm text-on-surface-variant">
          Historial auditable de entradas, salidas, ventas, compras y ajustes de stock.
        </p>
      </div>
      <div className="flex w-full flex-col gap-2 sm:w-auto sm:max-w-full sm:flex-row sm:flex-wrap">
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
