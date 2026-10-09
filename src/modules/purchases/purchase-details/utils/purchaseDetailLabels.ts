import {
  Ban,
  Clock,
  PackageCheck,
  RotateCcw,
  type LucideIcon,
} from "lucide-react";

import type { PurchaseStatus } from "@/shared/mocks/erp-data";
import { formatDateTimeShort } from "@/shared/utils/date";

/**
 * Texto secundario de una línea de compra sobre el desarme al recibir (COM-14):
 * "Desarmado al recibir" si la recepción ya abrió sus empaques; "Se desarmará al
 * recibir" si el pedido aún no se recibió y la línea está marcada; `null` si no aplica.
 */
export function getPurchaseLineDisassembleLabel(
  line: { disassembled?: boolean; disassembleOnReceive?: boolean },
  status: PurchaseStatus,
): string | null {
  if (line.disassembled) {
    return "Desarmado al recibir";
  }

  return status === "pedido" && line.disassembleOnReceive ? "Se desarmará al recibir" : null;
}

export function formatPurchaseHeading(purchaseNumber: string) {
  const code = purchaseNumber.startsWith("#")
    ? purchaseNumber.slice(1)
    : purchaseNumber;
  return `Compra #${code}`;
}

export type PurchaseInfoBannerContent = {
  description: string;
  icon: LucideIcon;
  title: string;
};

export function getPurchaseInfoBanner(
  status: PurchaseStatus,
  context: { createdAt: string; notes?: string; updatedAt?: string },
): PurchaseInfoBannerContent {
  const receivedAt = formatDateTimeShort(context.updatedAt ?? context.createdAt);
  const notesSuffix = context.notes?.trim()
    ? ` Observaciones: ${context.notes.trim()}`
    : "";

  switch (status) {
    case "recibido":
      return {
        description: `La mercancía de esta orden ingresó al inventario el ${receivedAt}.${notesSuffix}`,
        icon: PackageCheck,
        title: "Mercancía recibida",
      };
    case "pedido":
      return {
        description: `La mercancía aún no ha ingresado al inventario. Registra la recepción cuando confirmes la entrega del proveedor.${notesSuffix}`,
        icon: Clock,
        title: "Pendiente de recepción",
      };
    case "cancelado":
      return {
        description:
          "Esta orden fue cancelada y no modificará el stock. Los montos pagados deberán conciliarse manualmente.",
        icon: Ban,
        title: "Compra cancelada",
      };
    case "devuelto":
      return {
        description:
          "La mercancía asociada a esta orden fue devuelta o reversada. Verifica inventario y pagos con el proveedor.",
        icon: RotateCcw,
        title: "Compra devuelta",
      };
  }
}
