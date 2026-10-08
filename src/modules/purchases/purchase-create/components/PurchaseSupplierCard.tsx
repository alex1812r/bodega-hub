"use client";

import { Building2 } from "lucide-react";
import { useState } from "react";

import { useContact } from "@/modules/contacts/hooks/useContacts";
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
  /** Con el nombre del proveedor elegido; al quitarlo, `""` y sin nombre. */
  onSupplierChange: (supplierId: string, supplierName?: string) => void;
  selectedSupplierId: string;
  /** Búsqueda de proveedores; por defecto `GET /api/contacts`. */
  supplierFetcher?: EntityFetcher<"contact">;
};

export function PurchaseSupplierCard({
  onSupplierChange,
  selectedSupplierId,
  supplierFetcher,
}: PurchaseSupplierCardProps) {
  const [pickedSupplier, setPickedSupplier] = useState<EntityAutocompleteValue | null>(null);
  const pickedLabel =
    pickedSupplier?.id === selectedSupplierId ? pickedSupplier.label : undefined;
  // El id que llega desde fuera (borrador restaurado, compra duplicada) no trae
  // nombre: se lee el contacto solo en ese caso.
  const externalSupplier = useContact(pickedLabel === undefined ? selectedSupplierId : undefined);
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
          setPickedSupplier(option ? { id: option.id, label: option.label } : null);
          onSupplierChange(option?.id ?? "", option?.label);
        }}
        placeholder={isResolvingName ? LOADING_SUPPLIER_PLACEHOLDER : undefined}
        // Un reciente guardado puede haberse desactivado: aquí no se ofrecen.
        recentsKey={null}
        required
        value={value}
      />
    </PurchaseCreateSectionCard>
  );
}
