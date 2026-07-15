"use client";

import { type FormEvent, useId, useState } from "react";

import { useUpdateSupplierProductMetadata } from "@/modules/contacts/hooks/useSupplierProductMutations";
import { GenerateSkuIconButton } from "@/shared/components/GenerateSkuIconButton";
import { FormActions } from "@/shared/components/FormActions";
import { Input } from "@/shared/components/Input";
import { Modal } from "@/shared/components/Modal";
import { Textarea } from "@/shared/components/Textarea";
import { generateSupplierSkuFromProduct } from "@/shared/utils/skuGeneration";

import type { SupplierProduct } from "../../types/supplierProducts";

type EditSupplierProductModalProps = {
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  open: boolean;
  supplierProduct: SupplierProduct | null;
};

export function EditSupplierProductModal({
  onOpenChange,
  onSuccess,
  open,
  supplierProduct,
}: EditSupplierProductModalProps) {
  const formId = useId();
  const [supplierSku, setSupplierSku] = useState(supplierProduct?.supplierSku ?? "");
  const [notes, setNotes] = useState(supplierProduct?.notes ?? "");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const updateSupplierProduct = useUpdateSupplierProductMetadata(supplierProduct?.id ?? "");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supplierProduct) return;

    setErrorMessage(null);

    try {
      await updateSupplierProduct.mutateAsync({
        notes: notes.trim() || undefined,
        supplierSku: supplierSku.trim() || undefined,
      });
      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "No se pudo actualizar la relación.");
    }
  }

  return (
    <Modal
      description="Actualiza el SKU del proveedor o notas internas. El precio se gestiona con registrar precio."
      footer={({ close }) => (
        <FormActions
          isSubmitting={updateSupplierProduct.isPending}
          onCancel={close}
          submitFormId={formId}
          submitLabel="Guardar cambios"
          submittingLabel="Guardando..."
        />
      )}
      onOpenChange={(nextOpen) => {
        if (nextOpen && supplierProduct) {
          setSupplierSku(supplierProduct.supplierSku ?? "");
          setNotes(supplierProduct.notes ?? "");
        }
        onOpenChange(nextOpen);
      }}
      open={open}
      title="Editar producto del proveedor"
    >
      {supplierProduct ? (
        <form className="space-y-4" id={formId} onSubmit={(event) => void handleSubmit(event)}>
          <Input
            label="Producto"
            readOnly
            value={
              supplierProduct.product
                ? `${supplierProduct.product.name} (${supplierProduct.product.sku})`
                : supplierProduct.productId
            }
          />
          <Input
            label="SKU del proveedor"
            onChange={(event) => setSupplierSku(event.target.value.toLowerCase())}
            placeholder="Código del mayorista"
            trailing={
              <GenerateSkuIconButton
                disabled={
                  !supplierProduct.product?.sku?.trim() ||
                  !supplierProduct.supplier?.name?.trim()
                }
                onGenerate={() =>
                  setSupplierSku(
                    generateSupplierSkuFromProduct(
                      supplierProduct.product?.sku ?? "",
                      supplierProduct.supplier?.name ?? "",
                    ),
                  )
                }
              />
            }
            value={supplierSku}
          />
          <Textarea
            label="Notas"
            onChange={(event) => setNotes(event.target.value)}
            rows={3}
            value={notes}
          />
          {errorMessage ? <p className="text-sm text-error">{errorMessage}</p> : null}
        </form>
      ) : null}
    </Modal>
  );
}
