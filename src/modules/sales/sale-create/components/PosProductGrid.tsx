"use client";

import type { ProductWithCategory } from "@/modules/products/hooks/useProducts";
import { EmptyState } from "@/shared/components/EmptyState";
import { LoadingState } from "@/shared/components/LoadingState";

import { PosProductCard } from "./PosProductCard";
import { PosProductListRow } from "./PosProductListRow";

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
    <>
      <ul className="flex flex-col gap-2 p-3 lg:hidden">
        {products.map((product) => (
          <PosProductListRow
            isSelected={selectedProductIds?.has(product.id) ?? false}
            key={product.id}
            onAdd={onAddProduct}
            product={product}
            rateVes={rateVes}
          />
        ))}
      </ul>

      <div className="hidden min-w-0 grid-cols-[repeat(auto-fill,minmax(9.5rem,11rem))] justify-start gap-3 p-4 lg:grid">
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
    </>
  );
}
