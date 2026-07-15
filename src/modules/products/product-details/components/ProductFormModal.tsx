"use client";

import { type FormEvent, type ReactNode, useId, useState } from "react";

import { getFormSaveDescription } from "@/lib/api/dataSourceUi";
import { Can } from "@/shared/auth/Can";
import { GenerateSkuIconButton } from "@/shared/components/GenerateSkuIconButton";
import { Button } from "@/shared/components/Button";
import { FormActions } from "@/shared/components/FormActions";
import { Input } from "@/shared/components/Input";
import { Modal } from "@/shared/components/Modal";
import { SelectField } from "@/shared/components/SelectField";
import { Textarea } from "@/shared/components/Textarea";
import type { CategoryMock } from "@/shared/mocks/erp-data";
import { generateProductSkuFromName } from "@/shared/utils/skuGeneration";

import type { ProductInput, ProductWithCategory } from "../../hooks/useProducts";
import { normalizeBarcode } from "../../services/productSearch";
import {
  removeProductImage,
  uploadProductImageBlob,
} from "../../services/uploadProductImage";
import { ProductImageUploadField } from "./ProductImageUploadField";

export type ProductFormSubmitContext = {
  pendingImageBlob?: Blob | null;
};

type ProductFormModalProps = {
  categories?: CategoryMock[];
  errorMessage?: string;
  isSubmitting?: boolean;
  mode?: "create" | "edit";
  onImageUpdated?: () => void | Promise<void>;
  onSubmit?: (input: ProductInput, context?: ProductFormSubmitContext) => Promise<void> | void;
  product?: ProductWithCategory;
  trigger?: ReactNode;
};

function numberFromFormData(formData: FormData, key: string) {
  const value = formData.get(key);

  return value === null || value === "" ? undefined : Number(value);
}

export function ProductFormModal({
  categories = [],
  errorMessage,
  isSubmitting = false,
  mode = "create",
  onImageUpdated,
  onSubmit,
  product,
  trigger,
}: ProductFormModalProps) {
  const formId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [pendingImageBlob, setPendingImageBlob] = useState<Blob | null>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const isEdit = mode === "edit";

  function resetFormFields() {
    setName(product?.name ?? "");
    setSku(product?.sku ?? "");
    setPendingImageBlob(null);
    setImageError(null);
  }

  function handleOpenChange(nextOpen: boolean) {
    setIsOpen(nextOpen);
    if (nextOpen) {
      resetFormFields();
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>, close: () => void) {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    const categoryId = String(formData.get("categoryId") ?? "");
    const input: ProductInput = {
      barcode: normalizeBarcode(String(formData.get("barcode") ?? "")),
      categoryId: categoryId || undefined,
      currentCostRef: numberFromFormData(formData, "currentCostRef"),
      currentStock: numberFromFormData(formData, "currentStock"),
      minStock: numberFromFormData(formData, "minStock"),
      name: name.trim(),
      salePriceRef: Number(formData.get("salePriceRef") ?? 0),
      sku: sku.trim().toLowerCase(),
    };

    await onSubmit?.(input, { pendingImageBlob });
    close();
  }

  async function handleUploadImage(blob: Blob) {
    if (!product?.id) {
      return;
    }

    setIsUploadingImage(true);
    setImageError(null);

    try {
      await uploadProductImageBlob(product.id, blob);
      await onImageUpdated?.();
    } catch (error) {
      setImageError(
        error instanceof Error ? error.message : "No se pudo subir la imagen del producto.",
      );
      throw error;
    } finally {
      setIsUploadingImage(false);
    }
  }

  async function handleRemoveImage() {
    if (!product?.id) {
      return;
    }

    setIsUploadingImage(true);
    setImageError(null);

    try {
      await removeProductImage(product.id);
      await onImageUpdated?.();
    } catch (error) {
      setImageError(
        error instanceof Error ? error.message : "No se pudo quitar la imagen del producto.",
      );
    } finally {
      setIsUploadingImage(false);
    }
  }

  return (
    <Modal
      description={getFormSaveDescription()}
      footer={({ close }) => (
        <FormActions
          isSubmitting={isSubmitting || isUploadingImage}
          onCancel={close}
          submitFormId={formId}
          submitLabel={isEdit ? "Guardar cambios" : "Crear producto"}
        />
      )}
      onOpenChange={handleOpenChange}
      open={isOpen}
      title={isEdit ? "Editar producto" : "Crear producto"}
      trigger={
        trigger ?? (
          <Button size="sm" variant={isEdit ? "outline" : "primary"}>
            {isEdit ? "Editar producto" : "Nuevo producto"}
          </Button>
        )
      }
    >
      <form
        className="grid gap-4"
        id={formId}
        onSubmit={(event) => handleSubmit(event, () => handleOpenChange(false))}
      >
        <Can permission="products.manage">
          <ProductImageUploadField
            disabled={isSubmitting}
            imageUrl={product?.imageUrl}
            isUploading={isUploadingImage}
            onPendingBlobChange={isEdit ? undefined : setPendingImageBlob}
            onRemove={isEdit && product?.imageUrl ? handleRemoveImage : undefined}
            onUpload={isEdit && product?.id ? handleUploadImage : undefined}
          />
        </Can>
        <Input
          label="Nombre"
          name="name"
          onChange={(event) => setName(event.target.value)}
          required
          value={name}
        />
        <div className="grid gap-4 md:grid-cols-2">
          <Input
            label="SKU"
            name="sku"
            onChange={(event) => setSku(event.target.value.toLowerCase())}
            required
            trailing={
              <GenerateSkuIconButton
                disabled={!name.trim()}
                onGenerate={() => setSku(generateProductSkuFromName(name))}
              />
            }
            value={sku}
          />
          <Input
            defaultValue={product?.barcode ?? ""}
            label="Codigo de barras"
            name="barcode"
            placeholder="Opcional"
          />
        </div>
        <SelectField
          defaultValue={product?.categoryId ?? ""}
          label="Categoria"
          name="categoryId"
          options={categories.map((category) => ({
            label: category.name,
            value: category.id,
          }))}
          placeholder="Selecciona"
        />
        <div className="grid gap-4 md:grid-cols-2">
          <Input
            defaultValue={product?.currentCostRef}
            label="Costo ref"
            min={0}
            name="currentCostRef"
            step="0.01"
            type="number"
          />
          <Input
            defaultValue={product?.salePriceRef}
            label="Precio ref"
            min={0}
            name="salePriceRef"
            required
            step="0.01"
            type="number"
          />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Input
            defaultValue={product?.currentStock}
            label="Stock inicial"
            min={0}
            name="currentStock"
            type="number"
          />
          <Input
            defaultValue={product?.minStock}
            label="Stock minimo"
            min={0}
            name="minStock"
            type="number"
          />
        </div>
        <Textarea label="Descripcion" placeholder="Detalles del producto" />
        {imageError ? (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {imageError}
          </p>
        ) : null}
        {errorMessage ? (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {errorMessage}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
