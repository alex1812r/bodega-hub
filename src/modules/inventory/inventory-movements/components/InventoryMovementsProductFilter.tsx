"use client";

import { useState } from "react";

import {
  EntityAutocomplete,
  type EntityAutocompleteValue,
} from "@/shared/components/EntityAutocomplete";

import { useInventoryProduct } from "../../hooks/useInventory";

type InventoryMovementsProductFilterProps = {
  /** Cadena vacía = sin filtro. */
  onChange: (productId: string) => void;
  productId: string;
};

/**
 * Filtro de producto de los movimientos: busca en el servidor mientras se
 * escribe, sin cargar el catálogo. Con un `productId` que llega en la URL lee
 * ese producto una vez para mostrar su nombre.
 */
export function InventoryMovementsProductFilter({
  onChange,
  productId,
}: InventoryMovementsProductFilterProps) {
  const [picked, setPicked] = useState<EntityAutocompleteValue | null>(null);
  const pickedLabel = picked?.id === productId ? picked.label : undefined;
  // Lo elegido en el buscador ya trae su nombre: solo se lee el que vino en la URL.
  const productQuery = useInventoryProduct(productId || undefined, pickedLabel === undefined);
  const loadedLabel = productQuery.data
    ? `${productQuery.data.name} (${productQuery.data.sku})`
    : undefined;
  const label =
    pickedLabel ??
    loadedLabel ??
    (productQuery.error ? "Producto no disponible" : "Cargando producto…");

  return (
    <EntityAutocomplete
      entity="product"
      error={pickedLabel === undefined ? productQuery.error?.message : undefined}
      label="Producto"
      onChange={(option) => {
        setPicked(option ? { id: option.id, label: `${option.label} (${option.sku})` } : null);
        onChange(option?.id ?? "");
      }}
      placeholder="Todos los productos"
      value={productId ? { id: productId, label } : null}
    />
  );
}
