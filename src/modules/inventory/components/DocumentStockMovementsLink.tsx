import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { withChainedReturnTo } from "@/shared/utils/returnTo";

type StockDocument = {
  id: string;
  kind: "compra" | "venta";
};

/** `/inventory/movements` filtrado por los movimientos de una venta o una compra. */
export function getDocumentStockMovementsHref(document: StockDocument) {
  const param = document.kind === "venta" ? "saleId" : "purchaseId";

  return `/inventory/movements?${param}=${encodeURIComponent(document.id)}`;
}

type DocumentStockMovementsLinkProps = {
  /** URL actual del detalle (ruta + query, con su `returnTo`): a ella vuelve la lista. */
  currentUrl: string;
  document: StockDocument;
};

/**
 * «Ver movimientos de stock» del detalle de una venta o una compra. Quien lo
 * monta decide si se ofrece: solo con `inventory.view` y si el documento movió stock.
 */
export function DocumentStockMovementsLink({
  currentUrl,
  document,
}: DocumentStockMovementsLinkProps) {
  return (
    <Link
      className="inline-flex items-center gap-1 rounded text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      href={withChainedReturnTo(getDocumentStockMovementsHref(document), currentUrl)}
    >
      Ver movimientos de stock
      <ArrowRight aria-hidden className="size-4" />
    </Link>
  );
}
