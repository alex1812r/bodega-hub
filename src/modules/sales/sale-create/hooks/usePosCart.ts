"use client";

import { useMemo, useState } from "react";

import type { ProductWithCategory } from "@/modules/products/hooks/useProducts";

export type PosCartItem = {
  imageUrl?: string;
  productId: string;
  productName: string;
  quantity: number;
  stock: number;
  unitPriceRef: number;
};

export function usePosCart() {
  const [items, setItems] = useState<PosCartItem[]>([]);

  function addProduct(product: ProductWithCategory, quantity = 1) {
    if (quantity < 1) {
      return;
    }

    setItems((current) => {
      const existing = current.find((item) => item.productId === product.id);

      if (existing) {
        return current.map((item) =>
          item.productId === product.id
            ? { ...item, quantity: item.quantity + quantity }
            : item,
        );
      }

      return [
        ...current,
        {
          imageUrl: product.imageUrl ?? undefined,
          productId: product.id,
          productName: product.name,
          quantity,
          stock: product.currentStock,
          unitPriceRef: product.salePriceRef,
        },
      ];
    });
  }

  function setQuantity(productId: string, quantity: number) {
    if (quantity < 1) {
      setItems((current) => current.filter((item) => item.productId !== productId));
      return;
    }

    setItems((current) =>
      current.map((item) =>
        item.productId === productId ? { ...item, quantity } : item,
      ),
    );
  }

  function clearCart() {
    setItems([]);
  }

  const subtotalRef = useMemo(
    () => items.reduce((total, item) => total + item.quantity * item.unitPriceRef, 0),
    [items],
  );

  const itemsCount = useMemo(
    () => items.reduce((total, item) => total + item.quantity, 0),
    [items],
  );

  return {
    addProduct,
    clearCart,
    items,
    itemsCount,
    setQuantity,
    subtotalRef,
  };
}
