import { PageBackButton } from "@/shared/components/PageBackButton";

export function PurchaseCreateHeader() {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <p className="text-sm font-medium text-primary">Compras</p>
        <h1 className="mt-1 text-2xl font-semibold text-foreground">
          Registrar Nueva Compra
        </h1>
        <p className="mt-1 text-sm text-on-surface-variant">
          Ingreso de mercancía al inventario
        </p>
      </div>
      <PageBackButton className="shrink-0" href="/purchases" />
    </div>
  );
}
