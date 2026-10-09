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
      // Fijo: al desplazar el detalle se queda arriba del área de contenido (`main`
      // es quien se desplaza; la cabecera del shell queda fuera). Opaco por el fondo
      // de la tarjeta; por encima de lo pegado en las tablas (z-10) y por debajo de
      // la cabecera (z-40) y de menús y modales (z-50).
      className="sticky top-0 z-20 p-3 shadow-md sm:p-4"
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
