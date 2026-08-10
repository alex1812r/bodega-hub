import type { ContactMock, PaymentMock } from "@/shared/mocks/erp-data";
import { formatRefUsd, formatVesBs } from "@/shared/utils/currency";
import { formatDateTimeShort } from "@/shared/utils/date";
import { cn } from "@/shared/utils/cn";

import { SalePaymentMethodBadge } from "@/modules/sales/sale-details/components/SalePaymentMethodBadge";

import { PurchaseDetailSectionCard } from "./PurchaseDetailSectionCard";

type PurchaseDetailPaymentsTableProps = {
  payments: Array<PaymentMock & { contact?: ContactMock }>;
};

function contactLabel(payment: PaymentMock & { contact?: ContactMock }) {
  return payment.contact?.name?.trim() || payment.contactId;
}

function paymentAmountRef(payment: PaymentMock) {
  if (payment.amountRef > 0) {
    return payment.amountRef;
  }

  if (payment.refRateVes > 0 && payment.amountVes > 0) {
    return Math.round((payment.amountVes / payment.refRateVes) * 100) / 100;
  }

  return 0;
}

export function PurchaseDetailPaymentsTable({ payments }: PurchaseDetailPaymentsTableProps) {
  return (
    <PurchaseDetailSectionCard title="Historial de pagos">
      {payments.length === 0 ? (
        <p className="px-6 py-8 text-center text-sm text-on-surface-variant">
          No hay pagos registrados para esta compra.
        </p>
      ) : (
        <div className="w-full overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-container-low text-xs font-semibold uppercase tracking-wider text-on-surface-variant dark:border-slate-800">
                <th className="px-6 py-3">Fecha</th>
                <th className="px-6 py-3">Contacto</th>
                <th className="px-6 py-3">Método</th>
                <th className="px-6 py-3">Referencia</th>
                <th className="px-6 py-3 text-right">Monto</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border dark:divide-slate-800">
              {payments.map((payment, index) => {
                const name = contactLabel(payment);
                const amountRef = paymentAmountRef(payment);

                return (
                  <tr
                    className={cn(
                      "transition-colors hover:bg-surface-bright/50 dark:hover:bg-slate-800/50",
                      index % 2 === 1 && "bg-surface-bright/30 dark:bg-slate-800/20",
                    )}
                    key={payment.id}
                  >
                    <td className="whitespace-nowrap px-6 py-4 text-on-surface-variant">
                      {formatDateTimeShort(payment.createdAt)}
                    </td>
                    <td className="max-w-[10rem] px-6 py-4">
                      <span className="block truncate font-medium text-foreground" title={name}>
                        {name}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <SalePaymentMethodBadge method={payment.method} />
                    </td>
                    <td className="max-w-[8rem] px-6 py-4 font-mono text-sm text-on-surface-variant">
                      <span
                        className="block truncate"
                        title={payment.referenceCode?.trim() || undefined}
                      >
                        {payment.referenceCode?.trim() || "—"}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex flex-col items-end gap-0.5 leading-tight">
                        <span className="font-mono text-sm font-semibold tabular-nums text-foreground">
                          {formatVesBs(payment.amountVes)}
                        </span>
                        <span className="font-mono text-xs tabular-nums text-on-surface-variant">
                          {formatRefUsd(amountRef)}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </PurchaseDetailSectionCard>
  );
}
