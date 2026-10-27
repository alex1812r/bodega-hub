"use client";

import { AlertTriangle, Camera, Copy } from "lucide-react";
import Link from "next/link";
import { type RefObject, useId, useRef } from "react";

import { useInvoiceScanPurchase } from "@/modules/invoice-scan/client/useInvoiceScanPurchase";
import type { InvoiceDuplicateMatch } from "@/modules/invoice-scan/contracts";
import { PurchaseSupplierCard } from "@/modules/purchases/purchase-create/components/PurchaseSupplierCard";
import { Badge } from "@/shared/components/Badge/Badge";
import { Button } from "@/shared/components/Button";
import type { EntityFetcher } from "@/shared/components/EntityAutocomplete";
import { Input } from "@/shared/components/Input";
import { formControlErrorClassName, formHelperClassName, formHelperErrorClassName } from "@/shared/styles/form-controls";
import { cn } from "@/shared/utils/cn";

import { getHeaderDateMessage, type InvoiceReviewAction, type InvoiceReviewState } from "../reviewModel";
import {
  duplicateCriterionLabel,
  formatConfidencePct,
  formatScore,
  LOW_EXTRACTION_CONFIDENCE,
} from "./invoiceReviewView";
import { useFreshPressCheckbox } from "./useFreshPressCheckbox";

const CURRENCY_LABELS: Record<InvoiceReviewState["header"]["currency"], string> = {
  USD: "Dólares (USD)",
  VES: "Bolívares (Bs)",
  unknown: "Sin identificar",
};

/** ISO `AAAA-MM-DD` → `DD/MM/AAAA` (como la muestra el campo). */
function formatReadDate(date: string | undefined): string {
  const [year, month, day] = (date ?? "").split("-");
  return year && month && day ? `${day}/${month}/${year}` : (date ?? "");
}

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
  duplicateCheckboxRef?: RefObject<HTMLInputElement | null>;
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
  const acknowledgeTextId = useId();
  // La casilla la usan el hook (su sitio) y el panel (el motivo del pie le lleva el foco).
  const ownCheckboxRef = useRef<HTMLInputElement>(null);
  const acknowledgeRef = duplicateCheckboxRef ?? ownCheckboxRef;
  const acknowledge = useFreshPressCheckbox(acknowledgeRef);
  // REP13-02 (M-p14B-1): la fecha se valida con la regla del servidor; el motivo va junto al campo.
  const dateMessage = getHeaderDateMessage(state);
  const dateMessageId = useId();
  // REP14-03 (M-p15B-1, D64): el campo nativo da "" con 31/02 o dd/10/2026; `badInput` lo distingue de
  // vaciarlo. De 31/02 a dd/02 no hay evento `input` (sigue ""): se mira también al soltar la tecla y salir.
  const syncDate = (input: HTMLInputElement) =>
    onAction({ type: "editHeader", date: input.value, dateInvalid: input.validity.badInput });
  // Borrar la fecha leída pide confirmar registrar sin ella.
  const askNoDate = Boolean(extraction.date) && !header.date && !header.dateInvalid;
  const noDateTextId = useId();
  const noDateRef = useRef<HTMLInputElement>(null);
  const noDate = useFreshPressCheckbox(noDateRef);

  return (
    <section aria-label="Datos de la factura" className="@container flex flex-col gap-4">
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

      {/* D60(c): llega tras la consulta; useLayoutHold devuelve las filas a su punto. */}
      <div className="empty:hidden" data-layout-notice>
        {showDuplicate ? (
          <div
            className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"
            // REP12-05 (D49): aparece tras la consulta, con el dedo aún cerca; lo que aparece o se mueve en
            // él queda guardado 1 s (useLayoutHold), como el pie.
            data-layout-shift-guard
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
                // REP12-05 (M-qa-rep12-1): el texto no es su etiqueta; la casilla solo cambia con su propio
                // control y una pulsación nueva sobre ella (como la de diferencia del pie, D54(a)(3)).
                <div className="flex items-center gap-2 text-xs font-medium">
                  <input
                    aria-labelledby={acknowledgeTextId}
                    checked={duplicateAcknowledged}
                    className="size-6 shrink-0 rounded border-border"
                    onChange={(event) => {
                      if (acknowledge.accepts(event)) {
                        onDuplicateAcknowledge(event.target.checked);
                      }
                    }}
                    onPointerDown={acknowledge.onPointerDown}
                    onPointerUp={acknowledge.onPointerUp}
                    ref={acknowledgeRef}
                    type="checkbox"
                  />
                  <span id={acknowledgeTextId}>No es la misma compra, o quiero cargarla igual</span>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      {/* REP14-02 (M-p15-2, D63): las columnas dependen del ancho de la cabecera, no del de la pantalla. Con el menú
          lateral y la imagen al lado, a 1024 px la cabecera mide ~290 px: partida en dos, el proveedor y la fecha
          se cortaban. Dos columnas desde 42rem (cada una ≥ 328 px). */}
      <div className="grid gap-4 @2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* REP14-06b (B-qa06-1): un nombre sin espacios (elegido, leído o sugerido) se parte en vez de ensanchar
            la columna y, con ella, número y fecha. */}
        <div className="flex min-w-0 flex-col gap-2 [overflow-wrap:anywhere]">
          <PurchaseSupplierCard
            onSupplierChange={(contactId, name) => {
              // REP14-04 (B-p14-1): la × lo quita de verdad; sin proveedor Cargar pide elegirlo.
              onAction(
                contactId
                  ? { type: "setSupplier", supplier: { contactId, name: name ?? supplier.readName } }
                  : { type: "clearSupplier" },
              );
            }}
            selectedSupplierId={supplier.contactId ?? ""}
            supplierFetcher={supplierFetcher}
            // REP14-06 (B-qa234-1, D63): a 1024 con el menú y a 320 la columna mide ~288 px; el nombre elegido
            // se ve entero, envuelto, en vez de cortado en el campo.
            wrapSelectedName
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

        {/* Número y fecha lado a lado solo con la cabecera en una columna y ≥ 36rem (cada campo ≥ 264 px): más
            estrechos se apilan para que la fecha no se corte, la etiqueta no parta en dos líneas (QA global B1)
            y el motivo de la fecha quepa en su línea reservada (B-p15B-1). */}
        <div className="grid grid-cols-1 gap-4 rounded-xl border border-border bg-surface-container-lowest p-4 @xl:grid-cols-2 @2xl:grid-cols-1 dark:border-slate-800">
          <Input
            defaultValue={header.number ?? ""}
            label="Número de factura"
            onChange={(event) => onAction({ type: "editHeader", number: event.target.value })}
          />
          <div>
            <Input
              aria-describedby={dateMessage || askNoDate ? dateMessageId : undefined}
              aria-invalid={dateMessage ? true : undefined}
              className={dateMessage ? formControlErrorClassName : undefined}
              label="Fecha"
              onBlur={(event) => syncDate(event.currentTarget)}
              onChange={(event) => syncDate(event.currentTarget)}
              onKeyUp={(event) => syncDate(event.currentTarget)}
              type="date"
              value={header.date ?? ""}
            />
            {/* Línea reservada: con el campo de ≥ 256 px (la rejilla de arriba lo asegura de 320 a 1440) el motivo
                cabe en 3 renglones y al aparecer no empuja lo de debajo. */}
            <p
              className={cn(formHelperClassName, !askNoDate && formHelperErrorClassName, "mt-2 min-h-[3lh]")}
              id={dateMessageId}
            >
              {askNoDate ? (
                <span className="inline-flex items-center gap-2 font-medium">
                  <input
                    aria-labelledby={noDateTextId}
                    checked={header.noDateConfirmed === true}
                    className="size-6 shrink-0 rounded border-border"
                    onChange={(event) => {
                      if (noDate.accepts(event)) {
                        onAction({ type: "confirmNoDate", confirmed: event.target.checked });
                      }
                    }}
                    onPointerDown={noDate.onPointerDown}
                    onPointerUp={noDate.onPointerUp}
                    ref={noDateRef}
                    type="checkbox"
                  />
                  <span id={noDateTextId}>Registrar sin fecha (se leyó {formatReadDate(extraction.date)})</span>
                </span>
              ) : (
                dateMessage
              )}
            </p>
          </div>
          <div className="flex flex-col gap-2 @xl:col-span-2 @2xl:col-span-1">
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
