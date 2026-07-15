"use client";

import { useCallback, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";

import { Button } from "@/shared/components/Button";
import { Modal } from "@/shared/components/Modal";
import {
  cropImageToBlob,
  PRODUCT_IMAGE_ASPECT,
} from "@/shared/utils/cropImageToBlob";
import { removeImageBackground } from "@/shared/utils/removeImageBackground";
import { cn } from "@/shared/utils/cn";

type ImageCropModalProps = {
  imageSrc: string | null;
  onConfirm: (blob: Blob) => void | Promise<void>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
};

export function ImageCropModal({
  imageSrc,
  onConfirm,
  onOpenChange,
  open,
}: ImageCropModalProps) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [removeBackgroundEnabled, setRemoveBackgroundEnabled] = useState(false);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [progressMessage, setProgressMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const onCropComplete = useCallback((_area: Area, pixels: Area) => {
    setCroppedAreaPixels(pixels);
  }, []);

  async function handleConfirm(close: () => void) {
    if (!imageSrc || !croppedAreaPixels) {
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    setProgressMessage("Recortando imagen...");

    try {
      let blob = await cropImageToBlob(imageSrc, croppedAreaPixels);

      if (removeBackgroundEnabled) {
        blob = await removeImageBackground(blob, setProgressMessage);
      }

      await onConfirm(blob);
      close();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "No se pudo procesar la imagen.",
      );
    } finally {
      setIsSubmitting(false);
      setProgressMessage(null);
    }
  }

  return (
    <Modal
      contentClassName="max-w-2xl"
      description="Ajusta el encuadre en formato 4:3. Puedes quitar el fondo con IA en el navegador (opcional)."
      footer={({ close }) => (
        <>
          <Button disabled={isSubmitting} onClick={close} type="button" variant="outline">
            Cancelar
          </Button>
          <Button
            disabled={isSubmitting || !imageSrc}
            onClick={() => void handleConfirm(close)}
            type="button"
          >
            {isSubmitting ? "Procesando..." : "Usar imagen"}
          </Button>
        </>
      )}
      onOpenChange={onOpenChange}
      open={open}
      title="Recortar imagen"
    >
      <div className="flex flex-col gap-4">
        <div
          className={cn(
            "relative aspect-[4/3] overflow-hidden rounded-xl",
            removeBackgroundEnabled
              ? "bg-[linear-gradient(45deg,#cbd5e1_25%,transparent_25%,transparent_75%,#cbd5e1_75%,#cbd5e1),linear-gradient(45deg,#cbd5e1_25%,transparent_25%,transparent_75%,#cbd5e1_75%,#cbd5e1)] bg-[length:16px_16px] bg-[position:0_0,8px_8px] dark:bg-[linear-gradient(45deg,#334155_25%,transparent_25%,transparent_75%,#334155_75%,#334155),linear-gradient(45deg,#334155_25%,transparent_25%,transparent_75%,#334155_75%,#334155)]"
              : "bg-surface-container",
          )}
        >
          {imageSrc ? (
            <Cropper
              aspect={PRODUCT_IMAGE_ASPECT}
              crop={crop}
              image={imageSrc}
              onCropChange={setCrop}
              onCropComplete={onCropComplete}
              onZoomChange={setZoom}
              zoom={zoom}
            />
          ) : null}
        </div>
        <label className="flex flex-col gap-2 text-sm text-on-surface-variant">
          Zoom
          <input
            className="w-full accent-primary"
            disabled={isSubmitting}
            max={3}
            min={1}
            onChange={(event) => setZoom(Number(event.target.value))}
            step={0.05}
            type="range"
            value={zoom}
          />
        </label>
        <label className="flex items-start gap-3 rounded-lg border border-border/60 bg-surface-container-low p-3 text-sm">
          <input
            checked={removeBackgroundEnabled}
            className="mt-1 accent-primary"
            disabled={isSubmitting}
            onChange={(event) => setRemoveBackgroundEnabled(event.target.checked)}
            type="checkbox"
          />
          <span className="flex flex-col gap-1">
            <span className="font-medium text-foreground">Quitar fondo (IA en el navegador)</span>
            <span className="text-on-surface-variant">
              Opcional. La primera vez puede tardar unos segundos mientras descarga el modelo.
              Exporta PNG con transparencia.
            </span>
          </span>
        </label>
        {progressMessage ? (
          <p className="text-sm text-muted-foreground">{progressMessage}</p>
        ) : null}
        {errorMessage ? (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {errorMessage}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
