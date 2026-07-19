"use client";

import { BrowserMultiFormatReader, type IScannerControls } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/shared/utils/cn";

const SCAN_COOLDOWN_MS = 2200;
const START_DELAY_MS = 120;

type PosCameraBarcodeScannerProps = {
  className?: string;
  onDetected: (code: string) => void;
  /** Ignore detections while looking up a product (camera stays on). */
  paused?: boolean;
};

function createReader() {
  const hints = new Map<DecodeHintType, unknown>();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.EAN_13,
    BarcodeFormat.EAN_8,
    BarcodeFormat.UPC_A,
    BarcodeFormat.UPC_E,
    BarcodeFormat.CODE_128,
    BarcodeFormat.CODE_39,
    BarcodeFormat.QR_CODE,
    BarcodeFormat.ITF,
  ]);

  return new BrowserMultiFormatReader(hints, {
    delayBetweenScanAttempts: 350,
    delayBetweenScanSuccess: 1800,
    tryPlayVideoTimeout: 8000,
  });
}

function cameraErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "Permiso de camara denegado. Activalo en el navegador para escanear.";
  }
  if (error instanceof DOMException && error.name === "NotFoundError") {
    return "No se encontro una camara disponible en este dispositivo.";
  }
  if (error instanceof DOMException && error.name === "NotReadableError") {
    return "La camara esta en uso por otra aplicacion. Cierra esa app e intenta de nuevo.";
  }
  return "No se pudo iniciar la camara. Usa HTTPS o localhost e intenta de nuevo.";
}

function waitForVideoFrame(
  video: HTMLVideoElement,
  signal: AbortSignal,
): Promise<void> {
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const onReady = () => {
      if (video.videoWidth > 0) {
        cleanup();
        resolve();
      }
    };

    const onAbort = () => {
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    };

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      video.removeEventListener("loadedmetadata", onReady);
      video.removeEventListener("loadeddata", onReady);
      signal.removeEventListener("abort", onAbort);
    };

    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for camera frame."));
    }, 8000);

    video.addEventListener("loadedmetadata", onReady);
    video.addEventListener("loadeddata", onReady);
    signal.addEventListener("abort", onAbort);
    onReady();
  });
}

export function PosCameraBarcodeScanner({
  className,
  onDetected,
  paused = false,
}: PosCameraBarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onDetectedRef = useRef(onDetected);
  const pausedRef = useRef(paused);
  const lastCodeRef = useRef("");
  const lastAtRef = useRef(0);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(true);

  useEffect(() => {
    onDetectedRef.current = onDetected;
  }, [onDetected]);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    const abort = new AbortController();
    const controlsRef: { current?: IScannerControls } = {};
    let stream: MediaStream | undefined;
    const reader = createReader();

    void (async () => {
      try {
        // Let the dialog finish layout before touching getUserMedia/play().
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, START_DELAY_MS);
        });
        if (abort.signal.aborted) {
          return;
        }

        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        });

        if (abort.signal.aborted) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        video.srcObject = stream;
        video.muted = true;
        video.playsInline = true;

        await video.play();
        await waitForVideoFrame(video, abort.signal);

        if (abort.signal.aborted) {
          return;
        }

        // Video is already playing with a live stream; only start the decode loop.
        controlsRef.current = await reader.decodeFromVideoElement(
          video,
          (result, _error) => {
            if (!result || abort.signal.aborted || pausedRef.current) {
              return;
            }

            const text = result.getText().trim();
            if (!text) {
              return;
            }

            const now = Date.now();
            if (
              text === lastCodeRef.current &&
              now - lastAtRef.current < SCAN_COOLDOWN_MS
            ) {
              return;
            }

            lastCodeRef.current = text;
            lastAtRef.current = now;
            onDetectedRef.current(text);
          },
        );

        if (abort.signal.aborted) {
          controlsRef.current.stop();
          return;
        }

        setIsStarting(false);
      } catch (error) {
        if (abort.signal.aborted) {
          return;
        }
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        setCameraError(cameraErrorMessage(error));
        setIsStarting(false);
      }
    })();

    return () => {
      abort.abort();
      controlsRef.current?.stop();

      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }

      const media = video.srcObject;
      if (media instanceof MediaStream) {
        media.getTracks().forEach((track) => track.stop());
      }
      video.srcObject = null;
    };
  }, []);

  return (
    <div className={cn("space-y-3", className)}>
      <div className="relative overflow-hidden rounded-xl border border-border bg-slate-950 dark:border-slate-700">
        <video
          ref={videoRef}
          className="aspect-[4/3] w-full bg-slate-950 object-cover"
          muted
          playsInline
        />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-28 w-[78%] max-w-sm rounded-lg border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
        </div>
        {isStarting && !cameraError ? (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-950/70 text-sm text-white">
            Iniciando camara...
          </div>
        ) : null}
        {paused && !cameraError ? (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-950/60 text-sm text-white">
            Buscando producto...
          </div>
        ) : null}
      </div>

      {cameraError ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {cameraError}
        </p>
      ) : (
        <p className="text-center text-xs text-muted-foreground">
          Apunta al codigo de barras o QR. Al leerlo se agrega el producto como con el lector USB.
        </p>
      )}
    </div>
  );
}
