import { ScanLine } from "lucide-react";

import { Button } from "@/shared/components/Button";
import { PageBackButton } from "@/shared/components/PageBackButton";

type PurchaseCreateHeaderProps = {
  /** Abre el escaneo de factura; sin él (sin `purchases.create`) no hay botón. */
  onScanInvoice?: () => void;
};

export function PurchaseCreateHeader({ onScanInvoice }: PurchaseCreateHeaderProps = {}) {
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
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {onScanInvoice ? (
          <Button onClick={onScanInvoice} type="button" variant="outline">
            <ScanLine aria-hidden="true" className="h-4 w-4" />
            Escanear factura
          </Button>
        ) : null}
        {/* Vuelve a la lista de origen (`returnTo`) con sus filtros; sin atajos, como siempre. */}
        <PageBackButton className="shrink-0" fallbackHref="/purchases" shortcuts={false} />
      </div>
    </div>
  );
}
