import { type ReactNode } from "react";

import { cn } from "@/shared/utils/cn";

type PosCatalogColumnProps = {
  categorySlider: ReactNode;
  className?: string;
  productScroll: ReactNode;
  toolbar: ReactNode;
};

/**
 * Columna catalogo: buscador y categorias fijos; solo la grilla de productos hace scroll.
 */
export function PosCatalogColumn({
  categorySlider,
  className,
  productScroll,
  toolbar,
}: PosCatalogColumnProps) {
  return (
    <section className={cn("flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden", className)}>
      <div className="shrink-0">{toolbar}</div>
      <div className="shrink-0">{categorySlider}</div>
      <div className="min-h-0 min-w-0 flex-1 basis-0 overflow-x-hidden overflow-y-auto overscroll-contain bg-background">
        {productScroll}
      </div>
    </section>
  );
}
