"use client";

import { AlertTriangle, Camera, Copy } from "lucide-react";
import Link from "next/link";
import type { Ref } from "react";

import { useInvoiceScanPurchase } from "@/modules/invoice-scan/client/useInvoiceScanPurchase";
import type { InvoiceDuplicateMatch } from "@/modules/invoice-scan/contracts";
import { PurchaseSupplierCard } from "@/modules/purchases/purchase-create/components/PurchaseSupplierCard";
import { Badge } from "@/shared/components/Badge/Badge";
import { Button } from "@/shared/components/Button";
import type { EntityFetcher } from "@/shared/components/EntityAutocomplete";
import { Input } from "@/shared/components/Input";

import type { InvoiceReviewAction, InvoiceReviewState } from "../reviewModel";
import {
  duplicateCriterionLabel,
  formatConfidencePct,
  formatScore,
  LOW_EXTRACTION_CONFIDENCE,
} from "./invoiceReviewView";

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
  /**
   * REP12-01 (D52): duplicados consultados con el proveedor elegido; `undefined` mientras no hay
   * respuesta (se usa el `duplicateOfScanId` del escaneo).
   */
  duplicates?: InvoiceDuplicateMatch[];
  /** Casilla del aviso de duplicado marcada (Cargar la exige). */
  duplicateAcknowledged?: boolean;
  onDuplicateAcknowledge?: (acknowledged: boolean) => void;
  /** Casilla del aviso de duplicado: el motivo del pie lleva el foco a ella. */
  duplicateCheckboxRef?: Ref<HTMLInputElement>;
};

/**
 * Cabecera de la revisión: proveedor (confirmado, o candidatos y el buscador de
 * proveedores de la compra), número, fecha, moneda, avisos de la lectura con
 * "Repetir foto" y el aviso de factura ya escaneada.
 */
export function InvoiceReviewHeader({
  duplicateAcknowledged = false,
  duplicateCheckboxRef,
  duplicates,
  onAction,
  onDuplicateAcknowledge,
  onRescan,
  state,
  supplierFetcher,
}: InvoiceReviewHeaderProps) {
  const { extraction, header } = state;
  const { supplier } = header;
  const lowConfidence = extraction.confidence < LOW_EXTRACTION_CONFIDENCE;
  const warnings = extraction.warnings;
  const showCandidates = !supplier.contactId && supplier.candidates.length > 0;
  // Factura duplicada: si el escaneo anterior ya está en una compra, se enlaza. No bloquea, pero
  // Cargar exige marcar la casilla (REP12-01, D52). Con la consulta del proveedor elegido ya
  // respondida manda ella; si no, el aviso del escaneo.
  const { purchaseId: scanDuplicatePurchaseId } = useInvoiceScanPurchase(
    duplicates === undefined ? state.duplicateOfScanId : undefined,
  );
  const showDuplicate = duplicates === undefined ? Boolean(state.duplicateOfScanId) : duplicates.length > 0;
  const duplicatePurchaseId =
    duplicates === undefined ? scanDuplicatePurchaseId : (duplicates.find((match) => match.purchaseId)?.purchaseId ?? null);

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

      {showDuplicate ? (
        <div
          className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"
          role="status"
        >
          <Copy aria-hidden className="mt-0.5 size-4 shrink-0" />
          <div className="flex min-w-0 flex-col gap-2">
            {duplicatePurchaseId ? (
              <span>
                Esta factura ({duplicateCriterionLabel(extraction)}) ya se registró en una compra. Revisa que no la cargues dos
                veces.{" "}
                <Link
                  className="font-medium underline underline-offset-2 hover:text-amber-900 dark:hover:text-amber-200"
                  href={`/purchases/${encodeURIComponent(duplicatePurchaseId)}`}
                >
                  Ver
                </Link>
              </span>
            ) : (
              <span>
                Esta factura ({duplicateCriterionLabel(extraction)}) ya se escaneó antes en la tienda. Revisa que no la cargues dos
                veces.
              </span>
            )}
            {onDuplicateAcknowledge ? (
              <label className="flex items-center gap-2 text-xs font-medium">
                <input
                  checked={duplicateAcknowledged}
                  className="size-4 rounded border-border"
                  onChange={(event) => onDuplicateAcknowledge(event.target.checked)}
                  ref={duplicateCheckboxRef}
                  type="checkbox"
                />
                No es la misma compra, o quiero cargarla igual
              </label>
            ) : null}
          </div>
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
                  data-supplier-candidate
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

        {/* Desde lg la columna de datos es estrecha (~260 px a 1280): número y fecha se apilan para que
            la fecha no se corte ni la etiqueta parta en dos líneas (QA global B1). */}
        <div className="grid grid-cols-1 gap-4 rounded-xl border border-border bg-surface-container-lowest p-4 sm:grid-cols-2 lg:grid-cols-1 dark:border-slate-800">
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
          <div className="flex flex-col gap-2 sm:col-span-2 lg:col-span-1">
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
