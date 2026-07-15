import { PageBackButton } from "@/shared/components/PageBackButton";

export function PurchaseDetailPageHeader() {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <p className="text-sm font-medium text-primary">Compras</p>
        <h1 className="mt-1 text-2xl font-semibold text-foreground">Detalle de compra</h1>
        <p className="mt-1 text-sm text-on-surface-variant">
          Consulta proveedor, ítems, pagos y estado de la orden.
        </p>
      </div>
      <PageBackButton className="shrink-0" href="/purchases" />
    </div>
  );
}
