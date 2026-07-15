"use client";

import type { ProductWithCategory } from "@/modules/products/hooks/useProducts";
import { EmptyState } from "@/shared/components/EmptyState";
import { LoadingState } from "@/shared/components/LoadingState";

import { PosProductCard } from "./PosProductCard";

type PosProductGridProps = {
  isLoading?: boolean;
  onAddProduct: (product: ProductWithCategory) => void;
  products: ProductWithCategory[];
  rateVes: number;
  selectedProductIds?: ReadonlySet<string>;
};

export function PosProductGrid({
  isLoading = false,
  onAddProduct,
  products,
  rateVes,
  selectedProductIds,
}: PosProductGridProps) {
  if (isLoading) {
    return (
      <LoadingState
        className="py-16"
        description="Estamos cargando el catalogo de productos."
        title="Cargando productos"
        variant="inline"
      />
    );
  }

  if (products.length === 0) {
    return (
      <EmptyState
        className="py-16"
        description="Prueba otra categoria o ajusta la busqueda."
        title="No hay productos para mostrar"
      />
    );
  }

  return (
    <div className="grid min-w-0 grid-cols-2 gap-3 p-4 sm:grid-cols-3 xl:grid-cols-4">
      {products.map((product) => (
        <PosProductCard
          isSelected={selectedProductIds?.has(product.id) ?? false}
          key={product.id}
          onAdd={onAddProduct}
          product={product}
          rateVes={rateVes}
        />
      ))}
    </div>
  );
}
