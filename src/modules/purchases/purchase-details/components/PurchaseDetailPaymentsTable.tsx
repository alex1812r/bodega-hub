import type { PaymentMock } from "@/shared/mocks/erp-data";
import { formatVesBs } from "@/shared/utils/currency";
import { formatDateTimeShort } from "@/shared/utils/date";
import { cn } from "@/shared/utils/cn";

import { SalePaymentMethodBadge } from "@/modules/sales/sale-details/components/SalePaymentMethodBadge";

import { PurchaseDetailSectionCard } from "./PurchaseDetailSectionCard";

type PurchaseDetailPaymentsTableProps = {
  payments: PaymentMock[];
};

export function PurchaseDetailPaymentsTable({ payments }: PurchaseDetailPaymentsTableProps) {
  return (
    <PurchaseDetailSectionCard title="Historial de pagos">
      {payments.length === 0 ? (
        <p className="px-6 py-8 text-center text-sm text-on-surface-variant">
          No hay pagos registrados para esta compra.
        </p>
      ) : (
        <div className="w-full overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-container-low text-xs font-semibold uppercase tracking-wider text-on-surface-variant dark:border-slate-800">
                <th className="px-6 py-3">Fecha</th>
                <th className="px-6 py-3">Método</th>
                <th className="px-6 py-3">Referencia</th>
                <th className="px-6 py-3 text-right">Monto (VES)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border dark:divide-slate-800">
              {payments.map((payment, index) => (
                <tr
                  className={cn(
                    "transition-colors hover:bg-surface-bright/50 dark:hover:bg-slate-800/50",
                    index % 2 === 1 && "bg-surface-bright/30 dark:bg-slate-800/20",
                  )}
                  key={payment.id}
                >
                  <td className="px-6 py-4 text-on-surface-variant">
                    {formatDateTimeShort(payment.createdAt)}
                  </td>
                  <td className="px-6 py-4">
                    <SalePaymentMethodBadge method={payment.method} />
                  </td>
                  <td className="px-6 py-4 font-mono text-sm text-on-surface-variant">
                    {payment.referenceCode?.trim() || "—"}
                  </td>
                  <td className="px-6 py-4 text-right font-mono text-sm font-semibold tabular-nums">
                    {formatVesBs(payment.amountVes)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PurchaseDetailSectionCard>
  );
}
