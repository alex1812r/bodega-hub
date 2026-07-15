"use client";

import { Save, Tag } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/shared/components/Button";
import { stitchListFilterFieldClassName } from "@/shared/styles/form-controls";
import { cn } from "@/shared/utils/cn";

type ProductDetailPriceChangeCardProps = {
  currentPriceRef: number;
  isSubmitting?: boolean;
  onSubmit: (salePriceRef: number) => void | Promise<void>;
};

export function ProductDetailPriceChangeCard({
  currentPriceRef,
  isSubmitting = false,
  onSubmit,
}: ProductDetailPriceChangeCardProps) {
  const [priceInput, setPriceInput] = useState(String(currentPriceRef));

  useEffect(() => {
    setPriceInput(String(currentPriceRef));
  }, [currentPriceRef]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const nextPrice = Number(priceInput);

    if (!Number.isFinite(nextPrice) || nextPrice < 0) {
      return;
    }

    if (nextPrice === currentPriceRef) {
      return;
    }

    await onSubmit(nextPrice);
  }

  return (
    <section className="rounded-xl border border-border bg-surface-container-lowest p-5 shadow-sm dark:border-slate-800">
      <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-foreground">
        <Tag aria-hidden className="size-5 text-primary" />
        Cambio rápido de precio
      </h2>
      <form className="flex flex-col gap-4" onSubmit={(event) => void handleSubmit(event)}>
        <div>
          <label
            className="mb-1 block text-xs font-semibold text-on-surface-variant"
            htmlFor="product-new-price"
          >
            Nuevo precio (REF)
          </label>
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">
              $
            </span>
            <input
              className={cn(stitchListFilterFieldClassName, "pl-8")}
              id="product-new-price"
              min={0}
              onChange={(event) => setPriceInput(event.target.value)}
              placeholder={currentPriceRef.toFixed(2)}
              step="0.01"
              type="number"
              value={priceInput}
            />
          </div>
        </div>
        <Button
          className="w-full gap-2"
          disabled={isSubmitting}
          type="submit"
        >
          <Save aria-hidden className="size-[1.125rem]" />
          {isSubmitting ? "Actualizando..." : "Actualizar precio"}
        </Button>
      </form>
    </section>
  );
}
