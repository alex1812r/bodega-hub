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
  selectedQuantities?: ReadonlyMap<string, number>;
};

export function PosProductGrid({
  isLoading = false,
  onAddProduct,
  products,
  rateVes,
  selectedQuantities,
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
        {products.map((product) => {
          const selectedQuantity = selectedQuantities?.get(product.id) ?? 0;

          return (
            <PosProductListRow
              isSelected={selectedQuantity > 0}
              key={product.id}
              onAdd={onAddProduct}
              product={product}
              rateVes={rateVes}
              selectedQuantity={selectedQuantity}
            />
          );
        })}
      </ul>

      <div className="hidden min-w-0 grid-cols-[repeat(auto-fill,minmax(9.5rem,11rem))] justify-start gap-3 p-4 lg:grid">
        {products.map((product) => {
          const selectedQuantity = selectedQuantities?.get(product.id) ?? 0;

          return (
            <PosProductCard
              isSelected={selectedQuantity > 0}
              key={product.id}
              onAdd={onAddProduct}
              product={product}
              rateVes={rateVes}
            />
          );
        })}
      </div>
    </>
  );
}
