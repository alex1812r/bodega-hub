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
        const stock = Math.max(product.currentStock, 0);
        const nextQuantity = Math.min(stock, existing.quantity + quantity);
        const updated: PosCartItem = {
          ...existing,
          imageUrl: product.imageUrl ?? existing.imageUrl,
          productName: product.name,
          quantity: nextQuantity,
          stock,
          unitPriceRef: product.salePriceRef,
        };
        // Move the line to the top so rescan/selection feedback is obvious.
        return [updated, ...current.filter((item) => item.productId !== product.id)];
      }

      const initialQuantity = Math.min(Math.max(product.currentStock, 0), quantity);
      if (initialQuantity < 1) {
        return current;
      }

      return [
        {
          imageUrl: product.imageUrl ?? undefined,
          productId: product.id,
          productName: product.name,
          quantity: initialQuantity,
          stock: product.currentStock,
          unitPriceRef: product.salePriceRef,
        },
        ...current,
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
        item.productId === productId
          ? { ...item, quantity: Math.min(item.stock, quantity) }
          : item,
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
