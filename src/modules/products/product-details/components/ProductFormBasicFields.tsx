"use client";

import { type ReactNode, useState } from "react";

import { Can } from "@/shared/auth/Can";
import { Button } from "@/shared/components/Button";
import { Input } from "@/shared/components/Input";
import { NumberInput } from "@/shared/components/NumberInput";
import { PricingFields } from "@/shared/components/PricingFields";
import { SelectField } from "@/shared/components/SelectField";
import type { CategoryMock } from "@/shared/mocks/erp-data";

import { getProductPricingOptions } from "../../services/productMargin";

/** Marca del bloque de precio: el formulario busca dentro el campo de precio para enfocarlo. */
export const PRODUCT_PRICING_BLOCK_ATTRIBUTE = "data-product-pricing";

export const SALE_PRICE_REQUIRED_MESSAGE = "Escribe el precio de venta.";

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
  /** % recomendados; sin ellos, los de `getProductPricingOptions`. */
  pricingChips?: readonly number[];
  /** Se intentó guardar: un precio vacío muestra su aviso. */
  showPriceRequired?: boolean;
  /** % sugerido (el de la categoría): primer chip, destacado. */
  suggestedMarkupPct?: number;
};

/**
 * Nivel básico del formulario de producto: lo único visible al abrir.
 * Orden fijo: imagen, Nombre, Categoría, Código de barras, Costo REF y el
 * bloque de precio (`PricingFields`: chips de %, Ganancia % y Precio REF).
 *
 * El precio solo cambia cuando el usuario elige un chip, escribe un % o
 * escribe el precio: abrir el formulario o cambiar el costo no lo mueven.
 * Viaja en el campo oculto `salePriceRef`; vacío = sin precio.
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
  pricingChips,
  showPriceRequired = false,
  suggestedMarkupPct,
}: ProductFormBasicFieldsProps) {
  const [cost, setCost] = useState<number | null>(defaults.currentCostRef ?? null);
  const [price, setPrice] = useState<number | null>(defaults.salePriceRef ?? null);
  const pricingOptions = getProductPricingOptions();

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
      <NumberInput
        decimals={2}
        defaultValue={defaults.currentCostRef}
        label="Costo REF"
        name="currentCostRef"
        onValueChange={setCost}
      />
      <div {...{ [PRODUCT_PRICING_BLOCK_ATTRIBUTE]: "" }}>
        <PricingFields
          chips={pricingChips ?? pricingOptions.chips}
          cost={cost ?? 0}
          error={showPriceRequired && price === null ? SALE_PRICE_REQUIRED_MESSAGE : undefined}
          onPriceChange={setPrice}
          price={price}
          suggestedPct={suggestedMarkupPct}
          thresholds={pricingOptions.thresholds}
        />
        <input name="salePriceRef" type="hidden" value={price ?? ""} />
      </div>
    </>
  );
}
