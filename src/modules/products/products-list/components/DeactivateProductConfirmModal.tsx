"use client";

import { Button } from "@/shared/components/Button";
import { Modal } from "@/shared/components/Modal";

import { useUpdateProduct } from "../../hooks/useProducts";

import type { ProductWithCategory } from "../../hooks/useProducts";

type DeactivateProductConfirmModalProps = {
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  open: boolean;
  product: ProductWithCategory | null;
};

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
    <Modal
      description="El producto dejará de aparecer en el catálogo activo y no podrá venderse. El historial de ventas, compras y precios se conservará."
      footer={({ close }) => (
        <>
          <Button disabled={updateProduct.isPending} onClick={close} type="button" variant="outline">
            Cancelar
          </Button>
          <Button
            disabled={updateProduct.isPending}
            onClick={() => void handleConfirm()}
            type="button"
            variant="danger"
          >
            {updateProduct.isPending ? "Procesando..." : "Desactivar producto"}
          </Button>
        </>
      )}
      onOpenChange={onOpenChange}
      open={open}
      title="Confirmar desactivación"
    >
      <p className="text-sm text-on-surface-variant">
        <span className="font-medium text-foreground">{product?.name ?? "Producto"}</span>
        {product?.sku ? (
          <>
            {" "}
            (<span className="font-mono">{product.sku}</span>)
          </>
        ) : null}{" "}
        quedará inactivo.
      </p>
    </Modal>
  );
}
