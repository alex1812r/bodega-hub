"use client";

import { ImagePlus, Trash2 } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/shared/components/Button";
import { ImageCropModal } from "@/shared/components/ImageCropModal";
import {
  readFileAsDataUrl,
  validateProductImageFile,
} from "@/shared/utils/cropImageToBlob";
import { cn } from "@/shared/utils/cn";

type ProductImageUploadFieldProps = {
  className?: string;
  disabled?: boolean;
  imageUrl?: string | null;
  isUploading?: boolean;
  onPendingBlobChange?: (blob: Blob | null) => void;
  onRemove?: () => void | Promise<void>;
  onUpload?: (blob: Blob) => void | Promise<void>;
  productId?: string;
};

export function ProductImageUploadField({
  className,
  disabled = false,
  imageUrl,
  isUploading = false,
  onPendingBlobChange,
  onRemove,
  onUpload,
}: ProductImageUploadFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(imageUrl ?? null);
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [cropOpen, setCropOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    setPreviewUrl(imageUrl ?? null);
  }, [imageUrl]);

  useEffect(() => {
    return () => {
      if (previewUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  async function handleFileSelected(file: File) {
    const validationError = validateProductImageFile(file);

    if (validationError) {
      setErrorMessage(validationError);
      return;
    }

    setErrorMessage(null);
    const dataUrl = await readFileAsDataUrl(file);
    setCropSrc(dataUrl);
    setCropOpen(true);
  }

  async function handleCropConfirm(blob: Blob) {
    const nextPreview = URL.createObjectURL(blob);
    setPreviewUrl((current) => {
      if (current?.startsWith("blob:")) {
        URL.revokeObjectURL(current);
      }

      return nextPreview;
    });

    if (onUpload) {
      await onUpload(blob);
      return;
    }

    onPendingBlobChange?.(blob);
  }

  async function handleRemove() {
    setErrorMessage(null);

    if (previewUrl?.startsWith("blob:")) {
      URL.revokeObjectURL(previewUrl);
    }

    setPreviewUrl(null);
    onPendingBlobChange?.(null);

    if (onRemove) {
      await onRemove();
    }
  }

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <span className="text-sm font-medium text-foreground">Imagen del producto</span>
      <div className="relative aspect-[4/3] w-full max-w-xs overflow-hidden rounded-xl border border-border bg-surface-container">
        {previewUrl ? (
          <Image
            alt="Vista previa del producto"
            className="size-full object-cover"
            fill
            sizes="(max-width: 320px) 100vw, 320px"
            src={previewUrl}
            unoptimized={previewUrl.startsWith("blob:")}
          />
        ) : (
          <div className="flex size-full items-center justify-center text-sm text-muted-foreground">
            Sin imagen
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={disabled || isUploading}
          onClick={() => inputRef.current?.click()}
          size="sm"
          type="button"
          variant="outline"
        >
          <ImagePlus aria-hidden className="size-4" />
          {previewUrl ? "Cambiar imagen" : "Subir imagen"}
        </Button>
        {previewUrl ? (
          <Button
            disabled={disabled || isUploading}
            onClick={() => void handleRemove()}
            size="sm"
            type="button"
            variant="ghost"
          >
            <Trash2 aria-hidden className="size-4" />
            Quitar
          </Button>
        ) : null}
      </div>
      <input
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        disabled={disabled || isUploading}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";

          if (file) {
            void handleFileSelected(file);
          }
        }}
        ref={inputRef}
        type="file"
      />
      {isUploading ? (
        <p className="text-sm text-muted-foreground">Subiendo imagen...</p>
      ) : null}
      {errorMessage ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {errorMessage}
        </p>
      ) : null}
      <ImageCropModal
        imageSrc={cropSrc}
        onConfirm={handleCropConfirm}
        onOpenChange={setCropOpen}
        open={cropOpen}
      />
    </div>
  );
}
