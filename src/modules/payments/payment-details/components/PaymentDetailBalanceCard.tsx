import { ArrowRight, Wallet } from "lucide-react";
import Link from "next/link";

import { Button } from "@/shared/components/Button";

import type { PaymentDocumentBalance } from "../types";
import { formatRefStitch, formatVesStitch } from "../utils/paymentDetailLabels";
import { PaymentDetailCardHeader } from "./PaymentDetailCardHeader";

type PaymentDetailBalanceCardProps = {
  documentBalance?: PaymentDocumentBalance;
  refRateVes: number;
};

export function PaymentDetailBalanceCard({
  documentBalance,
  refRateVes,
}: PaymentDetailBalanceCardProps) {
  if (!documentBalance) {
    return (
      <section className="overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest shadow-sm lg:sticky lg:top-[5.5rem]">
        <PaymentDetailCardHeader icon={Wallet} title="Resumen de saldo" />
        <div className="p-6">
          <p className="text-sm text-on-surface-variant">
            Este pago no está vinculado a una venta o compra con saldo consultable.
          </p>
        </div>
      </section>
    );
  }

  const pendingRef = refRateVes > 0 ? documentBalance.pendingVes / refRateVes : 0;
  const isSale = documentBalance.href.startsWith("/sales");
  const documentKind = isSale ? "venta" : "compra";
  const documentKindLabel = isSale ? "factura" : "compra";

  return (
    <section className="overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest shadow-sm lg:sticky lg:top-[5.5rem]">
      <PaymentDetailCardHeader icon={Wallet} title="Resumen de saldo" />

      <div className="flex flex-col gap-4 p-6">
        <div className="flex items-center justify-between gap-4 border-b border-outline-variant/50 py-2">
          <span className="text-sm text-on-surface-variant">
            Total {documentKind}
          </span>
          <span className="text-sm font-semibold tabular-nums text-foreground">
            {formatVesStitch(documentBalance.totalVes)}
          </span>
        </div>

        <div className="flex items-center justify-between gap-4 border-b border-outline-variant/50 py-2">
          <span className="text-sm text-on-surface-variant">Total pagado a la fecha</span>
          <span className="text-sm font-semibold tabular-nums text-secondary">
            {formatVesStitch(documentBalance.paidVes)}
          </span>
        </div>

        <div className="mt-2 rounded-lg border border-outline-variant bg-surface-container-low p-4">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
              Saldo restante
            </span>
            <div className="flex items-end justify-between gap-4">
              <span className="text-2xl font-bold tracking-tight text-destructive tabular-nums">
                {documentBalance.pendingVes.toLocaleString("es-VE", {
                  maximumFractionDigits: 2,
                  minimumFractionDigits: 2,
                })}{" "}
                <span className="text-xl">VES</span>
              </span>
            </div>
            {documentBalance.pendingVes > 0 ? (
              <span className="text-right text-sm text-on-surface-variant tabular-nums">
                ~ {formatRefStitch(pendingRef)}
              </span>
            ) : null}
          </div>
        </div>

        <Button
          asChild
          className="mt-4 w-full gap-2 border-primary bg-surface text-primary hover:bg-primary-container/10"
          variant="outline"
        >
          <Link href={documentBalance.href}>
            Ver {documentKindLabel} completa
            <ArrowRight aria-hidden className="size-[1.125rem]" />
          </Link>
        </Button>
      </div>
    </section>
  );
}
