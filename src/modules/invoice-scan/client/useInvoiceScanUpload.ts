"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { apiFetch, ClientApiError } from "@/shared/api/apiFetch";

import type { InvoiceScanLimits, InvoiceScanResponse } from "../contracts";
import { prepareInvoiceFile, type PreparedInvoice } from "./prepareInvoiceFile";

export const INVOICE_SCAN_ENDPOINT = "/api/purchases/invoice-scan";
export const INVOICE_SCAN_LIMITS_ENDPOINT = "/api/purchases/invoice-scan/limits";
export const INVOICE_SCAN_UPLOAD_URL_ENDPOINT = "/api/purchases/invoice-scan/upload-url";

/**
 * Tope del cuerpo multipart que acepta el POST (4 MiB, como
 * `INVOICE_MULTIPART_MAX_BYTES` del servidor, que no se importa aquí para no
 * arrastrar código de servidor al cliente). Por encima se sube por upload-url.
 */
export const INVOICE_SCAN_MULTIPART_MAX_BYTES = 4 * 1024 * 1024;
/** Margen por página para las cabeceras multipart al estimar el cuerpo. */
const MULTIPART_OVERHEAD_PER_PAGE = 1024;
/**
 * `fetch` no avisa cuándo terminó de enviar el cuerpo: la etapa pasa de
 * "uploading" a "reading" con una estimación de ~1 MB/s, como mínimo 800 ms.
 */
const MIN_UPLOAD_ESTIMATE_MS = 800;
const UPLOAD_BYTES_PER_MS = 1000;

export type InvoiceScanUploadStage = "idle" | "preparing" | "uploading" | "reading" | "done" | "error";

export type InvoiceScanUploadErrorKind =
  | "prepare"
  | "in-progress"
  | "quota"
  | "provider"
  | "network"
  | "request";

export type InvoiceScanUploadError = {
  kind: InvoiceScanUploadErrorKind;
  message: string;
  status?: number;
};

export const INVOICE_SCAN_IN_PROGRESS_FALLBACK =
  "Esta factura ya se está leyendo en curso; espera unos segundos y vuelve a intentarlo.";
export const INVOICE_SCAN_QUOTA_FALLBACK =
  "Se agotó la cuota de escaneos de hoy. Vuelve a intentarlo mañana o registra la compra a mano.";
export const INVOICE_SCAN_PROVIDER_FALLBACK =
  "El servicio de lectura no respondió. Intenta de nuevo en unos segundos o registra la compra a mano.";
export const INVOICE_SCAN_NETWORK_MESSAGE =
  "No hay conexión con el servidor. Revisa tu internet y vuelve a intentarlo.";
export const INVOICE_SCAN_GENERIC_MESSAGE = "No pudimos escanear la factura. Vuelve a intentarlo.";
export const INVOICE_SCAN_PREPARE_FALLBACK = "No se pudo preparar la factura. Prueba con otra foto o PDF.";
const STORAGE_UPLOAD_FAILED_MESSAGE = "No se pudo subir la factura. Revisa tu conexión y vuelve a intentarlo.";

type UploadUrl = { page: number; path: string; signedUrl: string; token: string };

type QuotaDetails = { limit?: unknown; used?: unknown };

function isAbortError(error: unknown) {
  return (
    (error instanceof DOMException || error instanceof Error) &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

/** Mapea un fallo de la subida o la lectura a un mensaje en español para el modal. */
export function describeInvoiceScanError(error: unknown): InvoiceScanUploadError {
  if (error instanceof ClientApiError) {
    const serverMessage = error.message && error.code !== "UNKNOWN_ERROR" ? error.message : null;

    if (error.status === 409) {
      return { kind: "in-progress", message: serverMessage ?? INVOICE_SCAN_IN_PROGRESS_FALLBACK, status: 409 };
    }

    if (error.status === 429) {
      return { kind: "quota", message: serverMessage ?? INVOICE_SCAN_QUOTA_FALLBACK, status: 429 };
    }

    if (error.status === 502 || error.status === 503 || error.status === 504) {
      return { kind: "provider", message: serverMessage ?? INVOICE_SCAN_PROVIDER_FALLBACK, status: error.status };
    }

    return { kind: "request", message: serverMessage ?? INVOICE_SCAN_GENERIC_MESSAGE, status: error.status };
  }

  // `fetch` rechaza con TypeError cuando no hay red (o el servidor no contesta).
  if (error instanceof TypeError) {
    return { kind: "network", message: INVOICE_SCAN_NETWORK_MESSAGE };
  }

  return { kind: "request", message: INVOICE_SCAN_GENERIC_MESSAGE };
}

/** El 429 de cuota trae `{ limit, used }` en `details`: el contador se pone al día sin otra petición. */
function limitsFromQuotaError(error: unknown): InvoiceScanLimits | null {
  if (!(error instanceof ClientApiError) || error.status !== 429) {
    return null;
  }

  const details = (error.details ?? {}) as QuotaDetails;

  if (typeof details.limit !== "number" || typeof details.used !== "number") {
    return null;
  }

  return {
    limit: details.limit,
    remaining: Math.max(0, details.limit - details.used),
    used: details.used,
  };
}

function multipartBytes(prepared: PreparedInvoice) {
  return prepared.pages.reduce((sum, page) => sum + page.bytes + MULTIPART_OVERHEAD_PER_PAGE, 0);
}

export type UseInvoiceScanUploadOptions = {
  /** `false`: no pide la cuota del día (p. ej. modal cerrado). Por defecto `true`. */
  enabled?: boolean;
  /** Proveedor ya elegido en la compra: activa el few-shot del servidor. */
  supplierId?: string;
  /** Inyectable para tests y Storybook; por defecto `prepareInvoiceFile`. */
  prepareFile?: (file: File) => Promise<PreparedInvoice>;
};

export type UseInvoiceScanUploadResult = {
  stage: InvoiceScanUploadStage;
  /** Factura preparada (páginas JPEG ≤ 1 MB y `quality.warnings`); `null` antes de elegir. */
  prepared: PreparedInvoice | null;
  result: InvoiceScanResponse | null;
  error: InvoiceScanUploadError | null;
  /** Cuota del día; `null` mientras carga o si no se pudo pedir. */
  limits: InvoiceScanLimits | null;
  /** Preparando, subiendo o leyendo: hay un escaneo en curso. */
  isBusy: boolean;
  /** La cuota del día está agotada (por `limits` o por un 429). */
  quotaExhausted: boolean;
  /** Prepara el archivo; queda en `idle` con `prepared` listo para `upload()`. */
  prepare: (file: File) => Promise<PreparedInvoice | null>;
  /** Sube la factura preparada y la lee; devuelve la respuesta o `null` si falló o se canceló. */
  upload: () => Promise<InvoiceScanResponse | null>;
  /** Repite el paso que falló (preparar o subir). */
  retry: () => Promise<InvoiceScanResponse | PreparedInvoice | null>;
  /** Corta la preparación o la petición en curso y vuelve a `idle`. */
  abort: () => void;
  /** Olvida archivo, resultado y error. */
  reset: () => void;
};

/**
 * Prepara una factura (foto o PDF), la sube y la lee con `POST
 * /api/purchases/invoice-scan`. Multipart si cabe en 4 MB; si no, cada página
 * va por su URL firmada (`upload-url`) y el POST lleva las rutas. Toda petición
 * en curso se corta con `abort()` o al desmontar.
 */
export function useInvoiceScanUpload({
  enabled = true,
  prepareFile = prepareInvoiceFile,
  supplierId,
}: UseInvoiceScanUploadOptions = {}): UseInvoiceScanUploadResult {
  const [stage, setStage] = useState<InvoiceScanUploadStage>("idle");
  const [prepared, setPrepared] = useState<PreparedInvoice | null>(null);
  const [result, setResult] = useState<InvoiceScanResponse | null>(null);
  const [error, setError] = useState<InvoiceScanUploadError | null>(null);
  const [limits, setLimits] = useState<InvoiceScanLimits | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFileRef = useRef<File | null>(null);
  const preparedRef = useRef<PreparedInvoice | null>(null);
  const failedStepRef = useRef<"prepare" | "upload" | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startRun = useCallback(() => {
    controllerRef.current?.abort();
    clearTimer();
    const controller = new AbortController();
    controllerRef.current = controller;
    return controller;
  }, [clearTimer]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const controller = new AbortController();

    apiFetch<InvoiceScanLimits>(INVOICE_SCAN_LIMITS_ENDPOINT, { signal: controller.signal })
      .then((next) => {
        if (!controller.signal.aborted && next) {
          setLimits(next);
        }
      })
      // Sin cuota conocida el modal sigue usable: el POST la vuelve a validar.
      .catch(() => undefined);

    return () => controller.abort();
  }, [enabled]);

  // Al desmontar (cerrar el modal, salir de la pantalla) no queda nada en vuelo.
  useEffect(
    () => () => {
      controllerRef.current?.abort();
      clearTimer();
    },
    [clearTimer],
  );

  const fail = useCallback((next: InvoiceScanUploadError, step: "prepare" | "upload") => {
    failedStepRef.current = step;
    setError(next);
    setStage("error");
  }, []);

  const prepare = useCallback(
    async (file: File) => {
      const controller = startRun();
      lastFileRef.current = file;
      preparedRef.current = null;
      failedStepRef.current = null;
      setPrepared(null);
      setResult(null);
      setError(null);
      setStage("preparing");

      try {
        const next = await prepareFile(file);

        if (controller.signal.aborted) {
          return null;
        }

        preparedRef.current = next;
        setPrepared(next);
        setStage("idle");
        return next;
      } catch (cause) {
        if (controller.signal.aborted) {
          return null;
        }

        fail(
          {
            kind: "prepare",
            // `prepareInvoiceFile` lanza `Error` con mensaje en español; otro fallo (canvas, pdfjs) no se muestra tal cual.
            message:
              cause instanceof Error && cause.constructor === Error && cause.message
                ? cause.message
                : INVOICE_SCAN_PREPARE_FALLBACK,
          },
          "prepare",
        );
        return null;
      } finally {
        if (controllerRef.current === controller) {
          controllerRef.current = null;
        }
      }
    },
    [fail, prepareFile, startRun],
  );

  const sendByStorage = useCallback(
    async (invoice: PreparedInvoice, signal: AbortSignal) => {
      const types = invoice.pages[0]?.mediaType ?? "image/jpeg";
      const { uploads } = await apiFetch<{ uploads: UploadUrl[] }>(INVOICE_SCAN_UPLOAD_URL_ENDPOINT, {
        query: { pages: invoice.pages.length, sha256: invoice.sha256, types },
        signal,
      });

      await Promise.all(
        invoice.pages.map(async (page, index) => {
          const target = uploads.find((upload) => upload.page === index + 1);

          if (!target) {
            throw new Error(STORAGE_UPLOAD_FAILED_MESSAGE);
          }

          // URL firmada de Storage (otro origen): `fetch` directo, sin cabeceras de la app.
          const response = await fetch(target.signedUrl, {
            body: page.blob,
            headers: { "content-type": page.mediaType, "x-upsert": "true" },
            method: "PUT",
            signal,
          });

          if (!response.ok) {
            throw new ClientApiError(response.status, "STORAGE_UPLOAD_FAILED", STORAGE_UPLOAD_FAILED_MESSAGE);
          }
        }),
      );

      setStage("reading");

      return apiFetch<InvoiceScanResponse>(INVOICE_SCAN_ENDPOINT, {
        body: {
          sha256: invoice.sha256,
          storagePaths: [...uploads].sort((a, b) => a.page - b.page).map((upload) => upload.path),
          ...(supplierId ? { supplierId } : {}),
        },
        method: "POST",
        signal,
      });
    },
    [supplierId],
  );

  const sendMultipart = useCallback(
    (invoice: PreparedInvoice, signal: AbortSignal) => {
      const form = new FormData();

      invoice.pages.forEach((page, index) => {
        form.append("page", page.blob, `p${index + 1}.${page.mediaType === "image/webp" ? "webp" : "jpg"}`);
      });
      form.append("sha256", invoice.sha256);

      if (supplierId) {
        form.append("supplierId", supplierId);
      }

      const totalBytes = multipartBytes(invoice);
      timerRef.current = setTimeout(
        () => {
          timerRef.current = null;
          setStage((current) => (current === "uploading" ? "reading" : current));
        },
        Math.max(MIN_UPLOAD_ESTIMATE_MS, Math.round(totalBytes / UPLOAD_BYTES_PER_MS)),
      );

      return apiFetch<InvoiceScanResponse>(INVOICE_SCAN_ENDPOINT, { body: form, method: "POST", signal });
    },
    [supplierId],
  );

  const upload = useCallback(async () => {
    const invoice = preparedRef.current;

    if (!invoice) {
      return null;
    }

    const controller = startRun();
    failedStepRef.current = null;
    setError(null);
    setResult(null);
    setStage("uploading");

    try {
      const response =
        multipartBytes(invoice) > INVOICE_SCAN_MULTIPART_MAX_BYTES
          ? await sendByStorage(invoice, controller.signal)
          : await sendMultipart(invoice, controller.signal);

      if (controller.signal.aborted) {
        return null;
      }

      clearTimer();
      setResult(response);
      setLimits(response.limits);
      setStage("done");
      return response;
    } catch (cause) {
      clearTimer();

      if (controller.signal.aborted || isAbortError(cause)) {
        return null;
      }

      const quotaLimits = limitsFromQuotaError(cause);

      if (quotaLimits) {
        setLimits(quotaLimits);
      }

      fail(
        cause instanceof Error && cause.message === STORAGE_UPLOAD_FAILED_MESSAGE
          ? { kind: "network", message: STORAGE_UPLOAD_FAILED_MESSAGE }
          : describeInvoiceScanError(cause),
        "upload",
      );
      return null;
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
    }
  }, [clearTimer, fail, sendByStorage, sendMultipart, startRun]);

  const retry = useCallback(async () => {
    if (failedStepRef.current === "prepare" && lastFileRef.current) {
      return prepare(lastFileRef.current);
    }

    return upload();
  }, [prepare, upload]);

  const abort = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    clearTimer();
    setError(null);
    failedStepRef.current = null;
    setStage("idle");
  }, [clearTimer]);

  const reset = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    clearTimer();
    lastFileRef.current = null;
    preparedRef.current = null;
    failedStepRef.current = null;
    setPrepared(null);
    setResult(null);
    setError(null);
    setStage("idle");
  }, [clearTimer]);

  const isBusy = stage === "preparing" || stage === "uploading" || stage === "reading";
  // Un 429 con `details` deja `limits` al día (quizá aún quedan páginas para una factura más corta).
  const quotaExhausted = limits !== null ? limits.remaining <= 0 : error?.kind === "quota";

  return {
    abort,
    error,
    isBusy,
    limits,
    prepare,
    prepared,
    quotaExhausted,
    reset,
    result,
    retry,
    stage,
    upload,
  };
}
