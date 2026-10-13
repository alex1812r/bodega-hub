"use client";

import {
  ConfirmActionModal,
  type ConfirmActionEffect,
} from "@/shared/components/ConfirmActionModal";

import { useUpdateProduct, type ProductWithCategory } from "../../hooks/useProducts";

type ReactivateProductConfirmModalProps = {
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  open: boolean;
  product: ProductWithCategory | null;
};

const reactivateEffects: ConfirmActionEffect[] = [
  { after: "Activo", before: "Inactivo", label: "Estado en el catálogo", tone: "positive" },
  { label: "Podrá venderse de nuevo en POS y listados", tone: "positive" },
];

function getErrorMessage(error: unknown) {
  if (!error) {
    return null;
  }

  return error instanceof Error ? error.message : "No se pudo reactivar el producto.";
}

export function ReactivateProductConfirmModal({
  onOpenChange,
  onSuccess,
  open,
  product,
}: ReactivateProductConfirmModalProps) {
  const updateProduct = useUpdateProduct(product?.id ?? "");

  async function handleConfirm() {
    if (!product) {
      return;
    }

    await updateProduct.mutateAsync({ isActive: true });
    onOpenChange(false);
    onSuccess?.();
  }

  return (
    <ConfirmActionModal
      confirmLabel="Reactivar producto"
      description="El producto volverá al catálogo activo y podrá venderse de nuevo en POS y listados."
      effects={reactivateEffects}
      error={getErrorMessage(updateProduct.error)}
      isPending={updateProduct.isPending}
      onConfirm={handleConfirm}
      onOpenChange={onOpenChange}
      open={open}
      title="Confirmar reactivación"
    >
      <p>
        <span className="font-medium text-foreground">{product?.name ?? "Producto"}</span>
        {product?.sku ? (
          <>
            {" "}
            (<span className="font-mono">{product.sku}</span>)
          </>
        ) : null}{" "}
        quedará activo.
      </p>
    </ConfirmActionModal>
  );
}
