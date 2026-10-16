"use client";

import { ImageOff } from "lucide-react";
import { useState } from "react";

import { InvoiceImageViewer } from "@/modules/invoice-scan/client/components/InvoiceImageViewer";
import { CollapsibleSection } from "@/shared/components/CollapsibleSection";
import { ErrorState } from "@/shared/components/ErrorState";
import { LoadingState } from "@/shared/components/LoadingState";

import {
  type PurchaseInvoiceScanLine,
  usePurchaseInvoiceScan,
  usePurchaseInvoiceScanImages,
} from "../hooks/usePurchaseInvoiceScan";

export const PURCHASE_INVOICE_SCAN_EXPIRED_MESSAGE =
  "La imagen de esta factura ya se borró: se guarda 90 días. Las líneas aprendidas siguen aquí.";
const MISSING_PRODUCT_LABEL = "Producto no disponible";

/** Empaque de la línea para el paréntesis: «Bulto de 20», «Bulto» o «empaque de 20». */
export function formatInvoiceLinePack(line: Pick<PurchaseInvoiceScanLine, "packLabel" | "unitsPerPack">) {
  const label = line.packLabel?.trim();

  if (label && line.unitsPerPack) {
    return `${label} de ${line.unitsPerPack}`;
  }

  if (label) {
    return label;
  }

  return line.unitsPerPack ? `empaque de ${line.unitsPerPack}` : null;
}

function learnedSummary(learned: number, pages: number) {
  const lines = `${learned} ${learned === 1 ? "línea aprendida" : "líneas aprendidas"}`;
  return `${lines} · ${pages} ${pages === 1 ? "página" : "páginas"}`;
}

function ExpiredImageNotice() {
  return (
    <div
      className="flex items-start gap-3 rounded-lg border border-border bg-surface-container-low p-4 text-sm text-on-surface-variant dark:border-slate-800"
      role="status"
    >
      <ImageOff aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
      <p className="min-w-0 [overflow-wrap:anywhere]">{PURCHASE_INVOICE_SCAN_EXPIRED_MESSAGE}</p>
    </div>
  );
}

function InvoiceScanImages({ enabled, expired, purchaseId }: { enabled: boolean; expired: boolean; purchaseId: string }) {
  const images = usePurchaseInvoiceScanImages(purchaseId, enabled && !expired);

  if (expired || images.data?.imageExpired) {
    return <ExpiredImageNotice />;
  }

  if (images.isError) {
    return (
      <ErrorState
        description={images.error instanceof Error ? images.error.message : undefined}
        onRetry={() => void images.refetch()}
        title="No pudimos cargar la imagen de la factura"
      />
    );
  }

  if (images.isPending || !images.data) {
    return <LoadingState title="Cargando la factura..." variant="inline" className="py-6" />;
  }

  return <InvoiceImageViewer alt="Factura escaneada de la compra" urls={images.data.imageUrls} />;
}

function LearnedLines({ lines }: { lines: PurchaseInvoiceScanLine[] }) {
  if (lines.length === 0) {
    return <p className="text-sm text-on-surface-variant">No se aprendió ninguna línea de esta factura.</p>;
  }

  return (
    <ul aria-label="Líneas aprendidas" className="divide-y divide-border dark:divide-slate-800">
      {lines.map((line) => {
        const pack = formatInvoiceLinePack(line);

        return (
          <li className="flex flex-wrap items-baseline gap-x-2 gap-y-1 py-2 text-sm" key={line.lineIndex}>
            <span className="min-w-0 font-mono text-on-surface-variant [overflow-wrap:anywhere]">{line.rawText}</span>{" "}
            <span aria-hidden="true" className="text-on-surface-variant">
              →
            </span>{" "}
            <span className="sr-only">se aprendió como </span>
            <span className="min-w-0 font-medium text-slate-950 [overflow-wrap:anywhere] dark:text-slate-100">
              {line.productName ?? MISSING_PRODUCT_LABEL}
              {pack ? <span className="font-normal text-on-surface-variant"> ({pack})</span> : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * «Factura escaneada» del detalle de compra (SCN-09a): solo si la compra salió
 * de un escaneo confirmado. Cerrada por defecto; las URLs firmadas de la imagen
 * se piden al abrirla, nunca con la sección cerrada.
 */
export function PurchaseInvoiceScanSection({ purchaseId }: { purchaseId: string }) {
  const [open, setOpen] = useState(false);
  const scan = usePurchaseInvoiceScan(purchaseId);

  if (!scan.data) {
    return null;
  }

  const { imageExpired, learned, lines, pages } = scan.data;

  return (
    <CollapsibleSection
      onOpenChange={setOpen}
      open={open}
      summary={learnedSummary(learned, pages)}
      title="Factura escaneada"
    >
      <div className="space-y-4">
        {open ? <InvoiceScanImages enabled={open} expired={imageExpired} purchaseId={purchaseId} /> : null}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-950 dark:text-slate-100">
            Líneas aprendidas ({learned})
          </h3>
          <LearnedLines lines={lines} />
        </div>
      </div>
    </CollapsibleSection>
  );
}
