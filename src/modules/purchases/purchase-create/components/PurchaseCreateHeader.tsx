import { ScanLine } from "lucide-react";
import { useId } from "react";

import { Button } from "@/shared/components/Button";
import { PageBackButton } from "@/shared/components/PageBackButton";

type PurchaseCreateHeaderProps = {
  /** Abre el escaneo de factura; sin él (sin `purchases.create`) no hay botón. */
  onScanInvoice?: () => void;
  /**
   * D80: quien crea compras pero no puede cargar la factura en ellas ve el botón desactivado con
   * este motivo. Es estado de la sesión, ya cargada al montar la página: no es una llegada (D77).
   */
  scanInvoiceDisabledReason?: string;
};

export function PurchaseCreateHeader({
  onScanInvoice,
  scanInvoiceDisabledReason,
}: PurchaseCreateHeaderProps = {}) {
  const disabledReasonId = useId();

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
        ) : scanInvoiceDisabledReason ? (
          <div className="flex max-w-xs flex-col gap-1 sm:items-end">
            <Button aria-describedby={disabledReasonId} disabled type="button" variant="outline">
              <ScanLine aria-hidden="true" className="h-4 w-4" />
              Escanear factura
            </Button>
            <p className="text-xs text-on-surface-variant sm:text-right" id={disabledReasonId}>
              {scanInvoiceDisabledReason}
            </p>
          </div>
        ) : null}
        {/* Vuelve a la lista de origen (`returnTo`) con sus filtros; sin atajos, como siempre. */}
        <PageBackButton className="shrink-0" fallbackHref="/purchases" shortcuts={false} />
      </div>
    </div>
  );
}
