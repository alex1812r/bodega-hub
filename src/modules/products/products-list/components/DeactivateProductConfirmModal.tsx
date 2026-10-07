"use client";

import {
  ConfirmActionModal,
  type ConfirmActionEffect,
} from "@/shared/components/ConfirmActionModal";

import { useUpdateProduct } from "../../hooks/useProducts";

import type { ProductWithCategory } from "../../hooks/useProducts";

type DeactivateProductConfirmModalProps = {
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  open: boolean;
  product: ProductWithCategory | null;
};

const deactivateEffects: ConfirmActionEffect[] = [
  { after: "Inactivo", before: "Activo", label: "Estado en el catálogo", tone: "warning" },
  { label: "No podrá venderse", tone: "warning" },
  { label: "El historial de ventas, compras y precios se conserva" },
];

export function DeactivateProductConfirmModal({
  onOpenChange,
  onSuccess,
  open,
  product,
}: DeactivateProductConfirmModalProps) {
  const updateProduct = useUpdateProduct(product?.id ?? "");

  async function handleConfirm() {
    if (!product) return;

    await updateProduct.mutateAsync({ isActive: false });
    onOpenChange(false);
    onSuccess?.();
  }

  return (
    <ConfirmActionModal
      confirmLabel="Desactivar producto"
      description="El producto dejará de aparecer en el catálogo activo y no podrá venderse. El historial de ventas, compras y precios se conservará."
      effects={deactivateEffects}
      error={updateProduct.error instanceof Error ? updateProduct.error.message : null}
      isPending={updateProduct.isPending}
      onConfirm={handleConfirm}
      onOpenChange={onOpenChange}
      open={open}
      title="Confirmar desactivación"
      variant="danger"
    >
      <p>
        <span className="font-medium text-foreground">{product?.name ?? "Producto"}</span>
        {product?.sku ? (
          <>
            {" "}
            (<span className="font-mono">{product.sku}</span>)
          </>
        ) : null}{" "}
        quedará inactivo.
      </p>
    </ConfirmActionModal>
  );
}
