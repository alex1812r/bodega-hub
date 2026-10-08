"use client";

import { Building2 } from "lucide-react";
import { useState } from "react";

import {
  fetchPurchaseSupplierOptions,
  usePurchaseSupplier,
} from "@/modules/purchases/hooks/usePurchaseSuppliers";
import {
  type ContactEntityFilters,
  EntityAutocomplete,
  type EntityAutocompleteValue,
  type EntityFetcher,
} from "@/shared/components/EntityAutocomplete";

import { PurchaseCreateSectionCard } from "./PurchaseCreateSectionCard";

const SUPPLIER_FILTERS: ContactEntityFilters = { active: true, type: ["proveedor", "ambos"] };
const LOADING_SUPPLIER_PLACEHOLDER = "Cargando proveedor…";

type PurchaseSupplierCardProps = {
  /**
   * Con el nombre del proveedor elegido; al quitarlo, `""` y sin nombre. Es una petición:
   * quien la recibe puede retenerla (la página pregunta antes de quitar las líneas) y la
   * tarjeta sigue mostrando `selectedSupplierId`.
   */
  onSupplierChange: (supplierId: string, supplierName?: string) => void;
  selectedSupplierId: string;
  /**
   * Búsqueda de proveedores; por defecto `GET /api/purchases/suppliers`, que se
   * autoriza con `purchases.create` (quien registra compras puede no leer contactos).
   */
  supplierFetcher?: EntityFetcher<"contact">;
};

export function PurchaseSupplierCard({
  onSupplierChange,
  selectedSupplierId,
  supplierFetcher = fetchPurchaseSupplierOptions,
}: PurchaseSupplierCardProps) {
  // Nombre de cada proveedor elegido aquí, por id: si la página retiene un cambio, el
  // anterior sigue teniendo su nombre sin releer el proveedor.
  const [pickedLabels, setPickedLabels] = useState<Record<string, string>>({});
  const pickedLabel = selectedSupplierId ? pickedLabels[selectedSupplierId] : undefined;
  // El id que llega desde fuera (borrador restaurado, compra duplicada) no trae
  // nombre: se lee el proveedor solo en ese caso.
  const externalSupplier = usePurchaseSupplier(
    pickedLabel === undefined ? selectedSupplierId : undefined,
  );
  const isResolvingName =
    Boolean(selectedSupplierId) && pickedLabel === undefined && externalSupplier.isPending;
  const value: EntityAutocompleteValue | null = selectedSupplierId
    ? { id: selectedSupplierId, label: pickedLabel ?? externalSupplier.data?.name ?? "" }
    : null;

  return (
    <PurchaseCreateSectionCard icon={Building2} title="Datos del Proveedor">
      <EntityAutocomplete
        entity="contact"
        error={
          selectedSupplierId && pickedLabel === undefined && externalSupplier.error
            ? externalSupplier.error.message
            : undefined
        }
        fetcher={supplierFetcher}
        filters={SUPPLIER_FILTERS}
        label="Proveedor"
        onChange={(option) => {
          if (option) {
            setPickedLabels((current) => ({ ...current, [option.id]: option.label }));
          }

          onSupplierChange(option?.id ?? "", option?.label);
        }}
        placeholder={isResolvingName ? LOADING_SUPPLIER_PLACEHOLDER : undefined}
        // Un reciente guardado puede haberse desactivado: aquí no se ofrecen.
        recentsKey={null}
        // La búsqueda de compras no trae teléfono ni distingue `ambos`: solo el RIF.
        renderSecondary={(option) => option.taxId}
        required
        value={value}
      />
    </PurchaseCreateSectionCard>
  );
}
