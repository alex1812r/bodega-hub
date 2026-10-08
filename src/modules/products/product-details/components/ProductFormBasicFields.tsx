"use client";

import { type FormEvent, type ReactNode, useState } from "react";

import { Can } from "@/shared/auth/Can";
import { Button } from "@/shared/components/Button";
import { Input } from "@/shared/components/Input";
import { NumberInput } from "@/shared/components/NumberInput";
import { PricingFields } from "@/shared/components/PricingFields";
import { SelectField } from "@/shared/components/SelectField";
import type { CategoryMock } from "@/shared/mocks/erp-data";
import type { MarginThresholds } from "@/shared/utils/pricing";

import { getProductPricingOptions } from "../../services/productMargin";

/** Marca del bloque de precio: el formulario busca dentro el campo de precio para enfocarlo. */
export const PRODUCT_PRICING_BLOCK_ATTRIBUTE = "data-product-pricing";

export const SALE_PRICE_REQUIRED_MESSAGE = "Escribe el precio de venta.";

export const CATEGORY_REQUIRED_MESSAGE = "Elige una categoría.";

export const NAME_REQUIRED_MESSAGE = "Escribe el nombre del producto.";

type FormField = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

/** `field` es el primer campo del formulario que no pasa la validación nativa. */
function isFirstInvalidField(field: FormField) {
  const firstInvalid = Array.from(field.form?.elements ?? []).find(
    (element) =>
      (element instanceof HTMLInputElement ||
        element instanceof HTMLSelectElement ||
        element instanceof HTMLTextAreaElement) &&
      element.willValidate &&
      !element.validity.valid,
  );

  return !firstInvalid || firstInvalid === field;
}

type ProductFormBasicFieldsProps = {
  categories: CategoryMock[];
  /** Categoría elegida; "" = ninguna. */
  categoryId: string;
  /** Valores con los que abren los campos no controlados (producto en edición o `initialValues`). */
  defaults: {
    barcode?: string | null;
    /** Categoría con la que abre el formulario (la del producto en edición). */
    categoryId?: string | null;
    currentCostRef?: number;
    /** Solo el producto en edición lo trae: distingue la edición del alta. */
    id?: string;
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
  /** % recomendados; sin ellos, los por defecto de `getProductPricingOptions`. */
  pricingChips?: readonly number[];
  /** Se intentó guardar: un precio vacío muestra su aviso. */
  showPriceRequired?: boolean;
  /** % sugerido (el de la categoría): primer chip, destacado. */
  suggestedMarkupPct?: number;
  /** Cortes del semáforo; sin ellos, los por defecto de `getProductPricingOptions`. */
  thresholds?: MarginThresholds;
};

/**
 * Nivel básico del formulario de producto: lo único visible al abrir.
 * Orden fijo: imagen, Nombre, Categoría, Código de barras, Costo REF y el
 * bloque de precio (`PricingFields`: semáforo, chips de % y Precio REF). El %
 * libre ("Ganancia %") se revela con el chip "Otro %", o abre ya a la vista si
 * el % del precio cargado no es ningún chip. El costo se ve una sola vez, en
 * su campo: la caja de solo lectura de `PricingFields` va oculta.
 *
 * La Categoría es obligatoria en el alta. En la edición solo lo es si la del
 * producto está entre las opciones: no se le puede quitar, pero un producto
 * antiguo sin categoría, o con una que ya no se ofrece (inactiva), se guarda
 * sin elegirla. Sin categoría o sin nombre el envío se frena con el aviso en
 * el campo, en vez del globo nativo del navegador.
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
  thresholds,
}: ProductFormBasicFieldsProps) {
  const [cost, setCost] = useState<number | null>(defaults.currentCostRef ?? null);
  const [price, setPrice] = useState<number | null>(defaults.salePriceRef ?? null);
  const [showCategoryRequired, setShowCategoryRequired] = useState(false);
  const [showNameRequired, setShowNameRequired] = useState(false);
  const pricingOptions = getProductPricingOptions();
  const isCategoryRequired =
    !defaults.id || categories.some((category) => category.id === defaults.categoryId);
  const hasCategory = categories.some((category) => category.id === categoryId);

  // Validación nativa (`required`) con aviso propio: el foco va al selector solo
  // si es el primer campo que falla; si no, el navegador ya señala el anterior.
  function handleCategoryInvalid(event: FormEvent<HTMLSelectElement>) {
    event.preventDefault();
    setShowCategoryRequired(true);

    if (isFirstInvalidField(event.currentTarget)) {
      event.currentTarget.focus();
    }
  }

  // Igual que la Categoría: aviso propio en vez del globo del navegador.
  function handleNameInvalid(event: FormEvent<HTMLInputElement>) {
    event.preventDefault();
    setShowNameRequired(true);

    if (isFirstInvalidField(event.currentTarget)) {
      event.currentTarget.focus();
    }
  }

  return (
    <>
      {image}
      <Input
        // Alta: el foco inicial va al Nombre y no al botón de la imagen, que va antes.
        autoFocus={!defaults.id}
        error={showNameRequired && !name ? NAME_REQUIRED_MESSAGE : undefined}
        label="Nombre"
        name="name"
        onChange={(event) => onNameChange(event.target.value)}
        onInvalid={handleNameInvalid}
        required
        value={name}
      />
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1">
          <SelectField
            error={showCategoryRequired && !hasCategory ? CATEGORY_REQUIRED_MESSAGE : undefined}
            label="Categoría"
            name="categoryId"
            onChange={(event) => onCategoryChange(event.target.value)}
            onInvalid={handleCategoryInvalid}
            options={categories.map((category) => ({
              label: category.name,
              value: category.id,
            }))}
            placeholder="Selecciona"
            required={isCategoryRequired}
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
          customPct="onDemand"
          error={showPriceRequired && price === null ? SALE_PRICE_REQUIRED_MESSAGE : undefined}
          hideCost
          onPriceChange={setPrice}
          price={price}
          suggestedPct={suggestedMarkupPct}
          thresholds={thresholds ?? pricingOptions.thresholds}
        />
        <input name="salePriceRef" type="hidden" value={price ?? ""} />
      </div>
    </>
  );
}
