"use client";

import { ScanText } from "lucide-react";

import { Button } from "@/shared/components/Button";

type InvoiceReviewResumeBannerProps = {
  isResuming?: boolean;
  onDiscard: () => void;
  onResume: () => void;
  /** Aún no se puede retomar (la compra de debajo necesita la tasa vigente). */
  resumeDisabled?: boolean;
};

/**
 * Aviso al volver con una revisión de factura a medias (SCN-UI-C1): se retoma con lo
 * guardado en el escaneo o se descarta.
 */
export function InvoiceReviewResumeBanner({
  isResuming = false,
  onDiscard,
  onResume,
  resumeDisabled = false,
}: InvoiceReviewResumeBannerProps) {
  return (
    <section
      aria-label="Revisión de factura sin terminar"
      className="flex flex-col gap-3 rounded-xl border border-border bg-surface-container-low p-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex min-w-0 items-start gap-3">
        <ScanText aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <p className="min-w-0 break-words text-sm font-medium text-foreground">
          Dejaste sin terminar la revisión de una factura escaneada.
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <Button disabled={isResuming || resumeDisabled} onClick={onResume} size="sm" type="button">
          Retomar la revisión de la factura
        </Button>
        <Button disabled={isResuming} onClick={onDiscard} size="sm" type="button" variant="outline">
          Descartar
        </Button>
      </div>
    </section>
  );
}
