"use client";

import { Button } from "@/shared/components/Button";
import { Modal } from "@/shared/components/Modal";

import { useUpdateProduct, type ProductWithCategory } from "../../hooks/useProducts";

type ReactivateProductConfirmModalProps = {
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  open: boolean;
  product: ProductWithCategory | null;
};

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
    <Modal
      description="El producto volverá al catálogo activo y podrá venderse de nuevo en POS y listados."
      footer={({ close }) => (
        <>
          <Button disabled={updateProduct.isPending} onClick={close} type="button" variant="outline">
            Cancelar
          </Button>
          <Button
            disabled={updateProduct.isPending}
            onClick={() => void handleConfirm()}
            type="button"
          >
            {updateProduct.isPending ? "Procesando..." : "Reactivar producto"}
          </Button>
        </>
      )}
      onOpenChange={onOpenChange}
      open={open}
      title="Confirmar reactivación"
    >
      <p className="text-sm text-on-surface-variant">
        <span className="font-medium text-foreground">{product?.name ?? "Producto"}</span>
        {product?.sku ? (
          <>
            {" "}
            (<span className="font-mono">{product.sku}</span>)
          </>
        ) : null}{" "}
        quedará activo.
      </p>
      {updateProduct.error ? (
        <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {updateProduct.error instanceof Error
            ? updateProduct.error.message
            : "No se pudo reactivar el producto."}
        </p>
      ) : null}
    </Modal>
  );
}
