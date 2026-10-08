"use client";

import { PackageCheck } from "lucide-react";

import { PrimaryStateAction } from "@/shared/components/PrimaryStateAction";

type PurchasePendingReceiptBannerProps = {
  /** Sin permiso de recibir (`purchases.create`) el aviso se pinta sin botón. */
  canReceive: boolean;
  isReceiving?: boolean;
  onReceive: () => void;
};

/** Aviso del estado «Pedido»: la mercancía no ha entrado y la acción que toca es recibirla. */
export function PurchasePendingReceiptBanner({
  canReceive,
  isReceiving = false,
  onReceive,
}: PurchasePendingReceiptBannerProps) {
  return (
    <PrimaryStateAction
      ariaLabel="Pedido sin recibir"
      figures={[]}
      notice={{ text: "El inventario no ha cambiado.", tone: "warning" }}
      primaryAction={
        canReceive
          ? {
              icon: <PackageCheck aria-hidden="true" className="h-4 w-4" />,
              isPending: isReceiving,
              label: "Recibir mercancía",
              onClick: onReceive,
            }
          : undefined
      }
    />
  );
}
