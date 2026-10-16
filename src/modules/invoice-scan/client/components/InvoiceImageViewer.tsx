"use client";

import { ChevronLeft, ChevronRight, ImageOff, Minus, Plus, RotateCcw } from "lucide-react";
import { type PointerEvent, useEffect, useRef, useState } from "react";

import { Button } from "@/shared/components/Button";
import { cn } from "@/shared/utils/cn";

export const INVOICE_VIEWER_MIN_ZOOM = 1;
export const INVOICE_VIEWER_MAX_ZOOM = 4;
export const INVOICE_VIEWER_ZOOM_STEP = 0.5;
/** Cuánto acerca cada paso de la rueda. */
const WHEEL_ZOOM_STEP = 0.25;

export type InvoiceImageViewerProps = {
  /** Páginas de la factura (URLs firmadas o `blob:`), en orden. */
  urls: string[];
  /** Texto alternativo base; se le añade el número de página si hay varias. */
  alt: string;
  className?: string;
};

type Offset = { x: number; y: number };

const ORIGIN: Offset = { x: 0, y: 0 };

function clampZoom(value: number) {
  return Math.min(INVOICE_VIEWER_MAX_ZOOM, Math.max(INVOICE_VIEWER_MIN_ZOOM, Math.round(value * 100) / 100));
}

/**
 * Visor de la factura escaneada para cotejar: páginas, zoom con botones +/− o la
 * rueda del ratón, y arrastre para moverse por la imagen ampliada. Sin librerías:
 * `transform` sobre un `<img>`.
 */
export function InvoiceImageViewer({ alt, className, urls }: InvoiceImageViewerProps) {
  const [page, setPage] = useState(0);
  const [zoom, setZoom] = useState(INVOICE_VIEWER_MIN_ZOOM);
  const [offset, setOffset] = useState<Offset>(ORIGIN);
  const [failed, setFailed] = useState<Record<string, true>>({});
  const frameRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; origin: Offset } | null>(null);
  const pageCount = urls.length;
  const currentPage = Math.min(page, Math.max(pageCount - 1, 0));
  const url = urls[currentPage];
  const pageAlt = pageCount > 1 ? `${alt} (página ${currentPage + 1} de ${pageCount})` : alt;

  function applyZoom(next: number) {
    const value = clampZoom(next);
    setZoom(value);
    if (value === INVOICE_VIEWER_MIN_ZOOM) {
      setOffset(ORIGIN);
    }
  }

  function goToPage(next: number) {
    setPage(next);
    setZoom(INVOICE_VIEWER_MIN_ZOOM);
    setOffset(ORIGIN);
  }

  // La rueda acerca/aleja dentro del visor sin desplazar la página: React registra
  // `wheel` como pasivo y no deja cancelar el scroll, así que va con un listener propio.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) {
      return;
    }
    function handleWheel(event: WheelEvent) {
      event.preventDefault();
      setZoom((current) => {
        const next = clampZoom(current + (event.deltaY < 0 ? WHEEL_ZOOM_STEP : -WHEEL_ZOOM_STEP));
        if (next === INVOICE_VIEWER_MIN_ZOOM) {
          setOffset(ORIGIN);
        }
        return next;
      });
    }
    frame.addEventListener("wheel", handleWheel, { passive: false });
    return () => frame.removeEventListener("wheel", handleWheel);
  }, [url]);

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (zoom <= INVOICE_VIEWER_MIN_ZOOM) {
      return;
    }
    dragRef.current = { origin: offset, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    setOffset({
      x: drag.origin.x + (event.clientX - drag.startX) / zoom,
      y: drag.origin.y + (event.clientY - drag.startY) / zoom,
    });
  }

  function handlePointerUp(event: PointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
    }
  }

  if (pageCount === 0) {
    return (
      <div
        className={cn(
          "flex min-h-48 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-outline-variant p-6 text-center text-sm text-on-surface-variant",
          className,
        )}
        role="status"
      >
        <ImageOff aria-hidden className="size-6" />
        No hay imagen de esta factura.
      </div>
    );
  }

  const hasFailed = url !== undefined && failed[url] === true;

  return (
    <div className={cn("flex min-w-0 flex-col gap-2", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button
            aria-label="Alejar"
            disabled={zoom <= INVOICE_VIEWER_MIN_ZOOM}
            onClick={() => applyZoom(zoom - INVOICE_VIEWER_ZOOM_STEP)}
            size="icon"
            variant="outline"
          >
            <Minus aria-hidden className="size-4" />
          </Button>
          <span aria-live="polite" className="min-w-12 text-center text-xs tabular-nums text-on-surface-variant">
            {Math.round(zoom * 100)} %
          </span>
          <Button
            aria-label="Acercar"
            disabled={zoom >= INVOICE_VIEWER_MAX_ZOOM}
            onClick={() => applyZoom(zoom + INVOICE_VIEWER_ZOOM_STEP)}
            size="icon"
            variant="outline"
          >
            <Plus aria-hidden className="size-4" />
          </Button>
          <Button
            aria-label="Restablecer zoom"
            disabled={zoom === INVOICE_VIEWER_MIN_ZOOM}
            onClick={() => applyZoom(INVOICE_VIEWER_MIN_ZOOM)}
            size="icon"
            variant="ghost"
          >
            <RotateCcw aria-hidden className="size-4" />
          </Button>
        </div>
        {pageCount > 1 ? (
          <div className="flex items-center gap-1">
            <Button
              aria-label="Página anterior"
              disabled={currentPage === 0}
              onClick={() => goToPage(currentPage - 1)}
              size="icon"
              variant="ghost"
            >
              <ChevronLeft aria-hidden className="size-4" />
            </Button>
            <span className="text-xs tabular-nums text-on-surface-variant">
              Página {currentPage + 1} de {pageCount}
            </span>
            <Button
              aria-label="Página siguiente"
              disabled={currentPage >= pageCount - 1}
              onClick={() => goToPage(currentPage + 1)}
              size="icon"
              variant="ghost"
            >
              <ChevronRight aria-hidden className="size-4" />
            </Button>
          </div>
        ) : null}
      </div>
      <div
        className={cn(
          "relative h-[min(70vh,40rem)] touch-none overflow-hidden rounded-lg border border-border bg-surface-container-low select-none",
          zoom > INVOICE_VIEWER_MIN_ZOOM ? "cursor-grab active:cursor-grabbing" : null,
        )}
        data-testid="invoice-image-frame"
        onPointerCancel={handlePointerUp}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        ref={frameRef}
      >
        {hasFailed ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-on-surface-variant" role="alert">
            <ImageOff aria-hidden className="size-6" />
            No se pudo cargar la imagen de la factura.
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- URL firmada temporal de Storage, sin optimizar
          <img
            alt={pageAlt}
            className="h-full w-full object-contain transition-transform duration-75"
            draggable={false}
            onError={() => setFailed((current) => (url ? { ...current, [url]: true } : current))}
            src={url}
            style={{ transform: `scale(${zoom}) translate(${offset.x}px, ${offset.y}px)` }}
          />
        )}
      </div>
    </div>
  );
}
