import type { LucideIcon } from "lucide-react";
import {
  Banknote,
  CreditCard,
  Smartphone,
  Wallet,
} from "lucide-react";

import { roleLabels, type UserRole } from "@/shared/auth/permissions";
import type { PaymentMethod, SaleStatus } from "@/shared/mocks/erp-data";

export const saleDetailStatusConfig: Record<
  SaleStatus,
  { dotClassName: string; label: string }
> = {
  borrador: {
    dotClassName: "bg-slate-400",
    label: "Borrador",
  },
  cancelada: {
    dotClassName: "bg-slate-500",
    label: "Anulada",
  },
  devuelta: {
    dotClassName: "bg-amber-600",
    label: "Devuelta",
  },
  pagada: {
    dotClassName: "bg-emerald-600",
    label: "Pagada",
  },
  pendiente_pago: {
    dotClassName: "bg-amber-600",
    label: "Pendiente de Pago",
  },
};

export const paymentMethodConfig: Record<
  PaymentMethod,
  { icon: LucideIcon; label: string }
> = {
  efectivo_usd: { icon: Banknote, label: "Efectivo USD" },
  efectivo_ves: { icon: Wallet, label: "Efectivo VES" },
  pago_movil: { icon: Smartphone, label: "Pago Móvil" },
  punto_venta: { icon: CreditCard, label: "Punto de Venta" },
  transferencia: { icon: Banknote, label: "Transferencia" },
};

const sellerRoleSubtitles: Partial<Record<UserRole, string>> = {
  admin: "Caja Principal",
  vendedor: "Caja Principal",
};

export function getSellerSubtitle(role: UserRole) {
  return sellerRoleSubtitles[role] ?? roleLabels[role];
}

export function formatInvoiceHeading(invoiceNumber: string) {
  const normalized = invoiceNumber.startsWith("#")
    ? invoiceNumber
    : `#${invoiceNumber}`;
  return normalized.startsWith("#V") ? normalized : `#${normalized.replace(/^#/, "")}`;
}

export function getTaxPercentLabel(subtotalRef: number, taxRef: number, fallback = 16) {
  if (subtotalRef <= 0) {
    return fallback;
  }

  return Math.round((taxRef / subtotalRef) * 100);
}
