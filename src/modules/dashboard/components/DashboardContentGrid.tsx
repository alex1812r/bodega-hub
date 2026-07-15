import { type ReactNode } from "react";

type DashboardContentGridProps = {
  aside: ReactNode;
  children: ReactNode;
};

/**
 * 1 fila en desktop: grid de 3 columnas; `children` ocupa 2 (chart + ventas recientes).
 * @see https://tailwindcss.com/docs/grid-column
 */
export function DashboardContentGrid({ aside, children }: DashboardContentGridProps) {
  return (
    <div className="grid w-full grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">{children}</div>
      <div className="min-w-0 lg:col-span-1">{aside}</div>
    </div>
  );
}
