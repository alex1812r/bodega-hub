import type { ContactMock } from "@/shared/mocks/erp-data";
import { formatRefUsd, formatVesBs } from "@/shared/utils/currency";
import { formatDate } from "@/shared/utils/date";

import type { SaleItemWithProduct } from "../../hooks/useSales";
import { defaultReceiptCompany } from "../utils/receiptCompany";
import { formatInvoiceHeading, getTaxPercentLabel } from "../utils/saleDetailLabels";

type SaleDetailReceiptPreviewProps = {
  cashierName: string;
  companyName?: string;
  createdAt: string;
  customer?: ContactMock;
  discountRef: number;
  id?: string;
  invoiceNumber: string;
  items: SaleItemWithProduct[];
  refRateVes: number;
  subtotalRef: number;
  taxRef: number;
  totalRef: number;
  totalVes: number;
};

function shortenProductName(name: string, maxLength = 32) {
  if (name.length <= maxLength) {
    return name;
  }

  return `${name.slice(0, maxLength - 1)}…`;
}

export function SaleDetailReceiptPreview({
  cashierName,
  companyName = defaultReceiptCompany.name,
  createdAt,
  customer,
  discountRef,
  id = "sale-receipt-preview",
  invoiceNumber,
  items,
  refRateVes,
  subtotalRef,
  taxRef,
  totalRef,
  totalVes,
}: SaleDetailReceiptPreviewProps) {
  const taxPercent = getTaxPercentLabel(subtotalRef, taxRef);

  return (
    <article
      className="sale-receipt mx-auto flex w-full max-w-[80mm] flex-col gap-3 rounded border border-border bg-[#fffdf9] p-3 text-[11px] leading-snug text-[#111] shadow-sm print:max-w-none print:gap-2 print:p-0 print:shadow-none dark:border-slate-700"
      id={id}
    >
      <header className="sale-receipt__header border-b border-dashed border-border pb-2 text-center dark:border-slate-600">
        <div className="sale-receipt__logo mx-auto mb-1.5 flex size-10 items-center justify-center rounded-full bg-[#0b1c30] text-base font-bold text-white print:hidden">
          B
        </div>
        <h2 className="sale-receipt__company text-sm font-bold leading-tight">{companyName}</h2>
        <p className="sale-receipt__meta">RIF: {defaultReceiptCompany.rif}</p>
        <p className="sale-receipt__meta">{defaultReceiptCompany.address}</p>
        <p className="sale-receipt__meta">Tel: {defaultReceiptCompany.phone}</p>
      </header>

      <section className="sale-receipt__info space-y-0.5 border-b border-dashed border-border pb-2 dark:border-slate-600">
        <p>Factura: {formatInvoiceHeading(invoiceNumber)}</p>
        <p>Fecha: {formatDate(createdAt, "DD/MM/YYYY HH:mm")}</p>
        <p>Cliente: {customer?.name ?? "—"}</p>
        <p>CI/RIF: {customer?.taxId ?? "—"}</p>
        <p>Cajero: {cashierName}</p>
      </section>

      <section className="sale-receipt__items border-b border-dashed border-border pb-2 dark:border-slate-600">
        <table className="sale-receipt__table w-full table-fixed border-collapse text-left">
          <thead>
            <tr className="border-b border-border/40">
              <th className="w-[14%] py-0.5 pr-1">Cant</th>
              <th className="w-[56%] py-0.5">Descripcion</th>
              <th className="w-[30%] py-0.5 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={`${item.saleId}-${item.productId}`} className="align-top">
                <td className="py-0.5 pr-1">{item.quantity}</td>
                <td className="break-words py-0.5 pr-1">
                  {shortenProductName(item.product?.name ?? item.productId, 40)}
                </td>
                <td className="py-0.5 text-right tabular-nums">
                  {formatRefUsd(item.subtotalRef)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="sale-receipt__totals space-y-0.5 border-b border-dashed border-border pb-2 text-right dark:border-slate-600">
        <div className="flex justify-between gap-2">
          <span>Subtotal:</span>
          <span className="tabular-nums">{formatRefUsd(subtotalRef)}</span>
        </div>
        {discountRef > 0 ? (
          <div className="flex justify-between gap-2">
            <span>Descuento:</span>
            <span className="tabular-nums">-{formatRefUsd(discountRef)}</span>
          </div>
        ) : null}
        <div className="flex justify-between gap-2">
          <span>IVA ({taxPercent}%):</span>
          <span className="tabular-nums">{formatRefUsd(taxRef)}</span>
        </div>
        <div className="mt-1 flex justify-between gap-2 text-xs font-bold">
          <span>TOTAL REF:</span>
          <span className="tabular-nums">{formatRefUsd(totalRef)}</span>
        </div>
        <div className="flex justify-between gap-2 text-xs font-bold">
          <span>TOTAL VES:</span>
          <span className="tabular-nums">{formatVesBs(totalVes)}</span>
        </div>
        <p className="sale-receipt__rate mt-0.5 text-left text-[10px] text-gray-600">
          Tasa: {refRateVes.toFixed(2)} VES/REF
        </p>
      </section>

      <footer className="sale-receipt__footer pt-1 text-center text-[10px] text-gray-600">
        <p>¡Gracias por su compra!</p>
        <p>Conserve este ticket para reclamos.</p>
      </footer>
    </article>
  );
}
