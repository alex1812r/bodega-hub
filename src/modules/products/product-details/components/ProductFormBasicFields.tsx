"use client";

import type { ReactNode } from "react";

import { Can } from "@/shared/auth/Can";
import { Button } from "@/shared/components/Button";
import { Input } from "@/shared/components/Input";
import { NumberInput } from "@/shared/components/NumberInput";
import { SelectField } from "@/shared/components/SelectField";
import type { CategoryMock } from "@/shared/mocks/erp-data";

type ProductFormBasicFieldsProps = {
  categories: CategoryMock[];
  /** Categoría elegida; "" = ninguna. */
  categoryId: string;
  /** Valores con los que abren los campos no controlados (producto en edición o `initialValues`). */
  defaults: {
    barcode?: string | null;
    currentCostRef?: number;
    salePriceRef?: number;
  };
  /** Campo de imagen ya montado; el modo `compact` no lo pasa. */
  image?: ReactNode;
  name: string;
  onCategoryChange: (categoryId: string) => void;
  /**
   * Abre el alta rápida de categoría. Recibe el botón pulsado, para devolverle
   * el foco al cerrar. El botón exige `products.manage`, como crear categorías.
   */
  onCreateCategory?: (trigger: HTMLButtonElement) => void;
  onNameChange: (name: string) => void;
};

/**
 * Nivel básico del formulario de producto: lo único visible al abrir.
 * Orden fijo: imagen, Nombre, Categoría, Código de barras, Precio REF, Costo REF.
 */
export function ProductFormBasicFields({
  categories,
  categoryId,
  defaults,
  image,
  name,
  onCategoryChange,
  onCreateCategory,
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
        <div className="space-y-1">
          <SelectField
            label="Categoría"
            name="categoryId"
            onChange={(event) => onCategoryChange(event.target.value)}
            options={categories.map((category) => ({
              label: category.name,
              value: category.id,
            }))}
            placeholder="Selecciona"
            value={categoryId}
          />
          {onCreateCategory ? (
            <Can permission="products.manage">
              <Button
                className="-ml-2 h-8 px-2 text-primary"
                onClick={(event) => onCreateCategory(event.currentTarget)}
                size="sm"
                variant="ghost"
              >
                + Nueva categoría
              </Button>
            </Can>
          ) : null}
        </div>
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
