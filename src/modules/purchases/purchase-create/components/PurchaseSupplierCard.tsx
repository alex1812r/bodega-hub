"use client";

import { Building2 } from "lucide-react";
import { useMemo, useState } from "react";

import type { ContactMock } from "@/shared/mocks/erp-data";

import { PurchaseCreateSectionCard } from "./PurchaseCreateSectionCard";
import {
  PurchaseSearchAutocomplete,
  type PurchaseSearchOption,
} from "./PurchaseSearchAutocomplete";

type PurchaseSupplierCardProps = {
  onSupplierChange: (supplierId: string) => void;
  selectedSupplierId: string;
  suppliers: ContactMock[];
};

export function PurchaseSupplierCard({
  onSupplierChange,
  selectedSupplierId,
  suppliers,
}: PurchaseSupplierCardProps) {
  const [query, setQuery] = useState("");

  const selectedSupplier = suppliers.find((supplier) => supplier.id === selectedSupplierId);

  const options = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) {
      return [];
    }

    return suppliers
      .filter(
        (supplier) =>
          supplier.name.toLowerCase().includes(term) ||
          (supplier.taxId ?? "").toLowerCase().includes(term),
      )
      .slice(0, 8)
      .map(
        (supplier): PurchaseSearchOption => ({
          id: supplier.id,
          label: supplier.name,
          sublabel: supplier.taxId,
        }),
      );
  }, [query, suppliers]);

  return (
    <PurchaseCreateSectionCard icon={Building2} title="Datos del Proveedor">
      <PurchaseSearchAutocomplete
        label="Proveedor"
        onQueryChange={setQuery}
        onSelect={(option) => onSupplierChange(option.id)}
        options={options}
        placeholder="Buscar proveedor por nombre o RIF..."
        query={query}
        required
        selectedLabel={selectedSupplier?.name}
      />
    </PurchaseCreateSectionCard>
  );
}
