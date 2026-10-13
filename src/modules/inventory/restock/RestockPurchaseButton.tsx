"use client";

import { type ComponentProps, useState } from "react";

import { usePermission } from "@/shared/auth/usePermission";
import { Button } from "@/shared/components/Button";
import { Modal } from "@/shared/components/Modal";

import { RESTOCK_CREATE_LABEL, RestockSelection } from "./RestockSelection";

type RestockPurchaseButtonProps = Pick<
  ComponentProps<typeof Button>,
  "className" | "size" | "variant"
>;

/**
 * Punto de entrada de la reposición (INV-05): el botón "Crear compra con estos
 * productos" y el modal con la selección. Solo existe para quien puede crear
 * compras (`purchases.create`): el vendedor y el contador no lo ven.
 *
 * @example
 * <RestockPurchaseButton size="sm" variant="outline" />
 */
export function RestockPurchaseButton({
  className,
  size,
  variant = "secondary",
}: RestockPurchaseButtonProps) {
  const { can, isLoading } = usePermission();
  const [open, setOpen] = useState(false);

  if (isLoading || !can("purchases.create")) {
    return null;
  }

  return (
    <Modal
      contentClassName="sm:max-w-3xl"
      description="Productos con stock bajo o agotado. Elige cuáles pedir y cuánto: la cantidad sugerida es el doble del mínimo menos el stock actual."
      onOpenChange={setOpen}
      open={open}
      title="Reponer productos"
      trigger={
        <Button className={className} size={size} type="button" variant={variant}>
          {RESTOCK_CREATE_LABEL}
        </Button>
      }
    >
      {/* Se monta al abrir: la lista se pide entonces y la selección empieza de cero. */}
      {open ? <RestockSelection onCreated={() => setOpen(false)} /> : null}
    </Modal>
  );
}
