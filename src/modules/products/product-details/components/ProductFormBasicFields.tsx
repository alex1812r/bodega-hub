"use client";

import type { ReactNode } from "react";

import { Input } from "@/shared/components/Input";
import { NumberInput } from "@/shared/components/NumberInput";
import { SelectField } from "@/shared/components/SelectField";
import type { CategoryMock } from "@/shared/mocks/erp-data";

type ProductFormBasicFieldsProps = {
  categories: CategoryMock[];
  /** Valores con los que abren los campos no controlados (producto en edición o `initialValues`). */
  defaults: {
    barcode?: string | null;
    categoryId?: string;
    currentCostRef?: number;
    salePriceRef?: number;
  };
  /** Campo de imagen ya montado; el modo `compact` no lo pasa. */
  image?: ReactNode;
  name: string;
  onNameChange: (name: string) => void;
};

/**
 * Nivel básico del formulario de producto: lo único visible al abrir.
 * Orden fijo: imagen, Nombre, Categoría, Código de barras, Precio REF, Costo REF.
 */
export function ProductFormBasicFields({
  categories,
  defaults,
  image,
  name,
  onNameChange,
}: ProductFormBasicFieldsProps) {
  return (
    <>
      {image}
      <Input
        label="Nombre"
        name="name"
        onChange={(event) => onNameChange(event.target.value)}
        required
        value={name}
      />
      <div className="grid gap-4 md:grid-cols-2">
        <SelectField
          defaultValue={defaults.categoryId ?? ""}
          label="Categoría"
          name="categoryId"
          options={categories.map((category) => ({
            label: category.name,
            value: category.id,
          }))}
          placeholder="Selecciona"
        />
        <Input
          defaultValue={defaults.barcode ?? ""}
          label="Código de barras"
          name="barcode"
          placeholder="Opcional"
        />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <NumberInput
          decimals={2}
          defaultValue={defaults.salePriceRef}
          label="Precio REF"
          name="salePriceRef"
          required
        />
        <NumberInput
          decimals={2}
          defaultValue={defaults.currentCostRef}
          label="Costo REF"
          name="currentCostRef"
        />
      </div>
    </>
  );
}
