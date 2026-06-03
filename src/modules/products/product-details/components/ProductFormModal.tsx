"use client";

import { type FormEvent, useId, useState } from "react";

import { getFormSaveDescription } from "@/lib/api/dataSourceUi";
import { Button } from "@/shared/components/Button";
import { FormActions } from "@/shared/components/FormActions";
import { Input } from "@/shared/components/Input";
import { Modal } from "@/shared/components/Modal";
import { SelectField } from "@/shared/components/SelectField";
import { Textarea } from "@/shared/components/Textarea";
import type { CategoryMock } from "@/shared/mocks/erp-data";

import type { ProductInput, ProductWithCategory } from "../../hooks/useProducts";

type ProductFormModalProps = {
  categories?: CategoryMock[];
  errorMessage?: string;
  isSubmitting?: boolean;
  mode?: "create" | "edit";
  onSubmit?: (input: ProductInput) => Promise<void> | void;
  product?: ProductWithCategory;
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
  onSubmit,
  product,
}: ProductFormModalProps) {
  const formId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const isEdit = mode === "edit";

  async function handleSubmit(event: FormEvent<HTMLFormElement>, close: () => void) {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    const categoryId = String(formData.get("categoryId") ?? "");
    const input: ProductInput = {
      categoryId: categoryId || undefined,
      currentCostRef: numberFromFormData(formData, "currentCostRef"),
      currentStock: numberFromFormData(formData, "currentStock"),
      minStock: numberFromFormData(formData, "minStock"),
      name: String(formData.get("name") ?? ""),
      salePriceRef: Number(formData.get("salePriceRef") ?? 0),
      sku: String(formData.get("sku") ?? ""),
    };

    await onSubmit?.(input);
    close();
  }

  return (
    <Modal
      description={getFormSaveDescription()}
      footer={({ close }) => (
        <FormActions
          isSubmitting={isSubmitting}
          onCancel={close}
          submitFormId={formId}
          submitLabel={isEdit ? "Guardar cambios" : "Crear producto"}
        />
      )}
      onOpenChange={setIsOpen}
      open={isOpen}
      title={isEdit ? "Editar producto" : "Crear producto"}
      trigger={
        <Button size="sm" variant={isEdit ? "outline" : "primary"}>
          {isEdit ? "Editar producto" : "Nuevo producto"}
        </Button>
      }
    >
      <form
        className="grid gap-4"
        id={formId}
        onSubmit={(event) => handleSubmit(event, () => setIsOpen(false))}
      >
        <Input
          defaultValue={product?.name}
          label="Nombre"
          name="name"
          required
        />
        <div className="grid gap-4 md:grid-cols-2">
          <Input defaultValue={product?.sku} label="SKU" name="sku" required />
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
        </div>
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
        {errorMessage ? (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {errorMessage}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
