/**
 * Regla `@page` del ticket, tal cual estaba en `globals.css`. `@page` no admite
 * selector, así que global se aplicaba a todas las pantallas de la app; aquí
 * solo existe mientras el recibo está montado.
 */
export const SALE_RECEIPT_PAGE_CSS = "@media print { @page { margin: 2mm; size: 80mm auto; } }";

/**
 * Página de impresión del ticket de 80 mm. Se monta junto a la copia de
 * impresión del recibo (`#sale-receipt-preview`), nunca dentro de ella; el
 * resto de reglas de impresión del ticket vive en `globals.css`.
 */
export function SaleReceiptPrintPageStyle() {
  return <style>{SALE_RECEIPT_PAGE_CSS}</style>;
}
