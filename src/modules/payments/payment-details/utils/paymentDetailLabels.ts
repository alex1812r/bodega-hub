import {
  ArrowLeftRight,
  Banknote,
  Building2,
  CreditCard,
  Smartphone,
  type LucideIcon,
} from "lucide-react";
import moment from "moment";

import type { PaymentMethod } from "@/shared/mocks/erp-data";

export const paymentMethodLabels: Record<PaymentMethod, string> = {
  efectivo_usd: "Efectivo USD",
  efectivo_ves: "Efectivo VES",
  pago_movil: "Pago móvil",
  punto_venta: "Punto de venta",
  transferencia: "Transferencia",
};

const paymentMethodIcons: Record<PaymentMethod, LucideIcon> = {
  efectivo_usd: Banknote,
  efectivo_ves: Banknote,
  pago_movil: Smartphone,
  punto_venta: CreditCard,
  transferencia: Building2,
};

export function formatPaymentHeading(id: string) {
  if (/^PAG-/i.test(id)) {
    return id.toUpperCase();
  }

  const suffix = id.replace(/^pay-?/i, "").toUpperCase();
  return `PAG-${suffix}`;
}

export function formatPaymentDateTime(value: string) {
  return moment(value).locale("es").format("D MMM, YYYY - hh:mm A");
}

export function formatVesStitch(value: number) {
  return `${value.toLocaleString("es-VE", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  })} VES`;
}

export function formatRefStitch(value: number) {
  return `${value.toLocaleString("es-VE", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  })} REF`;
}

export function getPaymentMethodIcon(method: PaymentMethod) {
  return paymentMethodIcons[method] ?? ArrowLeftRight;
}

export function formatMaskedReference(referenceCode?: string) {
  if (!referenceCode?.trim()) {
    return "—";
  }

  const normalized = referenceCode.trim();

  if (normalized.length <= 4) {
    return `***${normalized}`;
  }

  return `***${normalized.slice(-4)}`;
}

