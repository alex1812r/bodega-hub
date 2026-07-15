"use client";

import { useDeactivateSupplierProduct } from "@/modules/contacts/hooks/useSupplierProductMutations";
import { Button } from "@/shared/components/Button";
import { Modal } from "@/shared/components/Modal";

import type { SupplierProduct } from "../../types/supplierProducts";

type UnlinkSupplierProductConfirmModalProps = {
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  open: boolean;
  supplierProduct: SupplierProduct | null;
};

export function UnlinkSupplierProductConfirmModal({
  onOpenChange,
  onSuccess,
  open,
  supplierProduct,
}: UnlinkSupplierProductConfirmModalProps) {
  const deactivate = useDeactivateSupplierProduct(supplierProduct?.id ?? "");

  async function handleConfirm() {
    if (!supplierProduct) return;

    await deactivate.mutateAsync();
    onOpenChange(false);
    onSuccess?.();
  }

  return (
    <Modal
      description="El producto quedará inactivo para este proveedor. El historial de precios se conservará."
      footer={({ close }) => (
        <>
          <Button disabled={deactivate.isPending} onClick={close} type="button" variant="outline">
            Cancelar
          </Button>
          <Button
            disabled={deactivate.isPending}
            onClick={() => void handleConfirm()}
            type="button"
            variant="danger"
          >
            {deactivate.isPending ? "Procesando..." : "Desvincular producto"}
          </Button>
        </>
      )}
      onOpenChange={onOpenChange}
      open={open}
      title="Confirmar desvinculación"
    >
      <p className="text-sm text-on-surface-variant">
        {supplierProduct?.product?.name ?? supplierProduct?.productId} dejará de aparecer en el catálogo
        activo de {supplierProduct?.supplier?.name ?? "este proveedor"}.
      </p>
    </Modal>
  );
}
