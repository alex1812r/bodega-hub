import Link from "next/link";
import { Receipt, type LucideIcon } from "lucide-react";
import { type ReactNode } from "react";

import type { PaymentMethod } from "@/shared/mocks/erp-data";
import { cn } from "@/shared/utils/cn";

import type { PaymentRelatedDocument } from "../../utils/resolvePaymentRelatedDocument";
import {
  formatPaymentDateTime,
  formatRefStitch,
  formatVesStitch,
  getPaymentMethodIcon,
  paymentMethodLabels,
} from "../utils/paymentDetailLabels";
import { PaymentDetailCardHeader } from "./PaymentDetailCardHeader";
import { PaymentDetailCopyableReference } from "./PaymentDetailCopyableReference";
import { PaymentDetailRegisteredBy } from "./PaymentDetailRegisteredBy";

type PaymentDetailInfoCardProps = {
  amountRef: number;
  amountVes: number;
  bankName?: string;
  createdAt: string;
  currency: "USD" | "VES";
  linkedDocument?: PaymentRelatedDocument;
  method: PaymentMethod;
  notes?: string;
  phone?: string;
  referenceCode?: string;
  refRateVes: number;
};

function PaymentDetailField({
  className,
  icon: Icon,
  label,
  value,
  valueClassName,
}: {
  className?: string;
  icon?: LucideIcon;
  label: string;
  value: ReactNode;
  valueClassName?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <span className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
        {label}
      </span>
      <div
        className={cn(
          "flex items-center gap-2 text-sm font-medium text-foreground",
          valueClassName,
        )}
      >
        {Icon ? <Icon aria-hidden className="size-5 shrink-0 text-primary" /> : null}
        <div className="min-w-0">{value}</div>
      </div>
    </div>
  );
}

export function PaymentDetailInfoCard({
  amountRef,
  amountVes,
  bankName,
  createdAt,
  currency,
  linkedDocument,
  method,
  notes,
  phone,
  referenceCode,
  refRateVes,
}: PaymentDetailInfoCardProps) {
  const MethodIcon = getPaymentMethodIcon(method);
  const notesText = notes?.trim() || "Sin notas registradas.";

  return (
    <section className="overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest shadow-sm">
      <PaymentDetailCardHeader title="Información del pago" />

      <div className="p-6">
        <div className="grid grid-cols-1 gap-x-8 gap-y-6 md:grid-cols-2">
          <PaymentDetailField label="Fecha" value={formatPaymentDateTime(createdAt)} />
          <PaymentDetailField
            icon={MethodIcon}
            label="Método"
            value={paymentMethodLabels[method]}
          />
          <PaymentDetailField
            label="Monto original"
            value={
              currency === "USD" ? formatRefStitch(amountRef) : formatVesStitch(amountVes)
            }
            valueClassName="text-base font-bold"
          />
          <PaymentDetailField
            label="Monto en REF"
            value={formatRefStitch(amountRef)}
            valueClassName="text-base font-bold text-primary"
          />
          <PaymentDetailField
            label="Tasa aplicada"
            value={`${refRateVes.toFixed(2)} VES/REF`}
          />
          <PaymentDetailField
            label="Banco origen"
            value={bankName?.trim() || "No aplica"}
          />
          <PaymentDetailField
            label="Teléfono origen"
            value={phone?.trim() || "No aplica"}
          />
          <PaymentDetailField
            label="Referencia"
            value={<PaymentDetailCopyableReference referenceCode={referenceCode} />}
          />

          <PaymentDetailField
            className="pt-2 md:col-span-2"
            label="Venta/compra vinculada"
            value={
              linkedDocument ? (
                <Link
                  className="inline-flex w-fit items-center gap-2 text-primary underline underline-offset-2 transition-colors hover:text-primary/80"
                  href={linkedDocument.href}
                >
                  <Receipt aria-hidden className="size-[1.125rem] shrink-0" />
                  {linkedDocument.label}
                </Link>
              ) : (
                "Sin documento vinculado"
              )
            }
          />

          <div className="flex flex-col gap-1 border-t border-outline-variant/50 pt-2 md:col-span-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
              Notas del pago
            </span>
            <p className="rounded-md border border-outline-variant/50 bg-surface-bright p-3 text-sm text-foreground">
              {notesText}
            </p>
          </div>

          <PaymentDetailRegisteredBy />
        </div>
      </div>
    </section>
  );
}
