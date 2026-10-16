"use client";

import { AlertTriangle, Camera, Copy } from "lucide-react";

import { PurchaseSupplierCard } from "@/modules/purchases/purchase-create/components/PurchaseSupplierCard";
import { Badge } from "@/shared/components/Badge/Badge";
import { Button } from "@/shared/components/Button";
import type { EntityFetcher } from "@/shared/components/EntityAutocomplete";
import { Input } from "@/shared/components/Input";

import type { InvoiceReviewAction, InvoiceReviewState } from "../reviewModel";
import { formatConfidencePct, formatScore, LOW_EXTRACTION_CONFIDENCE } from "./invoiceReviewView";

const CURRENCY_LABELS: Record<InvoiceReviewState["header"]["currency"], string> = {
  USD: "Dólares (USD)",
  VES: "Bolívares (Bs)",
  unknown: "Sin identificar",
};

export type InvoiceReviewHeaderProps = {
  state: InvoiceReviewState;
  onAction: (action: InvoiceReviewAction) => void;
  onRescan: () => void;
  supplierFetcher?: EntityFetcher<"contact">;
};

/**
 * Cabecera de la revisión: proveedor (confirmado, o candidatos y el buscador de
 * proveedores de la compra), número, fecha, moneda, avisos de la lectura con
 * "Repetir foto" y el aviso de factura ya escaneada.
 */
export function InvoiceReviewHeader({ onAction, onRescan, state, supplierFetcher }: InvoiceReviewHeaderProps) {
  const { extraction, header } = state;
  const { supplier } = header;
  const lowConfidence = extraction.confidence < LOW_EXTRACTION_CONFIDENCE;
  const warnings = extraction.warnings;
  const showCandidates = !supplier.contactId && supplier.candidates.length > 0;

  return (
    <section aria-label="Datos de la factura" className="flex flex-col gap-4">
      {warnings.length > 0 || lowConfidence ? (
        <div
          className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 sm:flex-row sm:items-start sm:justify-between dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"
          role="status"
        >
          <ul className="flex flex-col gap-1">
            {lowConfidence ? (
              <li className="flex items-start gap-2">
                <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
                La lectura salió con confianza baja ({formatConfidencePct(extraction.confidence)}): revisa cada
                línea o repite la foto.
              </li>
            ) : null}
            {warnings.map((warning) => (
              <li className="flex items-start gap-2" key={warning}>
                <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
                {warning}
              </li>
            ))}
          </ul>
          <Button className="shrink-0" onClick={onRescan} size="sm" variant="outline">
            <Camera aria-hidden className="size-4" />
            Repetir foto
          </Button>
        </div>
      ) : null}

      {state.duplicateOfScanId ? (
        <div
          className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"
          role="status"
        >
          <Copy aria-hidden className="mt-0.5 size-4 shrink-0" />
          Esta factura (mismo proveedor y número) ya se escaneó antes en la tienda. Revisa que no la cargues dos
          veces.
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-2">
          <PurchaseSupplierCard
            onSupplierChange={(contactId, name) => {
              // Quitarlo no tiene acción en el modelo: hace falta un proveedor para cargar.
              if (contactId) {
                onAction({ type: "setSupplier", supplier: { contactId, name: name ?? supplier.readName } });
              }
            }}
            selectedSupplierId={supplier.contactId ?? ""}
            supplierFetcher={supplierFetcher}
          />
          <p className="text-xs text-on-surface-variant">
            Leído en la factura: <span className="font-medium text-foreground">{supplier.readName || "—"}</span>
          </p>
          {showCandidates ? (
            <div aria-label="Proveedores sugeridos" className="flex flex-wrap gap-2" role="group">
              {supplier.candidates.map((candidate) => (
                <button
                  className="flex cursor-pointer flex-col items-start rounded-lg border border-outline-variant px-3 py-1.5 text-left text-xs transition-colors hover:bg-surface-container-low focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  key={candidate.contactId}
                  onClick={() =>
                    onAction({
                      type: "setSupplier",
                      supplier: { contactId: candidate.contactId, name: candidate.name },
                    })
                  }
                  type="button"
                >
                  <span className="text-sm font-medium text-foreground">{candidate.name}</span>
                  <span className="text-on-surface-variant">
                    {candidate.reason} · {formatScore(candidate.score)}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="grid grid-cols-1 gap-4 rounded-xl border border-border bg-surface-container-lowest p-4 sm:grid-cols-2 dark:border-slate-800">
          <Input
            defaultValue={header.number ?? ""}
            label="Número de factura"
            onChange={(event) => onAction({ type: "editHeader", number: event.target.value })}
          />
          <Input
            label="Fecha"
            onChange={(event) => onAction({ type: "editHeader", date: event.target.value })}
            type="date"
            value={header.date ?? ""}
          />
          <div className="flex flex-col gap-2 sm:col-span-2">
            <span className="text-xs font-medium text-on-surface-variant">Moneda de la factura</span>
            <span>
              <Badge variant={header.currency === "VES" ? "default" : "warning"}>
                {CURRENCY_LABELS[header.currency]}
              </Badge>
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
