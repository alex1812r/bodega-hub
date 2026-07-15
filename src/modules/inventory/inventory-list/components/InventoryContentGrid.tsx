import { type ReactNode } from "react";

type InventoryContentGridProps = {
  aside: ReactNode;
  children: ReactNode;
};

/**
 * Tabla (~75%) + filtros a la derecha (~25%) en desktop (Stitch 9/12 + 3/12).
 * Usa fracciones CSS en lugar de `col-span-*` para evitar utilidades no generadas.
 */
export function InventoryContentGrid({ aside, children }: InventoryContentGridProps) {
  return (
    <div className="grid w-full grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,9fr)_minmax(0,3fr)]">
      <div className="min-w-0">{children}</div>
      <aside className="hidden min-w-0 lg:block">{aside}</aside>
    </div>
  );
}
