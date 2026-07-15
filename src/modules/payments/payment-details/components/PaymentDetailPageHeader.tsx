import { getPageDataSourceSuffix } from "@/lib/api/dataSourceUi";

import { PageBackButton } from "@/shared/components/PageBackButton";

export function PaymentDetailPageHeader() {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <p className="text-sm font-medium text-primary">Pagos</p>
        <h1 className="mt-1 text-2xl font-semibold text-foreground">Detalle de pago</h1>
        <p className="mt-1 text-sm text-on-surface-variant">
          Consulta el método, montos y trazabilidad del pago{getPageDataSourceSuffix()}
        </p>
      </div>
      <PageBackButton className="shrink-0" href="/payments" />
    </div>
  );
}
