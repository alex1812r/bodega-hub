import { ChevronDown } from "lucide-react";

import { cn } from "@/shared/utils/cn";

/** `id` del panel de movimientos de un producto: lo comparten el botón (`aria-controls`) y el panel. */
export function getInventoryMovementsPanelId(productId: string) {
  return `inventory-movements-${productId}`;
}

/** `id` del elemento al que se desplaza la página al llegar con `?product=<id>`. */
export function getInventoryProductAnchorId(productId: string) {
  return `inventory-product-${productId}`;
}

type InventoryMovementsToggleProps = {
  className?: string;
  isExpanded: boolean;
  onToggle: (productId: string) => void;
  productId: string;
  productName: string;
  /** Tarjeta de móvil: el botón lleva el texto "Movimientos" además del icono. */
  showLabel?: boolean;
};

/**
 * Botón que abre o cierra los últimos movimientos de un producto en
 * `/inventory`. Es un botón normal dentro de una celda: no captura los clics del
 * resto de la fila.
 */
export function InventoryMovementsToggle({
  className,
  isExpanded,
  onToggle,
  productId,
  productName,
  showLabel = false,
}: InventoryMovementsToggleProps) {
  return (
    <button
      aria-controls={getInventoryMovementsPanelId(productId)}
      aria-expanded={isExpanded}
      aria-label={`${isExpanded ? "Ocultar" : "Ver"} movimientos de ${productName}`}
      className={cn(
        "inline-flex shrink-0 cursor-pointer items-center justify-center gap-1 rounded-md text-sm font-medium text-on-surface-variant transition-colors hover:bg-surface-container hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        showLabel ? "h-9 border border-border px-3" : "size-8",
        isExpanded && "bg-surface-container text-foreground",
        className,
      )}
      id={getInventoryProductAnchorId(productId)}
      onClick={() => onToggle(productId)}
      type="button"
    >
      {showLabel ? <span>Movimientos</span> : null}
      <ChevronDown
        aria-hidden
        className={cn("size-4 transition-transform motion-reduce:transition-none", isExpanded && "rotate-180")}
      />
    </button>
  );
}
