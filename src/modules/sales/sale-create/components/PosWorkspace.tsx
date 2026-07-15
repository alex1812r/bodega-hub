import { type ReactNode } from "react";

import { cn } from "@/shared/utils/cn";

import { PosCatalogColumn } from "./PosCatalogColumn";

type PosWorkspaceProps = {
  cart: ReactNode;
  catalogScroll: ReactNode;
  categorySlider: ReactNode;
  className?: string;
  toolbar: ReactNode;
};

/**
 * POS: movil 60/40 vertical; desktop catalogo flexible + carrito (--pos-cart-width) a la derecha.
 */
export function PosWorkspace({
  cart,
  catalogScroll,
  categorySlider,
  className,
  toolbar,
}: PosWorkspaceProps) {
  return (
    <div
      className={cn(
        "flex min-h-0 max-w-full flex-1 flex-col overflow-hidden lg:flex-row lg:items-stretch",
        className,
      )}
    >
      <PosCatalogColumn
        categorySlider={categorySlider}
        className={cn("min-h-0 max-lg:flex-[3] max-lg:basis-0", "lg:flex-1 lg:min-w-0")}
        productScroll={catalogScroll}
        toolbar={toolbar}
      />

      <div
        className={cn(
          "pos-cart-aside flex min-h-0 flex-col overflow-hidden",
          "max-lg:flex-[2] max-lg:basis-0",
        )}
      >
        {cart}
      </div>
    </div>
  );
}
