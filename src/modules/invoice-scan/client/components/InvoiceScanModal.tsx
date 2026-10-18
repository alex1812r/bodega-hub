"use client";

import { AlertTriangle, Camera, FileUp, Loader2 } from "lucide-react";
import { type DragEvent, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/shared/components/Button";
import { Modal } from "@/shared/components/Modal";
import { ProgressBar } from "@/shared/components/ProgressBar";
import { cn } from "@/shared/utils/cn";

import type { InvoiceScanResponse } from "../../contracts";
import type { PreparedInvoice } from "../prepareInvoiceFile";
import { type InvoiceScanUploadStage, useInvoiceScanUpload } from "../useInvoiceScanUpload";

export const INVOICE_SCAN_ACCEPT = "image/jpeg,image/png,image/webp,application/pdf";
export const INVOICE_SCAN_QUOTA_EXHAUSTED_MESSAGE =
  "Ya usaste todos los escaneos de hoy. Vuelve mañana o registra la compra a mano.";

const STAGE_TEXT: Partial<Record<InvoiceScanUploadStage, string>> = {
  preparing: "Preparando la factura…",
  reading: "Leyendo la factura…",
  uploading: "Subiendo la factura…",
};

const STAGE_PROGRESS: Partial<Record<InvoiceScanUploadStage, number>> = {
  done: 3,
  preparing: 1,
  reading: 2.5,
  uploading: 2,
};

export type InvoiceScanModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** La factura se leyó: la respuesta del BFF tal cual (la revisión la pinta quien llama). */
  onScanned: (response: InvoiceScanResponse) => void;
  /** Avisa cuando empieza o termina un escaneo (preparar, subir o leer), p. ej. para `ProcessGuard`. */
  onBusyChange?: (busy: boolean) => void;
  /** Proveedor ya elegido en la compra, si lo hay. */
  supplierId?: string;
  /** Inyectable para tests y Storybook; por defecto `prepareInvoiceFile`. */
  prepareFile?: (file: File) => Promise<PreparedInvoice>;
};

/** Pantallas táctiles: se ofrece abrir la cámara trasera directamente. */
function prefersCamera() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(pointer: coarse)").matches
    : false;
}

/** Miniaturas de las páginas preparadas; las URLs se liberan al cambiar de factura. */
function usePagePreviews(prepared: PreparedInvoice | null) {
  const previews = useMemo(
    () =>
      prepared && typeof URL.createObjectURL === "function"
        ? prepared.pages.map((page) => URL.createObjectURL(page.blob))
        : [],
    [prepared],
  );

  useEffect(() => () => previews.forEach((url) => URL.revokeObjectURL(url)), [previews]);

  return previews;
}

/**
 * Modal "Escanear factura": arrastrar/soltar, seleccionar o tomar foto, vista
 * previa, avisos de calidad con "Repetir foto" / "Escanear igual", progreso por
 * etapa, cuota del día y error en español con "Reintentar". Mientras hay un
 * escaneo en curso no se cierra por Esc o fuera: se cancela con su botón.
 */
export function InvoiceScanModal({
  onBusyChange,
  onOpenChange,
  onScanned,
  open,
  prepareFile,
  supplierId,
}: InvoiceScanModalProps) {
  const scan = useInvoiceScanUpload({ enabled: open, prepareFile, supplierId });
  const { abort, error, isBusy, limits, prepare, prepared, quotaExhausted, reset, retry, stage, upload } = scan;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [showCamera] = useState(prefersCamera);
  const previews = usePagePreviews(prepared);
  const onBusyChangeRef = useRef(onBusyChange);

  useEffect(() => {
    onBusyChangeRef.current = onBusyChange;
  }, [onBusyChange]);

  useEffect(() => {
    onBusyChangeRef.current?.(isBusy);
  }, [isBusy]);

  // Al desmontar con un escaneo en curso, quien escuchaba deja de verlo activo.
  useEffect(() => () => onBusyChangeRef.current?.(false), []);

  const warnings = prepared?.quality.warnings ?? [];
  const awaitingDecision = stage === "idle" && prepared !== null && warnings.length > 0;
  const showPicker = !isBusy && stage !== "done" && prepared === null && error?.kind !== "prepare";
  const pickerDisabled = quotaExhausted;
  // La misma factura volvería a pasarse de la cuota: se elige otra más corta o se espera a mañana.
  const retryDisabled = error?.kind === "quota";
  // 503 (sin key, almacenamiento caído): reintentar no puede funcionar; se sigue a mano.
  const unavailable = error?.kind === "unavailable";

  async function runUpload() {
    const response = await upload();

    if (response) {
      onScanned(response);
    }
  }

  async function handleFile(file: File | undefined) {
    if (!file || pickerDisabled) {
      return;
    }

    const next = await prepare(file);

    // Sin avisos de calidad se escanea directamente; con avisos, decide el usuario.
    if (next && next.quality.warnings.length === 0) {
      await runUpload();
    }
  }

  async function handleRetry() {
    const outcome = await retry();

    if (!outcome) {
      return;
    }

    if ("scanId" in outcome) {
      onScanned(outcome);
    } else if (outcome.quality.warnings.length === 0) {
      await runUpload();
    }
  }

  function openPicker(input: HTMLInputElement | null) {
    if (input) {
      input.value = "";
      input.click();
    }
  }

  function repeatPhoto() {
    reset();
    openPicker(showCamera ? cameraInputRef.current : fileInputRef.current);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);

    if (!pickerDisabled) {
      void handleFile(event.dataTransfer.files[0]);
    }
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();

    if (!pickerDisabled) {
      setDragging(true);
    }
  }

  const progress = STAGE_PROGRESS[stage];

  return (
    <Modal
      description="Sube una foto o un PDF de la factura del proveedor y la leemos por ti."
      footer={
        isBusy ? (
          <Button onClick={abort} type="button" variant="outline">
            Cancelar escaneo
          </Button>
        ) : (
          <Button onClick={() => onOpenChange(false)} type="button" variant="outline">
            Cerrar
          </Button>
        )
      }
      onOpenChange={(nextOpen) => {
        // En curso no se cierra por Esc, X o clic fuera: primero "Cancelar escaneo".
        if (!nextOpen && isBusy) {
          return;
        }

        onOpenChange(nextOpen);
      }}
      open={open}
      title="Escanear factura"
    >
      <div className="space-y-4">
        <p className="text-sm text-on-surface-variant" data-testid="invoice-scan-limits">
          {/* Con la cuota rebasada (p. ej. se bajó el límite) el uso se acota: nunca "32 de 5". */}
          {limits
            ? `Escaneos hoy: ${Math.min(limits.used, limits.limit)} de ${limits.limit}`
            : "Consultando los escaneos de hoy…"}
        </p>

        {quotaExhausted ? (
          <p
            className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300"
            role="status"
          >
            {INVOICE_SCAN_QUOTA_EXHAUSTED_MESSAGE}
          </p>
        ) : null}

        <input
          accept={INVOICE_SCAN_ACCEPT}
          aria-label="Archivo de la factura"
          className="sr-only"
          data-testid="invoice-scan-file-input"
          disabled={pickerDisabled}
          onChange={(event) => void handleFile(event.target.files?.[0])}
          ref={fileInputRef}
          tabIndex={-1}
          type="file"
        />
        {showCamera ? (
          <input
            accept={INVOICE_SCAN_ACCEPT}
            aria-label="Foto de la factura"
            capture="environment"
            className="sr-only"
            data-testid="invoice-scan-camera-input"
            disabled={pickerDisabled}
            onChange={(event) => void handleFile(event.target.files?.[0])}
            ref={cameraInputRef}
            tabIndex={-1}
            type="file"
          />
        ) : null}

        {showPicker ? (
          <div
            className={cn(
              "flex flex-col items-center gap-3 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors",
              dragging ? "border-primary bg-indigo-50 dark:bg-indigo-950" : "border-outline bg-surface-container-low",
              pickerDisabled && "opacity-60",
            )}
            data-testid="invoice-scan-dropzone"
            onDragLeave={() => setDragging(false)}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          >
            <FileUp aria-hidden="true" className="h-8 w-8 text-on-surface-variant" />
            <p className="text-sm text-foreground">Arrastra aquí la foto o el PDF de la factura</p>
            <p className="text-xs text-on-surface-variant">JPG, PNG, WebP o PDF de hasta 10 páginas.</p>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
              {showCamera ? (
                <Button disabled={pickerDisabled} onClick={() => openPicker(cameraInputRef.current)} type="button">
                  <Camera aria-hidden="true" className="h-4 w-4" />
                  Tomar foto
                </Button>
              ) : null}
              <Button
                disabled={pickerDisabled}
                onClick={() => openPicker(fileInputRef.current)}
                type="button"
                variant={showCamera ? "outline" : "primary"}
              >
                Seleccionar archivo
              </Button>
            </div>
          </div>
        ) : null}

        {previews.length > 0 ? (
          <ul aria-label="Vista previa" className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {previews.map((url, index) => (
              <li
                className="overflow-hidden rounded-md border border-border bg-surface-container-low"
                key={url}
              >
                {/* Blob local recién preparado: `next/image` no aporta nada aquí. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  alt={`Página ${index + 1} de la factura`}
                  className="aspect-[3/4] w-full object-cover"
                  src={url}
                />
              </li>
            ))}
          </ul>
        ) : null}

        {awaitingDecision ? (
          <div
            className="space-y-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300"
            role="status"
          >
            <div className="flex items-start gap-2">
              <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
              <ul className="space-y-1">
                {warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button onClick={repeatPhoto} size="sm" type="button">
                Repetir foto
              </Button>
              <Button
                disabled={pickerDisabled}
                onClick={() => void runUpload()}
                size="sm"
                type="button"
                variant="outline"
              >
                Escanear igual
              </Button>
            </div>
          </div>
        ) : null}

        {isBusy || stage === "done" ? (
          <div className="space-y-2" role="status">
            <p className="flex items-center gap-2 text-sm font-medium text-foreground">
              {isBusy ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin text-primary" /> : null}
              {stage === "done" ? "Factura leída." : STAGE_TEXT[stage]}
            </p>
            <ProgressBar max={3} value={progress ?? 0} />
          </div>
        ) : null}

        {stage === "error" && error ? (
          <div className="space-y-3 rounded-md border border-error bg-error-container px-3 py-3 text-sm text-on-error-container">
            <p className="break-words" role="alert">
              {error.message}
            </p>
            {unavailable ? (
              <Button onClick={() => onOpenChange(false)} size="sm" type="button">
                Registrar a mano
              </Button>
            ) : (
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button disabled={retryDisabled} onClick={() => void handleRetry()} size="sm" type="button">
                  Reintentar
                </Button>
                <Button
                  disabled={pickerDisabled}
                  onClick={() => {
                    reset();
                    openPicker(fileInputRef.current);
                  }}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  Elegir otro archivo
                </Button>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
