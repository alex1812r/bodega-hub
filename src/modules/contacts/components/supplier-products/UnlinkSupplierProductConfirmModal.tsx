"use client";

import { useDeactivateSupplierProduct } from "@/modules/contacts/hooks/useSupplierProductMutations";
import {
  ConfirmActionModal,
  type ConfirmActionEffect,
} from "@/shared/components/ConfirmActionModal";

import type { SupplierProduct } from "../../types/supplierProducts";

type UnlinkSupplierProductConfirmModalProps = {
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  open: boolean;
  supplierProduct: SupplierProduct | null;
};

const unlinkEffects: ConfirmActionEffect[] = [
  { after: "Inactivo", before: "Activo", label: "Vínculo con el proveedor", tone: "warning" },
  { label: "El historial de precios se conserva" },
];

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
    <ConfirmActionModal
      confirmLabel="Desvincular producto"
      description="El producto quedará inactivo para este proveedor. El historial de precios se conservará."
      effects={unlinkEffects}
      error={deactivate.error instanceof Error ? deactivate.error.message : null}
      isPending={deactivate.isPending}
      onConfirm={handleConfirm}
      onOpenChange={onOpenChange}
      open={open}
      title="Confirmar desvinculación"
      variant="danger"
    >
      <p>
        {supplierProduct?.product?.name ?? supplierProduct?.productId} dejará de aparecer en el catálogo
        activo de {supplierProduct?.supplier?.name ?? "este proveedor"}.
      </p>
    </ConfirmActionModal>
  );
}
